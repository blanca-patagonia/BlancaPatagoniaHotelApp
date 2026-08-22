import 'server-only'
import { seleccionarProveedor, advertirSiEsSimulado } from '@/lib/integraciones/seleccion'
import {
  MONEDA_BASE,
  validarCotizacion,
  type Cotizacion,
  type Fuente,
  type MonedaExtranjera,
} from '@/lib/domain/divisas'

/**
 * Abstracción del proveedor de cotizaciones (`CotizacionProvider`).
 *
 * Sexto adapter del proyecto, con el mismo patrón que `PaymentProvider`,
 * `EmailProvider`, `FirmaElectronicaProvider`, `FacturacionElectronicaProvider`
 * y `AsistenteProvider`: interfaz en el lenguaje del dominio + implementaciones
 * intercambiables por variable de entorno.
 *
 * ── Una diferencia importante con los otros cinco ───────────────────────────
 *
 * Los otros adapters tienen un *simulador* que miente: `email` no manda el
 * correo, `facturacion` devuelve un CAE inventado. Acá **no hay simulador**,
 * porque las dos fuentes son APIs públicas gratuitas y sin credenciales: se
 * pueden usar de verdad en desarrollo y en producción por igual.
 *
 * El modo de respaldo es `manual`, que **no inventa nada**: devuelve el valor
 * que un administrador cargó a mano. Es un modo degradado (no se actualiza solo)
 * pero honesto, y por eso `esReal()` devuelve `false`: en producción conviene que
 * quede el aviso en el log de que las cotizaciones no se están refrescando.
 *
 * ── Lo que este módulo garantiza ────────────────────────────────────────────
 *
 * **Nunca lanza y nunca cuelga.** Cada método devuelve `null` cuando no pudo
 * conseguir el dato. Es la condición para que una API de terceros caída no
 * bloquee la creación de una reserva, que es el requisito explícito del usuario.
 * La decisión de qué usar cuando esto devuelve `null` es del dominio
 * (`resolverVigente`), no de acá.
 */

/* ───────────────────────────────────────────────────────────── contrato ──── */

export interface CotizacionProvider {
  /**
   * Nombre del proveedor. Se tipa como `Fuente` y no como `string` a propósito:
   * este valor se persiste en `cotizaciones.fuente`, que tiene un `check` con
   * esos tres valores. Así el compilador impide agregar un proveedor cuyo nombre
   * la base vaya a rechazar recién en tiempo de ejecución.
   */
  nombre: Fuente
  /** `false` cuando no consulta ninguna fuente externa (modo manual). */
  esReal(): boolean
  /**
   * Trae la cotización de `moneda` frente al USD.
   *
   * Devuelve `null` ante cualquier problema —red, timeout, JSON raro, valor que
   * no pasa la validación del dominio— y deja el detalle en el log del servidor.
   * Nunca lanza: quien llama tiene que poder seguir operando.
   */
  traer(moneda: MonedaExtranjera): Promise<Cotizacion | null>
}

/**
 * Techo de espera para las fuentes externas.
 *
 * Tres segundos, igual que `/api/salud`. El razonamiento es el mismo: una
 * consulta colgada es peor que una que falla, porque quien espera no sabe si va
 * a llegar. Y acá hay alguien en un mostrador con un huésped enfrente.
 */
const TIMEOUT_MS = 3000

/* ────────────────────────────────────────────────────── utilidades HTTP ──── */

/**
 * `fetch` que no puede tirar la operación abajo.
 *
 * Envuelve todo —incluido el `AbortSignal.timeout`, que lanza `TimeoutError`— y
 * devuelve `null`. El `cache: 'no-store'` es deliberado: el caché de la
 * cotización lo maneja nuestro endpoint interno con su propia ventana, y dejar
 * que además lo cachee `fetch` daría dos ventanas superpuestas imposibles de
 * razonar.
 */
async function traerJson(url: string, contexto: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })

    if (!r.ok) {
      console.warn(`[divisas:${contexto}] ${url} respondió ${r.status}.`)
      return null
    }

    return await r.json()
  } catch (e) {
    console.warn(
      `[divisas:${contexto}] no se pudo consultar ${url}: ${e instanceof Error ? e.message : e}`,
    )
    return null
  }
}

