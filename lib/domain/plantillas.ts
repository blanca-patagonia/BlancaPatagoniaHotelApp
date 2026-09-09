/**
 * Plantillas de comunicaciones al huésped (lógica pura).
 *
 * Define QUÉ se comunica y CUÁNDO. El CÓMO (enviar el correo) queda detrás del
 * proveedor de email, que sigue siendo un stub: el proyecto no integra un
 * servicio real (ver ADR 0012).
 *
 * El render es un reemplazo de marcadores `{{variable}}`, deliberadamente
 * simple: sin motor de plantillas ni dependencias nuevas.
 */

export const EVENTOS_EMAIL = [
  'confirmacion_reserva',
  'recordatorio_saldo',
  'recordatorio_checkin',
  'encuesta_postcheckout',
  'cambio_nivel_fidelidad',
] as const

export type EventoEmail = (typeof EVENTOS_EMAIL)[number]

export interface Plantilla {
  evento: EventoEmail
  nombre: string
  /** Cuándo corresponde dispararla, en lenguaje llano. */
  disparador: string
  asunto: string
  cuerpo: string
  /** Marcadores que la plantilla necesita para renderizarse completa. */
  variables: readonly string[]
}

export const PLANTILLAS: Record<EventoEmail, Plantilla> = {
  confirmacion_reserva: {
    evento: 'confirmacion_reserva',
    nombre: 'Confirmación de reserva',
    /*
      ⚠️ Este correo sale al ALTA de la reserva, que nace `pendiente`, no al
      confirmarse.

      El texto decía «Confirmamos tu reserva» y el disparador «Al confirmarse la
      reserva», y las dos cosas eran falsas: quien confirma es el pago, y una
      reserva pendiente **expira a los 5 días** liberando la unidad
      (`expirar_reservas_pendientes`). El huésped se quedaba con la idea de que
      tenía la habitación asegurada y podía encontrarse sin ella.

      Decirle que la recibimos y que hay que abonar la seña es la verdad, y además
      es lo que hace que la seña llegue.
    */
    disparador: 'Al recibirse la reserva, antes del pago',
    asunto: 'Recibimos tu reserva en Blanca Patagonia ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Recibimos tu reserva en Blanca Patagonia. Todavía **no está confirmada**: para
asegurar la habitación hay que abonar la seña.

· Código: {{codigo}}
· Llegada: {{check_in}} desde las {{hora_check_in}}
· Salida: {{check_out}} hasta las {{hora_check_out}}
· Total: {{total}}

Podés abonar la seña y ver el detalle en {{enlace}}.

Si no recibimos la seña, la reserva se libera y la habitación vuelve a quedar
disponible para otros huéspedes.

¡Te esperamos en El Calafate!`,
    variables: [
      'nombre', 'codigo', 'check_in', 'check_out',
      'hora_check_in', 'hora_check_out', 'total', 'enlace',
    ],
  },

  /*
    Patrón de referencia: los recordatorios de seña/depósito de Invoice Ninja.
    Sin esto, una reserva `pendiente` solo se enteraba de que estaba por
    perder la unidad cuando ya la perdió (`expirar_reservas_pendientes`, a los
    5 días). Se manda a los 3, dejando 2 días de margen para reaccionar antes
    de que la unidad se libere.
  */
  recordatorio_saldo: {
    evento: 'recordatorio_saldo',
    nombre: 'Recordatorio de seña pendiente',
    disparador: 'A los 3 días de recibida la reserva, si sigue sin seña',
    asunto: 'Tu reserva en Blanca Patagonia está por vencer ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Tu reserva sigue pendiente de la seña. Si no la recibimos, la unidad se libera
en {{dias_restantes}} y vuelve a quedar disponible para otros huéspedes.

· Código: {{codigo}}
· Total: {{total}}

Podés abonarla en {{enlace}}.

Si ya la pagaste, podés ignorar este mensaje: puede cruzarse con la
confirmación.`,
    variables: ['nombre', 'codigo', 'total', 'dias_restantes', 'enlace'],
  },

  recordatorio_checkin: {
    evento: 'recordatorio_checkin',
    nombre: 'Recordatorio previo a la llegada',
    disparador: '48 horas antes del check-in',
    asunto: 'Te esperamos en Blanca Patagonia el {{check_in}}',
    cuerpo: `Hola {{nombre}},

Falta poco para tu llegada. Te recordamos los datos de tu estadía:

· Código: {{codigo}}
· Llegada: {{check_in}} desde las {{hora_check_in}}

Si vas a llegar fuera de ese horario, avisanos y lo coordinamos.

¡Buen viaje!`,
    variables: ['nombre', 'codigo', 'check_in', 'hora_check_in'],
  },

  encuesta_postcheckout: {
    evento: 'encuesta_postcheckout',
    nombre: 'Encuesta de satisfacción',
    disparador: 'Al hacer el check-out',
    asunto: '¿Cómo fue tu estadía en Blanca Patagonia?',
    cuerpo: `Hola {{nombre}},

Gracias por elegirnos. Nos ayudaría mucho saber cómo te fue: son dos preguntas
y no lleva más de un minuto.

{{enlace}}

¡Gracias!`,
    variables: ['nombre', 'enlace'],
  },

  cambio_nivel_fidelidad: {
    evento: 'cambio_nivel_fidelidad',
    nombre: 'Cambio de nivel de fidelidad',
    disparador: 'Cuando el huésped alcanza un nivel nuevo',
    asunto: 'Alcanzaste el nivel {{nivel}} en Blanca Patagonia',
    cuerpo: `Hola {{nombre}},

Con {{puntos}} puntos acumulados alcanzaste el nivel {{nivel}}.

Gracias por volver: nos alegra tenerte de nuevo frente al Lago Argentino.`,
    variables: ['nombre', 'nivel', 'puntos'],
  },
}

export interface EmailRenderizado {
  asunto: string
  cuerpo: string
  /** Marcadores que quedaron sin valor (la plantilla se envía igual, incompleta). */
  faltantes: string[]
}

const MARCADOR = /\{\{(\w+)\}\}/g

/** Reemplaza los marcadores `{{variable}}` por sus valores. */
function reemplazar(texto: string, variables: Record<string, string | number>): string {
  return texto.replace(MARCADOR, (_, clave: string) => {
    const valor = variables[clave]
    return valor === undefined || valor === null ? `{{${clave}}}` : String(valor)
  })
}

/** Variables que la plantilla declara y no vinieron con valor. */
export function variablesFaltantes(
  plantilla: Plantilla,
  variables: Record<string, string | number>,
): string[] {
  return plantilla.variables.filter(
    (v) => variables[v] === undefined || variables[v] === null || variables[v] === '',
  )
}

/**
 * Renderiza una plantilla.
 *
 * Los marcadores sin valor se dejan visibles (`{{nombre}}`) en lugar de quedar
 * vacíos: es preferible que un error se note antes de enviar y no que el
 * huésped reciba «Hola ,».
 */
export function renderizar(
  evento: EventoEmail,
  variables: Record<string, string | number>,
): EmailRenderizado {
  const plantilla = PLANTILLAS[evento]
  return {
    asunto: reemplazar(plantilla.asunto, variables),
    cuerpo: reemplazar(plantilla.cuerpo, variables),
    faltantes: variablesFaltantes(plantilla, variables),
  }
}
