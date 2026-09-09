import 'server-only'
import {
  PARAMETROS_WHATSAPP,
  PLANTILLAS_WHATSAPP,
  telefonoParaWhatsApp,
} from '@/lib/domain/whatsapp'
import type { EventoEmail } from '@/lib/domain/plantillas'

/**
 * Adapter de WhatsApp (`WhatsAppProvider`). El noveno del proyecto.
 *
 * Mismo patrón que `EmailProvider`: interfaz, un simulador que no manda nada y
 * una implementación real elegida por variable de entorno. La diferencia es que
 * acá el simulador **no está por omisión en producción**: si `WHATSAPP_PROVIDER`
 * no está configurada, el canal simplemente **no se ofrece** y todo sale por
 * correo (ver `whatsappActivo`). No hace falta el fallo ruidoso del ADR 0018
 * porque no hay nada que se pueda creer enviado: la bandeja elige el canal antes
 * de encolar.
 *
 * ── Lo que NO se puede cerrar desde el código ───────────────────────────────
 *
 * Enchufar esto de verdad exige, del lado de Meta:
 *
 *  1. Una **cuenta de WhatsApp Business** verificada, con el número del hotel.
 *  2. Un **token permanente** de un usuario de sistema (el token de prueba dura
 *     24 horas y sirve sólo para probar).
 *  3. Las **plantillas aprobadas**, una por evento, con el mismo nombre que
 *     declara `PLANTILLAS_WHATSAPP` y los huecos en el mismo orden que
 *     `PARAMETROS_WHATSAPP`. La aprobación la hace Meta y tarda.
 *
 * Nada de eso se puede hacer desde acá: son trámites del hotel con su cuenta.
 * Está escrito en `docs/despliegue.md` con los pasos.
 */

import { seleccionarProveedor } from '@/lib/integraciones/seleccion'

export interface MensajeWhatsApp {
  /** Teléfono en formato internacional, sólo dígitos. Ver `telefonoParaWhatsApp`. */
  para: string
  evento: EventoEmail
  variables: Record<string, string | number>
}

export interface ResultadoWhatsApp {
  ok: boolean
  detalle: string
  /** Id del mensaje en Meta, para casarlo con el webhook de estado. */
  proveedorId?: string
}

export interface WhatsAppProvider {
  nombre: string
  enviar(m: MensajeWhatsApp): Promise<ResultadoWhatsApp>
  esReal(): boolean
}

/**
 * Arma los parámetros de la plantilla, en el orden declarado.
 *
 * ⚠️ Devuelve `null` si falta alguno. Meta valida la **cantidad** de parámetros,
 * no su contenido: mandar una cadena vacía donde va la fecha pasa la validación
 * y le llega al huésped un mensaje con un hueco. Mejor no mandarlo y que la
 * bandeja lo registre como fallido, que es visible.
 */
export function parametrosDe(m: MensajeWhatsApp): string[] | null {
  const nombres = PARAMETROS_WHATSAPP[m.evento]
  if (!nombres) return null

  const valores: string[] = []
  for (const n of nombres) {
    const v = m.variables[n]
    if (v === undefined || v === null || v === '') return null
    valores.push(String(v))
  }
  return valores
}

/** Simulador: deja el rastro del envío sin mandar nada. */
class ProveedorConsolaWhatsApp implements WhatsAppProvider {
  nombre = 'consola'

  esReal(): boolean {
    return false
  }

  async enviar(m: MensajeWhatsApp): Promise<ResultadoWhatsApp> {
    const plantilla = PLANTILLAS_WHATSAPP[m.evento]
    if (!plantilla) {
      return { ok: false, detalle: `El evento «${m.evento}» no tiene plantilla de WhatsApp.` }
    }
    if (!parametrosDe(m)) {
      return { ok: false, detalle: 'Faltan datos para completar la plantilla de WhatsApp.' }
    }
    /*
      No se loguea el número ni los parámetros: son datos personales, y el
      `EmailProvider` de consola ya aprendió esa lección —dejaba tokens de larga
      vida en el log—. Alcanza con saber que se habría mandado y cuál.
    */
    return {
      ok: true,
      detalle: `Simulado: se habría mandado la plantilla «${plantilla}», no se envió.`,
    }
  }
}

/** Versión de la Graph API. Se fija a propósito: Meta rompe entre versiones. */
const VERSION = 'v21.0'

/** Corte de la llamada. Sin esto, un proveedor colgado bloquea la corrida entera. */
const TIMEOUT_MS = 10_000

/**
 * WhatsApp Cloud API de Meta, por HTTP y sin SDK.
 *
 * Mismo criterio que MercadoPago, Stripe y Resend (ADR 0027): es un `POST` con un
 * token en la cabecera, y el SDK agregaría una dependencia y un ciclo de vida
 * propio para envolver eso.
 */
export class ProveedorCloudApi implements WhatsAppProvider {
  nombre = 'cloud_api'

  esReal(): boolean {
    return true
  }

