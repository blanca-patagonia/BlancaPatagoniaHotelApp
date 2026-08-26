'use server'

/**
 * Desenlace del pago simulado.
 *
 * Dispara el webhook **contra el endpoint real**, firmado con el mismo HMAC que
 * usaría una pasarela. No toca la base directamente, y esa es la decisión que
 * hace que el simulador sirva para algo: si escribiera en `pagos` por su cuenta,
 * estaría probando un camino que en producción no existe, y el día que se
 * enchufe MercadoPago aparecerían bugs en el código que nunca se ejercitó.
 *
 * Lo que se ejercita acá es: verificación de firma → parseo → contraste de
 * importe → transición de estado → saldado de la reserva.
 */

import { redirect } from 'next/navigation'
import { proveedoresHabilitados, nombreClave } from '@/lib/payments'
import { firmar } from '@/lib/integraciones/firma-webhook'
import { urlDelSitio } from '@/lib/env'

export async function resolverPagoSimulado(formData: FormData): Promise<void> {
  // Misma guarda que la pantalla: sin simulador habilitado, esta acción no hace
  // nada. Una Server Action es un endpoint POST y se puede invocar sin pasar por
  // la pantalla que la muestra.
  const habilitado = proveedoresHabilitados().some((p) => nombreClave(p) === 'simulado')
  if (!habilitado) redirect('/')

  const volver = String(formData.get('volver') ?? '/')

  const cuerpo = JSON.stringify({
    external_id: String(formData.get('external_id') ?? ''),
    reserva_id: String(formData.get('reserva_id') ?? ''),
    monto: Number(formData.get('monto') ?? 0),
    moneda: String(formData.get('moneda') ?? 'USD'),
    tipo: String(formData.get('tipo') ?? 'saldo'),
    estado: String(formData.get('estado') ?? 'aprobado'),
  })

  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' }

  /*
    La firma sólo se agrega si hay secreto configurado.

    Sin él, `ProveedorSimulado.verificarFirma` acepta fuera de producción —es el
    enganche de desarrollo— y rechaza en producción. Firmar igual, con un
    secreto inventado, haría que el webhook rechace todo y el simulador no
    sirviera para probar nada.
  */
  const secreto = process.env.PAGO_WEBHOOK_SECRET
  if (secreto) {
    const ts = String(Math.floor(Date.now() / 1000))
    cabeceras['x-webhook-timestamp'] = ts
    cabeceras['x-webhook-signature'] = await firmar(secreto, ts, cuerpo)
  }

  const base = urlDelSitio().replace(/\/$/, '')

  try {
    const res = await fetch(`${base}/api/webhooks/pagos/simulado`, {
      method: 'POST',
      headers: cabeceras,
      body: cuerpo,
      // El webhook es el que decide; no hay nada que cachear.
      cache: 'no-store',
    })

    if (!res.ok) {
      const detalle = await res.text()
      console.error(`[pago simulado] el webhook respondió ${res.status}: ${detalle.slice(0, 300)}`)
      redirect(`${volver}?error=pago_simulado`)
    }
  } catch (e) {
    // `redirect` lanza para cortar el flujo: hay que dejarla pasar, o el catch
    // se comería la navegación y la pantalla quedaría en blanco.
    if (esRedirect(e)) throw e
    console.error(`[pago simulado] no se pudo llamar al webhook: ${mensaje(e)}`)
    redirect(`${volver}?error=pago_simulado`)
  }

  redirect(volver)
}

/**
 * ¿Esta excepción es el `redirect` de Next y no un error de verdad?
 *
 * Next implementa la navegación lanzando un error con `digest` que empieza con
 * `NEXT_REDIRECT`. Un `catch` que no lo distinga cancela la navegación y deja al
 * huésped mirando una pantalla vacía.
 */
function esRedirect(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    typeof (e as { digest?: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  )
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
