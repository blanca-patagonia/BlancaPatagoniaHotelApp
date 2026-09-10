import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { hayDB } from './db'
import { nuevoContexto, limpiar, usarSesion, type Contexto } from './acciones/entorno'
import { generarState } from '@/lib/conexiones/estado-oauth'
import { descifrar } from '@/lib/seguridad/cifrado'

const CLAVE_DE_PRUEBA = 'slwnR7g6cB0Wyx9QeNSva6BAgwbkJVzQD1+ayMntaUo='

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./acciones/entorno')
  return {
    obtenerSesion: async () => sesionActual(),
    requerirSesion: async () => sesionActual(),
    requerirAcceso: async () => sesionActual(),
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('./db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

/**
 * Callback del OAuth2 de Mercado Pago, de punta a punta contra la base real
 * (solo la escritura falsea la red hacia Mercado Pago — la base y el cifrado
 * son de verdad, igual que en `tests/acciones/reservas.test.ts`).
 */
describe.skipIf(!hayDB)('Callback · OAuth2 Mercado Pago', () => {
  let ctx: Contexto
  const fetchOriginal = globalThis.fetch

  beforeAll(async () => {
    ctx = nuevoContexto()
    usarSesion({ rol: 'admin' })

    // `conexiones_proveedores.conectado_por` tiene FK contra `perfiles`, así
    // que el userId de fantasía del andamiaje no entra. Se toma uno real,
    // como hace `tests/acciones/punto-venta.test.ts`.
    const { data: perfil } = await ctx.db.from('perfiles').select('id').limit(1).maybeSingle()
    if (!perfil) {
      throw new Error(
        'No hay ningún perfil en la base. `npx supabase db reset` borra los usuarios ' +
          'de auth: corré `npm run seed:usuarios` antes de este test.',
      )
    }
    usarSesion({ userId: (perfil as { id: string }).id })
  })

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CLAVE_DE_PRUEBA
    process.env.MERCADOPAGO_APP_ID = 'ejemplo-app-id'
    process.env.MERCADOPAGO_APP_SECRET = 'ejemplo-app-secret'
  })

  afterEach(async () => {
    globalThis.fetch = fetchOriginal
    await ctx.db.from('conexiones_proveedores').delete().eq('proveedor', 'mercadopago')
  })

  afterAll(async () => {
    delete process.env.ENCRYPTION_KEY
    delete process.env.MERCADOPAGO_APP_ID
    delete process.env.MERCADOPAGO_APP_SECRET
    await limpiar(ctx)
  })

  // Sólo intercepta la llamada al endpoint de token de Mercado Pago: si se
  // reemplaza `fetch` a secas, se rompen también las llamadas REST internas
  // de Supabase (usan `fetch` por debajo), y el `upsert` de la conexión falla
  // con un error que no tiene nada que ver con lo que el test quiere probar.
  function fetchFalso(respuesta: unknown, ok = true) {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('api.mercadopago.com')) {
        return { ok, json: async () => respuesta } as Response
      }
      return fetchOriginal(url, init)
    }) as unknown as typeof fetch
  }

  function req(params: { code?: string; state?: string; error?: string }, cookie?: string) {
    const url = new URL('http://local/api/conexiones/mercadopago/callback')
    if (params.code) url.searchParams.set('code', params.code)
    if (params.state) url.searchParams.set('state', params.state)
    if (params.error) url.searchParams.set('error', params.error)
    const headers = new Headers()
    if (cookie) headers.set('cookie', cookie)
    return new Request(url, { headers })
  }

  it('con code + state + cookie válidos, guarda los tokens cifrados', async () => {
    const { GET } = await import('@/app/api/conexiones/mercadopago/callback/route')
    fetchFalso({
      access_token: 'ejemplo-token-de-acceso',
      refresh_token: 'ejemplo-token-de-refresco',
      expires_in: 21600,
    })

    const state = await generarState('mercadopago')
    const r = await GET(req({ code: 'un-code', state }, 'mp_pkce_verifier=un-verifier'))
    const html = await r.text()
    expect(html, `respuesta: ${html}`).toContain('Conectado. Podés cerrar esta ventana.')

    const { data } = await ctx.db
      .from('conexiones_proveedores')
      .select('estado, access_token_cifrado, refresh_token_cifrado, expira_en')
      .eq('proveedor', 'mercadopago')
      .single<{
        estado: string
        access_token_cifrado: string
        refresh_token_cifrado: string
        expira_en: string
      }>()

    expect(data!.estado).toBe('conectado')
    expect(await descifrar(data!.access_token_cifrado)).toBe('ejemplo-token-de-acceso')
    expect(await descifrar(data!.refresh_token_cifrado)).toBe('ejemplo-token-de-refresco')
    expect(data!.expira_en).toBeTruthy()
  })

  it('sin la cookie del verifier, no guarda nada y no llama a Mercado Pago', async () => {
    const { GET } = await import('@/app/api/conexiones/mercadopago/callback/route')
    let llamado = false
    globalThis.fetch = (async () => {
      llamado = true
      return { ok: true, json: async () => ({}) } as Response
    }) as unknown as typeof fetch

    const state = await generarState('mercadopago')
    await GET(req({ code: 'un-code', state }))

    expect(llamado).toBe(false)
    const { data } = await ctx.db
      .from('conexiones_proveedores')
      .select('proveedor')
      .eq('proveedor', 'mercadopago')
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('con un state de otro proveedor, lo rechaza', async () => {
    const { GET } = await import('@/app/api/conexiones/mercadopago/callback/route')
    const stateDeOtroProveedor = await generarState('google_mail')
    const r = await GET(req({ code: 'x', state: stateDeOtroProveedor }, 'mp_pkce_verifier=v'))
    const html = await r.text()
    expect(html).toContain('No se pudo conectar')
  })

  it('cuando Mercado Pago rechaza el code, no guarda una fila a medias', async () => {
    const { GET } = await import('@/app/api/conexiones/mercadopago/callback/route')
    fetchFalso({ message: 'invalid_grant' }, false)

    const state = await generarState('mercadopago')
    await GET(req({ code: 'un-code', state }, 'mp_pkce_verifier=un-verifier'))

    const { data } = await ctx.db
      .from('conexiones_proveedores')
      .select('proveedor')
      .eq('proveedor', 'mercadopago')
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('si el usuario cancela en Mercado Pago (?error=), no llama a la API', async () => {
    const { GET } = await import('@/app/api/conexiones/mercadopago/callback/route')
    let llamado = false
    globalThis.fetch = (async () => {
      llamado = true
      return { ok: true, json: async () => ({}) } as Response
    }) as unknown as typeof fetch

    await GET(req({ error: 'access_denied' }))
    expect(llamado).toBe(false)
  })
})
