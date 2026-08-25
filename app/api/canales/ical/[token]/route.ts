import { crearClienteAdmin } from '@/lib/supabase/admin'
import { permitirIntento } from '@/lib/limites'
import { registrarFalla } from '@/lib/acciones'
import { traerTodo } from '@/lib/paginado'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import {
  calcularBloquesOcupados,
  generarIcal,
  type EstadiaOcupada,
} from '@/lib/canales/ical-saliente'

/**
 * Feed iCal de salida: `GET /api/canales/ical/<token>?tipo=CODIGO`.
 *
 * El calendario de ocupación que el hotel le publica al canal para que cierre fechas
 * solo, en vez de que alguien las cierre a mano en el extranet.
 *
 *   ?tipo=HOST-DBL-SUP    ocupación del tipo: cierra sólo cuando no queda ninguna
 *                         unidad libre de ese tipo
 *   ?unidad=Cabaña 3      ocupación de una unidad, para cuando el extranet la lista
 *                         como una habitación separada
 *
 * ── Autenticación: un token al portador en la URL ───────────────────────────
 *
 * Mismo patrón que el portal del socio (ADR 0014), y por la misma razón: el otro lado
 * es un servidor de Booking que no puede iniciar sesión. El token sale de
 * `canal_config.ical_token` y se puede rotar desde el panel.
 *
 * Un token que no existe devuelve **404 y no 401**: un 401 confirmaría que la ruta
 * existe y que el token tenía la forma correcta. Y no hay comparación en tiempo
 * constante porque no hay secreto que comparar en memoria: es una búsqueda por
 * igualdad en la base sobre un uuid.
 *
 * ── Por qué usa `service_role` ──────────────────────────────────────────────
 *
 * `canal_config` no la lee ni recepción (migración 0049: guarda el token y el
 * porcentaje pactado), y quien llama acá no tiene sesión. La autorización de este
 * endpoint **es el token**, y lo que puede leer está acotado a esta consulta.
 *
 * ── Lo que el cuerpo NO trae ────────────────────────────────────────────────
 *
 * Ni un dato personal: ni apellido, ni correo, ni código de reserva, ni precio
 * (ADR 0016). El `SUMMARY` es la constante «Ocupado». Hay dos tests que lo verifican,
 * y uno lo hace **contra datos sembrados en la base**, no contra la constante.
 */

/** Un año hacia adelante. Más allá de eso el hotel todavía no tiene tarifas cargadas. */
const DIAS_DE_VENTANA = 365

