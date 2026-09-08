import { crearClienteAdmin } from '@/lib/supabase/admin'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { registrarError, registrarInfo } from '@/lib/registro'
import { DIAS_EXPIRACION } from '@/lib/domain/recordatorios'

/**
 * Tareas de mantenimiento diarias: `POST /api/cron/mantenimiento`.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Estas cuatro funciones existen desde hace fases y **las dispara únicamente
 * pg_cron** (migración 0027), programado dentro de un
 * `do $$ ... exception when others` que **se traga el fallo**: si la extensión no
 * quedó activa, la migración no protesta y las tareas simplemente no corren.
 *
 * La más cara es `expirar_reservas_pendientes`: es la que libera el inventario
 * que retienen las reservas web sin seña. Sin ella, cada reserva abandonada
 * bloquea una unidad **para siempre** y nadie se entera, porque no hay error que
 * mirar. No tiene un solo call site en la aplicación.
 *
 * Y `purgar_errores` (0068) directamente **nunca se programó**: la tabla `errores`
 * crece sin techo.
 *
 * ── Por qué acá y no otra migración de pg_cron ──────────────────────────────
 *
 * Porque el problema no es el horario, es la **visibilidad**. Vercel Cron falla
 * ruidosamente y deja rastro; pg_cron corre dentro de la base y su fallo no llega
 * a ninguna pantalla. Acá cada tarea deja su resultado en `errores` —vía
 * `lib/registro.ts`— así que «se expiraron 3 reservas» y «la expiración falló»
 * son dos cosas que se ven en `/panel/errores`.
 *
 * ⚠️ **Convivir con pg_cron es seguro**: las cuatro son idempotentes. Expirar dos
 * veces no expira de más —la segunda corrida no encuentra nada vencido— y purgar
 * dos veces borra lo mismo. Si en el proyecto hosted pg_cron está activo, esto es
 * una red; si no lo está, es el único camino.
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

interface Tarea {
  nombre: string
  rpc: string
  args?: Record<string, number>
  /** Qué significa el número que devuelve, para el log. */
  unidad: string
}

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
]

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
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
    const { data, error } = await admin.rpc(tarea.rpc, tarea.args ?? {})

    if (error) {
      fallidas.push(tarea.nombre)
      await registrarError('mantenimiento_tarea_fallida', {
        detalle: error.message,
        tarea: tarea.nombre,
      })
      continue
    }

    const n = Number(data ?? 0)
    hechas[tarea.nombre] = n
    // Sólo se anota cuando hizo algo: una corrida que no encontró nada que hacer
    // es lo normal y no vale una línea por día.
    if (n > 0) await registrarInfo('mantenimiento_tarea', { tarea: tarea.nombre, [tarea.unidad]: n })
  }

  // 500 si falló alguna, para que Vercel lo marque y lo reintente. Las que sí
  // corrieron ya surtieron efecto: son idempotentes, reintentar no duplica nada.
  const estado = fallidas.length > 0 ? 500 : 200
  return Response.json({ ok: fallidas.length === 0, hechas, fallidas }, { status: estado })
}

/** Vercel Cron dispara con GET. Mismo camino, misma autenticación. */
export async function GET(req: Request) {
  return POST(req)
}
