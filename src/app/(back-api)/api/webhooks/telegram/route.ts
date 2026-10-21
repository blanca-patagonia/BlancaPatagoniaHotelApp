import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { interpretarTelegram } from '@/lib/domain/bandeja-entrante'
import { procesarInterpretacion } from '@/lib/bandeja/entrante'
import { permitirIntento } from '@/lib/limites'
import { registrarError } from '@/lib/registro'

/**
 * Webhook del bot de Telegram para la bandeja (ADR 0043): `/api/webhooks/telegram`.
 *
 * Telegram no firma el cuerpo: al registrar el webhook (`setWebhook`) se le da
 * un `secret_token` y lo devuelve en cada pedido en la cabecera
 * `X-Telegram-Bot-Api-Secret-Token`. Sin esa cabecera correcta, el pedido no es
 * de Telegram. Fail-closed igual que los demás webhooks.
 *
 * El registro del webhook lo hace la pantalla de Integraciones (botón
 * «Conectar el bot»), que ya conoce la URL pública y el secreto.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secreto = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!secreto || !process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    await registrarError('webhook_telegram_sin_configurar', {})
    return Response.json({ error: 'el webhook de Telegram no está configurado' }, { status: 503 })
  }

  const recibido = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!comparacionConstante(recibido, secreto)) {
    await registrarError('webhook_telegram_token_invalido', {})
    if (!(await permitirIntento('webhook_telegram'))) {
      return Response.json({ error: 'demasiados intentos' }, { status: 429 })
    }
    return Response.json({ error: 'token inválido' }, { status: 401 })
  }

  let update: unknown
  try {
    update = await req.json()
  } catch {
    return Response.json({ error: 'cuerpo inválido' }, { status: 400 })
  }

  const interpretacion = interpretarTelegram(update)
  if (interpretacion.mensajes.length === 0) return Response.json({ ok: true, ignorado: true })

  const r = await procesarInterpretacion(interpretacion)
  if (r.fallidos > 0) return Response.json({ error: 'no se pudo guardar' }, { status: 500 })
  return Response.json({ ok: true })
}
