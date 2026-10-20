import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HERRAMIENTAS_IA } from '@/lib/domain/ia-herramientas'

vi.mock('@/lib/registro', () => ({ registrarInfo: vi.fn(), registrarErrorSync: vi.fn() }))
import { AVISO_CORTADA, IaNoDisponible, iaActiva, obtenerProveedorIa, pareceClave, sinClaves } from '@/lib/ia/proveedor'

const VARS = [
  'IA_PROVIDER',
  'IA_API_KEY',
  'IA_BASE_URL',
  'IA_MODELO',
  'IA_MODELO_RESPALDO',
  'IA_RESPALDO_BASE_URL',
  'IA_RESPALDO_API_KEY',
  'IA_RESPALDO_MODELO',
] as const
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
    ], HERRAMIENTAS_IA)

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
    const respuesta = await proveedor.chat([{ rol: 'user', contenido: 'ocupación de septiembre' }], HERRAMIENTAS_IA)

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
    ], HERRAMIENTAS_IA)

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

  it('devuelve tal cual el `extra_content` del pedido (la firma de Gemini 3)', async () => {
    // Gemini 3 manda una `thought_signature` en cada pedido de herramienta y
    // rechaza la vuelta siguiente si no vuelve. El adapter no la interpreta:
    // sólo la guarda y la reenvía.
    const firma = { google: { thought_signature: 'firma-opaca' } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    function: { name: 'metricas_periodo', arguments: '{}' },
                    extra_content: firma,
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'listo' } }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    // Sólo Gemini conoce ese campo: se reenvía cuando el proveedor ES Gemini.
    process.env.IA_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
    const proveedor = obtenerProveedorIa()
    const primera = await proveedor.chat([{ rol: 'user', contenido: 'ocupación' }], HERRAMIENTAS_IA)
    expect(primera.llamadas[0].extra).toEqual(firma)

    await proveedor.chat([
      { rol: 'user', contenido: 'ocupación' },
      { rol: 'assistant', contenido: '', llamadas: primera.llamadas },
      { rol: 'tool', contenido: '{}', idLlamada: 'call_1', nombreHerramienta: 'metricas_periodo' },
    ], HERRAMIENTAS_IA)
    const cuerpo = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(cuerpo.messages[1].tool_calls[0].extra_content).toEqual(firma)
  })

  it('una respuesta cortada por largo lo dice, en vez de pasar por completa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'Ocupación: 6' } }] }),
      }),
    )
    const r = await obtenerProveedorIa().chat([{ rol: 'user', contenido: 'analizá' }], HERRAMIENTAS_IA)
    expect(r.contenido).toContain('Ocupación: 6')
    expect(r.contenido).toContain(AVISO_CORTADA)
  })

  it('ante saturación (503) reintenta una vez y sigue', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'high demand' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const promesa = obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)
    await vi.runAllTimersAsync()
    await expect(promesa).resolves.toMatchObject({ contenido: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('un 429 sostenido es «cupo», no «saturado»', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'quota' }))
    const promesa = obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)
    const verificacion = expect(promesa).rejects.toMatchObject({ motivo: 'cupo' })
    await vi.runAllTimersAsync()
    await verificacion
    vi.useRealTimers()
  })

  it('si el principal sigue saturado, pasa al modelo de respaldo', async () => {
    vi.useFakeTimers()
    process.env.IA_MODELO_RESPALDO = 'modelo-liviano'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'high demand' })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'high demand' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const promesa = obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)
    await vi.runAllTimersAsync()
    await expect(promesa).resolves.toMatchObject({ contenido: 'ok' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).model).toBe('modelo-liviano')
    vi.useRealTimers()
  })

  it('si sigue saturado, lanza IaNoDisponible (no un error del sistema)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'high demand' }),
    )
    const promesa = obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)
    const verificacion = expect(promesa).rejects.toBeInstanceOf(IaNoDisponible)
    await vi.runAllTimersAsync()
    await verificacion
    vi.useRealTimers()
  })

  it('sin herramientas para el rol no manda `tools` vacío', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hola' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], [])
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo.tools).toBeUndefined()
    expect(cuerpo.tool_choice).toBeUndefined()
  })

  it('a un proveedor que no es Gemini NO le reenvía `extra_content`', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'listo' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await obtenerProveedorIa().chat(
      [
        { rol: 'user', contenido: 'x' },
        {
          rol: 'assistant',
          contenido: '',
          llamadas: [{ id: 'c1', nombre: 'metricas_periodo', argumentos: '{}', extra: { google: {} } }],
        },
        { rol: 'tool', contenido: '{}', idLlamada: 'c1', nombreHerramienta: 'metricas_periodo' },
      ],
      HERRAMIENTAS_IA,
    )
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(cuerpo.messages[1].tool_calls[0].extra_content).toBeUndefined()
  })

  describe('cadena de respaldo con otro proveedor (Groq)', () => {
    beforeEach(() => {
      process.env.IA_RESPALDO_BASE_URL = 'https://api.groq.test/openai/v1'
      process.env.IA_RESPALDO_API_KEY = 'otra-clave'
      process.env.IA_RESPALDO_MODELO = 'llama-de-respaldo'
    })

    it('sin cupo en el principal (429 sostenido) contesta el otro proveedor, con SU clave', async () => {
      vi.useFakeTimers()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota' })
        .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota' })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'desde groq' } }] }) })
      vi.stubGlobal('fetch', fetchMock)
      const promesa = obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)
      await vi.runAllTimersAsync()
      await expect(promesa).resolves.toMatchObject({ contenido: 'desde groq' })
      const [url, opciones] = fetchMock.mock.calls[2]
      expect(url).toBe('https://api.groq.test/openai/v1/chat/completions')
      expect(opciones.headers.authorization).toBe('Bearer otra-clave')
      expect(JSON.parse(opciones.body).model).toBe('llama-de-respaldo')
      vi.useRealTimers()
    })

    it('el orden es: modelo principal → otro modelo del mismo proveedor → otro proveedor', async () => {
      vi.useFakeTimers()
      process.env.IA_MODELO_RESPALDO = 'modelo-liviano'
      const fallo = { ok: false, status: 503, text: async () => 'high demand' }
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(fallo)
        .mockResolvedValueOnce(fallo)
        .mockResolvedValueOnce(fallo)
        .mockResolvedValueOnce(fallo)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
      vi.stubGlobal('fetch', fetchMock)
      const promesa = obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)
      await vi.runAllTimersAsync()
      await promesa
      const modelos = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).model)
      expect(modelos).toEqual(['modelo-1', 'modelo-1', 'modelo-liviano', 'modelo-liviano', 'llama-de-respaldo'])
      vi.useRealTimers()
    })

    it('una clave rota en el principal (401) también pasa al respaldo', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid key' })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA),
      ).resolves.toMatchObject({ contenido: 'ok' })
    })

    it('si el principal no responde (red caída), pasa al respaldo', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA),
      ).resolves.toMatchObject({ contenido: 'ok' })
    })

    it('con una variable de respaldo a medias no se arma el respaldo', async () => {
      delete process.env.IA_RESPALDO_MODELO
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'x' }))
      await expect(
        obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA),
      ).rejects.toThrow(/401/)
    })
  })

  it('lanza si el proveedor responde con un status de error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'no autorizado' }),
    )
    const proveedor = obtenerProveedorIa()
    await expect(proveedor.chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)).rejects.toThrow(/401/)
  })
})

