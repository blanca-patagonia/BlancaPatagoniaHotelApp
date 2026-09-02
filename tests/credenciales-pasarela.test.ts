import { describe, it, expect, afterEach, vi } from 'vitest'
import { verificarCredencialesDePasarela } from '@/lib/payments'

/**
 * `verificarCredencialesDePasarela` cumple lo que el ADR 0018 prometía y no se
 * cumplía: en producción, una pasarela habilitada en `PAGO_PROVIDER` sin sus
 * credenciales tiene que **hacer fallar el arranque**, no aparecer cuando un
 * huésped no puede pagar.
 *
 * Mismo mecanismo que `tests/integraciones.test.ts`: `vi.stubEnv`.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('credenciales de pasarela al arrancar', () => {
  it('fuera de producción no exige nada, aunque falte todo', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PAGO_PROVIDER', 'stripe,mercadopago')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', '')

    expect(() => verificarCredencialesDePasarela()).not.toThrow()
  })

  it('en producción, stripe sin STRIPE_SECRET_KEY hace fallar el arranque', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAGO_PROVIDER', 'stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x')

    expect(() => verificarCredencialesDePasarela()).toThrow(/STRIPE_SECRET_KEY/)
  })

  it('en producción, mercadopago sin su webhook secret también', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAGO_PROVIDER', 'mercadopago')
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'APP_USR-x')
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', '')

    expect(() => verificarCredencialesDePasarela()).toThrow(/MERCADOPAGO_WEBHOOK_SECRET/)
  })

  it('en producción con todas las credenciales, no lanza', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAGO_PROVIDER', 'stripe,mercadopago')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_x')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x')
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'APP_USR-x')
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'mp_x')

    expect(() => verificarCredencialesDePasarela()).not.toThrow()
  })

  it('en producción con el simulador declarado a propósito, no exige credenciales', () => {
    // `PAGO_PROVIDER=simulado` es una decisión válida (ADR 0018): el simulador no
    // tiene credenciales que pedir.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAGO_PROVIDER', 'simulado')

    expect(() => verificarCredencialesDePasarela()).not.toThrow()
  })

  it('una pasarela sin las dos credenciales lista las dos que faltan', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAGO_PROVIDER', 'stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')

    try {
      verificarCredencialesDePasarela()
      expect.unreachable('debió lanzar')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      expect(msg).toContain('STRIPE_SECRET_KEY')
      expect(msg).toContain('STRIPE_WEBHOOK_SECRET')
    }
  })
})
