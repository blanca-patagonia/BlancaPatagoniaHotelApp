import 'server-only'
import type { CondicionIva, TipoComprobante } from '@/lib/domain/facturacion'

/**
 * Abstracción de la facturación electrónica (`FacturacionElectronicaProvider`).
 *
 * Cuarto adapter del proyecto, con el mismo patrón que `PaymentProvider`,
 * `FirmaElectronicaProvider` y `AsistenteProvider`: interfaz estable + stub
 * local, para que conectar el web service de AFIP/ARCA (WSFEv1) sea escribir
 * una clase nueva y cambiar una variable de entorno.
 *
 * ⚠️ El stub NO se conecta a AFIP. Emite un CAE simulado para poder recorrer el
 * circuito completo en la defensa de la tesis. Ver ADR 0012.
 */

export interface SolicitudCae {
  tipo: TipoComprobante
  puntoVenta: number
  /** Importe total con IVA incluido. */
  total: number
  neto: number
  iva: number
  condicionReceptor: CondicionIva
  /** CUIT del receptor; obligatorio en comprobantes A. */
  cuitReceptor?: string | null
  fecha: string
}

export interface ResultadoCae {
  ok: boolean
  cae?: string
  caeVto?: string
  numero?: number
  /** Motivo del rechazo, tal como lo devolvería AFIP en `Observaciones`. */
  error?: string
}

export interface FacturacionElectronicaProvider {
  nombre: string
  /** Solicita el Código de Autorización Electrónico del comprobante. */
  solicitarCae(s: SolicitudCae): Promise<ResultadoCae>
  /** Indica si el proveedor está operando contra el organismo de verdad. */
  esReal(): boolean
}

/**
 * Proveedor simulado.
 *
 * Reproduce dos comportamientos reales de AFIP que conviene tener modelados
 * desde ahora, porque condicionan la interfaz:
 *  1. rechaza una factura A sin CUIT de receptor válido;
 *  2. devuelve el CAE con una fecha de vencimiento (10 días corridos).
 */
class ProveedorSimulado implements FacturacionElectronicaProvider {
  nombre = 'simulado'

  esReal(): boolean {
    return false
  }

  async solicitarCae(s: SolicitudCae): Promise<ResultadoCae> {
    if (s.tipo === 'A' && !s.cuitReceptor) {
      return { ok: false, error: 'El comprobante A exige el CUIT del receptor.' }
    }
    if (!(s.total > 0)) {
      return { ok: false, error: 'El importe total debe ser mayor a cero.' }
    }

    // CAE simulado de 14 dígitos, como el real. Determinístico sobre los datos
    // del comprobante para que dos llamadas iguales devuelvan lo mismo.
    const semilla = `${s.tipo}${s.puntoVenta}${s.total}${s.fecha}`
    let acumulado = 0
    for (const c of semilla) acumulado = (acumulado * 31 + c.charCodeAt(0)) % 1_000_000_000_000

    const vto = new Date(`${s.fecha}T00:00:00Z`)
    vto.setUTCDate(vto.getUTCDate() + 10)

    return {
      ok: true,
      cae: String(acumulado).padStart(14, '7'),
      caeVto: vto.toISOString().slice(0, 10),
    }
  }
}

const PROVEEDORES: Record<string, FacturacionElectronicaProvider> = {
  simulado: new ProveedorSimulado(),
}

/**
 * Proveedor vigente. Con `FACTURACION_PROVIDER=afip` (cuando exista esa
 * implementación) el sistema pasaría a emitir comprobantes reales sin tocar el
 * dominio ni las pantallas.
 */
export function obtenerProveedorFacturacion(
  nombre: string = process.env.FACTURACION_PROVIDER ?? 'simulado',
): FacturacionElectronicaProvider {
  return PROVEEDORES[nombre] ?? PROVEEDORES.simulado
}
