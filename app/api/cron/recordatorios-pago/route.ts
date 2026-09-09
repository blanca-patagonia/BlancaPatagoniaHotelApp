import { crearClienteAdmin } from '@/lib/supabase/admin'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { encolar } from '@/lib/notificaciones'
import { registrarError, registrarInfo } from '@/lib/registro'
import { urlDelSitio } from '@/lib/env'
import { formatearUSD } from '@/lib/domain/moneda'
import { resumenPagos, type EstadoPago, type TipoPago } from '@/lib/domain/pagos'

/**
 * Recordatorio de seña pendiente: `POST /api/cron/recordatorios-pago`.
 *
 * Patrón de referencia: los recordatorios de seña/depósito de Invoice Ninja.
 *
 * ── Por qué a los 3 días y no antes o después ───────────────────────────────
 *
 * `expirar_reservas_pendientes` libera la unidad a los 5 días sin seña
 * (migración 0011). Avisar el mismo día que se recibe la reserva sería
 * apurar a alguien que recién está por decidir; esperar a último momento no
 * deja margen para que el pago se acredite. Tres días deja dos de aire.
 *
 * ── Por qué la clave de idempotencia no lleva discriminante ─────────────────
 *
 * A diferencia de `recordatorio_checkin` (que se repite una vez por estadía),
 * una reserva pasa por el estado `pendiente` **una sola vez** en su vida: de
 * ahí sale hacia `confirmada` (llegó la seña) o `cancelada`/expirada. La
 * clave `recordatorio_saldo:<reserva_id>` alcanza sola — no hace falta acotar
 * la ventana de la consulta con un límite superior, porque encolarla de
 * nuevo en la corrida siguiente no manda un segundo correo.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Días sin seña antes de avisar. Deja 2 de margen sobre los 5 de expiración. */
const DIAS_PARA_AVISAR = 3

interface FilaReserva {
  id: string
  codigo: string
  total: number | string
  token: string
  huesped_id: string | null
  huesped: { nombre: string; apellido: string; email: string | null } | null
  pagos: { tipo: TipoPago; monto: number | string; estado: EstadoPago }[]
}

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return Response.json({ error: 'los recordatorios de pago no están configurados' }, { status: 503 })
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  const admin = crearClienteAdmin()
  const corte = new Date(Date.now() - DIAS_PARA_AVISAR * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('reservas')
    .select(
      'id, codigo, total, token, huesped_id, huesped:huespedes!reservas_huesped_id_fkey(nombre, apellido, email), pagos(tipo, monto, estado)',
    )
    .eq('estado', 'pendiente')
    .lte('creada_en', corte)

  if (error) {
    await registrarError('recordatorios_pago_consulta_fallo', { detalle: error.message })
    return Response.json({ error: 'no se pudo consultar reservas pendientes' }, { status: 500 })
  }

  const filas = (data ?? []) as unknown as FilaReserva[]
  let encoladas = 0

  for (const r of filas) {
    const h = r.huesped
    if (!h?.email) continue

    const saldo = resumenPagos(
      Number(r.total),
      (r.pagos ?? []).map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
    ).saldo
    // Ya se acreditó un pago que la sacó de deuda pero el cambio de estado
    // todavía no corrió (o falló): no tiene sentido apurarla por saldo cero.
    if (saldo <= 0) continue

    const res = await encolar(admin, {
      evento: 'recordatorio_saldo',
      entidadId: r.id,
      destinatario: h.email,
      huespedId: r.huesped_id,
      reservaId: r.id,
      variables: {
        nombre: h.nombre || h.apellido,
        codigo: r.codigo,
        total: formatearUSD(saldo),
        dias_restantes: '2 días',
        enlace: `${urlDelSitio()}/reservar/confirmacion/${r.token}`,
      },
    })
    if (res.ok && !res.yaEstaba) encoladas++
  }

  if (encoladas > 0) await registrarInfo('recordatorios_pago', { encoladas })

  return Response.json({ ok: true, encoladas })
}

/** Vercel Cron dispara con GET. Mismo camino, misma autenticación. */
export async function GET(req: Request) {
  return POST(req)
}
