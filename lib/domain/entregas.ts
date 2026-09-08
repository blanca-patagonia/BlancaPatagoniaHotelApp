/**
 * Qué significa cada evento de entrega del proveedor de correo (lógica pura).
 *
 * ── El caso que cierra ──────────────────────────────────────────────────────
 *
 * Hasta acá, un correo pasaba a `enviada` y ahí se quedaba. Pero «el proveedor
 * lo aceptó» no es «le llegó»: entre las dos cosas está el rebote, que es
 * exactamente el caso que el hotel necesita ver —«le escribimos y no le
 * llegó»—. Un huésped con la dirección mal cargada figuraba avisado.
 *
 * Este módulo traduce los eventos del proveedor a los estados de la bandeja. Es
 * puro para poder probar la tabla completa sin webhook ni base: es una tabla de
 * traducción, y lo que se rompe en una tabla de traducción es una fila, no la
 * infraestructura.
 */

/** Los estados a los que un evento de entrega puede mover una notificación. */
export type EstadoDeEntrega = 'enviada' | 'entregada' | 'leida' | 'fallida'

export interface Entrega {
  estado: EstadoDeEntrega
  /** Qué columna de sello escribir, si corresponde alguna. */
  sello: 'enviada_en' | 'entregada_en' | 'leida_en' | null
  /** Texto para la columna `error`. `null` deja lo que haya. */
  error: string | null
}

/**
 * Eventos de Resend y qué significan.
 *
 * Fuente: los tipos que Resend publica en su panel de webhooks. Los que no están
 * acá se ignoran a propósito (ver `interpretarEvento`).
 *
 * ⚠️ `email.complained` —el destinatario lo marcó como spam— se trata como
 * **fallida** y no como entregada, aunque técnicamente haya llegado. Para el
 * hotel significa lo mismo que un rebote y más: no hay que volver a escribirle
 * a esa dirección, y seguir haciéndolo arruina la reputación del dominio y hace
 * que dejen de llegar los correos de todos los demás.
 */
const EVENTOS: Record<string, Entrega> = {
  'email.sent': { estado: 'enviada', sello: 'enviada_en', error: null },
  'email.delivered': { estado: 'entregada', sello: 'entregada_en', error: null },
  'email.opened': { estado: 'leida', sello: 'leida_en', error: null },
  'email.bounced': {
    estado: 'fallida',
    sello: null,
    error: 'El servidor del destinatario rechazó el correo (rebote).',
  },
  'email.complained': {
    estado: 'fallida',
    sello: null,
    error: 'El destinatario lo marcó como correo no deseado. No volver a escribirle a esa dirección.',
  },
  /*
    Una demora **no** cambia el estado: el mensaje sigue en camino y el proveedor
    lo va a reintentar. Marcarlo fallido acá haría que el hotel diera por perdido
    algo que después llega, y que el reintento manual mandara un duplicado.
  */
  'email.delivery_delayed': { estado: 'enviada', sello: null, error: 'Entrega demorada; el proveedor sigue intentando.' },
}

/**
 * Orden de avance de los estados.
 *
 * ⚠️ Existe porque **los eventos llegan desordenados**. Un webhook no garantiza
 * orden: el de apertura puede entrar antes que el de entrega, y sin esta tabla
 * el segundo haría retroceder de `leida` a `entregada` — o sea, el sistema
 * «olvidaría» que el huésped abrió el correo.
 *
 * `fallida` está arriba de todo a propósito: un rebote posterior a una entrega
 * es información nueva y mala, y esa sí tiene que pisar.
 */
const AVANCE: Record<string, number> = {
  pendiente: 0,
  enviada: 1,
  entregada: 2,
  leida: 3,
  fallida: 4,
  cancelada: 4,
}

/**
 * ¿El estado nuevo es un avance sobre el actual?
 *
 * `false` cuando el evento llegó tarde y contaría una historia peor que la que
 * ya está registrada.
 */
export function esAvance(actual: string, nuevo: EstadoDeEntrega): boolean {
  return (AVANCE[nuevo] ?? 0) > (AVANCE[actual] ?? 0)
}

/**
 * Traduce un evento del proveedor.
 *
 * `null` para los que no dicen nada sobre la entrega. Se ignoran en silencio y
 * el webhook responde 200: **un webhook que responde 400 a un evento que no le
 * interesa termina deshabilitado**, y ahí se pierden también los que sí
 * importan. Es la misma lección que dejó el webhook de pagos.
 */
export function interpretarEvento(tipo: string): Entrega | null {
  return EVENTOS[tipo] ?? null
}

/** Los tipos que este sistema entiende. Para la documentación y los tests. */
export const EVENTOS_DE_ENTREGA = Object.keys(EVENTOS)
