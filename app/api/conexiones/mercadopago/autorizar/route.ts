import { NextResponse } from 'next/server'
import { requerirAcceso } from '@/lib/auth/session'
import { generarPkce, urlDeAutorizacion } from '@/lib/conexiones/mercadopago'
import { generarState } from '@/lib/conexiones/estado-oauth'
import { urlDelSitio } from '@/lib/env'

/**
 * `GET /api/conexiones/mercadopago/autorizar` — arranca el OAuth2 de Mercado Pago.
 *
 * Lo abre el botón «Conectar Mercado Pago» en una VENTANA EMERGENTE
 * (`window.open`), no como navegación de la pestaña principal: así, cuando
 * termina, la ventana se cierra sola y el panel de atrás nunca se movió de
 * `/panel/config/conexiones`.
 *
 * El `code_verifier` de PKCE viaja en una cookie propia porque el navegador
 * es el mismo entre esta llamada y el `callback` (es la misma pestaña
 * emergente yendo y volviendo), pero el servidor no tiene otro lugar donde
 * guardarlo sin una tabla dedicada — y una cookie de 10 minutos, con
 * `path` acotado a esta ruta, alcanza.
 */
export async function GET() {
  await requerirAcceso('config')

  const { verifier, challenge } = await generarPkce()
  const state = await generarState('mercadopago')
  const redirectUri = `${urlDelSitio()}/api/conexiones/mercadopago/callback`

  const url = urlDeAutorizacion({ redirectUri, state, codeChallenge: challenge })

  const respuesta = NextResponse.redirect(url)
  respuesta.cookies.set('mp_pkce_verifier', verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/conexiones/mercadopago',
  })
  return respuesta
}
