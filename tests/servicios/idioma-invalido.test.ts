import { describe, it, expect, vi } from 'vitest'

// `next/font` sólo existe dentro del compilador de Next: acá se simula.
vi.mock('next/font/google', () => ({ Noto_Sans_SC: () => ({ variable: 'fuente-cjk' }) }))

import LayoutIdioma from '@/app/(front-publico)/[idioma]/layout'

/**
 * `[idioma]` es un segmento dinámico en la raíz: atrapa cualquier dirección de
 * un solo tramo. Antes de la guarda, `/no-existe` mostraba la portada en
 * español con un 200 en vez del «no encontrado».
 */
describe('layout de [idioma]', () => {
  it('responde «no encontrado» con un idioma que no es de los cinco', async () => {
    await expect(
      LayoutIdioma({ children: null, params: Promise.resolve({ idioma: 'no-existe' }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('404') })
  })

  /** Los hijos que devuelve el layout, sea un fragmento o el div de chino. */
  function hijos(r: unknown): unknown[] {
    const props = (r as { props: { children: unknown } }).props
    return ([] as unknown[]).concat(props.children)
  }
  /** La etiqueta `lang` que el layout le pasa al documento. */
  function lang(r: unknown): string | undefined {
    const el = hijos(r).find(
      (h) => typeof h === 'object' && h !== null && 'props' in h && 'etiqueta' in (h as { props: object }).props,
    ) as { props: { etiqueta: string } } | undefined
    return el?.props.etiqueta
  }

  it('deja pasar los cinco idiomas y marca el documento con el suyo', async () => {
    const { ETIQUETA_BCP47 } = await import('@/lib/i18n/idiomas')
    for (const idioma of ['es', 'en', 'pt', 'fr', 'zh'] as const) {
      const r = await LayoutIdioma({ children: 'contenido', params: Promise.resolve({ idioma }) })
      expect(hijos(r)).toContain('contenido')
      expect(lang(r)).toBe(ETIQUETA_BCP47[idioma])
    }
  })

  it('en chino envuelve el contenido con la tipografía CJK, sin armar caja propia', async () => {
    const r = (await LayoutIdioma({
      children: 'contenido',
      params: Promise.resolve({ idioma: 'zh' }),
    })) as { props: { className: string } }
    expect(r.props.className).toContain('font-cjk')
    expect(r.props.className).toContain('contents')
    expect(hijos(r)).toContain('contenido')
  })
})
