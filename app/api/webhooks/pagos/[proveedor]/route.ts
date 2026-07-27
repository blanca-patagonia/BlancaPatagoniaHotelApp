import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerProveedor } from '@/lib/payments'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { puedeTransicionar, type EstadoReserva } from '@/lib/domain/reservas'

/**
 * Webhook de pagos: `POST /api/webhooks/pagos/{proveedor}`.
 *
 * Idempotente: cada evento trae un `external_id` único (columna `pagos.external_id`
 * con restricción UNIQUE); un evento repetido choca con la restricción y se ignora
 * de forma segura. Corre con `service_role` (sin sesión de usuario) y, si el pago
 * salda la reserva, la transiciona a `pagada`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ proveedor: string }> },
) {
  const { proveedor } = await params
  const prov = obtenerProveedor(proveedor)
  if (!prov) return Response.json({ error: 'proveedor desconocido' }, { status: 404 })

  if (!(await prov.verificarFirma(req.clone()))) {
    return Response.json({ error: 'firma inválida' }, { status: 401 })
  }

  const evento = await prov.parsearWebhook(req)
  if (!evento) return Response.json({ error: 'evento inválido' }, { status: 400 })

  const admin = crearClienteAdmin()
  const { error } = await admin.from('pagos').insert({
    reserva_id: evento.reservaId,
    medio: evento.medio,
    tipo: evento.tipo,
    monto: evento.monto,
    estado: evento.estado,
    external_id: evento.externalId,
  })

  if (error) {
    // 23505 = unique_violation → el evento ya fue procesado (idempotencia).
    if (error.code === '23505') return Response.json({ ok: true, duplicado: true })
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (evento.estado === 'aprobado') {
    const { data: reserva } = await admin
      .from('reservas')
      .select('estado, total')
      .eq('id', evento.reservaId)
      .single()
    if (reserva && reserva.estado !== 'pagada') {
      const { data: pagos } = await admin
        .from('pagos')
        .select('tipo, monto, estado')
        .eq('reserva_id', evento.reservaId)
      const resumen = resumenPagos(Number(reserva.total), (pagos ?? []) as Pago[])
      if (resumen.saldada && puedeTransicionar(reserva.estado as EstadoReserva, 'pagada')) {
        await admin.from('reservas').update({ estado: 'pagada' }).eq('id', evento.reservaId)
      }
    }
  }

  return Response.json({ ok: true })
}
