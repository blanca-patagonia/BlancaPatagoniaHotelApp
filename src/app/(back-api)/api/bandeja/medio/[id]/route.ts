import { obtenerSesion } from '@/lib/auth/session'
import { puedeAcceder } from '@/lib/domain/permisos'
import { registrarError } from '@/lib/registro'

/**
 * Archivos que el huésped mandó por WhatsApp: `GET /api/bandeja/medio/{id}`.
 *
 * WhatsApp NO entrega la URL del archivo: entrega un ID, y el archivo se baja
 * con el token del hotel en dos pasos —pedir la URL, bajarla—. Esa URL vence a los
 * pocos minutos, así que no se puede guardar en el mensaje: hay que resolverla
 * cada vez que se mira. Es lo que hace `download_attachment_file` en Chatwoot.
 *
 * ── Por qué es un proxy y no un enlace ───────────────────────────────────────
 *
 * El navegador del staff no tiene el token (y no debe tenerlo): el servidor baja
 * el archivo y lo reenvía. Eso lo convierte en una puerta, así que:
 *
 *  · Sólo staff con acceso a la bandeja (los mismos tres roles de RLS).
 *  · El `id` son SÓLO dígitos: un id con barras o `?` armaría una URL a otro
 *    recurso del Graph con el token del hotel (SSRF).
 *  · El tipo de contenido sale de una lista blanca. Un archivo que el huésped
 *    mandó es contenido de un desconocido: un HTML servido como `text/html` ejecutaría
 *    su script con el origen del panel. Lo que no está en la lista se descarga
 *    como binario, y toda respuesta lleva `nosniff` y una CSP que lo aísla.
 *  · Tope de tamaño: un archivo enorme no tiene que pasar por la función.
 */

export const dynamic = 'force-dynamic'

const GRAPH = 'v21.0'
const TIMEOUT_MS = 15_000
const TOPE_BYTES = 16 * 1024 * 1024

/** Tipos que se muestran en la propia pantalla. El resto se baja como archivo. */
const MOSTRABLES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'video/mp4',
  'video/3gpp',
  'application/pdf',
])

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await obtenerSesion()
  if (!sesion) return new Response('No autorizado', { status: 401 })
  if (!puedeAcceder(sesion.rol, 'bandeja')) return new Response('Sin acceso', { status: 403 })

  const { id } = await params
  if (!/^\d{5,30}$/.test(id)) return new Response('Identificador inválido', { status: 400 })

  const token = process.env.WHATSAPP_TOKEN?.trim()
  if (!token) return new Response('WhatsApp no está configurado', { status: 503 })
  const cab = { Authorization: `Bearer ${token}` }

  try {
    const meta = await fetch(`https://graph.facebook.com/${GRAPH}/${id}`, { headers: cab, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!meta.ok) {
      // 401/403: token vencido. 404: el archivo ya no está en Meta (los medios se borran a los 30 días).
      return new Response('El archivo no está disponible', { status: meta.status === 404 ? 404 : 502 })
    }
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number }
    if (!info.url || !/^https:\/\//.test(info.url)) return new Response('Respuesta inesperada de Meta', { status: 502 })
    if ((info.file_size ?? 0) > TOPE_BYTES) return new Response('El archivo es demasiado grande', { status: 413 })

    const archivo = await fetch(info.url, { headers: cab, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!archivo.ok || !archivo.body) return new Response('No se pudo bajar el archivo', { status: 502 })

    const tipo = (info.mime_type ?? '').split(';')[0].trim().toLowerCase()
    const mostrable = MOSTRABLES.has(tipo)

    return new Response(archivo.body, {
      status: 200,
      headers: {
        'Content-Type': mostrable ? tipo : 'application/octet-stream',
        'Content-Disposition': mostrable ? 'inline' : 'attachment',
        'X-Content-Type-Options': 'nosniff',
        // Aislado aunque el navegador lo abra solo: sin scripts, sin nada.
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (e) {
    await registrarError('bandeja_medio_fallo', { motivo: e instanceof Error ? e.message : String(e) })
    return new Response('No se pudo obtener el archivo', { status: 502 })
  }
}
