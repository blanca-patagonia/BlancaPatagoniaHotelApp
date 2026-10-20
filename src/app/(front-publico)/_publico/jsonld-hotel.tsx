import { DIRECCION, SERVICIOS } from '@/lib/domain/hotel'
import { baseUrlSeo } from '@/lib/seo'

/**
 * Datos estructurados (schema.org/Hotel) para que un buscador pueda mostrar la
 * portada o el catálogo como una ficha de hotel, no como un enlace pelado.
 *
 * Solo lleva los campos que el sistema sabe de verdad — `DIRECCION` es
 * "localidad, provincia", no una calle y altura que nadie cargó en ningún
 * lado — en vez de inventar un domicilio, un teléfono o coordenadas que
 * después quedan mal si el hotel se muda o cambia de número. Mismo criterio
 * que `lib/domain/catalogo.ts` con las fotos: mejor un campo ausente que uno
 * falso.
 */
export function JsonLdHotel() {
  const base = baseUrlSeo()
  const [localidad, provincia] = DIRECCION.split(',').map((s) => s.trim())

  const datos = {
    '@context': 'https://schema.org',
    '@type': 'Hotel',
    name: 'Blanca Patagonia',
    description:
      'Hostería boutique y cabañas frente al Lago Argentino, en El Calafate, a pasos del Parque Nacional Los Glaciares.',
    url: base,
    address: {
      '@type': 'PostalAddress',
      addressLocality: localidad,
      addressRegion: provincia,
      addressCountry: 'AR',
    },
    amenityFeature: SERVICIOS.map((s) => ({
      '@type': 'LocationFeatureSpecification',
      name: s,
      value: true,
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(datos) }}
    />
  )
}
