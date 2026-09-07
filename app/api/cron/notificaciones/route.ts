import { crearClienteAdmin } from '@/lib/supabase/admin'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { despachar } from '@/lib/notificaciones'
import { registrarError, registrarInfo } from '@/lib/registro'

/**
 * Despacho de la bandeja de salida: `POST /api/cron/notificaciones`.
 *
 * Toma lo pendiente que ya venció y lo manda. Encolar y enviar están separados a
 * propósito (ver el encabezado de `lib/notificaciones`): la acción que origina el
 * hecho anota qué comunicar y termina, así que un proveedor lento no demora el
 * alta de una reserva ni un fallo suyo se pierde.
 *
 * ── Cada 5 minutos, y por qué no menos ──────────────────────────────────────
 *
 * La confirmación de reserva es lo único que el huésped está esperando en el
 * momento, y cinco minutos de demora ahí es aceptable —el correo tarda lo suyo en
 * llegar igual—. Bajar a un minuto multiplicaría por cinco las invocaciones para
 * ganar una diferencia que nadie percibe.
 *
 * ⚠️ El límite por corrida existe para que una bandeja acumulada —un corte largo
 * del proveedor— no haga que la función se pase del `maxDuration` y no termine
 * **ninguna**. Lo que no entra en esta corrida entra en la siguiente.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cuántas se procesan por corrida. Ver el aviso de arriba. */
const POR_CORRIDA = 25

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return Response.json({ error: 'el despacho de avisos no está configurado' }, { status: 503 })
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  let resumen
  try {
    resumen = await despachar(crearClienteAdmin(), POR_CORRIDA)
  } catch (e) {
    await registrarError('despacho_avisos_fallo', {
      detalle: e instanceof Error ? e.message : String(e),
    })
    // 500 para que el disparador reintente: la bandeja no perdió nada, las filas
    // siguen pendientes.
    return Response.json({ error: 'no se pudo despachar la bandeja' }, { status: 500 })
  }

  // Sólo se anota cuando hubo algo que hacer: una corrida vacía es lo normal cada
  // cinco minutos y no vale una línea de log.
  if (resumen.tomadas > 0) await registrarInfo('despacho_avisos', { ...resumen })

  return Response.json({ ok: true, ...resumen })
}

/** Vercel Cron dispara con GET. */
export async function GET(req: Request) {
  return POST(req)
}