/** Respuesta de error en texto plano: quien llama es un servidor, no un navegador. */
function fallo(estado: number, mensaje: string): Response {
  return new Response(`${mensaje}\n`, {
    status: estado,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** ¿Tiene forma de uuid? Consultar la base con otra cosa da error de sintaxis. */
function pareceUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  /*
    El límite de tasa va **antes** de tocar la base. Sin él, la URL es una consulta
    sin sesión que cualquiera puede repetir en un bucle: no filtra nada, pero cada
    llamada recorre un año de estadías y eso es un amplificador gratis.
  */
  if (!(await permitirIntento('ical'))) {
    return fallo(429, 'Demasiadas lecturas. Probá de nuevo en un rato.')
  }

  if (!pareceUuid(token)) return fallo(404, 'No encontrado.')

  const admin = crearClienteAdmin()

  const { data: config, error: eConfig } = await admin
    .from('canal_config')
    .select('canal')
    .eq('ical_token', token)
    .maybeSingle<{ canal: string }>()

  // Un fallo de lectura NO es un token inválido, y confundirlos haría que un
  // problema de base se vea como «Booking tiene la URL mal».
  if (eConfig) {
    console.error('No se pudo verificar el token del feed iCal:', eConfig.message)
    return fallo(503, 'No se pudo generar el calendario en este momento.')
  }
  if (!config) return fallo(404, 'No encontrado.')

  const url = new URL(request.url)
  const tipoCodigo = url.searchParams.get('tipo')?.trim()
  const unidadNombre = url.searchParams.get('unidad')?.trim()

  if (!tipoCodigo && !unidadNombre) {
    return fallo(
      400,
      'Falta indicar qué calendario se pide: agregá ?tipo=CODIGO o ?unidad=NOMBRE. ' +
        'La pantalla de Canales del panel muestra las URLs armadas.',
    )
  }

  const desde = hoyISO()
  const hasta = sumarDias(desde, DIAS_DE_VENTANA)

  // ── Qué unidades entran en el cálculo ─────────────────────────────────────

  let unidadIds: string[]
  let nombre: string
  let calendarioId: string

  if (unidadNombre) {
    const { data: unidad, error } = await admin
      .from('unidades')
      .select('id, nombre')
      .eq('nombre', unidadNombre)
      .eq('activo', true)
      .maybeSingle<{ id: string; nombre: string }>()

    if (error) {
      console.error('No se pudo leer la unidad del feed iCal:', error.message)
      return fallo(503, 'No se pudo generar el calendario en este momento.')
    }
    if (!unidad) return fallo(404, 'No encontrado.')

    unidadIds = [unidad.id]
    nombre = `Blanca Patagonia · ${unidad.nombre}`
    calendarioId = `unidad-${unidad.id}`
  } else {
    const { data: tipo, error: eTipo } = await admin
      .from('tipos_unidad')
      .select('id, codigo, nombre')
      .eq('codigo', tipoCodigo!)
      .eq('activo', true)
      .maybeSingle<{ id: string; codigo: string; nombre: string }>()

    if (eTipo) {
      console.error('No se pudo leer el tipo de unidad del feed iCal:', eTipo.message)
      return fallo(503, 'No se pudo generar el calendario en este momento.')
    }
    if (!tipo) return fallo(404, 'No encontrado.')

    const { data: unidades, error: eUnidades } = await admin
      .from('unidades')
      .select('id')
      .eq('tipo_unidad_id', tipo.id)
      .eq('activo', true)

    if (eUnidades) {
      console.error('No se pudieron leer las unidades del feed iCal:', eUnidades.message)
      return fallo(503, 'No se pudo generar el calendario en este momento.')
    }

    unidadIds = (unidades ?? []).map((u) => u.id)
    nombre = `Blanca Patagonia · ${tipo.nombre}`
    calendarioId = `tipo-${tipo.codigo}`
  }

  // ── Las estadías de la ventana ────────────────────────────────────────────

  /*
    Va por `traerTodo` y no por un `select` pelado.

    PostgREST corta en 1000 filas sin error y sin aviso (`max_rows`), y un año de
    estadías de 15 unidades las pasa. Acá ese corte no da un listado incompleto en
    pantalla —que se nota— sino un calendario que **publica como libre una noche que
    está llena**: exactamente el overbooking que este feed viene a angostar.

    Y si aun así queda truncado, se responde 503 en vez de servir un calendario
    parcial. Un canal que no puede leer conserva la versión anterior; uno que lee una
    versión incompleta vende de más.
  */
  const { filas, truncado, error: eEstadias } = await traerTodo<{
    unidad_id: string
    check_in: string
    check_out: string
  }>((desdeFila, hastaFila) =>
    admin
      .from('estadias')
      .select('unidad_id, check_in, check_out')
      .in('unidad_id', unidadIds)
      .in('estado', [...ESTADOS_ACTIVOS])
      .lt('check_in', hasta)
      .gt('check_out', desde)
      .order('check_in')
      .order('id')
      .range(desdeFila, hastaFila),
  )

  if (eEstadias) {
    console.error('No se pudieron leer las estadías del feed iCal:', eEstadias)
    return fallo(503, 'No se pudo generar el calendario en este momento.')
  }
  if (truncado) {
    console.error(
      'El feed iCal quedó truncado: hay más estadías que el techo de paginado. ' +
        'Servir el calendario parcial publicaría como libres noches que están llenas.',
    )
    return fallo(503, 'No se pudo generar el calendario completo en este momento.')
  }

  // Cuando se pide una unidad, la única que puede ocuparla es ella: `unidadIds` tiene
  // un solo elemento y el cálculo sale igual.
  const estadias: EstadiaOcupada[] = filas.map((f) => ({
    unidadId: f.unidad_id,
    checkIn: f.check_in,
    checkOut: f.check_out,
  }))

  const bloques = calcularBloquesOcupados(estadias, unidadIds.length, desde, hasta)
  const cuerpo = generarIcal({ nombre, calendarioId, bloques, generadoEn: new Date() })

  /*
    Se registra que alguien leyó el feed, y el fallo de esa escritura **no corta**.

    Es la única mitigación posible de que el iCal no tenga acuse de recibo: nadie
    avisa que dejó de leer. Con esto la pantalla puede decir «lo leyeron hace 3 h» o
    «hace 6 días», y lo segundo es información que hoy no existe en ningún lado.

    Pero es una escritura accesoria: si falla, el calendario igual se sirve. Cortar
    acá convertiría un problema de registro en fechas que el canal no cierra.
  */
  const { error: eLectura } = await admin
    .from('canal_config')
    .update({ ical_leido_en: new Date().toISOString() })
    .eq('canal', config.canal)
  registrarFalla(eLectura, `registro de lectura del feed iCal de ${config.canal}`)

  return new Response(cuerpo, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // Sin caché: el valor de esto es estar al día, y una respuesta guardada en un
      // intermediario es justo lo que agranda la ventana del overbooking.
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="ocupacion.ics"',
    },
  })
}
