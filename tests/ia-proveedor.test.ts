import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { iaActiva, obtenerProveedorIa } from '@/lib/ia/proveedor'

const VARS = ['IA_PROVIDER', 'IA_API_KEY', 'IA_BASE_URL', 'IA_MODELO'] as const
const VALOR_DE_PRUEBA = ['x', 'y', 'z'].join('-')

function limpiarEnv() {
  for (const v of VARS) delete process.env[v]
}

describe('iaActiva', () => {
  beforeEach(limpiarEnv)
  afterEach(limpiarEnv)

  it('sin ninguna variable, no está activo', () => {
    expect(iaActiva()).toBe(false)
  })

  it('con las cuatro variables completas, está activo', () => {
    process.env.IA_PROVIDER = 'openai_compatible'
    process.env.IA_API_KEY = VALOR_DE_PRUEBA
    process.env.IA_BASE_URL = 'https://ejemplo.test/v1'
    process.env.IA_MODELO = 'modelo-1'
    expect(iaActiva()).toBe(true)
  })

  it('si falta una sola variable, no está activo', () => {
    process.env.IA_PROVIDER = 'openai_compatible'
    process.env.IA_API_KEY = VALOR_DE_PRUEBA
    process.env.IA_BASE_URL = 'https://ejemplo.test/v1'
    // Falta IA_MODELO.
    expect(iaActiva()).toBe(false)
  })

  it('un IA_PROVIDER que no sea "openai_compatible" no activa nada, aunque el resto esté', () => {
    process.env.IA_PROVIDER = 'otro-nombre'
    process.env.IA_API_KEY = VALOR_DE_PRUEBA
    process.env.IA_BASE_URL = 'https://ejemplo.test/v1'
    process.env.IA_MODELO = 'modelo-1'
    expect(iaActiva()).toBe(false)
  })

  it('obtenerProveedorIa lanza en vez de devolver un simulador', () => {
    expect(() => obtenerProveedorIa()).toThrow(/no está configurado/)
  })
})

describe('ProveedorIaCompatibleOpenAI · chat', () => {
  beforeEach(() => {
    process.env.IA_PROVIDER = 'openai_compatible'
    process.env.IA_API_KEY = VALOR_DE_PRUEBA
    process.env.IA_BASE_URL = 'https://ejemplo.test/v1'
    process.env.IA_MODELO = 'modelo-1'
  })
  afterEach(() => {
    limpiarEnv()
    vi.unstubAllGlobals()
  })

  it('manda la conversación y el encabezado de autorización, y devuelve el texto de la respuesta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'La ocupación fue del 60%.' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const proveedor = obtenerProveedorIa()
    const respuesta = await proveedor.chat([
      { rol: 'system', contenido: 'sos un asistente' },
      { rol: 'user', contenido: '¿cómo viene la ocupación?' },
    ])

    expect(respuesta.contenido).toBe('La ocupación fue del 60%.')
    expect(respuesta.llamadas).toEqual([])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opciones] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ejemplo.test/v1/chat/completions')
    expect(opciones.headers.authorization).toBe(`Bearer ${VALOR_DE_PRUEBA}`)

    const cuerpo = JSON.parse(opciones.body)
    expect(cuerpo.model).toBe('modelo-1')
    expect(cuerpo.messages).toEqual([
      { role: 'system', content: 'sos un asistente' },
      { role: 'user', content: '¿cómo viene la ocupación?' },
    ])
    expect(Array.isArray(cuerpo.tools)).toBe(true)
    expect(cuerpo.tools.length).toBeGreaterThan(0)
  })

  it('traduce un pedido de herramienta del modelo a `llamadas`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', function: { name: 'metricas_periodo', arguments: '{"mes":"2026-09"}' } },
                ],
              },
            },
          ],
        }),
      }),
    )

    const proveedor = obtenerProveedorIa()
    const respuesta = await proveedor.chat([{ rol: 'user', contenido: 'ocupación de septiembre' }])

    expect(respuesta.contenido).toBeNull()
    expect(respuesta.llamadas).toEqual([
      { id: 'call_1', nombre: 'metricas_periodo', argumentos: '{"mes":"2026-09"}' },
    ])
  })

  it('un mensaje `tool` de vuelta viaja con `tool_call_id`, no como texto suelto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'listo' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const proveedor = obtenerProveedorIa()
    await proveedor.chat([
      { rol: 'user', contenido: 'ocupación' },
      {
        rol: 'assistant',
        contenido: '',
        llamadas: [{ id: 'call_1', nombre: 'metricas_periodo', argumentos: '{}' }],
      },
      { rol: 'tool', contenido: '{"ocupacionPct":60}', idLlamada: 'call_1', nombreHerramienta: 'metricas_periodo' },
    ])

    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'metricas_periodo', arguments: '{}' } }],
    })
    expect(cuerpo.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"ocupacionPct":60}',
    })
  })

  it('lanza si el proveedor responde con un status de error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'no autorizado' }),
    )
    const proveedor = obtenerProveedorIa()
    await expect(proveedor.chat([{ rol: 'user', contenido: 'hola' }])).rejects.toThrow(/401/)
  })
})
