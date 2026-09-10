/**
 * Plantillas de comunicaciones al huésped (lógica pura).
 *
 * Define QUÉ se comunica y CUÁNDO. El CÓMO (enviar el correo) lo resuelve el
 * proveedor de email (`lib/email`) — hoy Resend, real, por HTTP (ADR 0012 sigue
 * vigente para lo que no tiene proveedor real: firma electrónica, facturación).
 *
 * El render es un reemplazo de marcadores `{{variable}}`, deliberadamente
 * simple: sin motor de plantillas ni dependencias nuevas. Cada plantilla se
 * escribe UNA vez, en texto plano con un formato mínimo (`**negrita**`,
 * viñetas con `·`, párrafos separados por línea en blanco); `textoAHtml`
 * deriva el cuerpo HTML de ese mismo texto en vez de mantener dos redacciones
 * por evento, que es como el texto y el HTML de un correo terminan diciendo
 * cosas distintas con el tiempo.
 */

/**
 * El catálogo de avisos.
 *
 * ── Los tres grupos, y por qué importan ─────────────────────────────────────
 *
 * 1. **Al huésped, sobre su reserva.** Son la mayoría y todos son
 *    transaccionales: hablan de algo que él inició o que le afecta.
 * 2. **Al huésped, comerciales.** Piden opt-in explícito (`acepta_promociones`).
 *    Hoy sólo `solicitud_resena`, que es lo único que le pide un favor al huésped
 *    en vez de informarle algo suyo.
 * 3. **Internos, al hotel.** No van por correo al huésped: aterrizan en la
 *    cartelera de `avisos`, que el staff ya mira. Ver `canal` en la 0086.
 *
 * ⚠️ Agregar un evento acá **obliga** a decidir tres cosas en
 * `lib/domain/notificaciones.ts`: si es inmediato o espera al horario, si es
 * comercial, y si su clave lleva discriminante —o sea, si se manda una vez por
 * entidad o varias—. Los tres tienen test de cobertura: si falta uno, falla.
 */
export const EVENTOS_EMAIL = [
  // ── Ciclo de la reserva ──
  'confirmacion_reserva',
  'reserva_confirmada',
  'reserva_por_vencer',
  'reserva_reprogramada',
  'reserva_cancelada',
  'no_show',

  // ── Dinero ──
  'pago_recibido',
  'pago_rechazado',
  'saldo_pendiente',

  // ── Estadía ──
  'recordatorio_checkin',
  'checkout_proximo',
  'encuesta_postcheckout',
  'solicitud_resena',
  'cambio_nivel_fidelidad',

  // ── Internos: van a la cartelera del hotel, no al huésped ──
  'interno_nueva_reserva',
  'interno_nuevo_pago',
  'interno_error_sincronizacion',
  'interno_canal_por_revisar',
  'interno_reserva_modificada_canal',
  'interno_discrepancia_factura',
  'interno_habitacion_lista',
  'interno_incidente_mantenimiento',
] as const

/** Los que aterrizan en la cartelera interna en vez de ir al huésped. */
export const EVENTOS_INTERNOS = [
  'interno_nueva_reserva',
  'interno_nuevo_pago',
  'interno_error_sincronizacion',
  'interno_canal_por_revisar',
  'interno_reserva_modificada_canal',
  'interno_discrepancia_factura',
  'interno_habitacion_lista',
  'interno_incidente_mantenimiento',
] as const

