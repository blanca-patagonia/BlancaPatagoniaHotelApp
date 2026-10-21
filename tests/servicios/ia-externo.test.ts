import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Información de afuera para el asistente (`lib/ia/externo.ts`), con las fuentes
 * simuladas: el clima se lee bien, una fuente caída no rompe nada, a Wikipedia
 * no le llega ningún dato personal y la cotización es la del sistema.
 */

vi.mock('@/lib/divisas/servicio', () => ({
  cotizacionVigente: vi.fn(async (moneda: string) =>
    moneda === 'ARS'
      ? { compra: 1180, venta: 1220, fuente: 'dolarapi', antiguedadMinutos: 12, requiereAdvertencia: false }
      : null,
  ),
}))

const { climaEnElCalafate, buscarEnWikipedia, cotizacionDeMonedas } = await import('@/lib/ia/externo')

afterEach(() => vi.unstubAllGlobals())

describe('clima', () => {
  it('pide El Calafate en la zona del hotel y resume el pronóstico', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 7, wind_speed_10m: 25, wind_gusts_10m: 70, weather_code: 3 },
        daily: { time: ['2026-10-19'], wind_gusts_10m_max: [75], weather_code: [3] },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await climaEnElCalafate(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('latitude=-50.3379')
    expect(url).toContain('timezone=America%2FArgentina%2FRio_Gallegos')
    expect(r).toMatchObject({ ahora: { cielo: 'nublado' }, dias: [{ vientoFuerte: true }] })
  })

  it('si la fuente no responde, lo dice sin lanzar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    await expect(climaEnElCalafate(3)).resolves.toMatchObject({ error: expect.stringMatching(/no respondió/) })
  })
})

describe('Wikipedia', () => {
  it('no le manda datos personales y devuelve resumen con fuente y enlace', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { search: [{ title: 'Glaciar Upsala' }] } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Glaciar Upsala',
          extract: 'El glaciar Upsala es un glaciar de Argentina…',
          content_urls: { desktop: { page: 'https://es.wikipedia.org/wiki/Glaciar_Upsala' } },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const r = await buscarEnWikipedia('glaciar Upsala para juan.perez@mail.com DNI 30.123.456')
    const consulta = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(consulta).not.toContain('juan.perez@mail.com')
    expect(consulta).not.toContain('30.123.456')
    expect(r).toMatchObject({
      encontrado: true,
      titulo: 'Glaciar Upsala',
      fuente: 'Wikipedia',
      enlace: 'https://es.wikipedia.org/wiki/Glaciar_Upsala',
    })
  })

  it('sin resultados lo dice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { search: [] } }) }))
    await expect(buscarEnWikipedia('xyzxyz')).resolves.toMatchObject({ encontrado: false })
  })
})

describe('cotización', () => {
  it('es la del sistema, con fuente; una moneda sin dato lo dice en vez de inventarlo', async () => {
    const r = await cotizacionDeMonedas()
    expect(r.cotizaciones[0]).toMatchObject({ codigo: 'ARS', ventaPorDolar: 1220, fuente: 'dolarapi' })
    expect(r.cotizaciones.find((c) => c.codigo === 'EUR')).toMatchObject({ error: expect.any(String) })
  })
})
