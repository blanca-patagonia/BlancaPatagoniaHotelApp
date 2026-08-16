import { obtenerSesion } from '@/lib/auth/session'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import {
  MONEDAS_EXTRANJERAS,
  esMonedaExtranjera,
  convertirDesdeUSD,
  textoEstado,
  type MonedaExtranjera,
} from '@/lib/domain/divisas'

/**
 * Cotización de divisas: `GET /api/cotizacion`.
 *
 * Endpoint **interno propio**, no un proxy transparente a la API de terceros. La
 * diferencia importa:
 *
 * · La fuente externa se consulta a lo sumo una vez cada 30 minutos por proceso
 *   (`lib/divisas/servicio.ts`); acá se puede pegar todas las veces que haga
 *   falta sin castigar un servicio gratuito ajeno.
 * · Si la fuente está caída, esto **igual responde 200** con el último valor
 *   conocido y su antigüedad. Un 503 obligaría a cada pantalla a decidir qué
 *   hacer, y la respuesta correcta ya está decidida en el dominio: se opera con
 *   lo que hay y se avisa.
 * · El formato es el del dominio, no el de DolarAPI. Cambiar de fuente no cambia
 *   este contrato.
 *
 * ── Parámetros ──────────────────────────────────────────────────────────────
 *
 *   ?moneda=ARS      una sola moneda (por defecto, todas)
 *   ?monto=250       además de la cotización, devuelve la conversión de ese USD
 *   ?forzar=1        salta el caché en memoria (botón «Actualizar»)
 *
 * ── Por qué pide sesión ─────────────────────────────────────────────────────
 *
 * El valor en sí es público —lo publica un banco—, pero el servicio lee con el
 * cliente `service_role`, que **saltea RLS**. Si el endpoint fuera anónimo, la
 * política «staff lee» de la migración 0036 quedaría sin efecto por la puerta de
 * atrás. Además, un endpoint público que dispara llamadas a un tercero es un
 * amplificador gratis para cualquiera que quiera abusar de DolarAPI en nuestro
 * nombre.
 */

export const dynamic = 'force-dynamic'

interface Cuerpo {
  moneda: MonedaExtranjera
  compra: number
  venta: number
  fuente: string
  obtenidaEn: string
  origen: string
  antiguedadMinutos: number
  vencida: boolean
  requiereAdvertencia: boolean
  estado: string
  /** Solo si vino `?monto=`. */
  convertido?: number
}

export async function GET(req: Request) {
  const sesion = await obtenerSesion()
  if (!sesion) {
    // 401 sin detalle: no se distingue «no hay sesión» de «la sesión no sirve».
    return Response.json({ error: 'Sin sesión.' }, { status: 401 })
  }

  const url = new URL(req.url)
  const pedida = url.searchParams.get('moneda')
  const forzar = url.searchParams.get('forzar') === '1'

  // Un `monto` ilegible se ignora en lugar de devolver 400: el dato principal de
  // este endpoint es la cotización, y negarla entera por un parámetro accesorio
  // mal escrito sería desproporcionado.
  const montoCrudo = Number(url.searchParams.get('monto'))
  const monto = Number.isFinite(montoCrudo) && montoCrudo > 0 ? montoCrudo : null

  if (pedida && !esMonedaExtranjera(pedida)) {
    return Response.json(
      {
        error: `Moneda no soportada. Disponibles: ${MONEDAS_EXTRANJERAS.join(', ')}.`,
      },
      { status: 400 },
    )
  }

  const monedas: readonly MonedaExtranjera[] = pedida
    ? [pedida as MonedaExtranjera]
    : MONEDAS_EXTRANJERAS

  const resultados = await Promise.all(
    monedas.map(async (m): Promise<Cuerpo | null> => {
      const v = await cotizacionVigente(m, { forzar })
      if (!v) return null

      return {
        moneda: v.moneda,
        compra: v.compra,
        venta: v.venta,
        fuente: v.fuente,
        obtenidaEn: v.obtenidaEn,
        origen: v.origen,
        antiguedadMinutos: v.antiguedadMinutos,
        vencida: v.vencida,
        requiereAdvertencia: v.requiereAdvertencia,
        estado: textoEstado(v),
        ...(monto !== null ? { convertido: convertirDesdeUSD(monto, v) } : {}),
      }
    }),
  )

  const cotizaciones = resultados.filter((r): r is Cuerpo => r !== null)

  return Response.json(
    {
      base: 'USD',
      ...(monto !== null ? { monto } : {}),
      cotizaciones,
      // Se dice explícitamente cuando no hay ninguna, en vez de devolver una
      // lista vacía a secas: quien consume tiene que poder distinguir «no hay
      // conversión disponible, mostrá USD» de «pediste una moneda que no cotizo».
      sinCotizacion: cotizaciones.length === 0,
    },
    {
      // `no-store` y no un `max-age`: el caché real es el del servicio, que sabe
      // la antigüedad del dato. Un caché de HTTP encima serviría un valor viejo
      // informando una antigüedad que ya no es cierta.
      headers: { 'cache-control': 'no-store' },
    },
  )
}
