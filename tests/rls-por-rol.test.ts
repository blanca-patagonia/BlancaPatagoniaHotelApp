import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hayDB, clienteDePrueba, sufijoUnico } from './db'
import {
  crearLosCuatroRoles,
  crearUsuarioSinRol,
  hayRoles,
  limpiarUsuarios,
  type UsuarioDePrueba,
} from './roles'
import type { Rol } from '@/lib/domain/roles'

/**
 * AUDITORÍA DE LAS POLÍTICAS RLS, ROL POR ROL.
 *
 * ── El pendiente que este archivo cierra ─────────────────────────────────────
 *
 * La auditoría de seguridad venía arrastrando este ítem: *«las ~75 políticas RLS
 * nunca se probaron rol por rol; que RLS esté activo en las 40 tablas no dice qué
 * permite cada política»*. Seguía abierto por una razón concreta: **ningún test se
 * autenticaba como un rol de staff**. `tests/db.ts` solo daba `service_role` (que
 * saltea RLS) y `anon` (el borde público, ya verificado).
 *
 * Con `tests/roles.ts` eso se puede hacer, y esto lo hace: recorre **todas** las
 * tablas con los cuatro roles y un usuario autenticado sin rol, y compara lo que
 * cada uno puede leer contra lo que la matriz del ADR 0005 dice que debería.
 *
 * ── Cómo leer un fallo ──────────────────────────────────────────────────────
 *
 * Un fallo acá NO es «el test está mal». Es una de dos cosas, y las dos importan:
 *
 *  · Una política permite más de lo declarado → hay una exposición de datos.
 *  · Una política permite menos → hay una pantalla que va a mostrar vacío sin
 *    explicar por qué, que es el modo de falla más difícil de diagnosticar de este
 *    stack.
 *
 * ── Por qué se prueba la LECTURA y no la escritura ──────────────────────────
 *
 * La escritura ya tiene su propia red: `tests/autorizacion-acciones.test.ts` es una
 * guarda estructural que verifica que las 51 Server Actions comprueben el rol, y
 * `tests/alta-sin-privilegios.test.ts` cubre el alta de usuarios. Lo que no tenía
 * red era la lectura, que es por donde se filtran datos sin que nadie lo note: una
 * política de `select` demasiado amplia no rompe nada, solo muestra de más.
 */

const sufijo = sufijoUnico()

/** Qué se espera que cada rol pueda LEER de cada tabla. */
type Expectativa = 'si' | 'no'

/**
 * La matriz declarada. Es la fuente de verdad de este test y sale del ADR 0005 más
 * los comentarios de cada migración.
 *
 * `todos` = los cuatro roles de staff. Cualquier tabla que no esté acá hace fallar
 * el test de cobertura de más abajo, así que agregar una tabla obliga a decidir
 * quién la lee — que es exactamente lo que se quiere.
 */
