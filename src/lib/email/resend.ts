import 'server-only'
import type { EmailProvider, MensajeEmail, ResultadoEnvio } from '.'

/**
 * Envío real de correo por Resend.
 *
 * ── Por qué Resend y por HTTP ───────────────────────────────────────────────
 *
 * Es una llamada `POST` con una clave en la cabecera. El SDK oficial agrega una
 * dependencia y un ciclo de vida propio para envolver eso, así que se hace con
 * `fetch` — el mismo criterio que ya tomaron los adapters de MercadoPago y
 * Stripe (ADR 0027).
 *
 * `RESEND_API_KEY` estaba declarada en `.env.example` desde hace fases y **no la
 * leía nadie**: era la variable de un proveedor que no existía.
 *
 * ── Lo que este adapter NO hace ─────────────────────────────────────────────
 *
 * No reintenta y no encola: de eso se ocupa la bandeja de salida
 * (`lib/notificaciones`, migración 0075). Acá un fallo se informa como fallo y se
 * termina. Mezclar las dos cosas haría que un reintento del proveedor y uno de la
 * bandeja se pisen y el huésped reciba dos correos.
 */

const API = 'https://api.resend.com/emails'

/** Corte de la llamada. Sin esto, un proveedor colgado bloquea la corrida entera. */
const TIMEOUT_MS = 10_000

export class ProveedorResend implements EmailProvider {
  nombre = 'resend'

  esReal(): boolean {
    return true
  }

  async enviar(m: MensajeEmail): Promise<ResultadoEnvio> {
    const clave = process.env.RESEND_API_KEY?.trim()
    if (!clave) {
      return { ok: false, detalle: 'Falta RESEND_API_KEY: no se puede enviar el correo.' }
    }

    /*
      El remitente tiene que ser de un dominio verificado en Resend. Si no lo
      está, la API rechaza con 403 y el motivo aparece en `detalle`, que la
      bandeja guarda y la pantalla muestra: es el error más común al enchufar
      esto y conviene que se lea entero en vez de quedar en «no se pudo enviar».
    */
    const de = process.env.EMAIL_FROM?.trim()
    if (!de) {
      return { ok: false, detalle: 'Falta EMAIL_FROM: Resend exige un remitente verificado.' }
    }

    if (!m.para || !m.para.includes('@')) {
      return { ok: false, detalle: 'El destinatario no tiene un email válido.' }
    }

    const corte = AbortSignal.timeout(TIMEOUT_MS)

    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clave}`,
          'Content-Type': 'application/json',
          /*
            Idempotencia del lado de Resend.

            La bandeja ya evita encolar dos veces el mismo mensaje, pero un
            reintento por corte de red puede llegar después de que el correo salió
            —la respuesta se perdió, no el envío—. Con esta clave, el segundo
            intento devuelve el mismo id en vez de mandar un duplicado.
          */
          'Idempotency-Key': `${m.para}:${m.asunto}`.slice(0, 256),
        },
        body: JSON.stringify({
          from: de,
          to: [m.para],
          subject: m.asunto,
          text: m.cuerpo,
          // Resend acepta las dos partes en la misma llamada: el cliente de
          // correo elige cuál mostrar. Sin `html`, algunos clientes muestran
          // el texto plano sin ningún salto de línea propio.
          ...(m.cuerpoHtml ? { html: m.cuerpoHtml } : {}),
        }),
        signal: corte,
      })

      if (!r.ok) {
        // El cuerpo del error de Resend dice el motivo real (dominio sin
        // verificar, clave inválida, destinatario en la lista de rebotes).
        const detalle = await r.text().catch(() => '')
        return {
          ok: false,
          detalle: `Resend rechazó el envío (${r.status}): ${detalle.slice(0, 300)}`,
        }
      }

      const datos = (await r.json().catch(() => ({}))) as { id?: string }
      return {
        ok: true,
        detalle: datos.id ? `Enviado por Resend (${datos.id}).` : 'Enviado por Resend.',
        /*
          El id se devuelve para que la bandeja lo guarde: es lo único con lo que
          el webhook de entrega puede encontrar esta fila cuando llegue el rebote
          o la apertura. Sin él, el estado se congela en `enviada`, que se lee
          igual que «salió bien».
        */
        proveedorId: datos.id,
      }
    } catch (e) {
      // Incluye el corte por tiempo. No se relanza: la bandeja decide si
      // reintentar, y una excepción acá abortaría el resto del lote.
      const motivo = e instanceof Error ? e.message : String(e)
      return { ok: false, detalle: `No se pudo llamar a Resend: ${motivo}` }
    }
  }
}
