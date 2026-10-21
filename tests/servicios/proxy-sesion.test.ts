import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
  Simula que Supabase renueva la sesión durante `getUser()`: llama a `setAll`
  con la cookie nueva, como hace @supabase/ssr cuando el access token venció.
*/
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _clave: string,
    opciones: { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        opciones.cookies.setAll([{ name: 'sb-token', value: 'NUEVO', options: {} }])
        return { data: { user: null }, error: null }
      },
    },
  }),
}))

import { actualizarSesion } from '@/lib/supabase/proxy'

describe('proxy · refresco de sesión', () => {
  it('la aplicación recibe la cookie RENOVADA, no la vencida', async () => {
    const pedido = new NextRequest('http://localhost/panel', {
      headers: { cookie: 'sb-token=VIEJO; otra=1' },
    })

    const respuesta = await actualizarSesion(pedido, { 'x-idioma': 'es' })

    // Next reenvía las cabeceras de la petición reconstruida con este prefijo.
    const cookieReenviada = respuesta.headers.get('x-middleware-request-cookie') ?? ''
    expect(cookieReenviada).toContain('sb-token=NUEVO')
    expect(cookieReenviada).not.toContain('VIEJO')
    expect(cookieReenviada).toContain('otra=1')
    // La cabecera extra sigue llegando.
    expect(respuesta.headers.get('x-middleware-request-x-idioma')).toBe('es')
    // Y el navegador recibe la cookie nueva.
    expect(respuesta.cookies.get('sb-token')?.value).toBe('NUEVO')
  })
})
