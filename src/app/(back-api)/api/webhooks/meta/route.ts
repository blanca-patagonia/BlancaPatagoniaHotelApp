import { verificarFirmaMeta } from '@/lib/integraciones/firma-meta'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { interpretarMensajeriaMeta, interpretarWhatsApp } from '@/lib/domain/bandeja-entrante'
import { procesarInterpretacion } from '@/lib/bandeja/entrante'
import { permitirIntento } from '@/lib/limites'
import { registrarError } from '@/lib/registro'

/**
 * Webhook de Meta para la bandeja (ADR 0043): `/api/webhooks/meta`.
 *
 * UN endpoint para WhatsApp, Instagram y Messenger. Meta los distingue por el
 * campo `object` (`whatsapp_business_account`, `instagram`, `page`), así que en
 * la app de Meta se configura la misma URL en los tres productos con el mismo
 * token de verificación. Chatwoot usa tres controladores; acá la diferencia
 * vive en el intérprete de cada forma (`lib/domain/bandeja-entrante.ts`).
 *
 * ── GET: la verificación de la suscripción ───────────────────────────────────
 *
 * Al guardar la URL en Meta, Meta llama con `hub.mode=subscribe`,
 * `hub.verify_token` y `hub.challenge`, y espera recibir el `challenge` tal
 * cual. El token es uno que inventa el hotel (`META_WEBHOOK_VERIFY_TOKEN`).
 *
 * ── POST: fail-closed ────────────────────────────────────────────────────────
 *
 * Sin `META_APP_SECRET` no se puede saber si el evento es de Meta, y aceptarlo
 * dejaría que cualquiera escriba en la bandeja haciéndose pasar por un huésped.
 * Mismo criterio que los webhooks de pagos y de correo.
 *
 * ── Por qué 200 a casi todo ──────────────────────────────────────────────────
 *
 * Un webhook que responde error a eventos que no le interesan termina
 * deshabilitado por Meta, y ahí se pierden también los mensajes. Sólo la firma
 * inválida (401) y un fallo al guardar (500, para que Meta reintente) responden
 * otra cosa.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token') ?? ''
  const desafio = url.searchParams.get('hub.challenge') ?? ''
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()

  if (!esperado) {
    await registrarError('webhook_meta_sin_token_de_verificacion', {})
    return Response.json({ error: 'el webhook de Meta no está configurado' }, { status: 503 })
  }
  if (modo !== 'subscribe' || !comparacionConstante(token, esperado)) {
    return Response.json({ error: 'token de verificación incorrecto' }, { status: 403 })
  }
  // El desafío vuelve como texto plano: Meta compara el cuerpo literal.
  return new Response(desafio, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(req: Request) {
  const secretos = [process.env.META_APP_SECRET?.trim(), process.env.INSTAGRAM_APP_SECRET?.trim()]
  if (!secretos.some(Boolean)) {
    await registrarError('webhook_meta_sin_secreto', {})
    return Response.json({ error: 'el webhook de Meta no está configurado' }, { status: 503 })
  }

  // El cuerpo CRUDO: re-serializarlo cambia bytes y la firma deja de coincidir.
  const cuerpo = await req.text()

  if (!(await verificarFirmaMeta(secretos, req.headers.get('x-hub-signature-256'), cuerpo))) {
    await registrarError('webhook_meta_firma_invalida', {})
    // El límite se cuenta acá, después de rechazar: los eventos legítimos nunca
    // pasan por esta rama (ver `webhook_meta` en `lib/domain/limites.ts`).
    if (!(await permitirIntento('webhook_meta'))) {
      return Response.json({ error: 'demasiados intentos' }, { status: 429 })
    }
    return Response.json({ error: 'firma inválida' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(cuerpo)
  } catch {
    return Response.json({ error: 'cuerpo inválido' }, { status: 400 })
  }

  const objeto = (payload as { object?: string })?.object
  const interpretacion =
    objeto === 'whatsapp_business_account'
      ? interpretarWhatsApp(payload)
      : interpretarMensajeriaMeta(
          payload,
          objeto === 'instagram'
            ? process.env.INSTAGRAM_ACCOUNT_ID?.trim()
            : process.env.MESSENGER_PAGE_ID?.trim(),
        )

  if (interpretacion.mensajes.length === 0 && interpretacion.estados.length === 0) {
    return Response.json({ ok: true, ignorado: objeto ?? 'sin objeto' })
  }

  const r = await procesarInterpretacion(interpretacion)
  if (r.fallidos > 0) {
    // 500 para que Meta reintente; lo que ya entró no se duplica (externo_id).
    return Response.json({ error: 'no se pudo guardar todo el lote' }, { status: 500 })
  }
  return Response.json({ ok: true, guardados: r.guardados, duplicados: r.duplicados, estados: r.estados })
}
