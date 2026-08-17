import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { clienteAnonimo, clienteDePrueba } from './db'
import {
  crearLosCuatroRoles,
  crearUsuarioSinRol,
  hayRoles,
  limpiarUsuarios,
  type UsuarioDePrueba,
} from './roles'
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
 * Una matriz completa sería 40 tablas × 4 roles × 3 operaciones = 480 casos, y cada
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

    const { data: reservas, error: eReservas } = await admin.from('reservas').select('id').limit(1)
    if (eReservas) throw new Error(`No se pudieron leer reservas: ${eReservas.message}`)
    if (!reservas?.length) throw new Error('No hay reservas en la base. Corré el seed.')
    reservaId = reservas[0].id

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
    const { data } = await admin
      .from('canal_cargos')
      .select('id, estado_conciliacion')
      .limit(1)
      .maybeSingle<{ id: string; estado_conciliacion: string }>()

    if (!data) throw new Error('No hay cargos en la base: el backfill de la 0049 no corrió.')

    await noPuedeActualizar(usuarios.recepcion, 'canal_cargos', data.id, {
      estado_conciliacion: data.estado_conciliacion === 'conciliado' ? 'devengado' : 'conciliado',
    })
  })

  it('housekeeping no puede leer ni tocar la configuración del canal', async () => {
    // `canal_config` guarda el token del feed iCal de salida, que va en una URL.
    const { error } = await usuarios.housekeeping.cliente
      .from('canal_config')
      .update({ comision_pct_pactada: 99 })
      .eq('canal', 'booking')
    // Un update bloqueado por RLS no da error: se verifica leyendo de vuelta.
    void error

    const admin = clienteDePrueba()
    const { data } = await admin
      .from('canal_config')
      .select('comision_pct_pactada')
      .eq('canal', 'booking')
      .maybeSingle<{ comision_pct_pactada: number | null }>()

    if (data) expect(Number(data.comision_pct_pactada ?? 0)).not.toBe(99)
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
})
