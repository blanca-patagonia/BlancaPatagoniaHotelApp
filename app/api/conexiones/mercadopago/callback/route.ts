import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { canjearCodigo } from '@/lib/conexiones/mercadopago'
import { verificarState } from '@/lib/conexiones/estado-oauth'
import { cifrar } from '@/lib/seguridad/cifrado'
import { registrarError } from '@/lib/registro'
import { urlDelSitio } from '@/lib/env'

/**
 * `GET /api/conexiones/mercadopago/callback` — vuelta del OAuth2 de Mercado Pago.
 *
 * Nunca redirige de vuelta al panel: la ventana que abrió el `autorizar` es
 * una emergente, así que esto responde una página HTML mínima que le avisa al
 * padre por `postMessage` y se cierra sola. Si la ventana redirigiera, el
 * usuario vería el panel duplicado en una ventana chica que no sabe cerrar.
 *
 * `targetOrigin` es el sitio propio, nunca `'*'`: con `'*'`, cualquier página
 * que lograra abrir esta ventana como popup podría leer el mensaje.
 */

function paginaDeCierre(cuerpo: { ok: true } | { ok: false; error: string }): Response {
  const origen = urlDelSitio()
  const mensaje = JSON.stringify({ provider: 'mercadopago', ...cuerpo })
  const html = `<!doctype html><html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify(mensaje)}, ${JSON.stringify(origen)});
  }
  window.close();
</script>
<p>${cuerpo.ok ? 'Conectado. Podés cerrar esta ventana.' : 'No se pudo conectar. Podés cerrar esta ventana e intentar de nuevo.'}</p>
</body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function GET(request: Request): Promise<Response> {
  const sesion = await requerirAcceso('config')

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorProveedor = url.searchParams.get('error')

  if (errorProveedor) {
    // El usuario canceló en la pantalla de Mercado Pago, o negó el permiso.
    // No es una falla del sistema: no se registra como error.
    return paginaDeCierre({ ok: false, error: 'Cancelado.' })
  }

  if (!code || !state) {
    return paginaDeCierre({ ok: false, error: 'Faltan datos de la respuesta.' })
  }

  const resultadoState = await verificarState(state, 'mercadopago')
  if (!resultadoState.valido) {
    await registrarError('conexion_mercadopago_state', { detalle: resultadoState.motivo ?? '' })
    return paginaDeCierre({ ok: false, error: 'La solicitud expiró. Probá conectar de nuevo.' })
  }

  const verifier = request.headers
    .get('cookie')
    ?.split('; ')
    .find((c) => c.startsWith('mp_pkce_verifier='))
    ?.split('=')[1]

  if (!verifier) {
    return paginaDeCierre({ ok: false, error: 'La solicitud expiró. Probá conectar de nuevo.' })
  }

  const redirectUri = `${urlDelSitio()}/api/conexiones/mercadopago/callback`
  const resultado = await canjearCodigo({ code, codeVerifier: verifier, redirectUri })

  const limpiarCookie = 'mp_pkce_verifier=; Max-Age=0; Path=/api/conexiones/mercadopago'

  if (!resultado.ok) {
    const resp = paginaDeCierre({ ok: false, error: resultado.error })
    resp.headers.append('set-cookie', limpiarCookie)
    return resp
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('conexiones_proveedores').upsert({
    proveedor: 'mercadopago',
    tipo_conexion: 'oauth2',
    estado: 'conectado',
    access_token_cifrado: await cifrar(resultado.tokens.accessToken),
    refresh_token_cifrado: await cifrar(resultado.tokens.refreshToken),
    expira_en: new Date(Date.now() + resultado.tokens.expiraEnSegundos * 1000).toISOString(),
    conectado_por: sesion.userId,
    conectado_en: new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
  })

  if (error) {
    await registrarError('conexion_mercadopago_guardar', { detalle: error.message })
    const resp = paginaDeCierre({ ok: false, error: 'Se conectó, pero no se pudo guardar. Probá de nuevo.' })
    resp.headers.append('set-cookie', limpiarCookie)
    return resp
  }

  const resp = paginaDeCierre({ ok: true })
  resp.headers.append('set-cookie', limpiarCookie)
  return resp
}
