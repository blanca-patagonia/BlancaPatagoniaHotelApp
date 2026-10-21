import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DefinicionHerramienta } from '@/lib/domain/ia-herramientas'
import type { MensajeIa, RespuestaIa } from '@/lib/ia/proveedor'

/**
 * La ruta del chat (`/panel/ia/consulta`) con el proveedor simulado:
 *  · cada rol recibe sólo las herramientas de sus áreas;
 *  · una herramienta pedida que no se ofreció NO se ejecuta;
 *  · pasado el tope de consultas por persona responde 429.
 */

let rol = 'housekeeping'
vi.mock('@/lib/auth/session', () => ({
  obtenerSesion: async () => ({ userId: 'u1', email: 'a@b.c', nombre: 'A', rol }),
}))
const registrarAviso = vi.fn()
vi.mock('@/lib/registro', () => ({ registrarError: vi.fn(), registrarInfo: vi.fn(), registrarAviso }))

let permitido = true
vi.mock('@/lib/limites', () => ({ permitirIntentoDe: async () => permitido }))

const ejecutarHerramienta = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/(front-gestion)/panel/ia/herramientas', () => ({
  ejecutarHerramienta,
  propuestaDe: () => null,
}))

let ofrecidas: string[] = []
let guion: RespuestaIa[] = []
vi.mock('@/lib/ia/proveedor', () => ({
  iaActiva: () => true,
  IaNoDisponible: class extends Error {},
  obtenerProveedorIa: () => ({
    nombre: 'falso',
    chat: async (_m: MensajeIa[], herramientas: DefinicionHerramienta[]) => {
      ofrecidas = herramientas.map((h) => h.nombre)
      return guion.shift() ?? { contenido: 'listo', llamadas: [] }
    },
  }),
}))

const { POST } = await import('@/app/(front-gestion)/panel/ia/consulta/route')

function preguntar(texto = 'hola') {
  return POST(
    new Request('http://localhost/panel/ia/consulta', {
      method: 'POST',
      body: JSON.stringify({ mensajes: [{ rol: 'user', contenido: texto }] }),
    }),
  )
}

beforeEach(() => {
  rol = 'housekeeping'
  permitido = true
  ofrecidas = []
  guion = []
  ejecutarHerramienta.mockClear()
  registrarAviso.mockClear()
})

describe('consulta del asistente por rol', () => {
  it('housekeeping no recibe herramientas de plata, aunque las nombre', async () => {
    await preguntar('¿cuánto se facturó? cargale un desayuno a BP-1')
    expect(ofrecidas).toContain('consultar_ayuda')
    expect(ofrecidas).not.toContain('facturacion_mes')
    expect(ofrecidas).not.toContain('proponer_consumo')
  })

  it('admin recibe las de reportes cuando la conversación es sobre eso', async () => {
    rol = 'admin'
    await preguntar('¿cuánto se facturó este mes?')
    expect(ofrecidas).toContain('facturacion_mes')
  })

  it('una herramienta que no se ofreció no se ejecuta, aunque el modelo la pida', async () => {
    guion = [
      { contenido: null, llamadas: [{ id: 'c1', nombre: 'facturacion_mes', argumentos: '{}' }] },
      { contenido: 'No tengo ese dato.', llamadas: [] },
    ]
    const r = await preguntar('¿cuánto se facturó?')
    expect(r.status).toBe(200)
    expect(ejecutarHerramienta).not.toHaveBeenCalled()
  })

  it('ejecuta como máximo 6 herramientas por vuelta aunque el modelo pida más', async () => {
    rol = 'admin'
    guion = [
      {
        contenido: null,
        llamadas: Array.from({ length: 10 }, (_, i) => ({
          id: `c${i}`,
          nombre: 'consultar_ayuda',
          argumentos: '{"pregunta":"x"}',
        })),
      },
      { contenido: 'listo', llamadas: [] },
    ]
    await preguntar()
    expect(ejecutarHerramienta).toHaveBeenCalledTimes(6)
  })

  it('un pedido mal formado responde 400 antes de contar contra el cupo', async () => {
    permitido = false
    const r = await POST(
      new Request('http://localhost/panel/ia/consulta', { method: 'POST', body: '{"mensajes": []}' }),
    )
    expect(r.status).toBe(400)
  })

  it('pasado el tope por persona responde 429 sin llamar al proveedor', async () => {
    permitido = false
    const r = await preguntar()
    expect(r.status).toBe(429)
    expect(ofrecidas).toEqual([])
  })
})

describe('lo que el asistente no pudo responder', () => {
  it('queda anotado como ia_sin_respuesta, con la pregunta enmascarada y sin el usuario', async () => {
    rol = 'recepcion'
    guion = [{ contenido: 'No tengo una herramienta para ver los sueldos del personal.', llamadas: [] }]
    await preguntar('¿Cuánto cobra el empleado con DNI 30.123.456?')
    expect(registrarAviso).toHaveBeenCalledTimes(1)
    const [evento, datos] = registrarAviso.mock.calls[0]
    expect(evento).toBe('ia_sin_respuesta')
    expect(datos).toMatchObject({ motivo: 'sin_herramienta', rol: 'recepcion' })
    expect(String(datos.pregunta)).not.toMatch(/30\.123\.456/)
    expect(datos).not.toHaveProperty('usuarioId')
  })

  it('una respuesta normal no se anota', async () => {
    guion = [{ contenido: 'Hoy llegan 3 reservas.', llamadas: [] }]
    await preguntar('¿Quién llega hoy?')
    expect(registrarAviso).not.toHaveBeenCalled()
  })
})