export function esInterno(evento: EventoEmail): boolean {
  return (EVENTOS_INTERNOS as readonly string[]).includes(evento)
}

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
  /**
   * Marcadores que pueden faltar, y entonces se reemplazan por **nada**.
   *
   * Sin esto, un `{{aviso_saldo}}` que no aplica se le mostraría crudo al
   * huésped: los marcadores sin valor se dejan visibles a propósito —para que un
   * error se note antes de enviar— y esa regla, buena para los obligatorios, es
   * exactamente la equivocada para los opcionales.
   *
   * Son para el caso «esta frase va sólo a veces»: preferible a mantener dos
   * plantillas casi iguales, o a escribir «saldo: 0», que hace que alguien
   * revise si le están cobrando algo.
   */
  opcionales?: readonly string[]
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

  reserva_confirmada: {
    evento: 'reserva_confirmada',
    nombre: 'Reserva confirmada',
    /*
      Éste es el que de verdad dice «tenés la habitación», y por eso existe
      separado de `confirmacion_reserva`.

      Aquél sale al ALTA y aclara que falta la seña; éste sale cuando la seña
      llegó y la reserva pasó a `confirmada`. Mandar uno solo obligaba a elegir
      entre prometer de más al principio o no avisar nunca que ya está firme.
    */
    disparador: 'Cuando la seña se acredita y la reserva pasa a confirmada',
    asunto: 'Tu reserva en Blanca Patagonia está confirmada ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Recibimos tu seña: **tu reserva está confirmada**. La habitación queda reservada
a tu nombre.

· Código: {{codigo}}
· Llegada: {{check_in}} desde las {{hora_check_in}}
· Salida: {{check_out}} hasta las {{hora_check_out}}
· Saldo pendiente: {{saldo}}

El saldo se puede abonar antes de llegar o en el mostrador.

¡Nos vemos en El Calafate!`,
    variables: [
      'nombre', 'codigo', 'check_in', 'check_out',
      'hora_check_in', 'hora_check_out', 'saldo',
    ],
  },

  reserva_por_vencer: {
    evento: 'reserva_por_vencer',
    nombre: 'La reserva está por liberarse',
    /*
      El aviso que evita la peor sorpresa: una reserva pendiente se libera a los
      5 días (`expirar_reservas_pendientes`) y hasta ahora eso pasaba en silencio.
      El huésped creía tener la habitación y se enteraba al llegar.
    */
    disparador: '24 horas antes de que la reserva pendiente expire',
    asunto: 'Tu reserva {{codigo}} se libera mañana',
    cuerpo: `Hola {{nombre}},

Tu reserva sigue **sin la seña**, así que mañana se libera y la habitación
vuelve a quedar disponible para otros huéspedes.

· Código: {{codigo}}
· Llegada: {{check_in}}
· Seña necesaria: {{sena}}

Si todavía querés la habitación, podés abonar acá: {{enlace}}

Si ya no la necesitás, no hace falta que hagas nada.`,
    variables: ['nombre', 'codigo', 'check_in', 'sena', 'enlace'],
  },

  reserva_reprogramada: {
    evento: 'reserva_reprogramada',
    nombre: 'Cambio de fechas',
    disparador: 'Al reprogramar la estadía',
    asunto: 'Cambiamos las fechas de tu reserva {{codigo}}',
    cuerpo: `Hola {{nombre}},

Quedaron registradas las fechas nuevas de tu estadía:

· Llegada: {{check_in}} desde las {{hora_check_in}}
· Salida: {{check_out}} hasta las {{hora_check_out}}
· Total actualizado: {{total}}

⚠️ El total puede haber cambiado: las tarifas dependen de la temporada, y las
fechas nuevas pueden caer en otra.

Si algo no coincide con lo que hablamos, escribinos y lo corregimos.`,
    variables: [
      'nombre', 'codigo', 'check_in', 'check_out',
      'hora_check_in', 'hora_check_out', 'total',
    ],
  },

  reserva_cancelada: {
    evento: 'reserva_cancelada',
    nombre: 'Reserva cancelada',
    disparador: 'Al cancelar la reserva',
    asunto: 'Cancelamos tu reserva {{codigo}}',
    cuerpo: `Hola {{nombre}},

Tu reserva quedó cancelada.

· Código: {{codigo}}
· Fechas: {{check_in}} a {{check_out}}

{{detalle_cancelacion}}

Si esto no era lo que esperabas, escribinos: todavía estamos a tiempo de
revisarlo.`,
    /*
      `detalle_cancelacion` lo arma quien dispara el aviso, con la política que
      corresponda (Tarifario: >14 días sin cargo, 14–7 primera noche, <7 el 100 %).
      No se calcula acá: la plantilla no conoce la política, y meterle la regla la
      dejaría desactualizada el día que cambie.
    */
    variables: ['nombre', 'codigo', 'check_in', 'check_out', 'detalle_cancelacion'],
  },

  no_show: {
    evento: 'no_show',
    nombre: 'No se presentó',
    disparador: 'Al marcar la reserva como no-show',
    asunto: 'No pudimos recibirte en Blanca Patagonia ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Te esperábamos el {{check_in}} y no pudimos recibirte. La reserva quedó cerrada
como no presentada.

{{detalle_cancelacion}}

Si hubo un problema o querés reprogramar, escribinos: preferimos resolverlo.`,
    variables: ['nombre', 'codigo', 'check_in', 'detalle_cancelacion'],
  },

  pago_recibido: {
    evento: 'pago_recibido',
    nombre: 'Pago recibido',
    disparador: 'Cuando un pago se acredita',
    asunto: 'Recibimos tu pago ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Recibimos tu pago de {{importe}}.

· Reserva: {{codigo}}
· Saldo pendiente: {{saldo}}

Gracias. Si el saldo quedó en cero, no hay nada más que abonar.`,
    variables: ['nombre', 'codigo', 'importe', 'saldo'],
  },

  pago_rechazado: {
    evento: 'pago_rechazado',
    nombre: 'Pago rechazado',
    /*
      ⚠️ Este correo **no** dice por qué lo rechazaron, y es deliberado: el motivo
      lo sabe el emisor de la tarjeta, no el hotel, y arriesgar una explicación
      ajena («fondos insuficientes») donde puede haber sido otra cosa es peor que
      no decir nada.
    */
    disparador: 'Cuando la pasarela rechaza un pago',
    asunto: 'No se pudo procesar tu pago ({{codigo}})',
    cuerpo: `Hola {{nombre}},

El pago de {{importe}} no se pudo procesar. No se te cobró nada.

Podés intentar de nuevo, con la misma tarjeta u otra, acá: {{enlace}}

Si el problema sigue, escribinos y lo resolvemos por otro medio.`,
    variables: ['nombre', 'codigo', 'importe', 'enlace'],
  },

  saldo_pendiente: {
    evento: 'saldo_pendiente',
    nombre: 'Recordatorio de saldo',
    disparador: 'Unos días antes de la llegada, si queda saldo',
    asunto: 'Te queda un saldo pendiente para tu estadía ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Falta poco para tu llegada del {{check_in}} y queda un saldo de {{saldo}}.

Podés abonarlo antes de viajar acá: {{enlace}}

También se puede pagar en el mostrador al llegar; te lo recordamos por si
preferís tenerlo resuelto.`,
    variables: ['nombre', 'codigo', 'check_in', 'saldo', 'enlace'],
  },

  checkout_proximo: {
    evento: 'checkout_proximo',
    nombre: 'Check-out próximo',
    disparador: 'La víspera de la salida',
    asunto: 'Tu salida es mañana ({{codigo}})',
    cuerpo: `Hola {{nombre}},

Te recordamos que tu salida es el {{check_out}}, hasta las {{hora_check_out}}.

Si necesitás una salida más tarde, consultanos: según la ocupación del día
solemos poder darla.

{{aviso_saldo}}`,
    /*
      `aviso_saldo` viene vacío cuando no hay nada que cobrar. Es preferible a
      dos plantillas casi iguales, y a mandar «saldo: 0» —que hace que alguien
      revise si le están cobrando algo—.
    */
    variables: ['nombre', 'codigo', 'check_out', 'hora_check_out'],
    opcionales: ['aviso_saldo'],
  },

  solicitud_resena: {
    evento: 'solicitud_resena',
    nombre: 'Pedido de reseña',
    /*
      ⚠️ El ÚNICO evento comercial del catálogo, y por eso exige
      `acepta_promociones`.

      Los demás informan algo de la reserva del propio huésped; éste le pide un
      favor al hotel. La diferencia no es de tono: es la que decide si hace falta
      opt-in.
    */
    disparador: 'Unos días después del check-out, si la encuesta salió bien',
    asunto: '¿Nos dejarías una reseña?',
    cuerpo: `Hola {{nombre}},

Nos alegró tenerte en Blanca Patagonia. Si te quedaste con una buena impresión,
una reseña nos ayuda muchísimo a que otros huéspedes nos encuentren.

{{enlace}}

Son dos minutos, y si preferís no hacerlo no pasa nada.

¡Gracias!`,
    variables: ['nombre', 'enlace'],
  },

  /* ────────────────────────── internos: van a la cartelera ──────────── */

  interno_nueva_reserva: {
    evento: 'interno_nueva_reserva',
    nombre: 'Interno · reserva nueva',
    disparador: 'Al entrar una reserva, sea del portal o de un canal',
    asunto: 'Reserva nueva: {{codigo}}',
    cuerpo: `{{origen}} · {{codigo}} · {{huesped}} · {{check_in}} a {{check_out}} · {{total}}`,
    variables: ['codigo', 'huesped', 'check_in', 'check_out', 'total', 'origen'],
  },

  interno_nuevo_pago: {
    evento: 'interno_nuevo_pago',
    nombre: 'Interno · pago acreditado',
    disparador: 'Cuando se acredita un pago',
    asunto: 'Pago acreditado: {{importe}} ({{codigo}})',
    cuerpo: `{{codigo}} · {{huesped}} · {{importe}} por {{medio}} · saldo {{saldo}}`,
    variables: ['codigo', 'huesped', 'importe', 'medio', 'saldo'],
  },

  interno_error_sincronizacion: {
    evento: 'interno_error_sincronizacion',
    nombre: 'Interno · falló la sincronización con el canal',
    /*
      El aviso que evita el peor silencio del módulo de canales: si el feed deja
      de responder, las reservas de Booking no llegan y **el síntoma es que no
      pasa nada**. Alguien tiene que enterarse el mismo día.
    */
    disparador: 'Cuando una corrida de canales falla o rechaza filas',
    asunto: 'Revisar la sincronización con {{canal}}',
    cuerpo: `{{canal}} · {{detalle}}

Si esto se repite, las reservas del canal pueden no estar entrando.`,
    variables: ['canal', 'detalle'],
  },

  interno_canal_por_revisar: {
    evento: 'interno_canal_por_revisar',
    nombre: 'Interno · reservas de canal esperando revisión',
    /*
      ⚠️ El cron ATERRIZA, no importa (ver `app/api/cron/canales/route.ts`).

      Eso es deliberado: importar es crear una reserva que ocupa inventario, y
      hacerlo sin que nadie mire convertiría el choque con el anti-overbooking
      —el caso más caro que le puede pasar al hotel— en una fila de error que
      nadie lee.

      Pero el corolario es que una reserva que aterrizó el viernes a la noche
      **sigue sin importarse hasta que alguien entre a la pantalla de canales**.
      El KPI se enciende solo; el problema es que hay que estar mirándolo. Este
      aviso es el que hace que no haga falta.
    */
    disparador: 'Cuando el cron aterriza reservas nuevas de un canal',
    asunto: '{{cantidad}} reserva(s) de {{canal}} esperando importación',
    cuerpo: `Entraron {{cantidad}} reserva(s) de {{canal}} y están en la zona de recepción, sin importar.

Hasta que se importen, esas fechas NO ocupan inventario en el sistema.{{aviso_conflicto}}`,
    variables: ['canal', 'cantidad'],
    /*
      El aviso de conflicto va sólo cuando lo hay. Ponerlo siempre —«conflictos:
      0»— haría que se leyera como ruido y se dejara de mirar justo el día que
      dice otra cosa.
    */
    opcionales: ['aviso_conflicto'],
  },

  interno_reserva_modificada_canal: {
    evento: 'interno_reserva_modificada_canal',
    nombre: 'Interno · el canal cambió una reserva ya importada',
    /*
      ⚠️ El caso que más caro sale de los tres del módulo de canales.

      El huésped entra a Booking y mueve las fechas. La fila del canal se
      actualiza —correcto—, pero la reserva del hotel se queda con las fechas
      viejas y **no hay ningún síntoma**: las dos parecen normales y nada las
      compara. Se descubre el día que el huésped se presenta.

      El sistema no reprograma solo (0088): mover el período va contra la
      restricción de exclusión, y el precio no se recotiza solo.
    */
    disparador: 'Cuando el canal modifica una entrante que ya se había importado',
    asunto: '{{cantidad}} reserva(s) de {{canal}} cambiaron después de importarse',
    cuerpo: `El canal cambió {{cantidad}} reserva(s) que ya están cargadas en el sistema.

⚠️ La reserva del hotel sigue con los datos VIEJOS: hay que corregirla a mano desde la ficha. El sistema no la mueve solo — cambiar las fechas puede chocar con otra estadía, y el precio no se recotiza automáticamente.`,
    variables: ['canal', 'cantidad'],
  },

  interno_discrepancia_factura: {
    evento: 'interno_discrepancia_factura',
    nombre: 'Interno · diferencia en una factura del canal',
    disparador: 'Cuando lo facturado no coincide con lo devengado',
    asunto: 'Diferencia en la factura de {{canal}}',
    cuerpo: `{{canal}} · devengado {{devengado}} · facturado {{facturado}} · diferencia {{diferencia}}

Revisar antes de pagarla.`,
    variables: ['canal', 'devengado', 'facturado', 'diferencia'],
  },

  interno_habitacion_lista: {
    evento: 'interno_habitacion_lista',
    nombre: 'Interno · habitación lista',
    disparador: 'Cuando housekeeping marca la unidad como inspeccionada',
    asunto: '{{unidad}} lista',
    cuerpo: `{{unidad}} quedó lista{{para_quien}}.`,
    variables: ['unidad'],
    opcionales: ['para_quien'],
  },

  interno_incidente_mantenimiento: {
    evento: 'interno_incidente_mantenimiento',
    nombre: 'Interno · incidente de mantenimiento',
    disparador: 'Al abrirse una orden urgente',
    asunto: 'Mantenimiento urgente: {{unidad}}',
    cuerpo: `{{unidad}} · {{titulo}} · prioridad {{prioridad}}`,
    variables: ['unidad', 'titulo', 'prioridad'],
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
  /** Mismo contenido que `cuerpo`, como HTML — ver `textoAHtml`. */
  cuerpoHtml: string
  /** Marcadores que quedaron sin valor (la plantilla se envía igual, incompleta). */
  faltantes: string[]
}

