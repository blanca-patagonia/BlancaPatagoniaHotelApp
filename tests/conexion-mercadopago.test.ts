import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  generarPkce,
  urlDeAutorizacion,
  canjearCodigo,
  renovarToken,
} from '@/lib/conexiones/mercadopago'

/**
 * OAuth2 de Mercado Pago, con la red simulada. Mismo patrón que
 * `tests/pasarelas-reales.test.ts` y `tests/email-real.test.ts`: se prueba
 * qué se le manda al proveedor real, no un mock del propio adapter.
 */

const fetchOriginal = globalThis.fetch

beforeEach(() => {
  process.env.MERCADOPAGO_APP_ID = 'ejemplo-app-id'
  process.env.MERCADOPAGO_APP_SECRET = 'ejemplo-app-secret'
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  delete process.env.MERCADOPAGO_APP_ID
  delete process.env.MERCADOPAGO_APP_SECRET
})

function fetchFalso(respuesta: unknown, ok = true, status = 200) {
  const llamadas: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init })
    return { ok, status, json: async () => respuesta } as Response
  }) as unknown as typeof fetch
  return llamadas
}

describe('PKCE', () => {
  it('genera un verifier y un challenge distintos entre sí', async () => {
    const { verifier, challenge } = await generarPkce()
    expect(verifier.length).toBeGreaterThan(20)
    expect(challenge).not.toBe(verifier)
  })

  it('dos pares generados no se repiten', async () => {
    const a = await generarPkce()
    const b = await generarPkce()
    expect(a.verifier).not.toBe(b.verifier)
  })

  it('el challenge no contiene caracteres fuera de base64url', async () => {
    const { challenge } = await generarPkce()
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('urlDeAutorizacion', () => {
  it('arma la URL real de Mercado Pago con PKCE', () => {
    const url = urlDeAutorizacion({
      redirectUri: 'https://blancapatagonia.com/api/conexiones/mercadopago/callback',
      state: 'el-state',
      codeChallenge: 'el-challenge',
    })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://auth.mercadopago.com/authorization')
    expect(u.searchParams.get('client_id')).toBe('ejemplo-app-id')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('state')).toBe('el-state')
    expect(u.searchParams.get('code_challenge')).toBe('el-challenge')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('sin las credenciales de la app, avisa qué falta', () => {
    delete process.env.MERCADOPAGO_APP_ID
    expect(() =>
      urlDeAutorizacion({ redirectUri: 'x', state: 'x', codeChallenge: 'x' }),
    ).toThrow(/MERCADOPAGO_APP_ID/)
  })
})

describe('canjearCodigo', () => {
  it('manda grant_type, client_id, client_secret, code, redirect_uri y code_verifier', async () => {
    const llamadas = fetchFalso({
      access_token: 'ejemplo-token-de-acceso',
      refresh_token: 'ejemplo-token-de-refresco',
      expires_in: 21600,
    })

    const r = await canjearCodigo({
      code: 'el-code',
      codeVerifier: 'el-verifier',
      redirectUri: 'https://blancapatagonia.com/callback',
    })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tokens.accessToken).toBe('ejemplo-token-de-acceso')
      expect(r.tokens.refreshToken).toBe('ejemplo-token-de-refresco')
      expect(r.tokens.expiraEnSegundos).toBe(21600)
    }

    expect(llamadas).toHaveLength(1)
    const cuerpo = JSON.parse(String(llamadas[0].init.body))
    expect(cuerpo).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'ejemplo-app-id',
      client_secret: 'ejemplo-app-secret',
      code: 'el-code',
      redirect_uri: 'https://blancapatagonia.com/callback',
      code_verifier: 'el-verifier',
    })
  })

  it('un rechazo del proveedor no tira una excepción sin manejar', async () => {
    fetchFalso({ message: 'invalid_grant' }, false, 400)
    const r = await canjearCodigo({ code: 'x', codeVerifier: 'x', redirectUri: 'x' })
    expect(r.ok).toBe(false)
  })

  it('un corte de red da un error legible, no una excepción', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network error')
    }) as unknown as typeof fetch
    const r = await canjearCodigo({ code: 'x', codeVerifier: 'x', redirectUri: 'x' })
    expect(r.ok).toBe(false)
  })
})

describe('renovarToken', () => {
  it('manda grant_type=refresh_token con el refresh token', async () => {
    const llamadas = fetchFalso({
      access_token: 'ejemplo-nuevo-token',
      refresh_token: 'ejemplo-nuevo-refresh',
      expires_in: 21600,
    })

    await renovarToken('ejemplo-el-refresh-token')

    const cuerpo = JSON.parse(String(llamadas[0].init.body))
    expect(cuerpo).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'ejemplo-el-refresh-token',
    })
  })
})
