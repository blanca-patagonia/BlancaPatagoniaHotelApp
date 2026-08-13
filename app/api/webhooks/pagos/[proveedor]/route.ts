import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerProveedor } from '@/lib/payments'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { puedeTransicionar, type EstadoReserva } from '@/lib/domain/reservas'

type ClienteAdmin = ReturnType<typeof crearClienteAdmin>

/**
 * Webhook de pagos: `POST /api/webhooks/pagos/{proveedor}`.
 *
 * Idempotente: cada evento trae un `external_id` único (columna `pagos.external_id`
 * con restricción UNIQUE); un evento repetido choca con la restricción y no se
 * inserta dos veces. Corre con `service_role` (sin sesión de usuario) y, si el
 * pago salda la reserva, la transiciona a `pagada`.
 *
 * ⚠️ Para una pasarela, un `200` significa «entregado, no reintentes». Por eso
 * **todo fallo de base tiene que responder 500**: es el único modo de pedir el
 * reintento. Una respuesta `ok` con el trabajo a medias deja la plata cobrada y
 * la reserva sin marcar, y nadie se entera.
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

  // 23505 = unique_violation → este evento ya se había registrado.
  const duplicado = error?.code === '23505'
  if (error && !duplicado) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // La conciliación corre TAMBIÉN cuando el evento viene repetido, y es
  // deliberado: si una vez se registró el pago pero la transición de estado
  // falló, la fila de `pagos` ya existe y cualquier reenvío chocaría con la
  // restricción única. Si acá se cortara por «duplicado», esa inconsistencia
  // sería permanente —no habría manera de repararla—. Al reconciliar igual,
  // reenviar el evento se convierte en el modo de arreglarlo.
  if (evento.estado === 'aprobado') {
    const falla = await saldarSiCorresponde(admin, evento.reservaId)
    if (falla) return Response.json({ error: falla }, { status: 500 })
  }

  return duplicado ? Response.json({ ok: true, duplicado: true }) : Response.json({ ok: true })
}

/**
 * Marca la reserva como `pagada` si los pagos registrados la saldan.
 *
 * Devuelve `null` cuando no hay nada que hacer o salió bien, y el motivo cuando
 * falló algo de base. Los errores de lectura importan tanto como los de
 * escritura: si no se pudo leer el total o los pagos, el resumen daría «no
 * saldada» y se saltearía la transición **por un problema de infraestructura**,
 * respondiendo `ok`. Eso es exactamente el fallo silencioso que hay que evitar.
 */
async function saldarSiCorresponde(
  admin: ClienteAdmin,
  reservaId: string,
): Promise<string | null> {
  // `maybeSingle` y no `single`: si la reserva no existe, no es un error de
  // infraestructura y no tiene sentido pedirle a la pasarela que reintente.
  const { data: reserva, error: eReserva } = await admin
    .from('reservas')
    .select('estado, total')
    .eq('id', reservaId)
    .maybeSingle()
  if (eReserva) return `no se pudo leer la reserva: ${eReserva.message}`
  if (!reserva || reserva.estado === 'pagada') return null

  const { data: pagos, error: ePagos } = await admin
    .from('pagos')
    .select('tipo, monto, estado')
    .eq('reserva_id', reservaId)
  if (ePagos) return `no se pudieron leer los pagos: ${ePagos.message}`

  const resumen = resumenPagos(Number(reserva.total), (pagos ?? []) as Pago[])
  if (!resumen.saldada) return null

  // Una reserva anulada que quedó saldada no se transiciona: la máquina de
  // estados no lo permite. Queda fuera del alcance de este webhook resolver qué
  // hacer con esa plata; es una decisión del hotel, no del código.
  if (!puedeTransicionar(reserva.estado as EstadoReserva, 'pagada')) return null

  const { error: eEstado } = await admin
    .from('reservas')
    .update({ estado: 'pagada' })
    .eq('id', reservaId)
  if (eEstado) return `no se pudo marcar la reserva como pagada: ${eEstado.message}`

  return null
}
