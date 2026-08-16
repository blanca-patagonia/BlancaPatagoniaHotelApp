import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { obtenerProveedorCotizacion } from '@/lib/divisas'

/**
 * Tests del adapter de cotizaciones.
 *
 * Lo que se prueba acá **no** son las reglas —eso está en `divisas.test.ts`, sin
 * red ni mocks— sino el borde: qué pasa cuando una API pública de terceros
 * devuelve algo distinto de lo que promete su documentación.
 *
 * Es el riesgo real de esta integración. No controlamos DolarAPI: puede cambiar
 * un nombre de campo, devolver un `null`, contestar 500 o simplemente no
 * contestar. La garantía que estos tests protegen es la que pidió el usuario:
 * **nada de eso puede bloquear una reserva**. Ante cualquier problema el adapter
 * devuelve `null` y la decisión de qué usar queda en el dominio.
 */

/** Respuesta con la forma documentada de `/v1/dolares/oficial`. */
const OFICIAL_OK = {
  moneda: 'USD',
  casa: 'oficial',
  nombre: 'Oficial',
  compra: 1420,
  venta: 1480,
  fechaActualizacion: '2026-08-16T11:50:00.000Z',
}

/** Respuesta con la forma de `/v1/cotizaciones/eur`, que cotiza contra el peso. */
const EURO_OK = {
  moneda: 'EUR',
  casa: 'oficial',
  compra: 1600,
  venta: 1660,
  fechaActualizacion: '2026-08-16T11:50:00.000Z',
}

/**
 * Reemplaza `fetch` por una tabla de rutas.
 *
 * Se hace por sufijo de URL y no por igualdad para que un cambio en la variable
 * `DOLARAPI_URL` no rompa los tests.
 */
function fetchFalso(rutas: Record<string, { status?: number; cuerpo?: unknown }>) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url)
    const clave = Object.keys(rutas).find((k) => u.includes(k))

    if (!clave) return new Response('no encontrado', { status: 404 })

    const { status = 200, cuerpo } = rutas[clave]
    if (status !== 200) return new Response('error', { status })

    return new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const fetchOriginal = globalThis.fetch

beforeEach(() => {
  // Fuera de producción, para que la selección de proveedor no exija la variable.
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('proveedor dolarapi — camino feliz', () => {
  it('trae el dólar oficial y usa venta y compra tal como vienen', () => {
    globalThis.fetch = fetchFalso({ '/dolares/oficial': { cuerpo: OFICIAL_OK } }) as never

    return obtenerProveedorCotizacion('dolarapi')
      .traer('ARS')
      .then((c) => {
        expect(c).not.toBeNull()
        expect(c?.moneda).toBe('ARS')
        expect(c?.compra).toBe(1420)
        expect(c?.venta).toBe(1480)
        expect(c?.fuente).toBe('dolarapi')
        expect(c?.obtenidaEn).toBe('2026-08-16T11:50:00.000Z')
      })
  })

  it('cruza el euro dividiendo por su cotización en pesos', async () => {
    // La fuente da ARS por USD y ARS por EUR; lo que se necesita es EUR por USD.
    // 1480 / 1600 = 0,925 · 1420 / 1660 = 0,8554
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: OFICIAL_OK },
      '/cotizaciones/eur': { cuerpo: EURO_OK },
    }) as never

    const c = await obtenerProveedorCotizacion('dolarapi').traer('EUR')
    expect(c).not.toBeNull()
    expect(c?.moneda).toBe('EUR')
    // Cada pata usa el lado que le toca: al convertir USD a euros el hotel vende
    // dólares y compra euros.
    expect(c?.venta).toBeCloseTo(1480 / 1600, 4)
    expect(c?.compra).toBeCloseTo(1420 / 1660, 4)
  })

  it('el cruce sigue respetando que la venta no sea menor que la compra', async () => {
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: OFICIAL_OK },
      '/cotizaciones/eur': { cuerpo: EURO_OK },
    }) as never

    const c = await obtenerProveedorCotizacion('dolarapi').traer('EUR')
    expect(c!.venta).toBeGreaterThanOrEqual(c!.compra)
  })
})

