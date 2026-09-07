import 'server-only'

/**
 * MercadoPago — reporte de liquidaciones (*settlement report*).
 *
 * Es la fuente que cierra los objetivos 4 y 10 del pedido por el lado de la
 * pasarela: dice **cuánta plata entró de verdad a la cuenta**, cuánto se llevó
 * MercadoPago de comisión y contra qué cobro corresponde cada línea.
 *
 * ── Por qué este reporte y no `/v1/payments/search` ─────────────────────────
 *
 * Buscar pagos devuelve lo que la pasarela **aprobó**. El reporte de liquidaciones
 * devuelve lo que la pasarela **acreditó**, que es otra cosa y llega días después:
 * trae `SETTLEMENT_NET_AMOUNT`, que es el impacto real en el saldo una vez
 * descontadas comisiones, financiación e impuestos. Conciliar contra el importe
 * aprobado dejaría siempre una diferencia igual a la comisión, y eso es
 * exactamente lo que hay que poder auditar: si el canal descuenta más de lo
 * pactado, acá se ve.
 *
 * ── Los endpoints (verificados en la documentación oficial) ─────────────────
 *
 *   POST /v1/account/settlement_report          → pide generar uno. Responde 202.
 *   GET  /v1/account/settlement_report          → lista los ya generados.
 *   GET  /v1/account/settlement_report/{nombre} → descarga el CSV.
 *
 * ⚠️ **La generación es asincrónica.** El POST devuelve 202 «pending», no el
 * archivo. Por eso `consultar` NO se queda esperando: si el reporte del período no
 * está, lo pide y devuelve un `ok: false` explicando que hay que volver en unos
 * minutos. Bloquear la petición HTTP del panel haciendo polling contra un tercero
 * es la forma de que la pantalla quede colgada y después nadie sepa por qué.
 *
 * Se habla por HTTP y sin SDK, igual que el adapter de cobro (`lib/payments`).
 */

import {
  conClaves,
  type MovimientoExterno,
  type OrigenMovimiento,
} from '@/lib/domain/conciliacion'
import { partirCsv, normalizarEncabezado, interpretarImporte } from '@/lib/canales/csv'
import type {
  CapacidadesExtracto,
  ExtractoProvider,
  PeriodoConsulta,
  ResultadoExtracto,
} from '.'

const API = 'https://api.mercadopago.com'
const RECURSO = '/v1/account/settlement_report'

/**
 * Corte de las llamadas salientes.
 *
 * Veinte segundos, el doble que en el cobro: acá se descarga un CSV que puede
 * tener miles de líneas, y del otro lado no hay un huésped esperando para pagar
 * sino alguien de administración que apretó «traer». Sin timeout, un `fetch`
 * colgado consume la petición entera hasta el límite del runtime.
 */
const TIMEOUT_MS = 20_000

interface ReporteListado {
  file_name?: string
  begin_date?: string
  end_date?: string
  date_created?: string
}

/* ─────────────────────────────────────────────────────── el CSV ────────── */

/**
 * Columnas del reporte que se usan, con su nombre exacto en el archivo.
 *
 * Se listan las que importan y no todas: el reporte trae más de treinta y leerlas
 * todas para descartarlas no agrega nada. Los nombres están en mayúsculas y sin
 * acentos en el archivo; igual se comparan normalizados, porque MercadoPago ha
 * cambiado la capitalización entre versiones del reporte.
 */
const COLUMNAS = {
  referencia: 'external reference',
  idOrigen: 'source id',
  tipo: 'transaction type',
  fecha: 'transaction date',
  bruto: 'transaction amount',
  comision: 'fee amount',
  neto: 'settlement net amount',
  moneda: 'settlement currency',
  monedaTransaccion: 'transaction currency',
  descripcion: 'description',
} as const

type Campo = keyof typeof COLUMNAS

function indices(encabezados: readonly string[]): Record<Campo, number | null> {
  const normalizados = encabezados.map(normalizarEncabezado)
  const salida = {} as Record<Campo, number | null>
  for (const campo of Object.keys(COLUMNAS) as Campo[]) {
    const i = normalizados.indexOf(COLUMNAS[campo])
    salida[campo] = i === -1 ? null : i
  }
  return salida
}

