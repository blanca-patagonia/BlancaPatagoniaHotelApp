import { notFound } from 'next/navigation'
import { esIdioma } from '@/lib/i18n'
import { ETIQUETA_BCP47 } from '@/lib/i18n/idiomas'
import { IdiomaDelDocumento } from '../_publico/idioma-documento'

/**
 * Guarda de todo lo que cuelga de `[idioma]`.
 *
 * `[idioma]` es un segmento dinámico en la raíz del sitio, así que atrapa
 * cualquier dirección de un solo tramo: sin esta guarda, `/contacto` o un
 * enlace viejo mal copiado mostraban la portada en español con un 200 —una
 * página «encontrada» que no existe, para el visitante y para los buscadores—.
 * Con un idioma que no es de los que se muestran se responde el «no
 * encontrado» del sitio.
 */
export default async function LayoutIdioma({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ idioma: string }>
}) {
  const { idioma } = await params
  if (!esIdioma(idioma)) notFound()
  return (
    <>
      <IdiomaDelDocumento etiqueta={ETIQUETA_BCP47[idioma]} />
      {children}
    </>
  )
}