const MARCADOR = /\{\{(\w+)\}\}/g

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// No incluye `.,;:!?)` al final: sin eso, «en https://x.com/y.» enlazaba el
// punto de la oración y el link salía roto (verificado a mano en la vista
// previa: `/ejemplo.` en vez de `/ejemplo`).
const URL_ABSOLUTA = /https?:\/\/[^\s<]+[^\s<.,;:!?)]/g

/** Convierte una línea ya escapada: `**negrita**` y URLs sueltas como enlace. */
function formatearLinea(linea: string): string {
  return linea
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(URL_ABSOLUTA, (url) => `<a href="${url}" style="color:#0f5c8c;">${url}</a>`)
}

/**
 * Deriva el HTML de un cuerpo en texto plano ya con sus variables reemplazadas.
 *
 * Escapa ANTES de interpretar el formato propio (negrita, viñetas, enlaces):
 * si el nombre de un huésped trajera `<` o `&`, escapar después reventaría las
 * etiquetas que este mismo formateador acaba de escribir. `{{nombre}}` no se
 * valida en ningún otro lado — puede traer lo que sea — y este es el único
 * punto por el que ese texto se vuelve markup.
 *
 * El formato de entrada es deliberadamente chico (el mismo que ya usan todas
 * las plantillas): párrafos separados por una línea en blanco, líneas que
 * empiezan con «· » como una lista, y nada más. No es Markdown completo a
 * propósito — para lo que este sistema manda, no hace falta, y cada regla de
 * más es una forma nueva de que un texto futuro la dispare sin querer.
 */
