import { anotarCorrida } from '@/lib/crons'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { registrarError, registrarInfo } from '@/lib/registro'
import { DIAS_EXPIRACION } from '@/lib/domain/recordatorios'
import { hoyISO } from '@/lib/fechas'

/**
 * Tareas de mantenimiento diarias: `POST /api/cron/mantenimiento`.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Cuatro de estas cinco tareas son funciones de Postgres que existen desde
 * hace fases y **las dispara únicamente pg_cron** (migración 0027), programado
 * dentro de un `do $$ ... exception when others` que **se traga el fallo**: si
 * la extensión no quedó activa, la migración no protesta y las tareas
 * simplemente no corren.
 *
 * La más cara es `expirar_reservas_pendientes`: es la que libera el inventario
 * que retienen las reservas web sin seña. Sin ella, cada reserva abandonada
 * bloquea una unidad **para siempre** y nadie se entera, porque no hay error que
 * mirar. No tiene un solo call site en la aplicación.
 *
 * Y `purgar_errores` (0068) directamente **nunca se programó**: la tabla `errores`
 * crece sin techo.
 *
 * La quinta, `vencer_contratos`, es distinta: no es una función de la base —no
 * hay migración de pg_cron que la cubra—, es el mismo `update` que hace el botón
 * «Marcar vencidos» de `/panel/contratos`, que hasta ahora solo corría si
 * alguien entraba a esa pantalla y lo apretaba. Un contrato podía seguir
 * «vigente» semanas después de vencido si nadie miraba esa pantalla puntual.
 *
 * ── Por qué acá y no otra migración de pg_cron ──────────────────────────────
 *
 * Porque el problema no es el horario, es la **visibilidad**. Vercel Cron falla
 * ruidosamente y deja rastro; pg_cron corre dentro de la base y su fallo no llega
 * a ninguna pantalla. Acá cada tarea deja su resultado en `errores` —vía
 * `lib/registro.ts`— así que «se expiraron 3 reservas» y «la expiración falló»
 * son dos cosas que se ven en `/panel/errores`.
 *
 * ⚠️ **Convivir con pg_cron es seguro**: las cinco son idempotentes. Expirar dos
 * veces no expira de más —la segunda corrida no encuentra nada vencido— y purgar
 * dos veces borra lo mismo. Si en el proyecto hosted pg_cron está activo, esto es
 * una red para las primeras cuatro; si no lo está, es el único camino para todas.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/*
  Los días de expiración salen de `lib/domain/recordatorios.ts` y no se declaran
  acá.

  Es el mismo número que decide **cuándo se avisa** que la reserva está por
  liberarse. Con dos constantes, subir una sin la otra haría que el aviso saliera
  después de que la reserva ya se liberó: un correo diciéndole al huésped que
  tiene 24 horas para señar algo que el sistema ya soltó.
*/

/** Retención de la tabla `errores` (migración 0068). */
const DIAS_ERRORES = 90

type ClienteAdmin = ReturnType<typeof crearClienteAdmin>

type ResultadoTarea = Promise<{ n: number; error: { message: string } | null }>

interface TareaRpc {
  nombre: string
  /** Qué significa el número que devuelve, para el log. */
  unidad: string
  rpc: string
  args?: Record<string, number>
}

interface TareaPropia {
  nombre: string
  unidad: string
  /**
   * Para la tarea que no es una función de Postgres (ver `vencerContratos` de
   * `app/panel/contratos/actions.ts`, hoy solo a mano): recibe el cliente con
   * `service_role` —que saltea RLS igual que una función `security definer`—
   * y devuelve cuántas filas tocó.
   */
  ejecutar: (admin: ClienteAdmin) => ResultadoTarea
}

type Tarea = TareaRpc | TareaPropia