/** Lee un campo numérico de una respuesta desconocida sin confiar en su tipo. */
function numero(v: unknown): number {
  if (typeof v === 'number') return v
  // Algunas fuentes devuelven los importes como texto. Se acepta, pero pasa
  // igual por la validación del dominio.
  if (typeof v === 'string') return Number(v.replace(',', '.'))
  return Number.NaN
}

/**
 * Normaliza la fecha que informa la fuente.
 *
 * Si falta o es ilegible se usa **la hora actual**, no se descarta el valor: que
 * una fuente no informe su timestamp no significa que el número esté mal. Queda
 * registrado como «recién obtenido», que es literalmente cierto — lo acabamos de
 * pedir.
 */
function fechaFuente(v: unknown): string {
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
  return new Date().toISOString()
}

/**
 * Arma la `Cotizacion` si pasa la validación del dominio; si no, `null`.
 *
 * Toda respuesta externa cruza por acá. Es el único punto donde un cero, un
 * `null` o un par invertido puede entrar al sistema, y el único donde hay que
 * frenarlo.
 */
function construir(
  moneda: MonedaExtranjera,
  compra: unknown,
  venta: unknown,
  fecha: unknown,
  fuente: Cotizacion['fuente'],
): Cotizacion | null {
  const c: Cotizacion = {
    moneda,
    compra: numero(compra),
    venta: numero(venta),
    fuente,
    obtenidaEn: fechaFuente(fecha),
  }

  const motivos = validarCotizacion(c)
  if (motivos.length > 0) {
    console.warn(`[divisas:${fuente}] ${moneda} descartada: ${motivos.join(' ')}`)
    return null
  }

  return c
}

/* ────────────────────────────────────────────────────────────── DolarAPI ──── */

/**
 * Base de DolarAPI. Configurable para poder apuntar a otra instancia o a un
 * proxy sin recompilar.
 */
const DOLARAPI_BASE = process.env.DOLARAPI_URL?.replace(/\/$/, '') ?? 'https://dolarapi.com/v1'

/**
 * Proveedor DolarAPI — gratuito, sin clave.
 *
 * El «dólar oficial» que publica es el que los bancos públicos usan como
 * referencia, incluido el Banco Nación, que es el que nombra el Tarifario. No es
 * el Banco Nación *hablando*: es un tercero que replica su valor. La diferencia
 * importa para la tesis y está en el ADR 0020.
 *
 * ── El cruce para el real y el euro ─────────────────────────────────────────
 *
 * La fuente cotiza todo **contra el peso**: da ARS por USD y ARS por EUR, no EUR
 * por USD. Para las monedas que no son el peso hay que dividir:
 *
 *     EUR por USD = (ARS por USD) / (ARS por EUR)
 *
 * Es una **cotización cruzada**, con dos consecuencias que hay que asumir: hace
 * dos llamadas en vez de una, y arrastra el error de las dos. Para el mostrador
 * alcanza —son cobros ocasionales— pero por eso el ARS, que es el que se usa
 * todos los días, sale de una sola consulta directa y no de un cruce.
 */
class ProveedorDolarApi implements CotizacionProvider {
  nombre: Fuente = 'dolarapi'

  esReal(): boolean {
    return true
  }

  async traer(moneda: MonedaExtranjera): Promise<Cotizacion | null> {
    const dolar = await this.dolarOficial()
    if (!dolar) return null
    if (moneda === 'ARS') return dolar

    // Cotización cruzada: hace falta la otra pata, en pesos.
    const clave = moneda === 'BRL' ? 'brl' : 'eur'
    const otra = await traerJson(`${DOLARAPI_BASE}/cotizaciones/${clave}`, this.nombre)
    if (!otra || typeof otra !== 'object') return null

    const o = otra as Record<string, unknown>
    const compraOtra = numero(o.compra)
    const ventaOtra = numero(o.venta)

    if (!(compraOtra > 0) || !(ventaOtra > 0)) {
      console.warn(`[divisas:${this.nombre}] ${moneda} sin cotización en pesos utilizable.`)
      return null
    }

    // Se cruza compra contra venta y venta contra compra: al convertir USD a euros
    // el hotel vende dólares y compra euros, así que cada pata usa el lado que le
    // toca. Cruzar venta contra venta daría un número apenas mejor para el hotel
    // y apenas equivocado.
    return construir(
      moneda,
      dolar.compra / ventaOtra,
      dolar.venta / compraOtra,
      dolar.obtenidaEn,
      this.nombre,
    )
  }