export function textoAHtml(texto: string): string {
  const parrafos = escaparHtml(texto).split(/\n{2,}/)

  const html = parrafos
    .map((p) => {
      const lineas = p.split('\n').filter((l) => l.length > 0)
      if (lineas.length > 0 && lineas.every((l) => l.startsWith('· '))) {
        const items = lineas.map((l) => `<li>${formatearLinea(l.slice(2))}</li>`).join('')
        return `<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`
      }
      return `<p style="margin:0 0 16px;">${lineas.map(formatearLinea).join('<br>')}</p>`
    })
    .join('')

  // Estilos inline: la mayoría de los clientes de correo descartan un
  // `<style>` en el `<head>`, así que un color o un ancho que no viaje en el
  // atributo `style` de cada elemento simplemente no se ve.
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;` +
    `max-width:560px;margin:0 auto;padding:24px;color:#1c1917;font-size:15px;` +
    `line-height:1.5;">${html}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#78716c;">Blanca Patagonia — El Calafate, Santa Cruz</p>` +
    `</div>`
  )
}

/**
 * Reemplaza los marcadores `{{variable}}` por sus valores.
 *
 * Un marcador **opcional** sin valor desaparece; uno obligatorio se deja
 * visible. Ver el porqué en `Plantilla.opcionales`.
 */
