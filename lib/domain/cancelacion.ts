/**
 * Política de cancelación (lógica pura).
 *
 * Regla del Tarifario Blanca Patagonia:
 *  - Más de 14 días antes del check-in: sin cargo.
 *  - Entre 14 y 7 días: se cobra la primera noche.
 *  - Dentro de los 7 días: se cobra el 100 % de la estadía.
 *  - No-show: 100 % de la estadía.
 *
 * Se modela como una lista de umbrales `{ desde_dias, cargo }`: se aplica la
 * primera regla (ordenada de mayor a menor `desde_dias`) cuyo umbral es <= a los
 * días de anticipación de la cancelación.
 */

export type Cargo = 'ninguno' | 'primera_noche' | 'total'

export interface ReglaCancelacion {
  desde_dias: number
  cargo: Cargo
}

/** Determina el tipo de cargo según los días de anticipación de la cancelación. */
export function cargoPorCancelacion(
  reglas: ReglaCancelacion[],
  diasAntes: number,
): Cargo {
  const ordenadas = [...reglas].sort((a, b) => b.desde_dias - a.desde_dias)
  for (const regla of ordenadas) {
    if (diasAntes >= regla.desde_dias) return regla.cargo
  }
  return 'total'
}

/**
 * Precio de una noche **con IVA**, a partir del total de la estadía.
 *
 * Por qué existe. `estadias.precio_noche` guarda `totalNeto / noches`: está
 * **sin IVA y promediado**. La pantalla de la reserva lo pasaba directo como
 * «primera noche» junto a `reserva.total`, que **sí** lleva IVA: los dos montos
 * que decide el cargo estaban en unidades distintas, así que al huésped se le
 * anunciaba un número mal calculado.
 *
 * Como `precio_noche = totalNeto / noches`, llevarlo a IVA incluido es dividir
 * el total con IVA por la misma cantidad de noches.
 *
 * ⚠️ Esto corrige la unidad, **no el promedio**. Si las noches tienen precios
 * distintos —temporada que cambia a mitad de la estadía—, la primera noche real
 * no es el promedio. Arreglarlo exige guardar el precio de cada noche, que hoy
 * no se persiste. Queda anotado como pendiente en `docs/audit/00-pendientes.md`.
 */
export function nochePromedioConIva(totalConIva: number, noches: number): number {
  if (noches <= 0) return 0
  return Math.round((totalConIva / noches + Number.EPSILON) * 100) / 100
}

/**
 * Precio **real** de la primera noche, con IVA, cuando las noches valen distinto.
 *
 * ── El problema que cierra ──────────────────────────────────────────────────
 *
 * `nochePromedioConIva` reparte el total en partes iguales. Si la estadía cruza un
 * cambio de temporada, eso no es la primera noche: es el promedio. Con una entrada en
 * temporada baja y una salida en alta, el cargo por cancelar entre 14 y 7 días sale
 * **más alto** que la noche que efectivamente se pierde; al revés, sale más bajo.
 *
 * En los dos sentidos es plata mal cobrada, y el huésped tiene el tarifario publicado
 * para discutirlo.
 *
 * ── Por qué se reparte el total guardado en vez de recotizar ────────────────
 *
 * La tentación es cotizar de nuevo una noche y usar ese número. Está mal: el precio de
 * la reserva **se fijó al reservar** (ADR 0004), y las tarifas pudieron cambiar desde
 * entonces. Recotizar cobraría un precio que el huésped nunca aceptó.
 *
 * Lo que se hace es repartir el total que **ya está guardado** según la proporción de
 * las tarifas por noche: la primera noche se lleva la parte que le corresponde de lo
 * que efectivamente se pactó. Así el descuento, la promoción y el IVA quedan
 * distribuidos igual que en el total original, sin recalcular ninguno.
 *
 * Cuando todas las noches valen lo mismo, esto da exactamente `total / noches`, así
 * que reemplaza al promedio sin cambiar ningún caso que hoy esté bien.
 */
export function primeraNocheRealConIva(totalConIva: number, preciosPorNoche: readonly number[]): number {
  if (preciosPorNoche.length === 0) return 0

  const suma = preciosPorNoche.reduce((a, p) => a + p, 0)

  // Sin base para repartir —todas las noches en cero, o precios corruptos— se cae al
  // promedio en vez de devolver cero. Devolver cero significaría «no se cobra nada»,
  // que es una afirmación sobre el dinero que este dato no respalda.
  if (!(suma > 0)) return nochePromedioConIva(totalConIva, preciosPorNoche.length)

  const proporcion = preciosPorNoche[0] / suma
  return Math.round((totalConIva * proporcion + Number.EPSILON) * 100) / 100
}

/**
 * Traduce el tipo de cargo a un monto concreto.
 *
 * **Los dos importes tienen que venir en la misma unidad** —ambos con IVA—, o el
 * cargo sale mal según qué regla aplique. El nombre del parámetro lo dice para
 * que no se repita el error: usá `nochePromedioConIva` para calcularlo.
 */
export function montoCancelacion(params: {
  cargo: Cargo
  totalEstadia: number
  primeraNocheConIva: number
  noShow?: boolean
}): number {
  if (params.noShow) return params.totalEstadia
  switch (params.cargo) {
    case 'ninguno':
      return 0
    case 'primera_noche':
      return params.primeraNocheConIva
    case 'total':
      return params.totalEstadia
  }
}
