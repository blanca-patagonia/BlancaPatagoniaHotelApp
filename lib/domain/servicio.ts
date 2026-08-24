/**
 * Servicio de cocina: quiénes desayunan y qué se vendió.
 *
 * Dos documentos que la cocina y la recepción imprimen todos los días:
 *
 *  · **Lista de desayuno.** Cuántos cubiertos preparar y para quién.
 *  · **Resumen de consumos vendidos.** Qué salió del frigobar y de la cocina en
 *    un período, para reponer stock y para el arqueo.
 *
 * Reglas puras: sin base, sin framework. Se prueban solas.
 */

import { diasEntre, sumarDias } from '@/lib/fechas'

/* ────────────────────────────────────────────────────── desayuno ──── */

/**
 * ¿Esta estadía desayuna en la fecha indicada?
 *
 * La regla no es obvia y es la que más se equivoca a mano. El desayuno se sirve
 * **a la mañana siguiente de cada noche dormida**:
 *
 *  · Quien hace **check-out hoy** SÍ desayuna: durmió anoche y come antes de
 *    irse. Olvidarlo deja a alguien sin cubierto, que es el error que se ve.
 *  · Quien hace **check-in hoy** NO desayuna hoy: llega a la tarde. Contarlo
 *    infla el pedido a cocina, que es el error que no se ve.
 *
 * El período es `[check_in, check_out)`, donde cada elemento es una NOCHE. Quien
 * durmió la noche `f - 1` desayuna la mañana `f`.
 */
export function desayunaEn(checkIn: string, checkOut: string, fecha: string): boolean {
  const nocheAnterior = sumarDias(fecha, -1)
  // Durmió esa noche si la noche anterior cae dentro de [check_in, check_out).
  return checkIn <= nocheAnterior && nocheAnterior < checkOut
}

export interface EstadiaServicio {
  reservaCodigo: string
  unidad: string
  huesped: string
  checkIn: string
  checkOut: string
  huespedes: number
  /** Anotaciones del huésped: alergias, restricciones, pedidos especiales. */
  notas?: string | null
}

export interface LineaDesayuno {
  unidad: string
  huesped: string
  reservaCodigo: string
  cubiertos: number
  /** `true` si se retira hoy: la cocina suele adelantarles el servicio. */
  seRetiraHoy: boolean
  notas: string | null
  /**
   * `true` si es un desayuno **vendido suelto**, no incluido en una tarifa.
   *
   * La cocina necesita distinguirlos: el extra no tiene habitación asignada
   * todavía (el huésped llegó antes del check-in) y se sirve en el salón sin
   * referencia de mesa.
   */
  esExtra: boolean
}

/**
 * Desayuno vendido suelto, fuera de la tarifa de una noche.
 *
 * El caso que lo motiva (relevamiento del 15/08/2026): «llegan los huéspedes a
 * las 9 de la mañana, el check-in es recién a las 2 o 3 de la tarde, y te dicen
 * si se puede subir a desayunar».
 */
export interface DesayunoExtra {
  reservaCodigo: string
  huesped: string
  /** Puede no tener habitación: llegó antes del check-in. */
  unidad: string | null
  cubiertos: number
  /** Fecha en que se sirve, que es la del consumo. */
  fecha: string
}

export interface ListaDesayuno {
  fecha: string
  lineas: LineaDesayuno[]
  totalCubiertos: number
  /** Cuántas de esas líneas se van hoy, para ordenar la salida del salón. */
  totalSeRetiran: number
  /** Cubiertos que vienen de desayunos vendidos sueltos. */
  totalExtras: number
}

/**
 * Arma la lista del día, ordenada por unidad.
 *
 * Se ordena por unidad y no por huésped porque así recorre el salón quien sirve:
 * la mesa se identifica por habitación.
 *
 * ── Por qué los extras entran acá y no en una lista aparte ──────────────────
 *
 * Un desayuno vendido suelto **es un cubierto que la cocina tiene que
 * preparar**. Si viviera en otra pantalla, quien cocina miraría la lista de
 * siempre y prepararía de menos — que es exactamente el problema que esta
 * función existe para evitar. Van en la misma lista, marcados, y suman al total.
 *
 * Los extras se pasan ya filtrados por fecha desde la capa de datos: acá se
 * vuelve a filtrar igual, porque una regla que depende de que el llamador filtre
 * bien no es una regla.
 */
