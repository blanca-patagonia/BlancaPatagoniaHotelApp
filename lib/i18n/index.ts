import { es, type Diccionario } from './diccionarios/es'
import { claveDeComodidad } from '@/lib/domain/comodidades'
import { en } from './diccionarios/en'
import { pt } from './diccionarios/pt'
import { fr } from './diccionarios/fr'
import { zh } from './diccionarios/zh'
import {
  ETIQUETA_BCP47,
  IDIOMAS,
  IDIOMA_POR_OMISION,
  esIdioma,
  rutaConIdioma,
  type Idioma,
} from './idiomas'

/**
 * Acceso a los textos del portal.
 *
 * ── Por qué los cinco diccionarios se importan de una ───────────────────────
 *
 * Se evaluó cargarlos con `import()` dinámico para que cada visita baje sólo el
 * suyo. No se hizo: los diccionarios se usan en **Server Components**, así que
 * no viajan al navegador —el huésped recibe HTML ya traducido—, y lo único que
 * se ahorraría es memoria del servidor. A cambio, el `import()` obliga a que
 * todo lo que pida textos sea `async` y propaga `await` por media aplicación.
 *
 * Si algún día el portal necesita traducir del lado del cliente, esto es lo
 * primero que hay que revisar.
 */

const DICCIONARIOS: Record<Idioma, Diccionario> = { es, en, pt, fr, zh }

/** Los textos de un idioma. Un idioma desconocido cae al de origen. */
export function textos(idioma: string | undefined): Diccionario {
  return DICCIONARIOS[esIdioma(idioma) ? idioma : IDIOMA_POR_OMISION]
}

/**
 * Reemplaza los marcadores de una frase: `rellenar('{n} noches', { n: 3 })`.
 *
 * ── Por qué no hay una librería de plantillas ───────────────────────────────
 *
 * Lo único que hace falta es sustituir `{clave}` por un valor. Una librería de
 * mensajes ICU resolvería además plurales y géneros, y eso **sí** haría falta si
 * las frases se armaran por concatenación; acá no se arman: cada forma
 * (`noches` / `unaNoche`) está escrita entera en cada idioma, que es lo que
 * permite que el chino —sin plural— y el francés —con reglas propias— queden
 * ambos naturales.
 */
export function rellenar(plantilla: string, valores: Record<string, string | number>): string {
  return plantilla.replace(/\{(\w+)\}/g, (original, clave: string) =>
    clave in valores ? String(valores[clave]) : original,
  )
}

/**
 * Elige entre la forma singular y la plural.
 *
 * ⚠️ No es una regla de pluralización: es una **elección entre dos textos ya
 * escritos**. En chino las dos formas son iguales salvo el número, y en francés
 * el cero va en singular —«0 nuit», no «0 nuits»—, dos cosas que una regla
 * genérica basada en `n !== 1` se lleva por delante. Dejar que cada diccionario
 * escriba ambas formas completas es más largo y es correcto.
 */
export function plural(n: number, una: string, varias: string): string {
  return rellenar(n === 1 ? una : varias, { n })
}

/** La etiqueta de `Intl` que corresponde a ese idioma, para fechas e importes. */
export function etiquetaIntl(idioma: string | undefined): string {
  return ETIQUETA_BCP47[esIdioma(idioma) ? idioma : IDIOMA_POR_OMISION]
}

/**
 * `canonical` y `hreflang` de una pantalla del portal.
 *
 * `ruta` va SIN idioma (`/alojamientos`). Sin las alternativas un buscador ve
 * cinco URLs con el mismo contenido y se queda con una sola; con ellas, cada
 * idioma aparece en las búsquedas de su gente.
 */
export function alternativasDeIdioma(idioma: string, ruta: string) {
  const propia = esIdioma(idioma) ? idioma : IDIOMA_POR_OMISION
  return {
    canonical: rutaConIdioma(ruta, propia),
    languages: Object.fromEntries(IDIOMAS.map((i) => [ETIQUETA_BCP47[i], rutaConIdioma(ruta, i)])),
  }
}

/** «hasta 4 personas» / «up to 4 people», o la forma singular. */
export function textoCapacidadEn(t: Diccionario, n: number): string {
  return n === 1 ? t.categorias.capacidadUna : rellenar(t.categorias.capacidadVarias, { n })
}

/**
 * La política de cancelación, una línea por tramo, en el idioma del huésped.
 *
 * Es la misma regla que `describirPoliticaCancelacion` (lib/domain/asistente)
 * —cada tramo vale desde su umbral hasta el umbral del anterior— y en español
 * produce exactamente el mismo texto (hay un test que lo fija). Se reescribe
 * acá y no se traduce el resultado porque las reglas salen de la base: el
 * texto tiene que seguir a lo que el hotel cargó, no a una frase fija.
 */
export function lineasCancelacion(
  reglas: { desde_dias: number; cargo: 'ninguno' | 'primera_noche' | 'total' }[],
  t: Diccionario,
): string[] {
  const c = t.cancelacion
  const ordenadas = [...reglas].sort((a, b) => b.desde_dias - a.desde_dias)
  return ordenadas.map((r, i) => {
    const cargo = c[r.cargo]
    if (i === 0) return rellenar(c.primera, { n: r.desde_dias, cargo })
    const tope = ordenadas[i - 1].desde_dias
    if (r.desde_dias === 0) return rellenar(c.menos, { n: tope, cargo })
    return rellenar(c.entre, { desde: r.desde_dias, hasta: tope - 1, cargo })
  })
}

/**
 * El texto de una comodidad del catálogo para mostrar.
 *
 * En español va el texto tal como lo cargó el hotel —es su redacción—; en
 * otro idioma, la traducción si se la reconoce, y si no el original: una
 * comodidad nunca se esconde por no saber traducirla.
 */
export function textoComodidad(texto: string, idioma: string, t: Diccionario): string {
  if (idioma === IDIOMA_POR_OMISION) return texto
  const clave = claveDeComodidad(texto)
  return clave ? t.comodidades[clave] : texto
}

/** El idioma de la URL, o el de origen si no es uno conocido. */
export function idiomaValido(idioma: string | undefined): Idioma {
  return esIdioma(idioma) ? idioma : IDIOMA_POR_OMISION
}

export {
  IDIOMAS,
  IDIOMA_POR_OMISION,
  NOMBRE_IDIOMA,
  CODIGO_CORTO,
  ETIQUETA_BCP47,
  esIdioma,
  idiomaPreferido,
  rutaConIdioma,
  fechaCortaEn,
  fechaLargaEn,
  idiomaDeReferencia,
} from './idiomas'
export type { Idioma } from './idiomas'
export type { Diccionario } from './diccionarios/es'
