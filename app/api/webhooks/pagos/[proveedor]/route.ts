import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerProveedor } from '@/lib/payments'
import { puedeAvanzarEstadoPago, type EstadoPago } from '@/lib/domain/pagos'
import { saldarSiCorresponde } from '@/lib/reservas/saldar'

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

  // Un `external_id` identifica la INTENCIÓN de pago, no una entrega concreta:
  // las pasarelas mandan varios eventos sobre el mismo id a medida que la
  // operación avanza (`pendiente` → `aprobado`). Antes, el segundo evento
  // chocaba con la restricción única y se descartaba entero, así que la fila
  // quedaba en `pendiente` para siempre. Como `resumenPagos` solo suma los pagos
  // `aprobado` (lib/domain/pagos.ts:54), la reserva no se saldaba nunca **con la
  // plata ya cobrada**: el huésped llegaba al mostrador figurando como impago.
  if (duplicado) {
    const falla = await avanzarEstadoDelPago(admin, evento.externalId, evento.estado)
    if (falla) return Response.json({ error: falla }, { status: 500 })
  }

  // La conciliación corre TAMBIÉN cuando el evento viene repetido, y es
  // deliberado: si una vez se registró el pago pero la transición de estado
  // falló, la fila de `pagos` ya existe y cualquier reenvío chocaría con la
  // restricción única. Si acá se cortara por «duplicado», esa inconsistencia
  // sería permanente —no habría manera de repararla—. Al reconciliar igual,
  // reenviar el evento se convierte en el modo de arreglarlo.
  if (evento.estado === 'aprobado') {
    const falla = await saldarReserva(admin, evento.reservaId)
    if (falla) return Response.json({ error: falla }, { status: 500 })
  }

  return duplicado ? Response.json({ ok: true, duplicado: true }) : Response.json({ ok: true })
}

/**
 * Avanza el estado de un pago ya registrado, sin permitir retrocesos.
 *
 * Devuelve `null` si no había nada que hacer o salió bien, y el motivo si falló
 * la base. Un fallo acá tiene que responder 500 por la misma razón que el resto
 * del webhook: es el único modo de pedirle el reintento a la pasarela.
 */
async function avanzarEstadoDelPago(
  admin: ClienteAdmin,
  externalId: string,
  estadoEntrante: EstadoPago,
): Promise<string | null> {
  const { data: pago, error: eLectura } = await admin
    .from('pagos')
    .select('estado')
    .eq('external_id', externalId)
    .maybeSingle()
  if (eLectura) return `no se pudo leer el pago existente: ${eLectura.message}`

  // Si no aparece, el 23505 vino de otra restricción única y no de `external_id`.
  // No es este el lugar para adivinar cuál: se deja el pago como está.
  if (!pago) return null

  // La regla de qué transición corresponde vive en el dominio, no acá.
  if (!puedeAvanzarEstadoPago(pago.estado as EstadoPago, estadoEntrante)) return null

  const { error: eEscritura } = await admin
    .from('pagos')
    .update({ estado: estadoEntrante })
    .eq('external_id', externalId)
  if (eEscritura) return `no se pudo actualizar el estado del pago: ${eEscritura.message}`

  return null
}

/**
 * Marca la reserva como `pagada` si los pagos registrados la saldan.
 *
 * La regla vive en `lib/reservas/saldar.ts`: el mostrador (`registrarPago`) hace lo
 * mismo, las dos copias divergieron una vez —allá se corrigió para consolidar
 * alojamiento + consumos y acá no— y una regla de plata duplicada se vuelve a
 * separar. Esta función queda solo para traducir el resultado a lo que el webhook
 * necesita responder.
 *
 * Devuelve `null` cuando no hay nada que hacer o salió bien, y el motivo cuando
 * falló algo de base. Los errores de lectura importan tanto como los de escritura:
 * si no se pudo leer el total o los pagos, el resumen daría «no saldada» y se
 * saltearía la transición **por un problema de infraestructura**, respondiendo `ok`.
 * Eso es exactamente el fallo silencioso que hay que evitar.
 */
async function saldarReserva(admin: ClienteAdmin, reservaId: string): Promise<string | null> {
  const { error, noExiste } = await saldarSiCorresponde(admin, reservaId)

  // Una reserva inexistente NO es motivo de 500: reintentar no la va a hacer
  // aparecer, y un reintento eterno es peor que aceptar el evento. Por eso el módulo
  // compartido lo devuelve aparte del error.
  if (noExiste) return null

  return error
}
