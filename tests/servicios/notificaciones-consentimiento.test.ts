import { describe, it, expect, vi } from 'vitest'
import type { ClienteServicio } from '@/lib/supabase/admin'

/**
 * El consentimiento del huésped se verifica fallando CERRADO.
 *
 * Una lectura fallida de `huespedes` devuelve `data: null`, y para la regla
 * `motivoNoNotificar` `null` significa «sin ficha de preferencias: no se
 * bloquea nada». Antes, un error de la base hacía salir una promoción a quien
 * había pedido no recibirlas.
 */

vi.mock('@/lib/acciones', () => ({ registrarFalla: vi.fn() }))
vi.mock('@/lib/email', () => ({ enviarPlantilla: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ whatsappActivo: () => false, enviarPorWhatsApp: vi.fn() }))

const { encolar } = await import('@/lib/notificaciones')

function clienteQueFalla() {
  const insert = vi.fn()
  const cadena = {
    select: () => cadena,
    eq: () => cadena,
    maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }),
    insert,
  }
  return { cliente: { from: () => cadena } as unknown as ClienteServicio, insert }
}

describe('encolar: consentimiento', () => {
  it('si no se puede leer la ficha del huésped, NO encola', async () => {
    const { cliente, insert } = clienteQueFalla()
    const r = await encolar(cliente, {
      evento: 'solicitud_resena',
      entidadId: 'r1',
      destinatario: 'huesped@ejemplo.com',
      variables: {},
      huespedId: 'h1',
    })
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/consentimiento/)
    expect(insert).not.toHaveBeenCalled()
  })
})