  /** USD → ARS, que es la consulta directa y la que más se usa. */
  private async dolarOficial(): Promise<Cotizacion | null> {
    const j = await traerJson(`${DOLARAPI_BASE}/dolares/oficial`, this.nombre)
    if (!j || typeof j !== 'object') return null

    const d = j as Record<string, unknown>
    return construir('ARS', d.compra, d.venta, d.fechaActualizacion, this.nombre)
  }
}

/* ────────────────────────────────────────────────────── ArgentinaDatos ──── */

const ARGENTINADATOS_BASE =
  process.env.ARGENTINADATOS_URL?.replace(/\/$/, '') ?? 'https://api.argentinadatos.com/v1'

/**
 * Proveedor ArgentinaDatos — la alternativa, con detalle por banco.
 *
 * Sirve como segunda opinión si DolarAPI cambia de forma o se cae. Solo resuelve
 * el peso: devuelve `null` para el resto en lugar de improvisar un cruce, porque
 * una cotización de real inventada es peor que no tenerla.
 */
class ProveedorArgentinaDatos implements CotizacionProvider {
  nombre: Fuente = 'argentinadatos'

  esReal(): boolean {
    return true
  }

  async traer(moneda: MonedaExtranjera): Promise<Cotizacion | null> {
    if (moneda !== 'ARS') {
      console.info(`[divisas:${this.nombre}] no cotiza ${moneda}; se resuelve con el respaldo.`)
      return null
    }

    const j = await traerJson(`${ARGENTINADATOS_BASE}/cotizaciones/dolares`, this.nombre)
    if (!Array.isArray(j)) return null

    // La respuesta es una lista de casas de cambio. Interesa la oficial, que es
    // la que nombra el Tarifario; el resto (blue, MEP, CCL) no corresponde para
    // facturar.
    const oficial = j.find(
      (x) => typeof x === 'object' && x !== null && (x as Record<string, unknown>).casa === 'oficial',
    ) as Record<string, unknown> | undefined

    if (!oficial) {
      console.warn(`[divisas:${this.nombre}] la respuesta no trae la casa «oficial».`)
      return null
    }

    return construir('ARS', oficial.compra, oficial.venta, oficial.fecha, this.nombre)
  }
}

/* ────────────────────────────────────────────────────────────── manual ──── */

/**
 * Modo manual: no consulta nada.
 *
 * Devuelve siempre `null`, y eso es correcto: el valor cargado a mano vive en la
 * tabla `cotizaciones` y lo lee el servicio, no el adapter. Existe como
 * proveedor para poder **apagar las llamadas externas** con una variable de
 * entorno —en un entorno sin salida a internet, por ejemplo— sin que el resto
 * del sistema cambie de comportamiento.
 */
class ProveedorManual implements CotizacionProvider {
  nombre: Fuente = 'manual'

  esReal(): boolean {
    // No consulta ninguna fuente. Devolver `false` hace que
    // `advertirSiEsSimulado` deje rastro en producción: las cotizaciones no se
    // están refrescando solas y alguien tiene que saberlo.
    return false
  }

  async traer(): Promise<Cotizacion | null> {
    return null
  }
}

/* ───────────────────────────────────────────────────────────── selección ──── */

const PROVEEDORES: Record<string, CotizacionProvider> = {
  dolarapi: new ProveedorDolarApi(),
  argentinadatos: new ProveedorArgentinaDatos(),
  manual: new ProveedorManual(),
}

/**
 * Proveedor de cotizaciones vigente.
 *
 * El respaldo declarado es `manual`, así que en producción hay que nombrar la
 * fuente explícitamente (ADR 0018): si la variable falta, el sistema quedaría
 * sirviendo sólo valores cargados a mano y nadie se enteraría hasta que alguien
 * cobrara con el dólar de la semana pasada.
 */
export function obtenerProveedorCotizacion(
  nombre: string | undefined = process.env.COTIZACION_PROVIDER,
): CotizacionProvider {
  const proveedor = seleccionarProveedor({
    variable: 'COTIZACION_PROVIDER',
    proveedores: PROVEEDORES,
    simulado: 'manual',
    valor: nombre,
  })
  advertirSiEsSimulado(proveedor, 'COTIZACION_PROVIDER')
  return proveedor
}

/** Nombres disponibles, para mostrarlos en la pantalla de configuración. */
export const PROVEEDORES_COTIZACION = Object.keys(PROVEEDORES)

export { MONEDA_BASE }
