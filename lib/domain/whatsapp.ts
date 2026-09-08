import { esInterno, type EventoEmail } from './plantillas'

/**
 * Reglas del canal WhatsApp (lógica pura).
 *
 * ── Por qué WhatsApp y por qué la API oficial ───────────────────────────────
 *
 * En Argentina el huésped lee WhatsApp y no lee el correo. Un recordatorio de
 * check-in por mail se pierde entre promociones; el mismo mensaje por WhatsApp
 * se lee en el momento.
 *
 * La integración es la **WhatsApp Cloud API de Meta**, no un puente no oficial
 * sobre WhatsApp Web. Los puentes funcionan hasta que Meta bloquea el número —y
 * el número bloqueado es el del hotel, el que está publicado en su web y en
 * Booking—. Un canal que puede desaparecer de un día para el otro no es un canal
 * de producción.
 *
 * ── ⚠️ La restricción que define todo lo demás: la ventana de 24 horas ──────
 *
 * WhatsApp **no deja mandar texto libre cuando quiera**. Sólo se puede dentro de
 * las 24 horas posteriores al último mensaje del huésped («ventana de atención»).
 * Fuera de esa ventana, el único envío permitido es una **plantilla aprobada por
 * Meta**: texto fijo con huecos numerados, revisado antes por ellos.
 *
 * O sea que los cuerpos del catálogo (`lib/domain/plantillas.ts`) **no se pueden
 * mandar tal cual**: son el texto del correo. Cada evento que salga por WhatsApp
 * necesita su plantilla aprobada del otro lado, y este módulo es el que dice cuál
 * y con qué parámetros.
 *
 * Por eso `PLANTILLAS_WHATSAPP` no cubre los veinte eventos: cubre los que vale
 * la pena hacer aprobar. Los demás siguen yendo por correo, que no tiene esa
 * restricción.
 */

/**
 * Eventos que salen por WhatsApp, con el nombre de la plantilla en Meta.
 *
 * ── El criterio ─────────────────────────────────────────────────────────────
 *
 * Los cuatro que el huésped necesita **en el momento** y que hoy se pierden en
 * la casilla: la confirmación de que su reserva entró, la de que quedó firme, el
 * recordatorio del día antes de llegar, y el aviso de que la reserva se libera.
 *
 * Los que quedan afuera y por qué:
 *  · Los **internos** no salen del sistema: van a la cartelera.
 *  · El pedido de **reseña** es comercial. Meta cobra las plantillas de marketing
 *    aparte y las revisa distinto, y el hotel no lo pidió.
 *  · La **factura**, el **detalle de cancelación** y la **encuesta** llevan texto
 *    largo o un enlace con token: entran mejor en un correo, que además queda
 *    como constancia.
 */
export const PLANTILLAS_WHATSAPP: Partial<Record<EventoEmail, string>> = {
  confirmacion_reserva: 'reserva_recibida',
  reserva_confirmada: 'reserva_confirmada',
  recordatorio_checkin: 'recordatorio_llegada',
  reserva_por_vencer: 'reserva_por_vencer',
}

/**
 * Parámetros de cada plantilla, **en orden**.
 *
 * ⚠️ WhatsApp numera los huecos (`{{1}}`, `{{2}}`…), no los nombra. El orden de
 * este arreglo **es** el contrato con la plantilla aprobada en Meta: cambiarlo
 * acá sin cambiarlo allá manda el código de reserva donde va la fecha, y el
 * mensaje sale igual —Meta valida la cantidad, no el significado—.
 *
 * Por eso son pocos y siempre los mismos: cuantos menos huecos, menos formas de
 * cruzarlos.
 */
export const PARAMETROS_WHATSAPP: Partial<Record<EventoEmail, readonly string[]>> = {
  confirmacion_reserva: ['nombre', 'codigo', 'check_in', 'check_out'],
  reserva_confirmada: ['nombre', 'codigo', 'check_in', 'saldo'],
  recordatorio_checkin: ['nombre', 'codigo', 'check_in', 'hora_check_in'],
  reserva_por_vencer: ['nombre', 'codigo', 'sena'],
}

/** ¿Este evento tiene plantilla aprobada del lado de Meta? */
export function tienePlantillaWhatsApp(evento: EventoEmail): boolean {
  return Boolean(PLANTILLAS_WHATSAPP[evento])
}

/**
 * Normaliza un teléfono al formato que exige la Cloud API.
 *
 * Meta quiere el número **en formato internacional y sólo dígitos**: sin `+`,
 * sin espacios, sin guiones ni paréntesis.
 *
 * ⚠️ Argentina tiene su propia trampa: el `9` después del código de país en los
 * celulares. `+54 9 2902 …` es lo correcto para WhatsApp, y un número cargado
 * como `+54 2902 …` —que es válido para llamar— **no recibe mensajes**. No se
 * agrega solo: adivinar si un fijo es en realidad un celular es la clase de
 * suposición que manda el mensaje a otra persona. Se devuelve `null` y el aviso
 * cae al correo.
 */
export function telefonoParaWhatsApp(telefono: string | null | undefined): string | null {
  if (!telefono) return null

  const soloDigitos = telefono.replace(/[^0-9]/g, '')

  // Un número internacional válido tiene entre 8 y 15 dígitos (E.164). Menos que
  // eso es un interno o un número mal cargado.
  if (soloDigitos.length < 8 || soloDigitos.length > 15) return null

  /*
    Sin código de país no se puede mandar. Se exige explícito en vez de asumir
    Argentina: el hotel es internacional y la mitad de sus huéspedes son de
    afuera, así que anteponer `54` a un número europeo lo mandaría a un
    desconocido en Río Gallegos.
  */
  if (soloDigitos.length < 11) return null

  return soloDigitos
}

/**
 * Por dónde conviene mandar este aviso.
 *
 * El orden importa y no es negociable:
 *  1. **Interno** — no sale del sistema, va a la cartelera.
 *  2. **WhatsApp** — sólo si está configurado, el evento tiene plantilla
 *     aprobada y el huésped tiene un teléfono usable.
 *  3. **Correo** — el respaldo, y lo que se usa hoy.
 *
 * ⚠️ Devuelve **un solo** canal, no una lista. Mandar el mismo aviso por los dos
 * lados duplica el mensaje para el huésped y rompe la idempotencia de la bandeja,
 * cuya clave no incluye el canal: las dos filas chocarían contra el `unique` y
 * una se descartaría en silencio.
 */
export function canalDelAviso(
  evento: EventoEmail,
  d: { telefono?: string | null; whatsappActivo: boolean },
): 'interno' | 'whatsapp' | 'email' {
  if (esInterno(evento)) return 'interno'

  if (d.whatsappActivo && tienePlantillaWhatsApp(evento) && telefonoParaWhatsApp(d.telefono)) {
    return 'whatsapp'
  }

  return 'email'
}
