import 'server-only'
import { obtenerProveedorEmail } from '@/lib/email'
import { obtenerProveedorWhatsApp, whatsappActivo } from '@/lib/whatsapp'

/**
 * «¿El sistema puede avisar de verdad, o sólo lo anota?»
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Todo el camino de los avisos funciona sin credenciales: la bandeja encola, el
 * cron despacha y el proveedor de consola devuelve `ok`. O sea que **un hotel sin
 * configurar ve exactamente lo mismo que uno configurado**: filas en verde que
 * dicen «enviada». La diferencia sólo se nota cuando un huésped llama para decir
 * que no le llegó nada, que es tarde.
 *
 * Esta función responde esa pregunta antes. No adivina: mira qué proveedor quedó
 * elegido y si están las variables que ese proveedor necesita.
 *
 * ── Nunca devuelve el valor de un secreto ───────────────────────────────────
 *
 * ⚠️ Sólo booleanos y nombres de proveedor. Esto alimenta una pantalla del panel,
 * y una pantalla que muestre media clave de API para «ayudar a verificar» es una
 * clave filtrada: queda en el historial del navegador, en una captura de pantalla
 * y en el hombro de quien pasa por atrás. Lo que hace falta saber es **si está**,
 * no cuál es.
 */

/** Un requisito, con qué pasa si falta. */
export interface Requisito {
  clave: string
  /** Qué es, en una línea, para quien no escribió el código. */
  que: string
  listo: boolean
  /** La consecuencia concreta de que falte. Nunca «revisar la configuración». */
  siFalta: string
}

export interface DiagnosticoDeAvisos {
  /** Proveedor de correo elegido, y si manda de verdad. */
  email: { proveedor: string; real: boolean }
  /** WhatsApp: si el canal se ofrece, y con qué proveedor. */
  whatsapp: { activo: boolean; proveedor: string; real: boolean }
  requisitos: Requisito[]
  /** `true` si el hotel puede mandar un correo real ahora mismo. */
  puedeMandarCorreo: boolean
}

function hay(variable: string | undefined): boolean {
  return Boolean(variable?.trim())
}

export function diagnosticarAvisos(): DiagnosticoDeAvisos {
  const email = obtenerProveedorEmail()
  const emailReal = email.esReal()

  const wsp = whatsappActivo()
  const proveedorWsp = obtenerProveedorWhatsApp()

  const requisitos: Requisito[] = [
    {
      clave: 'EMAIL_PROVIDER',
      que: 'Qué servicio manda los correos.',
      listo: emailReal,
      siFalta:
        'Con el proveedor «consola» los correos se escriben en el registro del servidor y NO se envían. La bandeja igual los marca como enviados, así que no hay ningún síntoma.',
    },
    {
      clave: 'RESEND_API_KEY',
      que: 'La credencial del servicio de correo.',
      listo: hay(process.env.RESEND_API_KEY),
      siFalta: 'Todos los envíos fallan con «falta la clave» y quedan como fallidos en esta pantalla.',
    },
    {
      clave: 'EMAIL_FROM',
      que: 'La dirección desde la que sale el correo.',
      listo: hay(process.env.EMAIL_FROM),
      siFalta:
        'El servicio rechaza el envío. Tiene que ser de un dominio verificado del hotel: con una dirección de Gmail o Hotmail no funciona.',
    },
    {
      clave: 'RESEND_WEBHOOK_SECRET',
      que: 'Lo que permite enterarse de si el correo LLEGÓ.',
      listo: hay(process.env.RESEND_WEBHOOK_SECRET),
      siFalta:
        'Los avisos se quedan en «enviada» para siempre. No se detectan los rebotes, así que un huésped con la dirección mal cargada figura avisado.',
    },
    {
      clave: 'CRON_SECRET',
      que: 'Lo que autoriza a las tareas automáticas.',
      listo: hay(process.env.CRON_SECRET),
      siFalta:
        'No sale NADA: los avisos se anotan en la bandeja y se quedan ahí, porque quien los manda es una tarea programada que sin esto rechaza todo.',
    },
    {
      clave: 'NEXT_PUBLIC_SITE_URL',
      que: 'La dirección pública del sitio.',
      listo: hay(process.env.NEXT_PUBLIC_SITE_URL),
      siFalta:
        'Los enlaces de los correos —pagar, ver la reserva, responder la encuesta— apuntan a «localhost» y no le sirven a nadie.',
    },
  ]

  return {
    email: { proveedor: email.nombre, real: emailReal },
    whatsapp: { activo: wsp, proveedor: proveedorWsp.nombre, real: proveedorWsp.esReal() },
    requisitos,
    /*
      Los tres que hacen falta para que un correo salga de verdad. El del webhook
      y el de la URL no entran: sin ellos el correo **sale igual**, sólo que no se
      sabe si llegó y los enlaces no sirven. Mezclarlos haría que la pantalla
      dijera «no puede mandar» cuando sí puede, y eso entrena a ignorar el aviso.
    */
    puedeMandarCorreo:
      emailReal && hay(process.env.RESEND_API_KEY) && hay(process.env.EMAIL_FROM),
  }
}
