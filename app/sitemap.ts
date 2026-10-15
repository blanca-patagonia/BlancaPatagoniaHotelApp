import type { MetadataRoute } from 'next'
import { baseUrlSeo } from '@/lib/seo'
import { tiposUnidadPublicos } from '@/lib/catalogo/publico'
import { registrarError } from '@/lib/registro'

/**
 * Las rutas públicas y el catálogo de alojamientos, uno por `codigo`.
 *
 * No incluye nada de `/reservar/*` con token, `/panel` ni `/portal`: son
 * páginas que no tienen sentido como resultado de búsqueda (dependen de una
 * reserva o una sesión puntuales), y publicarlas en el sitemap sería invitar
 * a un buscador a indexar una URL que para cualquier otra visita es un 404 o
 * un token ajeno.
 *
 * Si la lectura del catálogo falla, el sitemap sale igual con las rutas
 * estáticas: un sitemap más corto no rompe nada, perder el archivo entero sí
 * —un 500 acá le dice a Google que deje de confiar en el sitemap del dominio—.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrlSeo()

  const estaticas: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/alojamientos`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/reservar`, changeFrequency: 'weekly', priority: 0.8 },
  ]

  try {
    const tipos = await tiposUnidadPublicos()
    const deTipos: MetadataRoute.Sitemap = tipos.map((t) => ({
      url: `${base}/alojamientos/${t.codigo}`,
      changeFrequency: 'monthly',
      priority: 0.7,
    }))
    return [...estaticas, ...deTipos]
  } catch (error) {
    await registrarError('sitemap_tipos_unidad_fallo', {
      detalle: error instanceof Error ? error.message : String(error),
    })
    return estaticas
  }
}
