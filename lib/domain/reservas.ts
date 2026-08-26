/**
 * Máquina de estados de la reserva (lógica pura).
 *
 * Ciclo de vida:
 *   pendiente → confirmada → pagada → in_house → checkout
 *   (con salidas a cancelada / no_show según el momento)
 *
 * Debe mantenerse en sincronía con el enum `estado_reserva` de la base
 * (ver `supabase/migrations/0005_reservas_ocupacion.sql`).
 */

export const ESTADOS_RESERVA = [
  'pendiente',
  'confirmada',
  'pagada',
  'in_house',
  'checkout',
  'cancelada',
  'no_show',
] as const

export type EstadoReserva = (typeof ESTADOS_RESERVA)[number]

export const ETIQUETAS_ESTADO_RESERVA: Record<EstadoReserva, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  pagada: 'Pagada',
  in_house: 'In house',
  checkout: 'Check-out',
  cancelada: 'Cancelada',
  no_show: 'No-show',
}

/**
 * Canales de venta. Debe coincidir con el default y los valores de
 * `reservas.canal` (ver `0005_reservas_ocupacion.sql`).
 */
export const CANALES = ['directo', 'web', 'booking', 'expedia'] as const

export type Canal = (typeof CANALES)[number]

export const ETIQUETAS_CANAL: Record<Canal, string> = {
  directo: 'Directo',
  web: 'Web propia',
  booking: 'Booking',
  expedia: 'Expedia',
}

/** Estados que OCUPAN inventario (bloquean la unidad en el motor anti-overbooking). */
export const ESTADOS_ACTIVOS: readonly EstadoReserva[] = [
  'pendiente',
  'confirmada',
  'pagada',
  'in_house',
]

/** Transiciones válidas desde cada estado. */
export const TRANSICIONES: Record<EstadoReserva, readonly EstadoReserva[]> = {
  pendiente: ['confirmada', 'cancelada'],
  confirmada: ['pagada', 'in_house', 'cancelada', 'no_show'],
  pagada: ['in_house', 'cancelada', 'no_show'],
  in_house: ['checkout'],
  checkout: [],
  cancelada: [],
  no_show: [],
}

/** ¿El estado es terminal (no admite más transiciones)? */
export function esTerminal(estado: EstadoReserva): boolean {
  return TRANSICIONES[estado].length === 0
}

/** ¿El estado ocupa inventario? */
export function ocupaInventario(estado: EstadoReserva): boolean {
  return ESTADOS_ACTIVOS.includes(estado)
}

/** Estados a los que se puede pasar desde el actual. */
export function transicionesPosibles(estado: EstadoReserva): readonly EstadoReserva[] {
  return TRANSICIONES[estado]
}

/** ¿Es válido pasar de `desde` a `hacia`? */
export function puedeTransicionar(desde: EstadoReserva, hacia: EstadoReserva): boolean {
  return TRANSICIONES[desde].includes(hacia)
}

/**
 * El camino de estados para llegar de `desde` a `hacia`, o `null` si no hay.
 *
 * Existe porque **la máquina de estados no tiene un atajo de `pendiente` a
 * `pagada`**, y ese salto es justo el que provoca un huésped que reserva por la
 * web y paga todo de una: su reserva nace `pendiente` y tiene que pasar por
 * `confirmada`.
 *
 * Sin esto, el pago se registraba y la transición se descartaba en silencio por
 * inválida. La reserva quedaba `pendiente`, la expiración la liberaba a los 5
 * días y el hotel revendía la unidad **con la plata del huésped ya cobrada**.
 *
 * El recorrido es a lo sumo de dos pasos, así que se resuelve con una búsqueda
 * en anchura corta en vez de un grafo general: si algún día hiciera falta un
 * camino de tres, este mismo código lo encuentra.
 */
