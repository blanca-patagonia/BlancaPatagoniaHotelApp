/**
 * Conexiones con proveedores externos (Mercado Pago, correo, Booking,
 * Expedia): lógica pura, sin base ni HTTP.
 *
 * Dos formas de conectar, según lo que el proveedor ofrezca de verdad:
 *  · `oauth2` — el usuario confirma en la pantalla real del proveedor.
 *  · `ical`   — no hay OAuth público; se pega un link de calendario.
 * Nunca se pide pegar una clave a mano en ninguna de las dos.
 */

export const PROVEEDORES = ['mercadopago', 'google_mail', 'booking', 'expedia'] as const
export type Proveedor = (typeof PROVEEDORES)[number]

export type TipoConexion = 'oauth2' | 'ical'

export const TIPO_CONEXION: Record<Proveedor, TipoConexion> = {
  mercadopago: 'oauth2',
  google_mail: 'oauth2',
  booking: 'ical',
  expedia: 'ical',
}

export const ESTADOS_CONEXION = [
  'conectado',
  'desconectado',
  'expirado',
  'requiere_cuenta_partner',
] as const
export type EstadoConexion = (typeof ESTADOS_CONEXION)[number]

export const ETIQUETAS_PROVEEDOR: Record<Proveedor, string> = {
  mercadopago: 'Mercado Pago',
  google_mail: 'Correo (Google)',
  booking: 'Booking.com',
  expedia: 'Expedia',
}

export const ETIQUETAS_ESTADO_CONEXION: Record<EstadoConexion, string> = {
  conectado: 'Conectado',
  desconectado: 'Sin conectar',
  expirado: 'Venció — reconectar',
  requiere_cuenta_partner: 'Necesita cuenta de partner',
}

/**
 * Texto de ayuda para el campo de link de calendario, un proveedor a la vez.
 *
 * Sin jerga de iCal ni de API: el paso a paso concreto que ve quien abre el
 * Extranet, no una explicación de qué es un feed.
 */
export const AYUDA_ICAL: Record<'booking' | 'expedia', string> = {
  booking:
    'En tu Extranet de Booking.com: Tarifas y Disponibilidad → Sincronizar calendarios → Exportar calendario → copiá el link y pegalo acá.',
  expedia:
    'En Expedia Partner Central, buscá la opción de exportar o sincronizar tu calendario y copiá el link. Si no la encontrás, es porque tu cuenta todavía no la tiene habilitada — no hace falta nada más de este lado hasta entonces.',
}

/** ¿El link que pegaron tiene forma de feed de calendario? Antes de guardarlo se valida contra la red. */
export function pareceUrlDeCalendario(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Un feed real empieza con esta línea. Se confirma con el CONTENIDO, no con
 * la extensión del link — Booking y Expedia no siempre terminan en `.ics`.
 */
export function pareceContenidoDeCalendario(cuerpo: string): boolean {
  return cuerpo.trimStart().startsWith('BEGIN:VCALENDAR')
}

/**
 * Booking sólo ofrece la sincronización por calendario cuando hay UNA sola
 * unidad por tipo de habitación. Con más de una, la opción puede no estar
 * disponible del lado de Booking y conviene decirlo antes de que la persona
 * busque un botón que no va a encontrar.
 */
export function tipoAmbiguoParaICal(unidadesDelTipo: number): boolean {
  return unidadesDelTipo > 1
}
