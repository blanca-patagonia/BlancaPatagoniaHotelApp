import 'server-only'
import { registrarError } from '@/lib/registro'

/**
 * OAuth2 de Mercado Pago, para conectar la cuenta de cobro del hotel sin
 * pegar un access token a mano.
 *
 * Por HTTP y no por el SDK oficial, mismo criterio que
 * `lib/payments/mercadopago.ts`: son tres llamadas (autorizar, canjear
 * código, renovar), no vale la dependencia y el ciclo de vida propio del SDK
 * para eso.
 *
 * Referencia: https://www.mercadopago.com.ar/developers/es/docs/security/oauth/authorization
 *
 * `MERCADOPAGO_APP_ID` / `MERCADOPAGO_APP_SECRET` son de la aplicación
 * registrada por Blanca Patagonia en el panel de developers de Mercado
 * Pago — una sola vez, no por cada hotel (acá hay uno solo).
 */

const AUTORIZACION_URL = 'https://auth.mercadopago.com/authorization'
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token'
const TIMEOUT_MS = 10_000

export interface TokensMercadoPago {
  accessToken: string
  refreshToken: string
  /** Segundos desde ahora hasta que vence el access token. */
  expiraEnSegundos: number
}

function credenciales(): { appId: string; appSecret: string } {
  const appId = process.env.MERCADOPAGO_APP_ID?.trim()
  const appSecret = process.env.MERCADOPAGO_APP_SECRET?.trim()
  if (!appId || !appSecret) {
    throw new Error(
      'Faltan MERCADOPAGO_APP_ID / MERCADOPAGO_APP_SECRET: hacen falta para conectar Mercado Pago. ' +
        'Se obtienen registrando una aplicación en https://www.mercadopago.com.ar/developers/panel.',
    )
  }
  return { appId, appSecret }
}

function aBase64Url(bytes: ArrayBuffer): string {
  const binario = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Par PKCE: `verifier` se guarda del lado del servidor, `challenge` va en la URL de autorización. */
export async function generarPkce(): Promise<{ verifier: string; challenge: string }> {
  const aleatorio = crypto.getRandomValues(new Uint8Array(32))
  const verifier = aBase64Url(aleatorio.buffer)
  const challenge = aBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

/** URL de la pantalla real de Mercado Pago. El usuario confirma ahí, nunca en un formulario propio. */
export function urlDeAutorizacion(params: {
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const { appId } = credenciales()
  const url = new URL(AUTORIZACION_URL)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export type ResultadoToken =
  | { ok: true; tokens: TokensMercadoPago }
  | { ok: false; error: string }

async function pedirToken(cuerpo: Record<string, string>): Promise<ResultadoToken> {
  const corte = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: corte,
    })
    const datos = await r.json().catch(() => null)
    if (!r.ok || !datos?.access_token) {
      const detalle = datos?.message ?? datos?.error ?? `HTTP ${r.status}`
      await registrarError('conexion_mercadopago_token', { detalle: String(detalle) })
      return { ok: false, error: 'Mercado Pago rechazó la solicitud. Probá conectar de nuevo.' }
    }
    return {
      ok: true,
      tokens: {
        accessToken: datos.access_token,
        refreshToken: datos.refresh_token,
        expiraEnSegundos: Number(datos.expires_in) || 0,
      },
    }
  } catch (error) {
    await registrarError('conexion_mercadopago_token', {
      detalle: error instanceof Error ? error.message : 'error de red',
    })
    return { ok: false, error: 'No se pudo conectar con Mercado Pago en este momento.' }
  }
}

/** Canjea el `code` de la redirección por los tokens. `codeVerifier` es el mismo PKCE del paso anterior. */
export async function canjearCodigo(params: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<ResultadoToken> {
  const { appId, appSecret } = credenciales()
  return pedirToken({
    grant_type: 'authorization_code',
    client_id: appId,
    client_secret: appSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  })
}

/**
 * Renueva el access token con el refresh token. Mercado Pago documenta que el
 * refresh token dura 6 meses y es reutilizable — no se descarta después de
 * usarlo una vez.
 */
export async function renovarToken(refreshToken: string): Promise<ResultadoToken> {
  const { appId, appSecret } = credenciales()
  return pedirToken({
    grant_type: 'refresh_token',
    client_id: appId,
    client_secret: appSecret,
    refresh_token: refreshToken,
  })
}
