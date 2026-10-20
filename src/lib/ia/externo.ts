import 'server-only'
import { EL_CALAFATE, resumirPronostico, type PronosticoCrudo } from '@/lib/domain/clima'
import { enmascararDatosPersonales } from '@/lib/domain/ia-datos'
import { ETIQUETAS_MONEDA, MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { ZONA_HOTEL } from '@/lib/fechas'

/**
 * Información de AFUERA del sistema para el asistente de IA: el clima, la
 * cotización de monedas y conocimiento general (Wikipedia).
 *
 * Tres reglas, las mismas para las tres fuentes:
 *  · Fuentes abiertas y sin clave: nada que contratar ni que se venza.
 *  · Nunca rompe la conversación: si la fuente no responde a tiempo, devuelve
 *    `{ error }` y el asistente lo dice. Una pregunta por el clima no puede dejar
 *    sin respuesta a quien además preguntó por una reserva.
 *  · Lo que sale hacia afuera no lleva datos personales: la consulta a Wikipedia
 *    pasa por `enmascararDatosPersonales`, y al clima sólo van coordenadas.
 *
 * Cada respuesta dice su fuente: el asistente la cita, para que nadie tome un
 * resumen de Wikipedia por un dato del hotel.
 */

const TIEMPO_LIMITE_MS = 8_000

async function traerJson<T>(url: string, cabeceras: Record<string, string> = {}): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(TIEMPO_LIMITE_MS) })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

/** Pronóstico de El Calafate para hoy y los próximos días (hasta 7). */
export async function climaEnElCalafate(dias: number) {
  const n = Math.min(7, Math.max(1, Math.trunc(dias) || 3))
  const params = new URLSearchParams({
    latitude: String(EL_CALAFATE.latitud),
    longitude: String(EL_CALAFATE.longitud),
    current: 'temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max,weather_code',
    timezone: ZONA_HOTEL,
    forecast_days: String(n),
  })
  const crudo = await traerJson<PronosticoCrudo>(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!crudo) return { error: 'El servicio del clima no respondió. Probá de nuevo en un rato.' }
  return resumirPronostico(crudo)
}

/**
 * La cotización vigente de cada moneda contra el dólar, la MISMA que usa el
 * sistema para cobrar en pesos (`lib/divisas`, ADR 0020), con su fuente y su
 * antigüedad. No es una consulta suelta a otra fuente: si el asistente diera un
 * valor distinto del que cobra el mostrador, habría dos dólares en el hotel.
 */
export async function cotizacionDeMonedas() {
  const filas = await Promise.all(
    MONEDAS_EXTRANJERAS.map(async (moneda) => {
      const c = await cotizacionVigente(moneda).catch(() => null)
      return c
        ? {
            moneda: ETIQUETAS_MONEDA[moneda],
            codigo: moneda,
            compraPorDolar: c.compra,
            ventaPorDolar: c.venta,
            fuente: c.fuente,
            hace: `${c.antiguedadMinutos} min`,
            ...(c.requiereAdvertencia ? { aviso: 'La cotización está desactualizada: confirmala antes de cobrar.' } : {}),
          }
        : { moneda: ETIQUETAS_MONEDA[moneda], codigo: moneda, error: 'Sin cotización disponible.' }
    }),
  )
  return { cotizaciones: filas, nota: 'Es la cotización que usa el sistema para cobrar.' }
}

interface BusquedaWiki {
  query?: { search?: { title: string }[] }
}
interface ResumenWiki {
  title?: string
  extract?: string
  content_urls?: { desktop?: { page?: string } }
}

/** Identificación que pide Wikipedia a quien usa su API. */
const AGENTE = { 'user-agent': 'BlancaPatagonia-PMS/1.0 (asistente interno del hotel)' }

/**
 * Información general de Wikipedia en español: un lugar, una excursión, un
 * dato histórico. Devuelve un resumen corto y el enlace, para citar la fuente.
 */
export async function buscarEnWikipedia(consulta: string) {
  const termino = enmascararDatosPersonales(consulta).trim().slice(0, 120)
  if (termino.length < 2) return { error: 'Decime qué querés saber.' }
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: termino,
    srlimit: '3',
    format: 'json',
  })
  const busqueda = await traerJson<BusquedaWiki>(`https://es.wikipedia.org/w/api.php?${params}`, AGENTE)
  if (!busqueda) return { error: 'Wikipedia no respondió. Probá de nuevo en un rato.' }
  const titulos = (busqueda.query?.search ?? []).map((r) => r.title)
  if (titulos.length === 0) return { encontrado: false, consulta: termino }

  const resumen = await traerJson<ResumenWiki>(
    `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titulos[0])}`,
    AGENTE,
  )
  if (!resumen?.extract) return { encontrado: false, consulta: termino }
  return {
    encontrado: true,
    titulo: resumen.title ?? titulos[0],
    resumen: resumen.extract.slice(0, 1200),
    fuente: 'Wikipedia',
    enlace: resumen.content_urls?.desktop?.page ?? null,
    otrosArticulos: titulos.slice(1),
  }
}
