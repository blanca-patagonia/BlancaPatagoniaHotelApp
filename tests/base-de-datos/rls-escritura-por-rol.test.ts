import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { clienteAnonimo, clienteDePrueba } from '../apoyo/db'
import {
  crearLosCuatroRoles,
  crearUsuarioSinRol,
  hayRoles,
  limpiarUsuarios,
  type UsuarioDePrueba,
} from '../apoyo/roles'
import type { Rol } from '@/lib/domain/roles'

/**
 * Auditoría RLS · **escritura** por rol.
 *
 * ── Por qué hace falta además del de lectura ─────────────────────────────────
 *
 * `rls-por-rol.test.ts` audita los `select`. Que housekeeping no pueda **leer**
 * `pagos` no dice nada sobre si puede **insertarlos**: son políticas distintas, y
 * en Postgres una tabla puede negar la lectura y permitir la escritura sin que nada
 * chille.
 *
 * De las 82 políticas del esquema, 41 son `select` y 41 gobiernan escritura (30
 * `all`, 6 `insert`, 3 `update`, 2 `delete`). El otro test cubre las primeras 41.
 * Éste cubre las que importan de las otras 41.
 *
 * ── Por qué la amenaza es real y no teórica ──────────────────────────────────
 *
 * PostgREST está expuesto al navegador: la clave publicable viaja en el cliente y
 * cualquiera con una sesión válida puede mandar un `PATCH /rest/v1/unidades` a mano,
 * sin pasar por ninguna pantalla ni por ninguna Server Action. Que la app solo
 * escriba dos columnas es irrelevante — lo que se puede escribir lo decide la
 * política, y por eso hay que probarla contra la base.
 *
 * ── Por qué es dirigido y no exhaustivo, dicho de frente ─────────────────────
 *
 * Una matriz completa sería 51 tablas × 4 roles × 3 operaciones = 612 casos, y cada
 * `insert` necesita una fila válida para *esa* tabla (claves foráneas, `not null`,
 * enums). Sería mucho andamiaje frágil para cubrir sobre todo tablas de catálogo
 * donde el peor caso es que alguien cargue una promoción de más.
 *
 * Entonces se eligen los casos por consecuencia, no por cobertura: escalada de
 * privilegio, dinero, inventario y el borde público. **No es una matriz completa y
 * no se presenta como tal**; lo que no está acá sigue sin auditar, y ésa es la
 * información honesta.
 *
 * ── Cómo se detecta un `update` negado ───────────────────────────────────────
 *
 * Ojo con esto, porque es la trampa del archivo: un `update` que RLS bloquea **no
 * devuelve error**. El `using` de la política filtra las filas antes de tocarlas,
 * así que la sentencia no encuentra nada que actualizar y responde «éxito, cero
 * filas». Comprobar `{ error }` daría verde siempre.
 *
 * La única verificación válida es leer el valor de vuelta con `service_role` y
 * confirmar que no cambió. Eso es lo que hace `noPuedeActualizar`.
 */
