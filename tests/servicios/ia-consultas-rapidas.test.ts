import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Consultas rápidas del tablero (`panel/ia/rapidas.ts`): el sistema junta los
 * datos con las herramientas del rol y hace UNA sola llamada al modelo, sin
 * herramientas, para redactarlos.
 */

let rol = 'admin'
vi.mock('@/lib/auth/session', () => ({
  requerirAcceso: async () => ({ userId: 'u1', email: 'a@b.c', nombre: 'A', rol }),
}))
vi.mock('@/lib/limites', () => ({ permitirIntentoDe: async () => true }))
vi.mock('@/lib/registro', () => ({ registrarError: vi.fn() }))

const ejecutarHerramienta = vi.fn(async (nombre: string) => ({ herramienta: nombre, ok: true }))
vi.mock('@/app/(front-gestion)/panel/ia/herramientas', () => ({ ejecutarHerramienta }))

class IaNoDisponible extends Error {
  constructor(m: string, readonly motivo: 'cupo' | 'saturado') {
    super(m)
  }
}
const chat = vi.fn<(m: unknown[], h: unknown[]) => Promise<{ contenido: string; llamadas: never[] }>>(
  async () => ({ contenido: '- Todo tranquilo', llamadas: [] }),
)
vi.mock('@/lib/ia/proveedor', () => ({
  iaActiva: () => true,
  IaNoDisponible,
  obtenerProveedorIa: () => ({ chat }),
}))

const { consultaRapida } = await import('@/app/(front-gestion)/panel/ia/rapidas')

beforeEach(() => {
  rol = 'admin'
  ejecutarHerramienta.mockClear()
  chat.mockClear()
})

describe('consultas rápidas del tablero', () => {
  it('una sola llamada al modelo, sin herramientas, con los datos ya juntados', async () => {
    const r = await consultaRapida('resumen')
    expect(r).toEqual({ texto: '- Todo tranquilo' })
    expect(chat).toHaveBeenCalledTimes(1)
    const [mensajes, herramientas] = chat.mock.calls[0]
    expect(herramientas).toEqual([])
    expect(JSON.stringify(mensajes)).toContain('operacion_del_dia')
  })

  it('housekeeping no junta saldos ni métricas (no son de su rol)', async () => {
    rol = 'housekeeping'
    await consultaRapida('atencion')
    const pedidas = ejecutarHerramienta.mock.calls.map((c) => c[0])
    expect(pedidas).not.toContain('saldos_pendientes')
    expect(pedidas).not.toContain('metricas_periodo')
    expect(pedidas).toContain('estado_limpieza')
  })

  it('cupo agotado: lo dice sin romper', async () => {
    chat.mockRejectedValueOnce(new IaNoDisponible('429', 'cupo'))
    await expect(consultaRapida('resumen')).resolves.toMatchObject({ error: expect.stringMatching(/cupo/) })
  })
})