const MATRIZ: Record<string, Partial<Record<Rol, Expectativa>> & { todos?: Expectativa }> = {
  // ── Catálogo: todo el staff lo lee, y parte es público ──
  tipos_unidad: { todos: 'si' },
  unidades: { todos: 'si' },
  temporadas: { todos: 'si' },
  temporada_rangos: { todos: 'si' },
  promociones: { todos: 'si' },
  politicas_cancelacion: { todos: 'si' },
  productos_servicios: { todos: 'si' },
  departamentos: { todos: 'si' },
  puntos_venta: { todos: 'si' },
  planes_mantenimiento: { todos: 'si' },

  // ── El tarifario: precio neto de agencia ──
  // Lo lee todo el staff; el borde que importa es que `anon` NO pueda, y eso ya lo
  // cubre `tests/` del ADR 0016.
  tarifas: { todos: 'si' },

  // ── Datos personales y dinero: housekeeping NO (ADR 0005, migración 0045) ──
  huespedes: { admin: 'si', gerencia: 'si', recepcion: 'si', housekeeping: 'no' },
  pagos: { admin: 'si', gerencia: 'si', recepcion: 'si', housekeeping: 'no' },
  facturas: { admin: 'si', gerencia: 'si', recepcion: 'si', housekeeping: 'no' },

  // ── Operación: housekeeping las necesita para priorizar la limpieza ──
  // `estadias` da las llegadas y salidas del día; `reservas` el código y el estado.
  // No traen datos personales por sí solas.
  reservas: { todos: 'si' },
  estadias: { todos: 'si' },
  reserva_huespedes: { todos: 'si' },
  consumos: { todos: 'si' },

  // ── Comercial ──
  agencias: { todos: 'si' },
  movimientos_cuenta: { todos: 'si' },
  proveedores: { todos: 'si' },
  movimientos_proveedor: { todos: 'si' },
  contratos: { todos: 'si' },

  // ── Equipo ──
  avisos: { todos: 'si' },
  canales: { todos: 'si' },
  mensajes: { todos: 'si' },
  consultas_bot: { todos: 'si' },

  // ── Unidades y mantenimiento ──
  ordenes_mantenimiento: { todos: 'si' },
  objetos_perdidos: { todos: 'si' },

  // ── Encuestas y comercial ──
  encuestas_satisfaccion: { todos: 'si' },

  // ── Perfiles: cada uno se ve a sí mismo; el listado es de admin ──
  perfiles: { todos: 'si' },

  // ── Auditoría: solo quien la audita ──
  auditoria: { admin: 'si', gerencia: 'si', recepcion: 'no', housekeeping: 'no' },

  // ── Canales de venta (migración 0038) ──
  canal_reservas: { todos: 'si' },
  canal_sincronizaciones: { todos: 'si' },
  canal_mensajes: { todos: 'si' },
  canal_resenas: { todos: 'si' },

  // ── Costos del canal (migración 0049) ──
  //
  // `canal_cargos` lo lee todo el staff: es el volumen del canal, no un secreto.
  // `canal_config` NO, y es deliberado: guarda el token del feed iCal de salida
  // —que va en una URL— y el porcentaje pactado con el canal. Housekeeping no tiene
  // ninguna razón para leer eso. Mismo criterio que el padrón de la 0045.
  canal_cargos: { todos: 'si' },
  // El mapeo de columnas lo lee todo el staff: es configuración del importador, no un
  // secreto. Su `muestra` guarda valores reales del archivo —apellidos, correos— así
  // que `anon` no lo lee, y eso lo verifica el borde público del mismo test.
  canal_mapeos_columnas: { todos: 'si' },
  canal_config: { admin: 'si', gerencia: 'si', recepcion: 'no', housekeeping: 'no' },

  // ── Divisas y respaldos ──
  cotizaciones: { todos: 'si' },
  respaldos: { todos: 'si' },

  // ── Firmas: la 0034 las sacó del alcance del staff que no las gestiona ──
  firmas: { admin: 'si', gerencia: 'si', recepcion: 'si', housekeeping: 'no' },

  // ── Sin política de lectura a propósito: la maneja una función `definer` ──
  intentos_limitados: { todos: 'no' },

  /*
    ── VISTAS (desde la migración 0056) ──────────────────────────────────────

    Hasta la 0056 quedaban fuera de esta auditoría, y era un agujero real: la lista de
    objetos salía de `pg_tables`, que **no devuelve vistas**. Agregar una vista nueva no
    hacía fallar el test de cobertura, o sea que la garantía que este archivo promete
    tenía una excepción que nadie había declarado.

    Importa porque una vista hereda el `grant select to anon` por omisión igual que una
    tabla, y además puede exponer datos de tablas que sí están protegidas — es el camino
    por el que se filtra algo sin que ninguna política se vea mal escrita.

    Apenas se arregló, encontró que `saldos_agencias` y `saldos_proveedores` tenían ese
    grant (migración 0057). No era una fuga: las cuatro son `security_invoker`, así que
    RLS de las tablas de abajo aplica igual y `anon` veía cero filas. Pero el grant
    estaba.

    Las cuatro las lee todo el staff: son agregados de tablas que el staff ya puede leer.
  */
  saldos_agencias: { todos: 'si' },
  saldos_proveedores: { todos: 'si' },
  conciliacion_comision_canal: { todos: 'si' },
  resumen_canal_mes: { todos: 'si' },
}

function esperado(tabla: string, rol: Rol): Expectativa {
  const fila = MATRIZ[tabla]
  if (!fila) throw new Error(`La tabla «${tabla}» no está declarada en la matriz`)
  return fila[rol] ?? fila.todos ?? 'no'
}

