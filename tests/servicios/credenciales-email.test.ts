import { describe, it, expect, afterEach, vi } from 'vitest'
import { verificarCredencialesDeEmail } from '@/lib/email'

/**
 * `verificarCredencialesDeEmail`: con `EMAIL_PROVIDER=resend` en producción, la
 * clave y el remitente tienen que estar al arrancar (ADR 0018). Antes el sistema
 * levantaba igual y el primer correo —la confirmación de una reserva— fallaba
 * sin que nadie mirara.
 *
 * Mismo mecanismo que `tests/dominio/credenciales-pasarela.test.ts`.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('credenciales de correo al arrancar', () => {
  it('fuera de producción no exige nada', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')

    expect(() => verificarCredencialesDeEmail('resend')).not.toThrow()
  })

  it('en producción, resend sin RESEND_API_KEY hace fallar el arranque', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', 'reservas@blancapatagonia.com')

    expect(() => verificarCredencialesDeEmail('resend')).toThrow(/RESEND_API_KEY/)
  })

  it('en producción, resend sin EMAIL_FROM también', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', 're_x')
    vi.stubEnv('EMAIL_FROM', '   ')

    expect(() => verificarCredencialesDeEmail('resend')).toThrow(/EMAIL_FROM/)
  })

  it('en producción con las dos, no lanza', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', 're_x')
    vi.stubEnv('EMAIL_FROM', 'reservas@blancapatagonia.com')

    expect(() => verificarCredencialesDeEmail('resend')).not.toThrow()
  })

  it('el proveedor de consola no tiene credenciales que pedir', () => {
    // Que `consola` en producción sea un error lo decide `obtenerProveedorEmail`.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')

    expect(() => verificarCredencialesDeEmail('consola')).not.toThrow()
  })
})
