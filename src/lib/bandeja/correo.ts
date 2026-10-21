import 'server-only'
import { interpretarCorreoRecibido } from '@/lib/domain/bandeja-entrante'
import { procesarInterpretacion, type ResultadoEntrada } from './entrante'

/**
 * Correo entrante a la bandeja (Resend Inbound, ADR 0043).
 *
 * El evento `email.received` NO trae el cuerpo: trae el id, y el contenido se
 * pide aparte a `GET /emails/receiving/{id}`. Es la forma documentada por
 * Resend, y la razón de que esto necesite `RESEND_API_KEY` además del secreto
 * del webhook.
 */
export async function procesarCorreoRecibido(emailId: string): Promise<ResultadoEntrada | { error: string }> {
  const clave = process.env.RESEND_API_KEY?.trim()
  if (!clave) return { error: 'Falta RESEND_API_KEY para leer el correo recibido.' }

  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${clave}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) return { error: `Resend respondió ${r.status} al pedir el correo recibido.` }

  const correo = await r.json()
  // El correo que viene desde la propia dirección del hotel no es de un huésped.
  const propia = process.env.BANDEJA_EMAIL?.trim() || process.env.EMAIL_FROM?.trim()
  return procesarInterpretacion(interpretarCorreoRecibido(correo, propia))
}
