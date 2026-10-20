/**
 * Libro de ventas: las facturas y notas de crédito emitidas en un período.
 *
 * Es el archivo que pide el contador cada mes para el libro de IVA ventas. Hasta
 * ahora el sistema emitía comprobantes pero no había forma de bajarlos juntos:
 * había que abrir reserva por reserva y copiar los números a mano.
 *
 * Tres decisiones que no son obvias:
 *
 * · **Las notas de crédito van en el mismo listado y CON SIGNO NEGATIVO.** Una
 *   NC anula total o parcialmente una factura (la factura es inmutable, 0034):
 *   si se listaran aparte, o en positivo, la suma de la columna daría más de lo
 *   que el hotel vendió de verdad.
 * · **El neto se parte en gravado y exento.** En la base `exento` es un
 *   SUBCONJUNTO de `neto` (ADR 0024); el contador necesita las dos bases por
 *   separado porque sólo la gravada lleva IVA. Así `gravado + exento + iva =
 *   total` en cada fila.
 * · **La fecha es la del hotel**, no la UTC: un comprobante emitido a las 22:00
 *   del 31 pertenece a ese mes, no al siguiente (`fechaDelHotel`).
 */

import { fechaDelHotel } from '@/lib/fechas'
import { nombreCompleto } from './huespedes'
import { ETIQUETAS_CONDICION_IVA, formatearCuit, type CondicionIva } from './facturacion'

type Importe = number | string | null

/** Lo que se lee de `facturas` y de `notas_credito`; los campos fiscales comunes. */
interface ComprobanteBase {
  numero: string
  numero_fiscal: string | null
  tipo_comprobante: string | null
  punto_venta: number | null
  emitida_en: string
  neto: Importe
  iva: Importe
  exento: Importe
  alicuota_iva: Importe
  total: Importe
  moneda: string | null
  cae: string | null
  cae_vto: string | null
}

interface ReservaDelComprobante {
  codigo: string
  huesped: { nombre?: string; apellido?: string } | null
}

export interface FacturaLibro extends ComprobanteBase {
  cuit_receptor: string | null
  condicion_iva_receptor: string | null
  motivo_exencion: string | null
  reserva: ReservaDelComprobante | null
}

export interface NotaCreditoLibro extends ComprobanteBase {
  motivo: string
  factura: {
    numero: string
    numero_fiscal: string | null
    cuit_receptor: string | null
    condicion_iva_receptor: string | null
    reserva: ReservaDelComprobante | null
  } | null
}

export interface FilaLibroVentas {
  fecha: string
  comprobante: 'Factura' | 'Nota de crédito'
  letra: string
  puntoVenta: string
  numero: string
  cae: string
  vencimientoCae: string
  reserva: string
  cliente: string
  cuit: string
  condicionIva: string
  moneda: string
  /** Importes con signo: negativos en una nota de crédito. `null` si el comprobante no lo tiene. */
  netoGravado: number | null
  exento: number
  iva: number | null
  total: number
  alicuota: number | null
  /** Para una NC, el número de la factura que corrige. */
  referencia: string
  observaciones: string
}

function num(v: Importe): number | null {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function condicion(c: string | null): string {
  return c && c in ETIQUETAS_CONDICION_IVA ? ETIQUETAS_CONDICION_IVA[c as CondicionIva] : ''
}

function cliente(r: ReservaDelComprobante | null): string {
  return r?.huesped ? nombreCompleto(r.huesped) : ''
}

/** Neto gravado = neto − exento (el exento es parte del neto, ADR 0024). */
function gravado(c: ComprobanteBase): number | null {
  const neto = num(c.neto)
  return neto === null ? null : neto - (num(c.exento) ?? 0)
}

function base(c: ComprobanteBase, signo: 1 | -1) {
  const g = gravado(c)
  const iva = num(c.iva)
  return {
    fecha: fechaDelHotel(c.emitida_en),
    letra: c.tipo_comprobante ?? '',
    puntoVenta: c.punto_venta === null ? '' : String(c.punto_venta).padStart(5, '0'),
    numero: c.numero_fiscal ?? c.numero,
    cae: c.cae ?? '',
    vencimientoCae: c.cae_vto ?? '',
    moneda: c.moneda ?? 'USD',
    netoGravado: g === null ? null : signo * g,
    exento: signo * (num(c.exento) ?? 0),
    iva: iva === null ? null : signo * iva,
    total: signo * (num(c.total) ?? 0),
    alicuota: num(c.alicuota_iva),
  }
}

/**
 * Arma las filas del libro, ordenadas por fecha y, dentro del día, con cada
 * factura antes que sus notas de crédito.
 */
export function filasLibroVentas(
  facturas: readonly FacturaLibro[],
  notas: readonly NotaCreditoLibro[],
): FilaLibroVentas[] {
  const filas: { instante: string; fila: FilaLibroVentas }[] = [
    ...facturas.map((f) => ({
      instante: f.emitida_en,
      fila: {
        ...base(f, 1),
        comprobante: 'Factura' as const,
        reserva: f.reserva?.codigo ?? '',
        cliente: cliente(f.reserva),
        cuit: f.cuit_receptor ? formatearCuit(f.cuit_receptor) : '',
        condicionIva: condicion(f.condicion_iva_receptor),
        referencia: '',
        observaciones: f.motivo_exencion ? `Exento: ${f.motivo_exencion}` : '',
      },
    })),
    ...notas.map((n) => ({
      instante: n.emitida_en,
      fila: {
        ...base(n, -1),
        comprobante: 'Nota de crédito' as const,
        reserva: n.factura?.reserva?.codigo ?? '',
        cliente: cliente(n.factura?.reserva ?? null),
        // La NC va al mismo receptor que la factura que corrige.
        cuit: n.factura?.cuit_receptor ? formatearCuit(n.factura.cuit_receptor) : '',
        condicionIva: condicion(n.factura?.condicion_iva_receptor ?? null),
        referencia: n.factura ? (n.factura.numero_fiscal ?? n.factura.numero) : '',
        observaciones: n.motivo,
      },
    })),
  ]
  return filas
    .sort((a, b) => (a.instante < b.instante ? -1 : a.instante > b.instante ? 1 : 0))
    .map((f) => f.fila)
}

/** Totales del período, con las notas de crédito ya restadas. */
export function totalesLibroVentas(filas: readonly FilaLibroVentas[]) {
  return filas.reduce(
    (t, f) => ({
      netoGravado: t.netoGravado + (f.netoGravado ?? 0),
      exento: t.exento + f.exento,
      iva: t.iva + (f.iva ?? 0),
      total: t.total + f.total,
    }),
    { netoGravado: 0, exento: 0, iva: 0, total: 0 },
  )
}