  async enviar(m: MensajeWhatsApp): Promise<ResultadoWhatsApp> {
    const token = process.env.WHATSAPP_TOKEN?.trim()
    const numeroId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

    if (!token || !numeroId) {
      return {
        ok: false,
        detalle: 'Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID: no se puede enviar.',
      }
    }

    const plantilla = PLANTILLAS_WHATSAPP[m.evento]
    if (!plantilla) {
      /*
        Sin plantilla aprobada, Meta rechaza el envío fuera de la ventana de 24
        horas. Se corta acá con un motivo legible en vez de dejar que vuelva un
        error de la API que nadie va a saber interpretar.
      */
      return { ok: false, detalle: `El evento «${m.evento}» no tiene plantilla aprobada en Meta.` }
    }

    const parametros = parametrosDe(m)
    if (!parametros) {
      return { ok: false, detalle: 'Faltan datos para completar la plantilla de WhatsApp.' }
    }

    const para = telefonoParaWhatsApp(m.para)
    if (!para) {
      return { ok: false, detalle: 'El teléfono no sirve para WhatsApp (formato internacional).' }
    }

    try {
      const r = await fetch(`https://graph.facebook.com/${VERSION}/${numeroId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: para,
          type: 'template',
          template: {
            name: plantilla,
            /*
              El idioma de la plantilla aprobada. `es_AR` y `es` son plantillas
              DISTINTAS para Meta: pedir una que no existe devuelve 132001 y el
              mensaje no sale. Se declara en una variable para poder alinearlo con
              lo que el hotel haya dado de alta sin tocar el código.
            */
            language: { code: process.env.WHATSAPP_IDIOMA?.trim() || 'es_AR' },
            components: [
              {
                type: 'body',
                // Los huecos van por POSICIÓN, no por nombre. El orden lo fija
                // `PARAMETROS_WHATSAPP` y es el contrato con la plantilla de Meta.
                parameters: parametros.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!r.ok) {
        // El cuerpo del error de Meta trae el código y el motivo real (plantilla
        // sin aprobar, número no registrado, token vencido).
        const detalle = await r.text().catch(() => '')
        return {
          ok: false,
          detalle: `WhatsApp rechazó el envío (${r.status}): ${detalle.slice(0, 300)}`,
        }
      }

      const datos = (await r.json().catch(() => ({}))) as {
        messages?: { id?: string }[]
      }
      const id = datos.messages?.[0]?.id

      return {
        ok: true,
        detalle: id ? `Enviado por WhatsApp (${id}).` : 'Enviado por WhatsApp.',
        proveedorId: id,
      }
    } catch (e) {
      // Incluye el corte por tiempo. No se relanza: la bandeja decide si
      // reintentar, y una excepción acá abortaría el resto del lote.
      const motivo = e instanceof Error ? e.message : String(e)
      return { ok: false, detalle: `No se pudo llamar a WhatsApp: ${motivo}` }
    }
  }
}

const PROVEEDORES: Record<string, WhatsAppProvider> = {
  consola: new ProveedorConsolaWhatsApp(),
  cloud_api: new ProveedorCloudApi(),
}

/**
 * ¿El hotel tiene WhatsApp enchufado?
 *
 * ⚠️ Es lo que decide si el canal se **ofrece**, y por eso mira las credenciales
 * y no sólo el nombre del proveedor. Con `WHATSAPP_PROVIDER=cloud_api` y sin
 * token, los avisos se encolarían como `whatsapp` y fallarían uno por uno: el
 * huésped no recibiría nada y el hotel tendría una bandeja llena de fallidos en
 * vez de correos entregados.
 *
 * Fuera de producción alcanza con nombrar el proveedor: el simulador no necesita
 * credenciales y es lo que permite recorrer el circuito en la defensa.
 */
export function whatsappActivo(): boolean {
  const nombre = process.env.WHATSAPP_PROVIDER?.trim()
  if (!nombre || !PROVEEDORES[nombre]) return false
  if (nombre === 'consola') return true
  return Boolean(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim())
}

export function obtenerProveedorWhatsApp(
  nombre: string | undefined = process.env.WHATSAPP_PROVIDER,
): WhatsAppProvider {
  /*
    A diferencia de los otros adapters, acá el simulador NO es un peligro en
    producción: `whatsappActivo()` decide antes si el canal se ofrece, así que un
    `WHATSAPP_PROVIDER=consola` mal puesto hace que los avisos salgan por correo,
    no que se den por enviados sin salir. Por eso no se llama a
    `advertirSiEsSimulado`, que ahí sería ruido en cada arranque.
  */
  return seleccionarProveedor({
    variable: 'WHATSAPP_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'consola',
    valor: nombre,
  })
}

/** Manda un aviso por WhatsApp. Único camino: nadie llama al proveedor directo. */
export async function enviarPorWhatsApp(
  evento: EventoEmail,
  para: string | null,
  variables: Record<string, string | number>,
): Promise<ResultadoWhatsApp> {
  if (!para) return { ok: false, detalle: 'El huésped no tiene teléfono cargado.' }
  return obtenerProveedorWhatsApp().enviar({ para, evento, variables })
}
