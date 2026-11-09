import { crearClienteAdmin } from '@/lib/supabase/admin'
import { verificarFirmaSvix } from '@/lib/integraciones/firma-svix'
import { esAvance, interpretarEvento } from '@/lib/domain/entregas'
import { permitirIntento } from '@/lib/limites'
import { registrarError } from '@/lib/registro'

/**
 * Webhook de entrega de correo: `POST /api/webhooks/email/{proveedor}`.
 *
 * ── Qué cierra ──────────────────────────────────────────────────────────────
 *
 * Los dos estados que **sólo puede informar el proveedor**: `entregada` y
 * `leida`. Sin esto, un correo pasaba a `enviada` y ahí se quedaba para siempre,
 * y un huésped con la dirección mal cargada figuraba avisado. El rebote —el caso
 * que el hotel de verdad necesita ver— era invisible.
 *
 * ── Por qué 200 a casi todo ─────────────────────────────────────────────────
 *
 * ⚠️ **Un webhook que responde 400 a un evento que no le interesa termina
 * deshabilitado.** Resend manda varios tipos y acumula fallos; cuando corta el
 * endpoint se pierden también los eventos buenos. Es la misma lección que dejó
 * el webhook de pagos, y por eso acá sólo la firma inválida devuelve 4xx.
 *
 * ── Por qué el estado no siempre avanza ─────────────────────────────────────
 *
 * Los eventos llegan **desordenados**. El de apertura puede entrar antes que el
 * de entrega, y aplicarlos a ciegas haría retroceder de `leida` a `entregada`:
 * el sistema olvidaría que el huésped abrió el correo. Lo decide `esAvance`.
 */

export const dynamic = 'force-dynamic'

/** Los proveedores que firman con el esquema de Svix. Hoy sólo Resend. */
const CON_SVIX = new Set(['resend'])

export async function POST(
  req: Request,
  { params }: { params: Promise<{ proveedor: string }> },
) {
  const { proveedor } = await params

  if (!CON_SVIX.has(proveedor)) {
    return Response.json({ error: 'proveedor desconocido' }, { status: 404 })
  }

  const secreto = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secreto) {
    /*
      Fail-closed, igual que el webhook de pagos.

      Sin secreto no se puede distinguir un evento de Resend de uno inventado, y
      aceptar a ciegas dejaría que cualquiera marcara como rebotados los correos
      del hotel — o como leídos los que nadie abrió.
    */
    await registrarError('webhook_email_sin_secreto', { proveedor })
    return Response.json({ error: 'el webhook de correo no está configurado' }, { status: 503 })
  }

  // El cuerpo CRUDO: parsearlo y re-serializarlo cambia espacios y orden de
  // claves, y la firma deja de coincidir.
  const cuerpo = await req.text()

  const verificacion = await verificarFirmaSvix(secreto, req.headers, cuerpo)
  if (!verificacion.valida) {
    // El motivo va al registro y **nunca a la respuesta**: explicarle a quien
    // manda una firma inválida por qué no coincide es ayudarlo a construir una
    // válida.
    await registrarError('webhook_email_firma_invalida', {
      proveedor,
      motivo: verificacion.motivo,
    })

    /*
      El límite se cuenta **acá dentro**, después de rechazar la firma.

      Un evento legítimo viene firmado con el secreto que sólo tiene el proveedor,
      así que no pasa nunca por esta rama. Limitar por volumen antes de verificar
      descartaría eventos buenos en un pico —y perder un rebote es volver a creer
      que un correo llegó cuando no llegó—. Mismo orden que el webhook de pagos.
    */
    if (!(await permitirIntento('webhook_email'))) {
      return Response.json({ error: 'demasiados intentos' }, { status: 429 })
    }
    return Response.json({ error: 'firma inválida' }, { status: 400 })
  }

  let evento: { type?: string; data?: { email_id?: string } }
  try {
    evento = JSON.parse(cuerpo)
  } catch {
    return Response.json({ error: 'cuerpo inválido' }, { status: 400 })
  }

  const entrega = interpretarEvento(evento.type ?? '')
  const emailId = evento.data?.email_id

  // Un evento que no habla de la entrega, o uno sin id: 200 y a otra cosa. No es
  // un fallo del proveedor ni algo que reintentar arregle.
  if (!entrega || !emailId) {
    return Response.json({ ok: true, ignorado: evento.type ?? 'sin tipo' })
  }

  const admin = crearClienteAdmin()

  const { data: fila, error: eLectura } = await admin
    .from('notificaciones')
    .select('id, estado')
    .eq('proveedor_id', emailId)
    .maybeSingle<{ id: string; estado: string }>()

  if (eLectura) {
    // 500 para que reintente: la fila puede estar y ser un problema de momento.
    return Response.json({ error: eLectura.message }, { status: 500 })
  }

  /*
    Sin fila no hay a qué imputarlo, y **200 es lo correcto**: puede ser un correo
    de otro sistema sobre el mismo dominio, o uno anterior a que se guardara el id
    del proveedor. Reintentar no lo va a hacer aparecer.
  */
  if (!fila) {
    return Response.json({ ok: true, ignorado: 'ningún aviso con ese id' })
  }

  if (!esAvance(fila.estado, entrega.estado)) {
    return Response.json({ ok: true, ignorado: `llegó tarde: ${fila.estado} ya es posterior` })
  }

  const ahora = new Date().toISOString()
  const { error } = await admin
    .from('notificaciones')
    .update({
      estado: entrega.estado,
      ...(entrega.sello ? { [entrega.sello]: ahora } : {}),
      // El motivo se escribe sólo cuando el evento trae uno: un `null` acá
      // borraría el error del intento anterior, que es lo que explica el fallo.
      ...(entrega.error ? { error: entrega.error } : {}),
    })
    .eq('id', fila.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, estado: entrega.estado })
}