export function listaDeDesayuno(
  estadias: EstadiaServicio[],
  fecha: string,
  extras: DesayunoExtra[] = [],
): ListaDesayuno {
  const incluidos: LineaDesayuno[] = estadias
    .filter((e) => desayunaEn(e.checkIn, e.checkOut, fecha))
    .map((e) => ({
      unidad: e.unidad,
      huesped: e.huesped,
      reservaCodigo: e.reservaCodigo,
      cubiertos: Math.max(1, e.huespedes),
      seRetiraHoy: e.checkOut === fecha,
      notas: e.notas ?? null,
      esExtra: false,
    }))

  const sueltos: LineaDesayuno[] = extras
    .filter((x) => x.fecha === fecha && x.cubiertos > 0)
    .map((x) => ({
      // Sin habitación asignada se muestra el guion largo y no una cadena vacía:
      // una celda vacía se lee como un dato que falta por error.
      unidad: x.unidad ?? '—',
      huesped: x.huesped,
      reservaCodigo: x.reservaCodigo,
      cubiertos: x.cubiertos,
      seRetiraHoy: false,
      notas: null,
      esExtra: true,
    }))

  const lineas = [...incluidos, ...sueltos].sort((a, b) =>
    a.unidad.localeCompare(b.unidad, 'es', { numeric: true }),
  )

  return {
    fecha,
    lineas,
    totalCubiertos: lineas.reduce((acc, l) => acc + l.cubiertos, 0),
    totalSeRetiran: lineas.filter((l) => l.seRetiraHoy).length,
    totalExtras: sueltos.reduce((acc, l) => acc + l.cubiertos, 0),
  }
}

/* ──────────────────────────────────── cuándo se le puede cargar un consumo ── */

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

/* ────────────────────────────────────────────────────── consumos ──── */

export type CategoriaProducto = 'desayuno' | 'frigobar' | 'excursion' | 'traslado' | 'otro'

export interface ConsumoVendido {
  productoCodigo: string
  productoNombre: string
  categoria: CategoriaProducto
  cantidad: number
  precioUnitario: number
  fecha: string
}

export interface LineaVenta {
  productoCodigo: string
  productoNombre: string
  categoria: CategoriaProducto
  cantidad: number
  /** Suma de cantidad × precio del snapshot, no del precio actual del catálogo. */
  total: number
}

export interface ResumenVentas {
  desde: string
  hasta: string
  dias: number
  lineas: LineaVenta[]
  porCategoria: { categoria: CategoriaProducto; cantidad: number; total: number }[]
  totalGeneral: number
  totalUnidades: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Agrupa lo vendido en un período por producto y por categoría.
 *
 * Usa el `precio_unitario` guardado en cada consumo —que es una foto del momento
 * de la venta— y **no** el precio actual del catálogo. Si se recalculara con el
 * precio de hoy, cualquier ajuste de tarifa reescribiría la historia de ventas y
 * el arqueo de un mes cerrado cambiaría solo.
 */
export function resumenDeVentas(
  consumos: ConsumoVendido[],
  desde: string,
  hasta: string,
): ResumenVentas {
  const enRango = consumos.filter((c) => c.fecha >= desde && c.fecha <= hasta)

  const porProducto = new Map<string, LineaVenta>()
  for (const c of enRango) {
    const actual = porProducto.get(c.productoCodigo) ?? {
      productoCodigo: c.productoCodigo,
      productoNombre: c.productoNombre,
      categoria: c.categoria,
      cantidad: 0,
      total: 0,
    }
    actual.cantidad += c.cantidad
    actual.total += c.cantidad * c.precioUnitario
    porProducto.set(c.productoCodigo, actual)
  }

  const lineas = [...porProducto.values()]
    .map((l) => ({ ...l, total: redondear(l.total) }))
    // De mayor a menor facturación: lo que importa aparece primero.
    .sort((a, b) => b.total - a.total)

  const acumCategoria = new Map<CategoriaProducto, { cantidad: number; total: number }>()
  for (const l of lineas) {
    const a = acumCategoria.get(l.categoria) ?? { cantidad: 0, total: 0 }
    a.cantidad += l.cantidad
    a.total += l.total
    acumCategoria.set(l.categoria, a)
  }

  const porCategoria = [...acumCategoria.entries()]
    .map(([categoria, v]) => ({ categoria, cantidad: v.cantidad, total: redondear(v.total) }))
    .sort((a, b) => b.total - a.total)

  return {
    desde,
    hasta,
    // Inclusivo en ambos extremos: del 1 al 1 es un día, no cero.
    dias: Math.max(1, diasEntre(desde, hasta) + 1),
    lineas,
    porCategoria,
    totalGeneral: redondear(lineas.reduce((acc, l) => acc + l.total, 0)),
    totalUnidades: lineas.reduce((acc, l) => acc + l.cantidad, 0),
  }
}

export const ETIQUETAS_CATEGORIA_PRODUCTO: Record<CategoriaProducto, string> = {
  desayuno: 'Desayuno',
  frigobar: 'Frigobar',
  excursion: 'Excursiones',
  traslado: 'Traslados',
  otro: 'Otros',
}