describe('una clave cargada donde va el nombre de un modelo', () => {
  afterEach(() => {
    limpiarEnv()
    vi.unstubAllGlobals()
  })

  it('pareceClave reconoce claves y deja pasar nombres de modelo', () => {
    for (const clave of ['gsk_' + 'a'.repeat(52), 'AIza' + 'b'.repeat(35), 'AQ.' + 'c'.repeat(50), 'sk-' + 'd'.repeat(40)]) {
      expect(pareceClave(clave)).toBe(true)
    }
    for (const modelo of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']) {
      expect(pareceClave(modelo)).toBe(false)
    }
  })

  it('una clave en IA_MODELO_RESPALDO NO viaja a ningún proveedor', async () => {
    process.env.IA_PROVIDER = 'openai_compatible'
    process.env.IA_API_KEY = VALOR_DE_PRUEBA
    process.env.IA_BASE_URL = 'https://ejemplo.test/v1'
    process.env.IA_MODELO = 'modelo-1'
    const clave = 'gsk_' + 'x'.repeat(52)
    process.env.IA_MODELO_RESPALDO = clave
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'no' })
    vi.stubGlobal('fetch', fetchMock)
    await expect(obtenerProveedorIa().chat([{ rol: 'user', contenido: 'hola' }], HERRAMIENTAS_IA)).rejects.toThrow()
    for (const [, opciones] of fetchMock.mock.calls) expect(opciones.body).not.toContain(clave)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('sinClaves (lo que se registra nunca lleva una clave)', () => {
  it('tapa claves de Groq, Gemini y OpenAI dentro de un mensaje de error', () => {
    const groq = 'gsk_' + 'Ab1'.repeat(15)
    const gemini = 'AIza' + 'Zy9'.repeat(12)
    const texto = `The model \`${groq}\` does not exist; key ${gemini} invalid`
    const limpio = sinClaves(texto)
    expect(limpio).not.toContain(groq)
    expect(limpio).not.toContain(gemini)
    expect(limpio).toContain('[clave]')
  })

  it('no toca nombres de modelo', () => {
    expect(sinClaves('model openai/gpt-oss-120b not found')).toBe('model openai/gpt-oss-120b not found')
  })
})