describe('proveedor dolarapi — la fuente devuelve basura', () => {
  it('un cero en venta se descarta en vez de convertir todo a $ 0', async () => {
    // Es el caso más peligroso: un cero que llega hasta el cobro convierte una
    // cuenta de USD 400 en «$ 0».
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: { ...OFICIAL_OK, venta: 0 } },
    }) as never

    expect(await obtenerProveedorCotizacion('dolarapi').traer('ARS')).toBeNull()
  })

  it('un null se descarta', async () => {
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: { ...OFICIAL_OK, venta: null } },
    }) as never

    expect(await obtenerProveedorCotizacion('dolarapi').traer('ARS')).toBeNull()
  })

  it('acepta importes que vienen como texto, incluso con coma decimal', async () => {
    // Algunas fuentes serializan los números como string. No es un error: se
    // normaliza y después se valida igual que cualquier otro valor.
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: { ...OFICIAL_OK, compra: '1420,50', venta: '1480,75' } },
    }) as never

    const c = await obtenerProveedorCotizacion('dolarapi').traer('ARS')
    expect(c?.compra).toBe(1420.5)
    expect(c?.venta).toBe(1480.75)
  })

  it('el par invertido se descarta: la fuente cambió el orden de los campos', async () => {
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: { ...OFICIAL_OK, compra: 1480, venta: 1420 } },
    }) as never

    expect(await obtenerProveedorCotizacion('dolarapi').traer('ARS')).toBeNull()
  })

  it('sin fecha usa la actual en lugar de descartar el valor', async () => {
    // Que una fuente no informe su timestamp no significa que el número esté mal.
    const sinFecha: Record<string, unknown> = { ...OFICIAL_OK }
    delete sinFecha.fechaActualizacion
    globalThis.fetch = fetchFalso({ '/dolares/oficial': { cuerpo: sinFecha } }) as never

    const c = await obtenerProveedorCotizacion('dolarapi').traer('ARS')
    expect(c).not.toBeNull()
    expect(Number.isNaN(Date.parse(c!.obtenidaEn))).toBe(false)
  })

  it('un JSON que no es objeto no rompe nada', async () => {
    globalThis.fetch = fetchFalso({ '/dolares/oficial': { cuerpo: 'mil cuatrocientos' } }) as never
    expect(await obtenerProveedorCotizacion('dolarapi').traer('ARS')).toBeNull()
  })
})

describe('proveedor dolarapi — la fuente no responde', () => {
  it('un 500 devuelve null y no lanza', async () => {
    globalThis.fetch = fetchFalso({ '/dolares/oficial': { status: 500 } }) as never
    expect(await obtenerProveedorCotizacion('dolarapi').traer('ARS')).toBeNull()
  })

  it('un 429 (nos limitaron) devuelve null y no lanza', async () => {
    globalThis.fetch = fetchFalso({ '/dolares/oficial': { status: 429 } }) as never
    expect(await obtenerProveedorCotizacion('dolarapi').traer('ARS')).toBeNull()
  })

  it('una excepción de red se traga y devuelve null', async () => {
    // ESTA es la garantía que importa: si `traer` lanzara, la excepción subiría
    // hasta la pantalla y el mostrador no podría tomar la reserva.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND dolarapi.com')
    }) as never

    await expect(obtenerProveedorCotizacion('dolarapi').traer('ARS')).resolves.toBeNull()
  })

  it('un cuerpo que no es JSON válido devuelve null', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 200 }),
    ) as never

    await expect(obtenerProveedorCotizacion('dolarapi').traer('ARS')).resolves.toBeNull()
  })

  it('si falla la segunda pata del cruce, el euro no se inventa', async () => {
    // El dólar llegó bien pero el euro no. Devolver el dólar como si fuera euro
    // sería un error de 1600x.
    globalThis.fetch = fetchFalso({
      '/dolares/oficial': { cuerpo: OFICIAL_OK },
      '/cotizaciones/eur': { status: 503 },
    }) as never

    expect(await obtenerProveedorCotizacion('dolarapi').traer('EUR')).toBeNull()
  })
})

