import { crearClienteAdmin } from '@/lib/supabase/admin'
import { hmacHex, comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { esAvanceDeEntrega, type EstadoNotificacion } from '@/lib/domain/notificaciones'
import { permitirIntento } from '@/lib/limites'
import { registrarError, registrarInfo } from '@/lib/registro'

/**
 * Webhook de WhatsApp (Meta Cloud API): `GET`/`POST /api/webhooks/whatsapp`.
 *
 * Patrón de referencia: Evolution API — arquitectura basada en webhooks, no en
 * sondear al proveedor. Meta manda dos tipos de evento acá: **estados de
 * entrega** de lo que el hotel mandó (`statuses`) y **mensajes entrantes**
 * del huésped (`messages`).
 *
 * ── El handshake de GET ──────────────────────────────────────────────────────
 *
 * Meta exige verificar la URL del webhook antes de activarla: manda
 * `hub.mode=subscribe`, `hub.verify_token` (el que se configuró en Meta
 * Business Manager) y `hub.challenge`, y espera el challenge de vuelta tal
 * cual si el token coincide. Sin esto, Meta nunca activa el webhook.
 *
 * ── Lo que este webhook NO hace ─────────────────────────────────────────────
 *
 * Los mensajes ENTRANTES del huésped solo se registran en el log
 * (`registrarInfo`), no se enrutan a `conversaciones` ni generan una
 * respuesta automática. Tender un puente de dos vías con el chat interno es
 * una integración más grande, que queda fuera de esta pasada — está anotado
 * en la bitácora para que no se dé por hecho que ya existe.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token') ?? ''
  const challenge = url.searchParams.get('hub.challenge') ?? ''

  const esperado = process.env.WHATSAPP_VERIFY_TOKEN
  if (!esperado) {
    return Response.json({ error: 'el webhook de WhatsApp no está configurado' }, { status: 503 })
  }

  if (modo === 'subscribe' && comparacionConstante(token, esperado)) {
    return new Response(challenge, { status: 200 })
  }
  return Response.json({ error: 'verificación rechazada' }, { status: 403 })
}

interface EstadoMeta {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
}

interface MensajeEntranteMeta {
  from: string
  id: string
  type: string
}

interface PayloadMeta {
  entry?: {
    changes?: {
      value?: {
        statuses?: EstadoMeta[]
        messages?: MensajeEntranteMeta[]
      }
    }[]
  }[]
}

const ESTADO_META_A_PROPIO: Partial<Record<EstadoMeta['status'], 'entregada' | 'leida' | 'fallida'>> = {
  delivered: 'entregada',
  read: 'leida',
  failed: 'fallida',
}

export async function POST(req: Request) {
  const secreto = process.env.WHATSAPP_APP_SECRET
  if (!secreto) {
    return Response.json({ error: 'el webhook de WhatsApp no está configurado' }, { status: 503 })
  }

  const crudo = await req.text()
  const firmaRecibida = req.headers.get('x-hub-signature-256') ?? ''
  const firmaEsperada = `sha256=${await hmacHex(secreto, crudo)}`

  if (!comparacionConstante(firmaRecibida, firmaEsperada)) {
    // El límite se cuenta DESPUÉS de rechazar la firma, nunca antes: un evento
    // legítimo viene firmado con un secreto que solo tiene Meta, así que no
    // pasa por acá por muchos que lleguen en un pico real de mensajes.
    if (!(await permitirIntento('webhook_whatsapp'))) {
      return Response.json({ error: 'demasiados intentos' }, { status: 429 })
    }
    return Response.json({ error: 'firma inválida' }, { status: 401 })
  }

  let payload: PayloadMeta
  try {
    payload = JSON.parse(crudo) as PayloadMeta
  } catch {
    // Firma válida pero cuerpo no es JSON: sería un evento de Meta con un
    // formato nuevo. 200, no 400 — un webhook que rechaza lo que no entiende
    // termina deshabilitado, y con él se pierden también los avisos buenos.
    return Response.json({ ok: true, ignorado: 'cuerpo no es JSON' })
  }

  const admin = crearClienteAdmin()
  let actualizadas = 0
  let entrantes = 0

  for (const entrada of payload.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      for (const estado of cambio.value?.statuses ?? []) {
        const nuevo = ESTADO_META_A_PROPIO[estado.status]
        if (!nuevo) continue // 'sent' no aporta nada que 'enviada' no dijera ya.

        const { data: fila } = await admin
          .from('notificaciones')
          .select('id, estado')
          .eq('id_externo', estado.id)
          .maybeSingle<{ id: string; estado: EstadoNotificacion }>()
        if (!fila) continue // Mensaje de otra instancia, o entrada vieja ya purgada.

        if (!esAvanceDeEntrega(fila.estado, nuevo)) continue

        const { error } = await admin.from('notificaciones').update({ estado: nuevo }).eq('id', fila.id)
        if (error) {
          await registrarError('whatsapp_actualizar_estado_fallo', { detalle: error.message, idExterno: estado.id })
        } else {
          actualizadas++
        }
      }

      entrantes += cambio.value?.messages?.length ?? 0
    }
  }

  if (entrantes > 0) {
    await registrarInfo('whatsapp_mensajes_entrantes', {
      cantidad: entrantes,
      nota: 'No enrutado a conversaciones todavía — solo registrado.',
    })
  }
  if (actualizadas > 0) await registrarInfo('whatsapp_estados_actualizados', { actualizadas })

  // Siempre 200 con firma válida: lo que no se pudo procesar quedó en el log,
  // pero reintentar el mismo evento no lo va a arreglar (no es un corte de
  // red, es una fila que no se encontró o un evento que no interesa).
  return Response.json({ ok: true, actualizadas, entrantes })
}