describe.skipIf(!hayDB || !hayRoles)('auditoría RLS · lectura por rol', () => {
  let usuarios: Record<Rol, UsuarioDePrueba>
  let sinRol: UsuarioDePrueba
  let tablas: string[] = []

  /**
   * Casos negativos que NO se pudieron verificar porque la tabla está vacía.
   *
   * Cero filas es la misma respuesta para «la política te negó» y para «no hay
   * nada». Un caso acá adentro es una casilla de la matriz **sin auditar**, y el
   * test del final lo dice con nombre y apellido en vez de dejar el verde falso.
   */
  const sinDatos = new Set<string>()

  /** Filas que la auditoría sembró y tiene que limpiar. */
  const sembradas: { tabla: string; columna: string; valor: string }[] = []

  beforeAll(async () => {
    usuarios = await crearLosCuatroRoles(sufijo)
    sinRol = await crearUsuarioSinRol(sufijo)

    // Las tablas se descubren de la base, no de una lista escrita a mano: así una
    // tabla nueva sin declarar hace fallar el test en vez de quedar sin auditar.
    const admin = clienteDePrueba()
    const { data, error } = await admin.rpc('tablas_publicas')
    if (error) throw new Error(`No se pudo listar las tablas: ${error.message}`)
    tablas = (data as { tabla: string }[] | string[]).map((t) =>
      typeof t === 'string' ? t : t.tabla,
    )

    await sembrarParaCasosNegativos()
  }, 60_000)

  /**
   * Siembra una fila en las tablas cuyos casos negativos, sin datos, no probarían
   * nada.
   *
   * Es parte de la auditoría, no una comodidad: verificar que housekeeping no puede
   * leer `facturas` **exige que haya una factura**. Con la tabla vacía el resultado
   * es el mismo con política o sin ella.
   *
   * ⚠️ Acá **nada** puede descartar `{ error }`. La primera versión de esta función
   * lo hacía, el insert de `contratos` falló por columnas obligatorias que no le
   * pasaba, y la siembra no ocurrió — sin una línea de aviso. Los casos de `firmas`
   * volvieron a pasar por la tabla vacía, o sea el verde falso que esta función
   * existe para eliminar. Es la misma regla de la Fase 20, y en un test de
   * seguridad cuesta más caro: una siembra que falla callada convierte la auditoría
   * en una ceremonia.
   */
  async function sembrarParaCasosNegativos(): Promise<void> {
    const admin = clienteDePrueba()

    /** Cuenta filas y explota si la consulta falló: sin el conteo no hay decisión. */
    const contar = async (tabla: string): Promise<number> => {
      const { count, error } = await admin.from(tabla).select('*', { count: 'exact', head: true })
      if (error) throw new Error(`No se pudo contar ${tabla}: ${error.message}`)
      return count ?? 0
    }

    /*
      Una reserva sobre la que colgar lo que haga falta, creándola si no hay ninguna.

      El seed del proyecto siembra **solo catálogo** —tipos, unidades, temporadas,
      tarifas, promociones, políticas— y ni una reserva ni un huésped. Así que en un
      entorno limpio, que es el del CI, esto abortaba con un «corré db reset» que
      además no habría arreglado nada. Un test tiene que traer lo que necesita.

      Memoizada: facturas y pagos cuelgan de la misma, y crear dos reservas para eso
      dejaría basura de más.
    */
    let reservaSembrada: string | null = null

    const reservaParaSembrar = async (): Promise<string> => {
      if (reservaSembrada) return reservaSembrada

      const { data: reservas, error } = await admin.from('reservas').select('id').limit(1)
      if (error) throw new Error(`No se pudieron leer reservas: ${error.message}`)

      const existente = (reservas ?? [])[0]?.id
      if (existente) {
        reservaSembrada = existente
        return existente
      }

      const { data: huesped, error: eHuesped } = await admin
        .from('huespedes')
        .insert({ nombre: 'Auditoría', apellido: `RLS${sufijo}` })
        .select('id')
        .single<{ id: string }>()
      if (eHuesped) throw new Error(`No se pudo crear el huésped: ${eHuesped.message}`)
      sembradas.push({ tabla: 'huespedes', columna: 'id', valor: huesped.id })

      const { data: creada, error: eReserva } = await admin
        .from('reservas')
        .insert({ huesped_id: huesped.id, estado: 'checkout', total: 100 })
        .select('id')
        .single<{ id: string }>()
      if (eReserva) throw new Error(`No se pudo crear la reserva: ${eReserva.message}`)
      sembradas.push({ tabla: 'reservas', columna: 'id', valor: creada.id })

      reservaSembrada = creada.id
      return creada.id
    }

    // ── facturas ──────────────────────────────────────────────────────────────
    // Desde la 0045 solo hay una factura por reserva; si no hay ninguna factura,
    // ninguna reserva la tiene y no se puede chocar con la restricción única.
    if ((await contar('facturas')) === 0) {
      const { error } = await admin
        .from('facturas')
        .insert({ reserva_id: await reservaParaSembrar(), numero: `AUDIT-${sufijo}`, total: 1 })
      if (error) throw new Error(`No se pudo sembrar la factura: ${error.message}`)

      sembradas.push({ tabla: 'facturas', columna: 'numero', valor: `AUDIT-${sufijo}` })
    }

    /*
      ── pagos ─────────────────────────────────────────────────────────────────

      Housekeeping no debe leer `pagos` (ADR 0005, migración 0045), y sobre una tabla
      vacía ese caso pasa solo: cero filas es la respuesta tanto de una política que
      niega como de una tabla sin datos.

      Lo detectó el propio guardián de esta auditoría —el test que denuncia lo que no
      se pudo verificar— corriendo en CI, que es el único lugar donde la base arranca
      vacía. En local pasaba de verdad, por los datos de demo, y por eso nadie lo vio.
    */
    if ((await contar('pagos')) === 0) {
      const { data, error } = await admin
        .from('pagos')
        .insert({ reserva_id: await reservaParaSembrar(), monto: 1, nota: `AUDIT-${sufijo}` })
        .select('id')
        .single<{ id: string }>()
      if (error) throw new Error(`No se pudo sembrar el pago: ${error.message}`)

      sembradas.push({ tabla: 'pagos', columna: 'id', valor: data.id })
    }

    // ── canal_config ──────────────────────────────────────────────────────────
    // Nace vacía (la migración 0049 no siembra: qué proveedor contabiliza el canal
    // es una decisión del hotel). Sin una fila, «recepción no puede leer» pasaría
    // por tabla vacía en vez de por la política.
    if ((await contar('canal_config')) === 0) {
      const { error } = await admin.from('canal_config').insert({ canal: 'booking' })
      if (error) throw new Error(`No se pudo sembrar canal_config: ${error.message}`)
      sembradas.push({ tabla: 'canal_config', columna: 'canal', valor: 'booking' })
    }

    // ── firmas ────────────────────────────────────────────────────────────────
    // Necesita un contrato, y `contratos` pide `tipo` y `entidad_id`. `entidad_id`
    // es polimórfico —apunta a agencias, proveedores o perfiles según `tipo`— y no
    // tiene clave foránea, así que se usa `empleado` con el perfil del admin de
    // prueba: es el único de los tres que existe seguro en este punto.
    if ((await contar('firmas')) === 0) {
      const { data: contratos, error: eContratos } = await admin
        .from('contratos')
        .select('id')
        .limit(1)
      if (eContratos) throw new Error(`No se pudieron leer contratos: ${eContratos.message}`)

      let contratoId = (contratos ?? [])[0]?.id

      if (!contratoId) {
        const { data: creado, error } = await admin
          .from('contratos')
          .insert({
            tipo: 'empleado',
            entidad_id: usuarios.admin.id,
            titulo: `Contrato auditoría ${sufijo}`,
            contenido: 'Fila creada por la auditoría RLS. Se borra en el afterAll.',
          })
          .select('id')
          .single()
        if (error) throw new Error(`No se pudo sembrar el contrato: ${error.message}`)

        contratoId = creado.id
        sembradas.push({ tabla: 'contratos', columna: 'id', valor: creado.id })
      }

      const { data: creada, error } = await admin
        .from('firmas')
        .insert({ contrato_id: contratoId, firmante_nombre: `Auditoría ${sufijo}` })
        .select('id')
        .single()
      if (error) throw new Error(`No se pudo sembrar la firma: ${error.message}`)

      sembradas.push({ tabla: 'firmas', columna: 'id', valor: creada.id })
    }
  }

  afterAll(async () => {
    const admin = clienteDePrueba()
    // En orden inverso: `firmas` antes que `contratos`, por la clave foránea.
    for (const s of [...sembradas].reverse()) {
      await admin.from(s.tabla).delete().eq(s.columna, s.valor)
    }
    await limpiarUsuarios()
  })

  it('los cuatro roles quedaron creados con su rol asignado', async () => {
    const admin = clienteDePrueba()
    for (const rol of ['admin', 'gerencia', 'recepcion', 'housekeeping'] as Rol[]) {
      const { data } = await admin
        .from('perfiles')
        .select('rol, activo')
        .eq('id', usuarios[rol].id)
        .single()

      expect(data!.rol, `el perfil de ${rol} no quedó con su rol`).toBe(rol)
      expect(data!.activo).toBe(true)
    }
  })

  it('la matriz declara TODAS las tablas de la base', () => {
    // ⚠️ La primera versión de este test comparaba la matriz contra sí misma —el
    // descubrimiento de tablas caía en `Object.keys(MATRIZ)` como respaldo— así que
    // no podía fallar nunca. Un test que no puede fallar en una auditoría es peor
    // que ninguno: da por verificado lo que no se miró.
    //
    // Ahora la cuenta viene de la base (`tablas_publicas()`, migración 0046). Si
    // alguien agrega una tabla y no la declara acá, esto falla nombrándola.
    const declaradas = new Set(Object.keys(MATRIZ))
    const faltantes = tablas.filter((t) => !declaradas.has(t))
    const sobrantes = [...declaradas].filter((t) => !tablas.includes(t))

    expect(faltantes, `tablas de la base sin declarar en la matriz: ${faltantes.join(', ')}`).toEqual(
      [],
    )
    expect(sobrantes, `tablas declaradas que ya no existen: ${sobrantes.join(', ')}`).toEqual([])
  })

  /**
   * El corazón de la auditoría. Una comprobación por tabla y por rol.
   *
   * Se usa `head: true` con `count`: no trae datos —no hace falta— y así el test no
   * depende de que haya filas. Lo que importa es si la política **deja pasar la
   * consulta**, no cuántas filas devuelve.
   */
  for (const tabla of Object.keys(MATRIZ)) {
    for (const rol of ['admin', 'gerencia', 'recepcion', 'housekeeping'] as Rol[]) {
      const debe = esperado(tabla, rol)

      it(`${tabla} · ${rol} ${debe === 'si' ? 'PUEDE' : 'NO puede'} leer`, async () => {
        const { error, count } = await usuarios[rol].cliente
          .from(tabla)
          .select('*', { count: 'exact', head: true })

        if (debe === 'si') {
          // Sin error y con un conteo (aunque sea 0): la política dejó pasar.
          expect(error, `${rol} debería poder leer ${tabla}: ${error?.message}`).toBeNull()
          expect(count).not.toBeNull()
        } else {
          // Dos formas válidas de negar: error de permisos, o pasar sin ver nada.
          // La segunda es la de RLS: la consulta corre y devuelve cero filas.
          const negado = error !== null || count === 0
          expect(
            negado,
            `${rol} NO debería poder leer ${tabla}, y devolvió ${count} fila(s)`,
          ).toBe(true)

          // ⚠️ Si la tabla está VACÍA, la comprobación de arriba pasa sin haber
          // probado nada: cero filas es lo que devuelve tanto una política que
          // niega como una tabla sin datos. Eso no se puede dejar pasar en una
          // auditoría, así que se anota y el test de abajo lo denuncia.
          if (error === null && count === 0) {
            const { count: reales } = await clienteDePrueba()
              .from(tabla)
              .select('*', { count: 'exact', head: true })
            if ((reales ?? 0) === 0) sinDatos.add(`${tabla} · ${rol}`)
          }
        }
      })
    }
  }

  /**
   * El borde propio del usuario sin rol.
   *
   * Desde la migración 0032 todo alta nace sin privilegios, así que este estado
   * existe de verdad: alguien con sesión válida y `rol_actual()` en `null`. Para RLS
   * tiene que ser indistinguible de un extraño.
   */
  it('un usuario autenticado SIN rol no lee ninguna tabla de datos', async () => {
    const sensibles = ['huespedes', 'reservas', 'pagos', 'facturas', 'consumos', 'auditoria']
    const filtradas: string[] = []

    for (const tabla of sensibles) {
      const { error, count } = await sinRol.cliente
        .from(tabla)
        .select('*', { count: 'exact', head: true })
      if (error === null && (count ?? 0) > 0) filtradas.push(`${tabla} (${count})`)
    }

    expect(
      filtradas,
      `un usuario sin rol vio datos en: ${filtradas.join(', ')}`,
    ).toEqual([])
  })

  /**
   * El test que evita el verde falso.
   *
   * Va último a propósito: cuando corre, todos los casos ya se evaluaron y
   * `sinDatos` tiene los que no se pudieron concluir. Un caso negativo sobre una
   * tabla vacía **no prueba nada** —cero filas es la respuesta tanto de una política
   * que niega como de una tabla sin datos— y una auditoría que cuenta esos casos
   * como verificados es peor que una que admite el hueco.
   */
  it('TODOS los casos negativos se pudieron verificar con datos reales', () => {
    expect(
      [...sinDatos],
      'Estos casos pasaron porque la tabla está vacía, no porque la política niegue. ' +
        'La casilla de la matriz quedó SIN auditar: sembrá una fila o ampliá ' +
        '`sembrarParaCasosNegativos()`.',
    ).toEqual([])
  })

  it('el usuario sin rol tiene sesión válida: no está fallando por eso', async () => {
    // Sin esta comprobación, el test de arriba pasaría igual si el login hubiera
    // fallado, y estaríamos verificando nada.
    const { data } = await sinRol.cliente.auth.getUser()
    expect(data.user?.id).toBe(sinRol.id)
  })
})
