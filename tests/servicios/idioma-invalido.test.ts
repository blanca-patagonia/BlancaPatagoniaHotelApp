import { describe, it, expect } from 'vitest'
import LayoutIdioma from '@/app/(front-publico)/[idioma]/layout'

/**
 * `[idioma]` es un segmento dinámico en la raíz: atrapa cualquier dirección de
 * un solo tramo. Antes de la guarda, `/no-existe` mostraba la portada en
 * español con un 200 en vez del «no encontrado».
 */
describe('layout de [idioma]', () => {
  it('responde «no encontrado» con un idioma que el sitio no muestra', async () => {
    await expect(
      LayoutIdioma({ children: null, params: Promise.resolve({ idioma: 'no-existe' }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('404') })
  })

  /** Los hijos que devuelve el layout. */
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

  it('deja pasar el español y marca el documento con su etiqueta', async () => {
    const { ETIQUETA_BCP47 } = await import('@/lib/i18n/idiomas')
    const r = await LayoutIdioma({ children: 'contenido', params: Promise.resolve({ idioma: 'es' }) })
    expect(hijos(r)).toContain('contenido')
    expect(lang(r)).toBe(ETIQUETA_BCP47.es)
  })

  it('rechaza los idiomas que se quitaron de la versión actual', async () => {
    for (const idioma of ['en', 'pt', 'fr', 'zh']) {
      await expect(
        LayoutIdioma({ children: null, params: Promise.resolve({ idioma }) }),
      ).rejects.toMatchObject({ digest: expect.stringContaining('404') })
    }
  })
})
