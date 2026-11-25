/**
 * Cuándo se le puede cargar un consumo a una reserva (lógica pura).
 *
 * Es la regla que comparten el punto de venta y la cuenta de la reserva. Sin
 * base, sin framework: se prueba sola.
 */

/**
 * Los motivos llevan el prefijo `cargo_` a propósito.
 *
 * `motivoNoFacturable` (en `lib/domain/facturacion.ts`) ya usa `anulada` y
 * `ya_facturada` para algo distinto: por qué no se puede EMITIR el comprobante.
 * Acá el motivo es por qué no se puede CARGAR un consumo. Sin el prefijo, las
 * dos tablas de mensajes se pisan al combinarse en la pantalla de la reserva y
 * una de las dos explicaciones desaparece — lo detectó el typecheck.
 */
export type MotivoNoCargable = 'cargo_anulada' | 'cargo_ya_facturada'

export const MENSAJES_NO_CARGABLE: Record<MotivoNoCargable, string> = {
  cargo_anulada:
    'La reserva está cancelada o marcada como no-show: no corresponde cargarle consumos.',
  cargo_ya_facturada:
    'La cuenta ya se facturó. Un consumo posterior no entraría en el comprobante emitido: cobralo aparte.',
}

/**
 * ¿Se le puede cargar un consumo a esta reserva?
 *
 * ── Dónde se cierra la cuenta, y por qué no en el check-out ─────────────────
 *
 * La tentación es cerrar en el check-out, pero eso deja afuera dos casos reales
 * que ocurren todos los días:
 *
 *  · el huésped que llega a las 9 y desayuna antes del check-in de las 15;
 *  · el que hace el check-out a las 10 y desayunó esa misma mañana.
 *
 * En los dos la persona consumió de verdad y hay que cobrarlo. Lo que **sí**
 * cierra la cuenta es la **factura**: una vez emitido el comprobante, un cargo
 * nuevo no entraría en él, y agregarlo dejaría la cuenta y la factura diciendo
 * cosas distintas —con el agravante de que `facturas` es inmutable (migración
 * 0034) y solo se puede emitir una por reserva (0045)—.
 *
 * Una reserva cancelada o no-show tampoco admite cargos: no hubo servicio.
 */
export function motivoNoCargable(
  estado: string,
  yaFacturada: boolean,
): MotivoNoCargable | null {
  if (yaFacturada) return 'cargo_ya_facturada'
  if (estado === 'cancelada' || estado === 'no_show') return 'cargo_anulada'
  return null
}

export function puedeCargarConsumo(estado: string, yaFacturada = false): boolean {
  return motivoNoCargable(estado, yaFacturada) === null
}