function reemplazar(
  texto: string,
  variables: Record<string, string | number>,
  opcionales: readonly string[] = [],
): string {
  return texto.replace(MARCADOR, (_, clave: string) => {
    const valor = variables[clave]
    if (valor !== undefined && valor !== null) return String(valor)
    return opcionales.includes(clave) ? '' : `{{${clave}}}`
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
 *
 * `override` es el asunto/cuerpo editado desde el panel
 * (`plantillas_email`, migración 0097) — este módulo es puro y no sabe leer
 * la base, así que quien llama (`lib/email`) lo trae resuelto. `variables` y
 * `opcionales` siguen saliendo SIEMPRE del catálogo de código: son el
 * contrato de qué datos hacen falta, y ese contrato no se edita desde acá.
 */
export function renderizar(
  evento: EventoEmail,
  variables: Record<string, string | number>,
  override?: { asunto?: string | null; cuerpo?: string | null },
): EmailRenderizado {
  const plantilla = PLANTILLAS[evento]
  const asuntoFuente = override?.asunto ?? plantilla.asunto
  const cuerpoFuente = override?.cuerpo ?? plantilla.cuerpo
  const cuerpo = reemplazar(cuerpoFuente, variables, plantilla.opcionales)
  return {
    asunto: reemplazar(asuntoFuente, variables, plantilla.opcionales),
    cuerpo,
    cuerpoHtml: textoAHtml(cuerpo),
    faltantes: variablesFaltantes(plantilla, variables),
  }
}