describe.skipIf(!hayRoles)('auditoría RLS · escritura por rol', () => {
  const sufijo = `esc-${process.pid}`

  let usuarios: Record<Rol, UsuarioDePrueba>
  let sinRol: UsuarioDePrueba

  /**
   * Una unidad de la base sobre la que se hacen los intentos.
   *
   * Se guardan **todas** las columnas que algún caso intenta escribir, para poder
   * dejarla como estaba en el `afterAll`. Si falta una y un intento tiene éxito, el
   * valor queda puesto y contamina las corridas siguientes.
   */
  let unidad: {
    id: string
    nombre: string
    estado: string
    activo: boolean
    tipo_unidad_id: string
    piso: string
    bloque: string
    orden: number
  }
  /** Un tipo de unidad distinto al de `unidad`, para intentar reclasificarla. */
  let otroTipoId: string
  /** Una reserva y un producto, para los intentos sobre dinero. */
  let reservaId: string

  /**
   * Lo que creó esta suite porque la base estaba vacía, para poder borrarlo al final.
   *
   * Queda en `null` cuando la reserva ya existía: ahí no hay nada que limpiar, y
   * borrar una reserva ajena sería peor que no limpiar.
   */
  let creadoAca: { reservaId: string; huespedId: string } | null = null
  let productoId: string

  /**
   * `anon` como si fuera un `UsuarioDePrueba`.
   *
   * Los ayudantes piden esa forma para poder nombrar al culpable en el mensaje de
   * error. `anon` no tiene rol ni id; el `rol` acá es solo la etiqueta del mensaje.
   */
  const comoAnon = (): UsuarioDePrueba =>
    ({ rol: 'anon' as unknown as Rol, id: '', email: '', cliente: clienteAnonimo() })

  beforeAll(async () => {
    usuarios = await crearLosCuatroRoles(sufijo)
    sinRol = await crearUsuarioSinRol(sufijo)

    const admin = clienteDePrueba()

    // `order` explícito: sin él, `limit(1)` devuelve una fila cualquiera y cada
    // corrida podría tomar una unidad distinta. Eso escondió un arrastre de estado
    // entre corridas hasta que la suite completa lo destapó.
    const { data: unidades, error: eUnidades } = await admin
      .from('unidades')
      .select('id, nombre, estado, activo, tipo_unidad_id, piso, bloque, orden')
      .order('nombre')
      .limit(1)
    if (eUnidades) throw new Error(`No se pudieron leer unidades: ${eUnidades.message}`)
    if (!unidades?.length) {
      throw new Error('No hay unidades en la base. Corré `npx supabase db reset` para el seed.')
    }
    unidad = unidades[0]

    const { data: tipos, error: eTipos } = await admin
      .from('tipos_unidad')
      .select('id')
      .neq('id', unidad.tipo_unidad_id)
      .limit(1)
    if (eTipos) throw new Error(`No se pudieron leer tipos: ${eTipos.message}`)
    if (!tipos?.length) throw new Error('Hace falta más de un tipo de unidad para esta auditoría.')
    otroTipoId = tipos[0].id

    /*
      La reserva se CREA si no hay ninguna.

      El seed siembra **solo catálogo** —tipos, unidades, temporadas, tarifas,
      promociones, políticas—: ni una reserva ni un huésped. Así que «corré el seed»
      era un consejo que no arreglaba nada, y en un entorno limpio como el del CI esta
      auditoría entera abortaba antes del primer caso.
    */
    const { data: reservas, error: eReservas } = await admin.from('reservas').select('id').limit(1)
    if (eReservas) throw new Error(`No se pudieron leer reservas: ${eReservas.message}`)

    if (reservas?.length) {
      reservaId = reservas[0].id
    } else {
      const { data: huesped, error: eHuesped } = await admin
        .from('huespedes')
        .insert({ nombre: 'Auditoría', apellido: `Escritura${sufijo}` })
        .select('id')
        .single<{ id: string }>()
      if (eHuesped) throw new Error(`No se pudo crear el huésped: ${eHuesped.message}`)

      const { data: creada, error: eReserva } = await admin
        .from('reservas')
        .insert({ huesped_id: huesped.id, estado: 'checkout', total: 100 })
        .select('id')
        .single<{ id: string }>()
      if (eReserva) throw new Error(`No se pudo crear la reserva: ${eReserva.message}`)

      reservaId = creada.id
      creadoAca = { reservaId: creada.id, huespedId: huesped.id }
    }

    const { data: productos, error: eProductos } = await admin
      .from('productos_servicios')
      .select('id')
      .limit(1)
    if (eProductos) throw new Error(`No se pudieron leer productos: ${eProductos.message}`)
    if (!productos?.length) throw new Error('No hay productos en la base. Corré el seed.')
    productoId = productos[0].id
  }, 60_000)

  afterAll(async () => {
    // La unidad se deja como estaba: si algún intento pasó —o sea, si el test
    // encontró un agujero— la fila quedó modificada y el resto de la suite la usa.
    const admin = clienteDePrueba()
    if (unidad) {
      const { id, ...original } = unidad
      const { error } = await admin
        .from('unidades')
        .update({ ...original, asignada_a: null })
        .eq('id', id)
      // Si la restauración falla hay que saberlo: la base queda sucia para la
      // próxima corrida, que es justamente lo que hizo fallar esta suite una vez.
      if (error) throw new Error(`No se pudo restaurar la unidad ${id}: ${error.message}`)
    }

    // La reserva y el huésped, sólo si los creó esta suite. Primero los hijos: la
    // mayoría de los intentos de esta auditoría tienen que fallar —son casos
    // negativos— pero si alguno pasó, o sea si encontró un agujero, dejó una fila
    // colgando que bloquearía el borrado.
    if (creadoAca) {
      for (const tabla of ['pagos', 'consumos', 'facturas']) {
        await admin.from(tabla).delete().eq('reserva_id', creadoAca.reservaId)
      }

      const { error: eReserva } = await admin.from('reservas').delete().eq('id', creadoAca.reservaId)
      if (eReserva) throw new Error(`No se pudo borrar la reserva de prueba: ${eReserva.message}`)

      const { error: eHuesped } = await admin
        .from('huespedes')
        .delete()
        .eq('id', creadoAca.huespedId)
      if (eHuesped) throw new Error(`No se pudo borrar el huésped de prueba: ${eHuesped.message}`)
    }

    await limpiarUsuarios()
  })

  // ── Ayudantes ───────────────────────────────────────────────────────────────

  /**
   * Lee una columna con `service_role`, con el nombre decidido en tiempo de
   * ejecución.
   *
   * El cliente de Supabase infiere el tipo de la fila a partir del **literal** que
   * se le pasa a `select`. Con un nombre dinámico no puede, y tipa `data` como
   * `GenericStringError`; de ahí el paso por `unknown`, que está para eso y no para
   * tapar un tipo mal puesto. Se centraliza acá para que la conversión exista una
   * sola vez en el archivo.
   */
  async function leerColumna(tabla: string, id: string, columna: string): Promise<unknown> {
    const admin = clienteDePrueba()
    const { data, error } = await admin.from(tabla).select(columna).eq('id', id).single()
    if (error) throw new Error(`No se pudo leer ${tabla}.${columna}: ${error.message}`)
    return (data as unknown as Record<string, unknown>)[columna]
  }

  /**
   * Intenta un `update` y verifica **con `service_role`** que la columna quedó
   * igual que antes del intento.
   *
   * No mira `{ error }` a propósito: ver el comentario de arriba. Un `update`
   * bloqueado por RLS devuelve éxito con cero filas.
   *
   * ⚠️ Compara contra el valor **previo**, y no contra «distinto del que se
   * intentó». La primera versión hacía lo segundo y tenía dos agujeros: si el valor
   * de la fila ya coincidía con el que se intenta escribir, el test fallaba sin que
   * nadie hubiera escrito nada; y al correr toda la suite, una corrida anterior que
   * sí había logrado el cambio dejaba el valor puesto y el test seguía en rojo
   * aunque el arreglo funcionara. Pasó de verdad con `unidades.piso`: en verde
   * corriendo el archivo solo, en rojo con `npm test`.
   *
   * Leer antes y exigir igualdad es además la afirmación que se quiere: la fila
   * **no cambió**, sin importar qué tenía.
   */
  async function noPuedeActualizar(
    quien: UsuarioDePrueba,
    tabla: string,
    id: string,
    cambio: Record<string, unknown>,
  ): Promise<void> {
    const columna = Object.keys(cambio)[0]
    const antes = await leerColumna(tabla, id, columna)

    // Si coincidieran, el intento no probaría nada: hay que arreglar el caso, no
    // dejarlo pasar en silencio.
    expect(
      antes,
      `El valor de ${tabla}.${columna} ya es el que se intenta escribir: el caso no prueba nada`,
    ).not.toBe(cambio[columna])

    await quien.cliente.from(tabla).update(cambio).eq('id', id)

    expect(
      await leerColumna(tabla, id, columna),
      `${quien.rol} logró escribir ${tabla}.${columna}`,
    ).toBe(antes)
  }

  /** Verifica que un `update` legítimo SÍ funcione: el arreglo no puede romperlo. */
  async function siPuedeActualizar(
    quien: UsuarioDePrueba,
    tabla: string,
    id: string,
    cambio: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await quien.cliente.from(tabla).update(cambio).eq('id', id)
    expect(error, `${quien.rol} no pudo hacer lo que le corresponde en ${tabla}`).toBeNull()

    const columna = Object.keys(cambio)[0]
    expect(await leerColumna(tabla, id, columna)).toBe(cambio[columna])
  }

  /**
   * Intenta un `insert` y verifica que no entró.
   *
   * Un `insert` bloqueado por RLS **sí** devuelve error (42501, «new row violates
   * row-level security policy»), a diferencia del `update`. Igual se comprueba
   * contando: si mañana alguien agrega un `with_check` permisivo, el conteo lo ve
   * aunque el error desaparezca.
   */
  async function noPuedeInsertar(
    quien: UsuarioDePrueba,
    tabla: string,
    fila: Record<string, unknown>,
  ): Promise<void> {
    const admin = clienteDePrueba()
    const { count: antes } = await admin.from(tabla).select('*', { count: 'exact', head: true })

    const { error } = await quien.cliente.from(tabla).insert(fila)
    expect(error, `${quien.rol} logró insertar en ${tabla} sin recibir error`).not.toBeNull()

    const { count: despues } = await admin.from(tabla).select('*', { count: 'exact', head: true })
    expect(despues, `${quien.rol} agregó una fila a ${tabla}`).toBe(antes)
  }

  // ── 1. Escalada de privilegio ───────────────────────────────────────────────
  //
  // El caso más grave posible: que alguien se ascienda solo. `perfiles` tiene una
  // política `select` «cada uno ve el suyo», así que la fila es alcanzable; lo único
  // que impide el `update` es que la política de escritura sea admin-only.

  for (const rol of ['gerencia', 'recepcion', 'housekeeping'] as const) {
    it(`${rol} NO puede ascenderse a admin`, async () => {
      await noPuedeActualizar(usuarios[rol], 'perfiles', usuarios[rol].id, { rol: 'admin' })
    })
  }

  it('un usuario sin rol no puede darse uno', async () => {
    await noPuedeActualizar(sinRol, 'perfiles', sinRol.id, { rol: 'recepcion' })
  })

  it('recepcion no puede reactivar un perfil dado de baja', async () => {
    // `rol_actual()` devuelve null si el perfil está inactivo: reactivarse sería la
    // vuelta al sistema de alguien a quien se le dio de baja.
    await noPuedeActualizar(usuarios.recepcion, 'perfiles', usuarios.housekeeping.id, {
      nombre: 'Renombrado por recepcion',
    })
  })

  // ── 2. Inventario: qué puede tocar housekeeping de una unidad ───────────────
  //
  // La política `unidades: housekeeping actualiza` dice
  // `rol_actual() = 'housekeeping'` y nada más. RLS filtra **filas**, no columnas,
  // así que autoriza cualquier columna de la tabla.
  //
  // Lo legítimo son dos: `estado` (marcar limpia/sucia) y `asignada_a` (la gobernanta
  // reparte el trabajo, y también es rol `housekeeping`). Las demás son inventario y
  // tarifa.

  it('housekeeping SÍ puede marcar una unidad como sucia', async () => {
    await siPuedeActualizar(usuarios.housekeeping, 'unidades', unidad.id, { estado: 'sucia' })
  })

  it('housekeeping SÍ puede asignar la limpieza a alguien', async () => {
    await siPuedeActualizar(usuarios.housekeeping, 'unidades', unidad.id, {
      asignada_a: usuarios.housekeeping.id,
    })
  })

  it('housekeeping NO puede reclasificar una unidad a otro tipo', async () => {
    // El peor caso de la tabla: `tipo_unidad_id` es de donde salen la capacidad y la
    // tarifa. Convertir una single en suite cambia lo que el sistema cobra.
    await noPuedeActualizar(usuarios.housekeeping, 'unidades', unidad.id, {
      tipo_unidad_id: otroTipoId,
    })
  })

  it('housekeeping NO puede sacar una unidad del inventario', async () => {
    // `activo = false` la retira de la disponibilidad: deja de venderse.
    await noPuedeActualizar(usuarios.housekeeping, 'unidades', unidad.id, { activo: false })
  })

  it('housekeeping NO puede renombrar una unidad', async () => {
    await noPuedeActualizar(usuarios.housekeeping, 'unidades', unidad.id, {
      nombre: 'Renombrada por housekeeping',
    })
  })

  it('housekeeping NO puede mover una unidad de piso', async () => {
    await noPuedeActualizar(usuarios.housekeeping, 'unidades', unidad.id, { piso: '99' })
  })

  it('recepcion no puede tocar las unidades', async () => {
    // No hay política de escritura para recepcion sobre `unidades`: el `all` es
    // admin+gerencia y el `update` suelto es housekeeping.
    await noPuedeActualizar(usuarios.recepcion, 'unidades', unidad.id, { estado: 'bloqueada' })
  })

  // ── 3. Dinero ───────────────────────────────────────────────────────────────

  it('housekeeping no puede registrar un pago', async () => {
    await noPuedeInsertar(usuarios.housekeeping, 'pagos', {
      reserva_id: reservaId,
      monto: 1,
      medio: 'efectivo',
    })
  })

  it('housekeeping no puede emitir una factura', async () => {
    await noPuedeInsertar(usuarios.housekeeping, 'facturas', {
      reserva_id: reservaId,
      numero: `INTRUSO-${sufijo}`,
      total: 1,
    })
  })

  it('housekeeping no puede cargar un consumo', async () => {
    await noPuedeInsertar(usuarios.housekeeping, 'consumos', {
      reserva_id: reservaId,
      producto_id: productoId,
      cantidad: 1,
      precio_unitario: 1,
    })
  })

  it('recepcion no puede cambiar una tarifa', async () => {
    // Las tarifas son admin+gerencia: quien cobra no fija el precio.
    const admin = clienteDePrueba()
    const { data } = await admin.from('tarifas').select('id, precio_rack').limit(1).single()
    await noPuedeActualizar(usuarios.recepcion, 'tarifas', data!.id, { precio_rack: 1 })
  })

  // ── 3b. Costos del canal (migración 0049) ───────────────────────────────────
  //
  // La regla es más fina que «staff sí / staff no»: recepción **devenga** —el cargo
  // nace de importar el informe, que lo hace el mostrador— pero **no concilia**, que
  // es lo que mueve el libro mayor. Un rol que puede conciliar puede declarar
  // saldada una deuda con el canal.

  it('recepcion SÍ puede devengar un cargo del canal', async () => {
    // Tiene que poder: el devengo nace de importar el informe del extranet, y eso lo
    // hace el mostrador. Si esto fallara, importar dejaría la comisión sin registrar.
    const clave = `informe_reservas:comision:AUDIT-ESC-${sufijo}`
    const { error } = await usuarios.recepcion.cliente.from('canal_cargos').insert({
      canal: 'booking',
      concepto: 'comision',
      origen: 'informe_reservas',
      monto: 1,
      clave_idempotencia: clave,
    })
    expect(error, 'recepción no pudo devengar: importar quedaría sin registrar la comisión').toBeNull()

    // Se limpia con `service_role` porque recepción no puede borrar (es la política
    // que el caso de abajo verifica).
    await clienteDePrueba().from('canal_cargos').delete().eq('clave_idempotencia', clave)
  })

  it('recepcion NO puede conciliar un cargo del canal', async () => {
    // Conciliar es declarar que una deuda con el canal cierra, y eso mueve el libro
    // mayor. Es de gerencia.
    const admin = clienteDePrueba()

    /*
      El cargo se CREA acá.

      Antes se tomaba uno cualquiera y, si no había, se abortaba con «el backfill de
      la 0049 no corrió». Ese mensaje era falso: el backfill sí corre, pero sólo
      rellena los cargos de las comisiones **ya cargadas**, y en una base limpia no
      hay ninguna. Así que en CI el caso reventaba culpando a una migración sana.
    */
    const clave = `manual:comision:AUDIT-CONCILIAR-${sufijo}`
    const { data, error } = await admin
      .from('canal_cargos')
      .insert({
        canal: 'booking',
        concepto: 'comision',
        origen: 'manual',
        monto: 1,
        clave_idempotencia: clave,
      })
      .select('id, estado_conciliacion')
      .single<{ id: string; estado_conciliacion: string }>()
    if (error) throw new Error(`No se pudo sembrar el cargo: ${error.message}`)

    try {
      /*
        El `update` tiene que ser VÁLIDO para que el caso pruebe RLS.

        Desde la migración 0079 un cargo que sale de «devengado» exige firma
        (`canal_cargos_cierre_con_firma`). Mandar sólo `estado_conciliacion` haría
        fallar el update por restricción (23514) en vez de por política, y el caso
        pasaría verde sin haber probado nada de lo que dice probar.
      */
      await noPuedeActualizar(usuarios.recepcion, 'canal_cargos', data.id, {
        estado_conciliacion: data.estado_conciliacion === 'conciliado' ? 'devengado' : 'conciliado',
        conciliado_por: usuarios.recepcion.id,
        conciliado_en: new Date().toISOString(),
      })
    } finally {
      await admin.from('canal_cargos').delete().eq('clave_idempotencia', clave)
    }
  })

  it('gerencia SÍ puede conciliar, y la base le exige firma y motivo', async () => {
    /*
      La contracara del caso anterior, que faltaba: si nadie puede conciliar, el
      arreglo de P1-4 no sirve de nada y el test de arriba pasaría igual.

      Y de paso se verifican los dos `check` de la 0079, que son la única barrera
      real: la aplicación puede olvidarse de mandar el motivo, la base no.
    */
    const admin = clienteDePrueba()
    const clave = `manual:comision:AUDIT-CONCILIA-OK-${sufijo}`
    const { data, error } = await admin
      .from('canal_cargos')
      .insert({
        canal: 'booking',
        concepto: 'comision',
        origen: 'manual',
        monto: 1,
        clave_idempotencia: clave,
      })
      .select('id')
      .single<{ id: string }>()
    if (error) throw new Error(`No se pudo sembrar el cargo: ${error.message}`)

    try {
      // 1) Conciliar sin firma no entra, ni siquiera siendo gerencia.
      const { error: eSinFirma } = await usuarios.gerencia.cliente
        .from('canal_cargos')
        .update({ estado_conciliacion: 'conciliado' })
        .eq('id', data.id)
      expect(eSinFirma, 'se pudo cerrar la revisión sin decir quién la cerró').not.toBeNull()

      // 2) Disputar sin motivo tampoco.
      const { error: eSinMotivo } = await usuarios.gerencia.cliente
        .from('canal_cargos')
        .update({
          estado_conciliacion: 'en_disputa',
          conciliado_por: usuarios.gerencia.id,
          conciliado_en: new Date().toISOString(),
        })
        .eq('id', data.id)
      expect(eSinMotivo, 'se pudo abrir una disputa sin escribir por qué').not.toBeNull()

      // 3) Con todo, sí.
      await siPuedeActualizar(usuarios.gerencia, 'canal_cargos', data.id, {
        estado_conciliacion: 'en_disputa',
        conciliado_por: usuarios.gerencia.id,
        conciliado_en: new Date().toISOString(),
        nota_conciliacion: 'La comisión facturada no coincide con la del informe.',
      })
    } finally {
      await admin.from('canal_cargos').delete().eq('clave_idempotencia', clave)
    }
  })

  it('housekeeping no puede leer ni tocar la configuración del canal', async () => {
    // `canal_config` guarda el token del feed iCal de salida, que va en una URL.
    const admin = clienteDePrueba()

    /*
      La fila se asegura antes de probar nada.

      `canal_config` nace vacía —qué proveedor contabiliza el canal es una decisión
      del hotel, no algo que siembre una migración—. Este caso terminaba en
      `if (data) expect(...)`, así que en una base limpia **no verificaba nada y pasaba
      igual**: el peor resultado posible en una auditoría, porque queda registrado
      como comprobado.
    */
    const { count, error: eContar } = await admin
      .from('canal_config')
      .select('*', { count: 'exact', head: true })
      .eq('canal', 'booking')
    if (eContar) throw new Error(`No se pudo contar canal_config: ${eContar.message}`)

    const laCreoEsteTest = (count ?? 0) === 0
    if (laCreoEsteTest) {
      const { error } = await admin.from('canal_config').insert({ canal: 'booking' })
      if (error) throw new Error(`No se pudo sembrar canal_config: ${error.message}`)
    }

    try {
      const { error } = await usuarios.housekeeping.cliente
        .from('canal_config')
        .update({ comision_pct_pactada: 99 })
        .eq('canal', 'booking')
      // Un update bloqueado por RLS no da error: se verifica leyendo de vuelta.
      void error

      const { data } = await admin
        .from('canal_config')
        .select('comision_pct_pactada')
        .eq('canal', 'booking')
        .maybeSingle<{ comision_pct_pactada: number | null }>()

      expect(data, 'sin la fila el caso no verifica nada').not.toBeNull()
      expect(Number(data!.comision_pct_pactada ?? 0)).not.toBe(99)
    } finally {
      if (laCreoEsteTest) await admin.from('canal_config').delete().eq('canal', 'booking')
    }
  })

  it('recepcion no puede cargar una cotización de divisa', async () => {
    // La cotización decide a cuánto se convierte todo lo que se cobra en pesos.
    await noPuedeInsertar(usuarios.recepcion, 'cotizaciones', {
      moneda: 'ARS',
      compra: 1,
      venta: 1,
      fuente: 'manual',
      obtenida_en: new Date(0).toISOString(),
    })
  })

  // ── 4. El borde público ─────────────────────────────────────────────────────
  //
  // `anon` lee el catálogo (tipos, tarifas, temporadas, promos activas) porque el
  // portal lo necesita. Leer no es escribir.

  it('anon no puede crear un tipo de unidad', async () => {
    await noPuedeInsertar(comoAnon(), 'tipos_unidad', {
      codigo: `INTRUSO-${sufijo}`,
      nombre: `Intruso ${sufijo}`,
      categoria: 'habitacion',
      capacidad_max: 1,
    })
  })

  it('anon no puede modificar una tarifa', async () => {
    const admin = clienteDePrueba()
    const { data } = await admin.from('tarifas').select('id, precio_rack').limit(1).single()
    await noPuedeActualizar(comoAnon(), 'tarifas', data!.id, { precio_rack: 1 })
  })

  // ── 5. Credenciales de terceros, integridad de estadías y datos personales ──
  //
  // Auditoría de calidad 2026-09-09: al medir la cobertura real de este archivo
  // contra `pg_policies` (112 políticas, 49 tablas con alguna política de
  // escritura) aparecieron 39 tablas con política de escritura y CERO caso acá.
  // No se cubren las 39 —el propio criterio de este archivo es por consecuencia,
  // no por cobertura, y la mayoría son catálogo de bajo riesgo (`promociones`,
  // `temporadas`...)—, pero estas tres SÍ entran en las categorías que el
  // archivo ya declara importantes: credenciales de terceros, integridad de
  // `estadias` (la tabla del anti-overbooking) y datos personales.

  it('recepcion NO puede escribir una conexión con un proveedor externo', async () => {
    // `conexiones_proveedores` (migración 0096) guarda tokens de OAuth2
    // CIFRADOS de la cuenta real de Mercado Pago o de Google del hotel. Es
    // `admin`/`gerencia` exclusivo — igual que la lectura (ver la matriz de
    // `rls-por-rol.test.ts`) pero acá importa más: escribir es lo que deja
    // conectar o desconectar una cuenta de cobro real.
    await noPuedeInsertar(usuarios.recepcion, 'conexiones_proveedores', {
      proveedor: 'mercadopago',
      tipo_conexion: 'oauth2',
    })
  })

  it('housekeeping NO puede escribir una conexión con un proveedor externo', async () => {
    await noPuedeInsertar(usuarios.housekeeping, 'conexiones_proveedores', {
      proveedor: 'google_mail',
      tipo_conexion: 'oauth2',
    })
  })

  it('housekeeping NO puede modificar el período de una estadía', async () => {
    // `estadias.periodo` es la columna que protege la restricción de exclusión
    // GiST del ADR 0002. La política de escritura es `admin/gerencia/recepcion`
    // —housekeeping queda afuera a propósito, porque no gestiona fechas de
    // estadía, solo el estado de limpieza de la unidad (ya cubierto arriba)—.
    //
    // La estadía se crea acá con `crear_reserva` (único camino que las hace
    // nacer) en vez de tomar una preexistente: en un CI limpio no hay ninguna,
    // y `.single()` ciego daba `null` → el test fallaba por el motivo equivocado.
    const admin = clienteDePrueba()
    const { data: u } = await admin
      .from('unidades')
      .select('id, tipo_unidad_id')
      .limit(1)
      .single<{ id: string; tipo_unidad_id: string }>()
    const { data: h } = await admin
      .from('huespedes')
      .insert({ apellido: `Periodo-${sufijo}`, nombre: 'Prueba' })
      .select('id')
      .single<{ id: string }>()
    const { data: r, error: eReserva } = await admin.rpc('crear_reserva', {
      p_huesped_id: h!.id,
      p_unidad_id: u!.id,
      p_tipo_unidad_id: u!.tipo_unidad_id,
      p_check_in: '2031-03-01',
      p_check_out: '2031-03-03',
      p_huespedes: 1,
      p_precio_noche: 100,
      p_total: 200,
      p_canal: 'directo',
      p_tarifa_tipo: 'rack',
      p_estado: 'confirmada',
    })
    if (eReserva) throw new Error(`no se pudo montar la reserva: ${eReserva.message}`)
    const reservaId = (r as { id: string }).id

    try {
      const { data: est } = await admin
        .from('estadias')
        .select('id')
        .eq('reserva_id', reservaId)
        .single<{ id: string }>()
      await noPuedeActualizar(usuarios.housekeeping, 'estadias', est!.id, {
        periodo: '[2031-04-01,2031-04-03)',
      })
    } finally {
      await admin.from('reservas').delete().eq('id', reservaId)
      await admin.from('huespedes').delete().eq('id', h!.id)
    }
  })

  it('housekeeping NO puede modificar los datos de un huésped', async () => {
    // Mismo criterio que la lectura (ADR 0005): housekeeping no maneja datos
    // personales. La política de escritura es `admin/gerencia/recepcion`.
    const admin = clienteDePrueba()
    const { data } = await admin.from('huespedes').select('id, nombre').limit(1).single<{
      id: string
      nombre: string
    }>()
    await noPuedeActualizar(usuarios.housekeeping, 'huespedes', data!.id, {
      nombre: `Alterado-${sufijo}`,
    })
  })

  /*
    ── Borrado de dinero (migración 0061) ─────────────────────────────────────

    El caso que motivó la migración, reproducido: con una sesión de recepción se
    creó una reserva confirmada con USD 150 de seña y un consumo, y se la borró
    por PostgREST. Se fueron el pago, el consumo y la estadía —arrastrados por
    las cascadas de las 0009 y 0010— y del borrado de la reserva no quedaba
    rastro, porque su trigger de auditoría era `after update`.

    Ninguna pantalla ofrece ese borrado: es alcanzable solo con una llamada
    directa a la API. Por eso el test va acá y no en los de Server Actions.
  */
  describe('borrar una reserva con plata encima', () => {
    /** Monta una reserva confirmada con un pago aprobado. Devuelve sus ids. */
    async function reservaConPago() {
      const admin = clienteDePrueba()
      const { data: u } = await admin
        .from('unidades')
        .select('id, tipo_unidad_id')
        .limit(1)
        .single()
      const { data: h } = await admin
        .from('huespedes')
        .insert({ apellido: `Borrado-${sufijo}`, nombre: 'Prueba' })
        .select('id')
        .single()
      const { data: r, error } = await admin.rpc('crear_reserva', {
        p_huesped_id: (h as { id: string }).id,
        p_unidad_id: (u as { id: string }).id,
        p_tipo_unidad_id: (u as { tipo_unidad_id: string }).tipo_unidad_id,
        p_check_in: '2029-05-01',
        p_check_out: '2029-05-03',
        p_huespedes: 1,
        p_precio_noche: 100,
        p_total: 200,
        p_canal: 'directo',
        p_tarifa_tipo: 'rack',
        p_estado: 'confirmada',
      })
      if (error) throw new Error(`no se pudo montar la reserva: ${error.message}`)
      const reservaId = (r as { id: string }).id
      await admin.from('pagos').insert({
        reserva_id: reservaId,
        medio: 'efectivo',
        tipo: 'senia',
        monto: 150,
        estado: 'aprobado',
      })
      return { reservaId, huespedId: (h as { id: string }).id }
    }

    async function limpiarReserva(ids: { reservaId: string; huespedId: string }) {
      const admin = clienteDePrueba()
      await admin.from('reservas').delete().eq('id', ids.reservaId)
      await admin.from('huespedes').delete().eq('id', ids.huespedId)
    }

    for (const rol of ['admin', 'gerencia', 'recepcion', 'housekeeping'] as Rol[]) {
      it(`${rol} NO puede borrar una reserva`, async () => {
        const ids = await reservaConPago()
        try {
          const { error } = await usuarios[rol].cliente
            .from('reservas')
            .delete()
            .eq('id', ids.reservaId)

          expect(error?.code, `${rol} pudo borrar una reserva con un pago encima`).toBe('42501')

          // Y lo que importa de verdad: la plata sigue ahí.
          const admin = clienteDePrueba()
          const { count } = await admin
            .from('pagos')
            .select('*', { count: 'exact', head: true })
            .eq('reserva_id', ids.reservaId)
          expect(count, 'el pago desapareció').toBe(1)
        } finally {
          await limpiarReserva(ids)
        }
      })
    }

    it('el borrado por service_role SÍ queda auditado', async () => {
      /*
        La cascada se dejó a propósito para el rol privilegiado (ver la 0061): una
        limpieza legítima tiene que llevarse los hijos. Lo que no puede pasar es
        que se lleve la plata sin dejar constancia.
      */
      const admin = clienteDePrueba()
      const ids = await reservaConPago()

      const { count: antes } = await admin
        .from('auditoria')
        .select('*', { count: 'exact', head: true })
        .eq('tabla', 'reservas')
        .eq('accion', 'DELETE')

      await admin.from('reservas').delete().eq('id', ids.reservaId)

      const { count: despues } = await admin
        .from('auditoria')
        .select('*', { count: 'exact', head: true })
        .eq('tabla', 'reservas')
        .eq('accion', 'DELETE')

      expect(
        (despues ?? 0) - (antes ?? 0),
        'se borró una reserva y no quedó registro en auditoría',
      ).toBe(1)

      await admin.from('huespedes').delete().eq('id', ids.huespedId)
    })

    it('la baja de una agencia es lógica: no se puede borrar la fila', async () => {
      const admin = clienteDePrueba()
      const { data } = await admin
        .from('agencias')
        .insert({ nombre: `Baja-${sufijo}`, tipo: 'agencia' })
        .select('id')
        .single()
      const id = (data as { id: string }).id
      try {
        const { error } = await usuarios.admin.cliente.from('agencias').delete().eq('id', id)
        expect(error?.code, 'se pudo borrar una agencia con su cuenta corriente').toBe('42501')
      } finally {
        await admin.from('agencias').delete().eq('id', id)
      }
    })
  })

  /*
    ── 6. Cuentas corrientes, comprobantes, contratos y catálogo (2026-10-20) ────

    Segunda pasada sobre las tablas con política de escritura y sin caso
    dirigido. Se eligieron las nueve de más consecuencia: plata (`notas_credito`,
    `movimientos_cuenta`, `movimientos_proveedor`, `movimientos_externos`),
    acuerdos firmados (`contratos`, `firmas`), el padrón de proveedores, el
    calendario de temporadas —de donde sale el precio de cada noche— y los
    acompañantes de una reserva (`reserva_huespedes`, datos personales).

    Dos reglas de esta sección que el resto del archivo no tenía:

    1. **Cada fila se siembra acá**, con `service_role`, y se borra en el
       `afterAll`. Nada de `if (contar(tabla) === 0)`: ésa es la trampa que dejó
       sin auditar `notas_credito` en la matriz de lectura (ver AGENTS.md).
    2. **Un `insert` negado tiene que fallar con 42501**, no con cualquier error.
       Si la fila fuera inválida (falta una columna, rompe un `check`), el
       intento fallaría por eso y el caso pasaría en verde sin haber probado
       ninguna política. Por eso cada tabla tiene además su caso positivo con
       la misma fila: demuestra que la fila es válida para quien sí puede.
  */
  describe('cuentas corrientes, comprobantes, contratos y catálogo', () => {
    const admin = () => clienteDePrueba()
    const s = `${sufijo}-6`

    let huespedId: string
    let acompananteId: string
    let reservaPropiaId: string
    let facturaId: string
    let notaCreditoId: string
    let agenciaId: string
    let movimientoCuentaId: string
    let proveedorId: string
    let movimientoProveedorId: string
    let contratoId: string
    let firmaId: string
    let movimientoExternoId: string
    let temporadaId: string

    /** Inserta con `service_role` y devuelve el id; explota si no pudo (no hay siembra muda). */
    async function sembrar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await admin().from(tabla).insert(fila).select('id').single<{ id: string }>()
      if (error) throw new Error(`No se pudo sembrar ${tabla}: ${error.message}`)
      return data.id
    }

    beforeAll(async () => {
      huespedId = await sembrar('huespedes', { nombre: 'Auditoría', apellido: `Titular-${s}` })
      acompananteId = await sembrar('huespedes', { nombre: 'Auditoría', apellido: `Acompañante-${s}` })
      reservaPropiaId = await sembrar('reservas', { huesped_id: huespedId, estado: 'checkout', total: 100 })
      facturaId = await sembrar('facturas', {
        reserva_id: reservaPropiaId,
        numero: `AUDIT-ESC6-${s}`,
        total: 100,
      })
      notaCreditoId = await sembrar('notas_credito', {
        factura_id: facturaId,
        tipo_comprobante: 'B',
        total: 1,
        motivo: `auditoría escritura ${s}`,
      })

      agenciaId = await sembrar('agencias', { nombre: `Agencia ${s}`, tipo: 'agencia' })
      movimientoCuentaId = await sembrar('movimientos_cuenta', {
        agencia_id: agenciaId,
        tipo: 'cargo',
        monto: 10,
        concepto: `cargo de prueba ${s}`,
      })

      proveedorId = await sembrar('proveedores', { nombre: `Proveedor ${s}` })
      movimientoProveedorId = await sembrar('movimientos_proveedor', {
        proveedor_id: proveedorId,
        tipo: 'cargo',
        monto: 10,
      })

      contratoId = await sembrar('contratos', {
        tipo: 'empleado',
        entidad_id: usuarios.admin.id,
        titulo: `Contrato ${s}`,
        contenido: 'Fila de la auditoría de escritura. Se borra en el afterAll.',
      })
      firmaId = await sembrar('firmas', { contrato_id: contratoId, firmante_nombre: `Firmante ${s}` })

      movimientoExternoId = await sembrar('movimientos_externos', {
        origen: 'banco',
        external_id: `auditoria-escritura-${s}`,
        fecha: '2026-01-02',
        monto: -1,
        moneda: 'ARS',
      })

      // Una temporada propia y no una del catálogo: si el caso de borrado
      // encontrara un agujero, se llevaría en cascada las tarifas reales.
      temporadaId = await sembrar('temporadas', { codigo: `audit-${s}`, nombre: `Auditoría ${s}` })
    }, 60_000)

    afterAll(async () => {
      const a = admin()
      // Hijos primero. Se borra por la clave de la siembra, así un intento que
      // haya pasado (un agujero) también se limpia y no contamina la próxima corrida.
      await a.from('notas_credito').delete().eq('factura_id', facturaId)
      await a.from('facturas').delete().eq('id', facturaId)
      await a.from('reserva_huespedes').delete().eq('reserva_id', reservaPropiaId)
      await a.from('reservas').delete().eq('id', reservaPropiaId)
      await a.from('huespedes').delete().in('id', [huespedId, acompananteId])
      await a.from('movimientos_cuenta').delete().eq('agencia_id', agenciaId)
      await a.from('agencias').delete().eq('id', agenciaId)
      await a.from('movimientos_proveedor').delete().eq('proveedor_id', proveedorId)
      await a.from('proveedores').delete().eq('id', proveedorId)
      await a.from('firmas').delete().eq('contrato_id', contratoId)
      await a.from('contratos').delete().like('titulo', `%${s}%`)
      await a.from('movimientos_externos').delete().like('external_id', `%${s}%`)
      await a.from('temporadas').delete().like('codigo', `%${s}%`)
    })

    /** El `insert` falla POR PERMISO (42501) y la tabla no creció. */
    async function insertNegado(
      quien: UsuarioDePrueba,
      tabla: string,
      fila: Record<string, unknown>,
    ): Promise<void> {
      const { count: antes } = await admin().from(tabla).select('*', { count: 'exact', head: true })
      const { error } = await quien.cliente.from(tabla).insert(fila)
      expect(error?.code, `${quien.rol} insertó en ${tabla}, o falló por otra cosa: ${error?.message}`).toBe(
        '42501',
      )
      const { count: despues } = await admin().from(tabla).select('*', { count: 'exact', head: true })
      expect(despues, `${quien.rol} agregó una fila a ${tabla}`).toBe(antes)
    }

    /**
     * El `insert` entra: prueba que la fila del caso negativo es válida.
     *
     * Sin `.select()` a propósito: `reserva_huespedes` no tiene columna `id` (su
     * clave es el par), y pedir la fila de vuelta exigiría además el `select`.
     * Lo que se inserta acá lo limpia el `afterAll` por la clave de la siembra.
     */
    async function insertPermitido(
      quien: UsuarioDePrueba,
      tabla: string,
      fila: Record<string, unknown>,
    ): Promise<void> {
      const { error } = await quien.cliente.from(tabla).insert(fila)
      expect(error, `${quien.rol} no pudo hacer lo que le corresponde en ${tabla}`).toBeNull()
    }

    /** El `delete` no borró nada. Igual que el `update`, uno negado por RLS no da error. */
    async function noPuedeBorrar(quien: UsuarioDePrueba, tabla: string, id: string): Promise<void> {
      await quien.cliente.from(tabla).delete().eq('id', id)
      const { count, error } = await admin()
        .from(tabla)
        .select('*', { count: 'exact', head: true })
        .eq('id', id)
      if (error) throw new Error(`No se pudo verificar ${tabla}: ${error.message}`)
      expect(count, `${quien.rol} borró una fila de ${tabla}`).toBe(1)
    }

    // ── notas_credito (0076): emite la dirección, y nadie la corrige ni la borra ──

    const notaDePrueba = () => ({
      factura_id: facturaId,
      tipo_comprobante: 'B',
      total: 1,
      motivo: `intento ${s}`,
    })

    for (const rol of ['recepcion', 'housekeeping'] as const) {
      it(`${rol} NO puede emitir una nota de crédito`, async () => {
        // Una nota de crédito devuelve plata y baja lo facturado: es de la dirección.
        await insertNegado(usuarios[rol], 'notas_credito', notaDePrueba())
      })
    }

    it('gerencia SÍ puede emitir una nota de crédito', async () => {
      await insertPermitido(usuarios.gerencia, 'notas_credito', notaDePrueba())
    })

    it('ni admin puede corregir una nota de crédito ya emitida', async () => {
      // Inmutable como `facturas`: con CAE ya está informada a ARCA.
      await noPuedeActualizar(usuarios.admin, 'notas_credito', notaCreditoId, { total: 0.5 })
    })

    it('ni admin puede borrar una nota de crédito', async () => {
      // Borrarla dejaría un hueco en la correlatividad fiscal.
      await noPuedeBorrar(usuarios.admin, 'notas_credito', notaCreditoId)
    })

    // ── movimientos_cuenta (0012): la cuenta corriente de una agencia ──────────

    const pagoDeAgencia = () => ({
      agencia_id: agenciaId,
      tipo: 'pago',
      monto: 5,
      concepto: `pago de prueba ${s}`,
    })

    it('housekeeping NO puede registrar un pago en la cuenta de una agencia', async () => {
      await insertNegado(usuarios.housekeeping, 'movimientos_cuenta', pagoDeAgencia())
    })

    it('gerencia SÍ puede registrar un pago en la cuenta de una agencia', async () => {
      await insertPermitido(usuarios.gerencia, 'movimientos_cuenta', pagoDeAgencia())
    })

    /*
      HALLAZGO (2026-10-20), cerrado por la 0124: la política «movimientos:
      recepcion+ gestiona» (0012) le dejaba a recepción insertar, modificar y
      BORRAR movimientos de la cuenta corriente de una agencia por PostgREST,
      aunque la aplicación exige `requerirRol('admin', 'gerencia')`. Estos dos
      casos fallaban antes de la 0124.
    */
    it('recepcion NO puede registrar un pago de agencia', async () => {
      try {
        await insertNegado(usuarios.recepcion, 'movimientos_cuenta', pagoDeAgencia())
      } finally {
        await admin().from('movimientos_cuenta').delete().eq('concepto', `pago de prueba ${s}`)
      }
    })

    it('recepcion NO puede borrar un cargo de agencia', async () => {
      const id = await sembrar('movimientos_cuenta', {
        agencia_id: agenciaId,
        tipo: 'cargo',
        monto: 10,
        concepto: `cargo a borrar ${s}`,
      })
      try {
        await noPuedeBorrar(usuarios.recepcion, 'movimientos_cuenta', id)
      } finally {
        await admin().from('movimientos_cuenta').delete().eq('id', id)
      }
    })

    it('housekeeping NO puede bajar el importe de un cargo de agencia', async () => {
      await noPuedeActualizar(usuarios.housekeeping, 'movimientos_cuenta', movimientoCuentaId, { monto: 1 })
    })

    // ── proveedores y movimientos_proveedor (0016): cuentas por pagar ──────────

    for (const rol of ['recepcion', 'housekeeping'] as const) {
      it(`${rol} NO puede cargar una deuda con un proveedor`, async () => {
        await insertNegado(usuarios[rol], 'movimientos_proveedor', {
          proveedor_id: proveedorId,
          tipo: 'pago',
          monto: 5,
        })
      })
    }

    it('gerencia SÍ puede registrar un pago a un proveedor', async () => {
      await insertPermitido(usuarios.gerencia, 'movimientos_proveedor', {
        proveedor_id: proveedorId,
        tipo: 'pago',
        monto: 5,
      })
    })

    it('recepcion NO puede modificar un movimiento de proveedor', async () => {
      await noPuedeActualizar(usuarios.recepcion, 'movimientos_proveedor', movimientoProveedorId, { monto: 1 })
    })

    it('recepcion NO puede dar de alta un proveedor', async () => {
      // Un proveedor nuevo es a quién se le puede pagar.
      await insertNegado(usuarios.recepcion, 'proveedores', { nombre: `Intruso ${s}` })
    })

    it('recepcion NO puede renombrar un proveedor', async () => {
      await noPuedeActualizar(usuarios.recepcion, 'proveedores', proveedorId, { nombre: `Renombrado ${s}` })
    })

    it('ni admin puede borrar un proveedor (la baja es lógica, 0061)', async () => {
      await noPuedeBorrar(usuarios.admin, 'proveedores', proveedorId)
    })

    // ── movimientos_externos (0077): el extracto del banco ───────────────────

    it('recepcion NO puede marcar como ignorado un movimiento del banco', async () => {
      // Ignorar un movimiento lo saca del cuadre sin conciliarlo.
      await noPuedeActualizar(usuarios.recepcion, 'movimientos_externos', movimientoExternoId, {
        estado: 'ignorado',
      })
    })

    it('ni gerencia puede cargar un movimiento del banco a mano', async () => {
      // El alta es del importador (service_role): una fila cargada a mano no
      // tendría archivo de origen y desaparecería del cuadre sin rastro.
      await insertNegado(usuarios.gerencia, 'movimientos_externos', {
        origen: 'banco',
        external_id: `a-mano-${s}`,
        fecha: '2026-01-02',
        monto: 1,
      })
    })

    it('ni admin puede borrar un movimiento del banco', async () => {
      await noPuedeBorrar(usuarios.admin, 'movimientos_externos', movimientoExternoId)
    })

    // ── contratos y firmas (0018) ────────────────────────────────────────────

    const contratoDePrueba = () => ({
      tipo: 'empleado',
      entidad_id: usuarios.admin.id,
      titulo: `Contrato intento ${s}`,
      contenido: 'Intento de la auditoría de escritura.',
    })

    for (const rol of ['recepcion', 'housekeeping'] as const) {
      it(`${rol} NO puede crear un contrato`, async () => {
        await insertNegado(usuarios[rol], 'contratos', contratoDePrueba())
      })
    }

    it('gerencia SÍ puede crear un contrato', async () => {
      await insertPermitido(usuarios.gerencia, 'contratos', contratoDePrueba())
    })

    it('recepcion NO puede cambiar el texto de un contrato', async () => {
      // Cambiar el contenido de un contrato ya firmado es cambiar lo que se firmó.
      await noPuedeActualizar(usuarios.recepcion, 'contratos', contratoId, { titulo: `Alterado ${s}` })
    })

    it('recepcion NO puede agregar una firma a un contrato', async () => {
      await insertNegado(usuarios.recepcion, 'firmas', {
        contrato_id: contratoId,
        firmante_nombre: `Firma falsa ${s}`,
      })
    })

    it('recepcion NO puede cambiar el nombre de quien firmó', async () => {
      await noPuedeActualizar(usuarios.recepcion, 'firmas', firmaId, { firmante_nombre: `Otro ${s}` })
    })

    // ── temporadas (0003): de dónde sale el precio de cada noche ──────────────

    it('recepcion NO puede crear una temporada', async () => {
      await insertNegado(usuarios.recepcion, 'temporadas', { codigo: `intrusa-${s}`, nombre: `Intrusa ${s}` })
    })

    it('recepcion NO puede renombrar una temporada', async () => {
      await noPuedeActualizar(usuarios.recepcion, 'temporadas', temporadaId, { nombre: `Alterada ${s}` })
    })

    it('housekeeping NO puede borrar una temporada', async () => {
      await noPuedeBorrar(usuarios.housekeeping, 'temporadas', temporadaId)
    })

    // ── reserva_huespedes (0005): los acompañantes, datos personales ──────────

    it('housekeeping NO puede agregar un acompañante a una reserva', async () => {
      await insertNegado(usuarios.housekeeping, 'reserva_huespedes', {
        reserva_id: reservaPropiaId,
        huesped_id: acompananteId,
      })
    })

    it('recepcion SÍ puede agregar un acompañante a una reserva', async () => {
      await insertPermitido(usuarios.recepcion, 'reserva_huespedes', {
        reserva_id: reservaPropiaId,
        huesped_id: acompananteId,
      })
    })
  })
})
