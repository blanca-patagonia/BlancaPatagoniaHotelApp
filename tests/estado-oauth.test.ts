import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generarState, verificarState } from '@/lib/conexiones/estado-oauth'

const CLAVE_DE_PRUEBA = 'slwnR7g6cB0Wyx9QeNSva6BAgwbkJVzQD1+ayMntaUo='

beforeEach(() => {
  process.env.ENCRYPTION_KEY = CLAVE_DE_PRUEBA
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
  vi.useRealTimers()
})

describe('state de OAuth2', () => {
  it('un state recién generado es válido para su mismo proveedor', async () => {
    const state = await generarState('mercadopago')
    const r = await verificarState(state, 'mercadopago')
    expect(r.valido).toBe(true)
  })

  it('rechaza el state de un proveedor para otro proveedor', async () => {
    const state = await generarState('mercadopago')
    const r = await verificarState(state, 'google_mail')
    expect(r.valido).toBe(false)
  })

  it('rechaza un state con la firma alterada', async () => {
    const state = await generarState('mercadopago')
    const alterado = state.slice(0, -4) + 'aaaa'
    const r = await verificarState(alterado, 'mercadopago')
    expect(r.valido).toBe(false)
  })

  it('rechaza un state con formato inválido', async () => {
    expect((await verificarState('cualquier-cosa', 'mercadopago')).valido).toBe(false)
    expect((await verificarState('', 'mercadopago')).valido).toBe(false)
  })

  it('rechaza un state vencido (más de 5 minutos)', async () => {
    const state = await generarState('mercadopago')
    const ahoraMasDiez = Math.floor(Date.now() / 1000) + 10 * 60
    const r = await verificarState(state, 'mercadopago', ahoraMasDiez)
    expect(r.valido).toBe(false)
    expect(r.motivo).toMatch(/expirado/)
  })

  it('dos states generados para el mismo proveedor son distintos (nonce aleatorio)', async () => {
    const a = await generarState('mercadopago')
    const b = await generarState('mercadopago')
    expect(a).not.toBe(b)
  })
})