const TAREAS: readonly Tarea[] = [
  {
    nombre: 'expirar_reservas_pendientes',
    rpc: 'expirar_reservas_pendientes',
    args: { p_dias: DIAS_EXPIRACION },
    unidad: 'reservas liberadas',
  },
  {
    nombre: 'vencer_comprobantes_proveedor',
    rpc: 'vencer_comprobantes_proveedor',
    unidad: 'comprobantes vencidos',
  },
  {
    nombre: 'generar_mantenimiento_preventivo',
    rpc: 'generar_mantenimiento_preventivo',
    unidad: 'órdenes generadas',
  },
  {
    nombre: 'purgar_errores',
    rpc: 'purgar_errores',
    args: { p_dias: DIAS_ERRORES },
    unidad: 'errores purgados',
  },
  {
    nombre: 'vencer_contratos',
    unidad: 'contratos vencidos',
    // Mismo criterio que `vencerContratos()`: enviado, con vigencia cargada y
    // ya pasada. Antes solo corría si alguien entraba a `/panel/contratos` y
    // apretaba el botón; un contrato podía seguir «vigente» semanas después de
    // vencido si nadie miraba esa pantalla.
    ejecutar: async (admin) => {
      const { data, error } = await admin
        .from('contratos')
        .update({ estado: 'vencido' })
        .eq('estado', 'enviado')
        .not('vigencia_hasta', 'is', null)
        .lt('vigencia_hasta', hoyISO())
        .select('id')
      return { n: data?.length ?? 0, error }
    },
  },
]

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    // Sin esto el cron dejaba de correr sin ningún rastro: Vercel lo llamaba,
    // recibía 503 y nadie del hotel se enteraba.
    await registrarError('cron_sin_secreto', { cron: 'mantenimiento' })
    return Response.json({ error: 'el mantenimiento programado no está configurado' }, { status: 503 })
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  const admin = crearClienteAdmin()
  const hechas: Record<string, number> = {}
  const fallidas: string[] = []

  /*
    Una tarea que falla NO frena a las otras.

    Son independientes entre sí, y que no se pueda purgar la tabla de errores no
    es motivo para dejar de liberar inventario. Cada fallo se registra por
    separado con su nombre, así que en `/panel/errores` se ve cuál fue.
  */
  for (const tarea of TAREAS) {
    // `ejecutar` no es una función de Postgres: puede lanzar (una conexión que
    // se corta, un error de programación) donde `.rpc()` normalmente resuelve
    // con `{ error }`. Sin este `try`, esa excepción saldría del `for` entero y
    // el resto de las tareas —incluida `purgar_errores`, que va al final— no
    // llegaría a correr, justo lo que este bloque existe para evitar.
    const { n, error } = await (async () => {
      try {
        return 'ejecutar' in tarea
          ? await tarea.ejecutar(admin)
          : await admin
              .rpc(tarea.rpc, tarea.args ?? {})
              .then(({ data, error }) => ({ n: Number(data ?? 0), error }))
      } catch (excepcion) {
        return {
          n: 0,
          error: { message: excepcion instanceof Error ? excepcion.message : String(excepcion) },
        }
      }
    })()

    if (error) {
      fallidas.push(tarea.nombre)
      await registrarError('mantenimiento_tarea_fallida', {
        detalle: error.message,
        tarea: tarea.nombre,
      })
      continue
    }

    hechas[tarea.nombre] = n
    // Sólo se anota cuando hizo algo: una corrida que no encontró nada que hacer
    // es lo normal y no vale una línea por día.
    if (n > 0) await registrarInfo('mantenimiento_tarea', { tarea: tarea.nombre, [tarea.unidad]: n })
  }

  // 500 si falló alguna, para que Vercel lo marque y lo reintente. Las que sí
  // corrieron ya surtieron efecto: son idempotentes, reintentar no duplica nada.
  const estado = fallidas.length > 0 ? 500 : 200
  await anotarCorrida('mantenimiento', fallidas.length === 0, JSON.stringify(fallidas))
  return Response.json({ ok: fallidas.length === 0, hechas, fallidas }, { status: estado })
}

/** Vercel Cron dispara con GET. Mismo camino, misma autenticación. */
export async function GET(req: Request) {
  return POST(req)
}
