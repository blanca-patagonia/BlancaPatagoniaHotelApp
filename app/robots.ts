import type { MetadataRoute } from 'next'
import { baseUrlSeo } from '@/lib/seo'

/**
 * Qué puede indexar un buscador: el catálogo público y la portada, nada que
 * dependa de un token o de una sesión. `/panel` ya es inaccesible sin login,
 * pero declararlo igual evita que un buscador gaste el rastreo en pantallas
 * que nunca va a poder mostrar en un resultado.
 */
export default function robots(): MetadataRoute.Robots {
  const base = baseUrlSeo()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/panel',
        '/login',
        '/portal',
        '/firmar',
        '/encuesta',
        '/auth',
        '/reservar/pagar',
        '/reservar/confirmacion',
        '/reservar/factura',
        '/pago-simulado',
        '/pago-payway',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