/** `2026-09-05T14:33:00.000-03:00` → `2026-09-05`. Vacío si no se entiende. */
function soloFecha(valor: string): string | null {
  const v = valor.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export interface LecturaLiquidacion {
  movimientos: MovimientoExterno[]
  descartadas: number
  /** Total de comisiones del período. Es el número del objetivo 4. */
  comisiones: number
}

/**
 * Convierte el CSV del reporte en movimientos.
 *
 * ── Las dos decisiones que importan ─────────────────────────────────────────
 *
 * 1. **El importe que se guarda es el NETO liquidado**, no el bruto cobrado. Es lo
 *    que de verdad entró a la cuenta, y es contra eso que tiene que cerrar el
 *    banco. El bruto y la comisión quedan en la descripción para poder explicar la
 *    diferencia sin volver al archivo.
 * 2. **La referencia es `EXTERNAL_REFERENCE`**, que es el mismo valor que este
 *    sistema le mandó a MercadoPago como `external_reference` al crear el link y
 *    que guarda en `pagos.external_id`. Por eso el emparejamiento por referencia
 *    es exacto y no una coincidencia de importes. Cuando viene vacío —un cobro
 *    hecho desde el panel de MercadoPago, que este sistema no originó— se cae al
 *    `SOURCE_ID`, que al menos identifica la operación en la pasarela.
 */
export function leerLiquidacion(texto: string, cuenta?: string | null): LecturaLiquidacion {
  const filas = partirCsv(texto)
  if (filas.length < 2) return { movimientos: [], descartadas: 0, comisiones: 0 }

  const mapa = indices(filas[0])
  if (mapa.neto === null && mapa.bruto === null) {
    return { movimientos: [], descartadas: filas.length - 1, comisiones: 0 }
  }

  const sinClave: Omit<MovimientoExterno, 'externalId'>[] = []
  const referencias: (string | null)[] = []
  let descartadas = 0
  let comisiones = 0

  const celda = (fila: readonly string[], campo: Campo): string =>
    mapa[campo] === null ? '' : (fila[mapa[campo]] ?? '')

  for (const fila of filas.slice(1)) {
    const fecha = soloFecha(celda(fila, 'fecha'))
    const neto = interpretarImporte(celda(fila, 'neto'))
    const bruto = interpretarImporte(celda(fila, 'bruto'))
    const monto = neto ?? bruto

    if (!fecha || monto === null) {
      descartadas++
      continue
    }

    const comision = interpretarImporte(celda(fila, 'comision')) ?? 0
    comisiones += Math.abs(comision)

    const tipo = celda(fila, 'tipo').trim()
    const detalle = celda(fila, 'descripcion').trim()
    const partes = [tipo || 'Liquidación', detalle].filter(Boolean)
    if (comision) partes.push(`comisión ${Math.abs(comision).toFixed(2)}`)
    if (bruto !== null && neto !== null && bruto !== neto) {
      partes.push(`bruto ${bruto.toFixed(2)}`)
    }

    sinClave.push({
      origen: 'mercadopago',
      cuenta: cuenta ?? null,
      fecha,
      descripcion: partes.join(' · '),
      monto,
      moneda: (celda(fila, 'moneda') || celda(fila, 'monedaTransaccion') || 'ARS')
        .trim()
        .toUpperCase()
        .slice(0, 3),
    })

    const referencia = celda(fila, 'referencia').trim() || celda(fila, 'idOrigen').trim()
    referencias.push(referencia || null)
  }

  return {
    movimientos: conClaves(sinClave, referencias),
    descartadas,
    comisiones: Math.round((comisiones + Number.EPSILON) * 100) / 100,
  }
}

/* ────────────────────────────────────────────────────── el proveedor ──── */

/** ¿Este reporte cubre el período que se pide? */
export function cubreElPeriodo(reporte: ReporteListado, periodo: PeriodoConsulta): boolean {
  const desde = soloFecha(reporte.begin_date ?? '')
  const hasta = soloFecha(reporte.end_date ?? '')
  if (!desde || !hasta) return false
  return desde <= periodo.desde && hasta >= periodo.hasta
}

export class ProveedorMercadoPagoReportes implements ExtractoProvider {
  nombre = 'mercadopago'
  origen: OrigenMovimiento = 'mercadopago'

  constructor(private readonly token: string) {}

  capacidades(): CapacidadesExtracto {
    return {
      puedeConsultar: true,
      aceptaArchivo: true,
      comoLlegan:
        'Por la API de reportes de MercadoPago. La generación es asincrónica: la primera vez se pide el reporte y queda listo en unos minutos.',
    }
  }

  esReal(): boolean {
    return true
  }

  private async pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${API}${ruta}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }

  async consultar(periodo: PeriodoConsulta): Promise<ResultadoExtracto> {
    try {
      const lista = await this.pedir(RECURSO)
      if (!lista.ok) {
        return {
          ok: false,
          movimientos: [],
          error: `MercadoPago respondió ${lista.status} al listar los reportes.`,
        }
      }

      const reportes = (await lista.json()) as ReporteListado[] | { results?: ReporteListado[] }
      const disponibles = Array.isArray(reportes) ? reportes : (reportes.results ?? [])
      const util = disponibles.find((r) => r.file_name && cubreElPeriodo(r, periodo))

      if (!util?.file_name) {
        // No hay reporte que sirva: se pide uno y se avisa. No se espera acá.
        return await this.pedirGeneracion(periodo)
      }

      const archivo = await this.pedir(`${RECURSO}/${encodeURIComponent(util.file_name)}`)
      if (!archivo.ok) {
        return {
          ok: false,
          movimientos: [],
          error: `MercadoPago respondió ${archivo.status} al descargar el reporte.`,
        }
      }

      const { movimientos } = leerLiquidacion(await archivo.text())
      return { ok: true, movimientos }
    } catch (e) {
      // Un timeout o una caída de red no puede tumbar la pantalla. El detalle va al
      // registro por quien llama; acá vuelve un mensaje que se pueda leer.
      const detalle = e instanceof Error && e.name === 'TimeoutError' ? 'tardó demasiado' : 'falló'
      return {
        ok: false,
        movimientos: [],
        error: `La consulta a MercadoPago ${detalle}. Probá de nuevo en unos minutos.`,
      }
    }
  }

  private async pedirGeneracion(periodo: PeriodoConsulta): Promise<ResultadoExtracto> {
    const respuesta = await this.pedir(RECURSO, {
      method: 'POST',
      body: JSON.stringify({
        // La API los quiere en UTC y con hora. El día `hasta` se pide completo.
        begin_date: `${periodo.desde}T00:00:00Z`,
        end_date: `${periodo.hasta}T23:59:59Z`,
      }),
    })

    if (respuesta.status === 202 || respuesta.ok) {
      return {
        ok: false,
        movimientos: [],
        error:
          'Se le pidió el reporte a MercadoPago. Tarda unos minutos en generarse: volvé a apretar «Traer» dentro de un rato.',
      }
    }

    return {
      ok: false,
      movimientos: [],
      error: `MercadoPago respondió ${respuesta.status} al pedir el reporte del período.`,
    }
  }
}

/**
 * Construye el proveedor si hay credenciales.
 *
 * Devuelve `null` cuando falta el token, en vez de un proveedor que falla en cada
 * llamada: así la pantalla puede decir «falta configurar MercadoPago» en lugar de
 * mostrar un error de red que no explica nada. Es el mismo token que ya usa el
 * cobro, así que enchufar esto no pide una credencial nueva.
 */
export function proveedorMercadoPagoReportes(
  token: string | undefined = process.env.MERCADOPAGO_ACCESS_TOKEN,
): ProveedorMercadoPagoReportes | null {
  const t = token?.trim()
  return t ? new ProveedorMercadoPagoReportes(t) : null
}
