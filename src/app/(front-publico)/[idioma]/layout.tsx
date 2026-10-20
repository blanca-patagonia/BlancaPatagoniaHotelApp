import { notFound } from 'next/navigation'
import { Noto_Sans_SC } from 'next/font/google'
import { esIdioma } from '@/lib/i18n'
import { ETIQUETA_BCP47 } from '@/lib/i18n/idiomas'
import { IdiomaDelDocumento } from '../_publico/idioma-documento'

/**
 * Tipografía para chino.
 *
 * `Inter` se carga con `subsets: ["latin"]` y no trae ni un carácter chino: sin
 * esta familia el portal en 中文 cae a la fuente del sistema (SimSun en
 * Windows, cuadraditos en algún Linux sin fuentes CJK).
 *
 * Está acá y no en el layout raíz porque `next/font` emite su CSS en todas las
 * rutas del módulo que la importa: en la raíz la pagaba también el panel.
 * Dos pesos y no cuatro (el 500 se resuelve con el 400) y sin precarga: el
 * archivo que se precargaría es el del subconjunto latino, que al chino no le
 * sirve. Se descartó cargarla desde Google Fonts con un `<link>`: está
 * bloqueado en China continental, que es justamente quien lee este idioma.
 */
const notoSC = Noto_Sans_SC({
  variable: '--fuente-cjk',
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  preload: false,
})

/**
 * Guarda de todo lo que cuelga de `[idioma]`.
 *
 * `[idioma]` es un segmento dinámico en la raíz del sitio, así que atrapa
 * cualquier dirección de un solo tramo: sin esta guarda, `/contacto` o un
 * enlace viejo mal copiado mostraban la portada en español con un 200 —una
 * página «encontrada» que no existe, para el visitante y para los buscadores—.
 * Con un idioma que no es de los cinco se responde el «no encontrado» del sitio.
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
  const lang = <IdiomaDelDocumento etiqueta={ETIQUETA_BCP47[idioma]} />
  if (idioma !== 'zh') {
    return (
      <>
        {lang}
        {children}
      </>
    )
  }
  // `contents`: el div no arma caja propia, sólo hereda la variable y la familia.
  return (
    <div className={`${notoSC.variable} font-cjk contents`}>
      {lang}
      {children}
    </div>
  )
}