export function caminoDeEstados(
  desde: EstadoReserva,
  hacia: EstadoReserva,
): EstadoReserva[] | null {
  if (desde === hacia) return []

  const visitados = new Set<EstadoReserva>([desde])
  const cola: { estado: EstadoReserva; camino: EstadoReserva[] }[] = [{ estado: desde, camino: [] }]

  while (cola.length > 0) {
    const { estado, camino } = cola.shift()!
    for (const siguiente of TRANSICIONES[estado]) {
      if (visitados.has(siguiente)) continue
      const nuevo = [...camino, siguiente]
      if (siguiente === hacia) return nuevo
      visitados.add(siguiente)
      cola.push({ estado: siguiente, camino: nuevo })
    }
  }
  return null
}

/* ───────────────────────────────────────────── datos comerciales (paso 6) ──── */

/**
 * Plan de comidas incluido en la tarifa.
 *
 * Es lo que WinPAX llamaba indistintamente «plan» y «pensión»: son el mismo dato.
 * El valor por omisión es `desayuno` porque es lo que incluye el Tarifario del
 * hotel; poner `solo_alojamiento` por defecto haría que toda reserva nueva
 * prometiera menos de lo que el hotel da.
 */
export const PLANES = ['solo_alojamiento', 'desayuno', 'media_pension', 'pension_completa'] as const
export type Plan = (typeof PLANES)[number]

export const ETIQUETAS_PLAN: Record<Plan, string> = {
  solo_alojamiento: 'Solo alojamiento',
  desayuno: 'Habitación y desayuno',
  media_pension: 'Media pensión',
  pension_completa: 'Pensión completa',
}

/**
 * Cómo está garantizada la reserva.
 *
 * No es un dato administrativo: es **lo que decide si un no-show se puede
 * cobrar**. Sin garantía no hay nada de dónde cobrar, y la política de
 * cancelación del Tarifario (no-show 100 %) queda en letra muerta. El ADR 0019
 * dejó pendiente cómo se ejecuta ese cobro; esta columna es el dato que va a
 * necesitar cuando se decida.
 */
export const GARANTIAS = ['sin_garantia', 'tarjeta', 'deposito', 'agencia', 'contrato'] as const
export type Garantia = (typeof GARANTIAS)[number]

export const ETIQUETAS_GARANTIA: Record<Garantia, string> = {
  sin_garantia: 'Sin garantía',
  tarjeta: 'Tarjeta',
  deposito: 'Depósito',
  agencia: 'Cuenta de agencia',
  contrato: 'Contrato',
}

/** Garantías con las que un no-show tiene de dónde cobrarse. */
export const GARANTIAS_COBRABLES: readonly Garantia[] = ['tarjeta', 'deposito', 'agencia', 'contrato']

export function noShowEsCobrable(g: Garantia): boolean {
  return GARANTIAS_COBRABLES.includes(g)
}

/** Segmento de mercado, para los reportes de gerencia. */
export const SEGMENTOS = ['particular', 'corporativo', 'grupo', 'ota', 'agencia'] as const
export type Segmento = (typeof SEGMENTOS)[number]

export const ETIQUETAS_SEGMENTO: Record<Segmento, string> = {
  particular: 'Particular',
  corporativo: 'Corporativo',
  grupo: 'Grupo',
  ota: 'OTA / Booking',
  agencia: 'Agencia',
}

/**
 * Segmento que corresponde a cada canal de venta.
 *
 * Se deriva en lugar de pedirlo dos veces: si la reserva entra por Booking, el
 * segmento es OTA por definición, y hacer que recepción lo elija a mano sólo
 * habilita que los dos datos se contradigan. Cuando entra por un canal directo el
 * segmento sí es una decisión —puede ser un particular o una empresa— y ahí la
 * pantalla lo deja elegir.
 */
export function segmentoDeCanal(canal: string): Segmento {
  if (canal === 'booking' || canal === 'expedia') return 'ota'
  return 'particular'
}