describe('proveedor argentinadatos', () => {
  it('elige la casa «oficial» y descarta blue, MEP y CCL', async () => {
    // El Tarifario nombra la cotización oficial. Facturar con el blue sería
    // cobrar casi el doble de lo pactado.
    globalThis.fetch = fetchFalso({
      '/cotizaciones/dolares': {
        cuerpo: [
          { casa: 'blue', compra: 2100, venta: 2150, fecha: '2026-08-16' },
          { casa: 'oficial', compra: 1420, venta: 1480, fecha: '2026-08-16' },
          { casa: 'mep', compra: 1900, venta: 1950, fecha: '2026-08-16' },
        ],
      },
    }) as never

    const c = await obtenerProveedorCotizacion('argentinadatos').traer('ARS')
    expect(c?.venta).toBe(1480)
    expect(c?.fuente).toBe('argentinadatos')
  })

  it('sin la casa oficial devuelve null en vez de tomar la primera', async () => {
    globalThis.fetch = fetchFalso({
      '/cotizaciones/dolares': {
        cuerpo: [{ casa: 'blue', compra: 2100, venta: 2150, fecha: '2026-08-16' }],
      },
    }) as never

    expect(await obtenerProveedorCotizacion('argentinadatos').traer('ARS')).toBeNull()
  })

  it('no improvisa un cruce para el real ni el euro', async () => {
    // Una cotización de real inventada es peor que no tenerla: la resuelve el
    // respaldo (valor manual o el último guardado).
    const p = obtenerProveedorCotizacion('argentinadatos')
    expect(await p.traer('BRL')).toBeNull()
    expect(await p.traer('EUR')).toBeNull()
  })

  it('una respuesta que no es lista devuelve null', async () => {
    globalThis.fetch = fetchFalso({
      '/cotizaciones/dolares': { cuerpo: { casa: 'oficial', venta: 1480 } },
    }) as never

    expect(await obtenerProveedorCotizacion('argentinadatos').traer('ARS')).toBeNull()
  })
})

describe('proveedor manual', () => {
  it('no consulta nada y no se declara real', () => {
    const p = obtenerProveedorCotizacion('manual')
    expect(p.nombre).toBe('manual')
    // `esReal()` en false hace que quede el aviso en el log si en producción se
    // está operando sólo con valores cargados a mano.
    expect(p.esReal()).toBe(false)
  })

  it('devuelve null: el valor manual lo lee el servicio de la base, no el adapter', async () => {
    const espia = vi.fn()
    globalThis.fetch = espia as never

    expect(await obtenerProveedorCotizacion('manual').traer('ARS')).toBeNull()
    expect(espia).not.toHaveBeenCalled()
  })
})

describe('selección de proveedor', () => {
  it('los dos automáticos se declaran reales', () => {
    expect(obtenerProveedorCotizacion('dolarapi').esReal()).toBe(true)
    expect(obtenerProveedorCotizacion('argentinadatos').esReal()).toBe(true)
  })

  it('en producción, sin variable declarada, falla en vez de quedar en manual', () => {
    // ADR 0018. Si la variable falta, el sistema quedaría sirviendo sólo valores
    // cargados a mano y nadie se enteraría hasta que alguien cobrara con el dólar
    // de la semana pasada.
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => obtenerProveedorCotizacion(undefined)).toThrow(/COTIZACION_PROVIDER/)
  })

  it('en producción, un nombre mal escrito falla en vez de degradar en silencio', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => obtenerProveedorCotizacion('dolarapy')).toThrow(/no corresponde/)
  })

  it('en producción se puede pedir el modo manual de forma explícita', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(obtenerProveedorCotizacion('manual').nombre).toBe('manual')
  })
})
