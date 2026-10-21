/**
 * Idiomas del portal público.
 *
 * ── Qué se traduce y qué no ─────────────────────────────────────────────────
 *
 * Esto es **sólo para el portal del huésped**. El panel sigue en español: lo usa
 * el personal del hotel, en El Calafate, y traducirlo sería mantener seis
 * versiones de pantallas que nadie más va a leer.
 *
 * ── Por qué el idioma va en la URL y no en una cookie ───────────────────────
 *
 * Un buscador indexa URLs, no cookies. Con una sola dirección que cambia de
 * idioma según quién entre, Google guarda una sola versión —la que le tocó— y
 * el hotel pierde todas las búsquedas en los otros idiomas, que es justamente
 * el motivo de traducir. Con `/en/alojamientos` cada idioma tiene su dirección,
 * se puede compartir por WhatsApp y se declara con `hreflang`.
 *
 * ── Por qué no hay una librería ─────────────────────────────────────────────
 *
 * La guía oficial de Next 16 (`node_modules/next/dist/docs/01-app/02-guides/
 * internationalization.md`) resuelve esto con el `proxy` y diccionarios
 * propios; las librerías que menciona son opcionales. Sumar una dependencia
 * para elegir un objeto según una cadena no se justifica (AGENTS.md).
 */

/** Los idiomas que el portal sabe mostrar. El primero es el de origen. */
export const IDIOMAS = ['es', 'en', 'pt', 'fr', 'zh'] as const

export type Idioma = (typeof IDIOMAS)[number]

/**
 * Idioma por omisión.
 *
 * Español: es el idioma en el que está escrito el contenido original y el que
 * habla el hotel. Si una traducción falta, se cae acá y no a una pantalla vacía.
 */
export const IDIOMA_POR_OMISION: Idioma = 'es'

/** Nombre de cada idioma **en ese idioma**, que es como se elige en un selector. */
export const NOMBRE_IDIOMA: Record<Idioma, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
  fr: 'Français',
  zh: '中文',
}

/**
 * Etiqueta corta para el selector cuando no entra el nombre completo.
 * No se usan banderas: una bandera es un país, no un idioma —el portugués de
 * Brasil y el de Portugal, o el inglés de media docena de países— y elegir una
 * deja afuera a todos los demás.
 */
export const CODIGO_CORTO: Record<Idioma, string> = {
  es: 'ES',
  en: 'EN',
  pt: 'PT',
  fr: 'FR',
  zh: '中文',
}

/**
 * Etiqueta de región para `Intl` y para el atributo `lang` del HTML.
 *
 * `es-AR` y no `es` a secas: el hotel está en Argentina y el español rioplatense
 * es el que usa el contenido («reservá», «tenés»). `pt-BR` porque el grueso del
 * turismo lusoparlante en El Calafate es brasileño.
 */
export const ETIQUETA_BCP47: Record<Idioma, string> = {
  es: 'es-AR',
  en: 'en-US',
  pt: 'pt-BR',
  fr: 'fr-FR',
  zh: 'zh-CN',
}

/** ¿Esa cadena es uno de los idiomas que sabemos mostrar? */
export function esIdioma(valor: string | undefined): valor is Idioma {
  return typeof valor === 'string' && (IDIOMAS as readonly string[]).includes(valor)
}

/**
 * Elige el idioma a partir de la cabecera `Accept-Language` del navegador.
 *
 * ── Por qué se implementa a mano ────────────────────────────────────────────
 *
 * El algoritmo completo de negociación (RFC 4647) contempla comodines y
 * subetiquetas que acá no aportan: los idiomas son cinco y ninguno se confunde
 * con otro. Alcanza con ordenar por el factor de calidad `q` y quedarse con el
 * primero que coincida por prefijo, que es lo que hace que `pt-BR` resuelva a
 * `pt` y `zh-Hant` a `zh`.
 *
 * Si no coincide ninguno devuelve el idioma por omisión: es preferible mostrar
 * español a un francés —que al menos ve un hotel real y puede cambiar de idioma
 * con el selector— que devolverle un error.
 */
export function idiomaPreferido(cabecera: string | null | undefined): Idioma {
  if (!cabecera) return IDIOMA_POR_OMISION

  const pedidos = cabecera
    .split(',')
    .map((parte) => {
      const [etiqueta, ...parametros] = parte.trim().split(';')
      const q = parametros
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2)
      const calidad = q === undefined ? 1 : Number.parseFloat(q)
      return {
        etiqueta: etiqueta.trim().toLowerCase(),
        // Un `q` ilegible se trata como 0: el navegador mandó algo raro y no
        // tiene por qué ganarle a una preferencia bien declarada.
        calidad: Number.isFinite(calidad) ? calidad : 0,
      }
    })
    // `q=0` significa «este NO», así que se descarta en vez de ordenarse último.
    .filter((p) => p.calidad > 0)
    .sort((a, b) => b.calidad - a.calidad)

  for (const { etiqueta } of pedidos) {
    const base = etiqueta.split('-')[0]
    if (esIdioma(base)) return base
  }

  return IDIOMA_POR_OMISION
}

/**
 * Reemplaza el idioma en una ruta ya localizada: `/en/alojamientos` + `pt` →
 * `/pt/alojamientos`. Lo usa el selector de idioma para quedarse en la misma
 * pantalla en vez de mandar a la portada, que obligaría a volver a navegar.
 */
export function rutaConIdioma(ruta: string, idioma: Idioma): string {
  const partes = ruta.split('/').filter(Boolean)
  if (esIdioma(partes[0])) partes[0] = idioma
  else partes.unshift(idioma)
  return `/${partes.join('/')}`
}

/**
 * A dónde lleva elegir otro idioma desde la pantalla actual.
 *
 * Las rutas del portal llevan el idioma como prefijo (`/es/reservar` →
 * `/en/reservar`). Las pantallas con token (`/reservar/confirmacion/<token>`,
 * `/reservar/pagar/<token>`) no pueden: sus direcciones ya viajaron en correos
 * y tienen que seguir funcionando, así que llevan el idioma como consulta
 * (`?idioma=en`). Ponerles un prefijo daba un 404.
 *
 * `consulta` es el `search` actual sin el `?`; se conserva todo lo demás.
 */
export function destinoDeIdioma(ruta: string, consulta: string, idioma: Idioma): string {
  const primero = ruta.split('/').filter(Boolean)[0]
  if (esIdioma(primero)) return `${rutaConIdioma(ruta, idioma)}${consulta ? `?${consulta}` : ''}`
  const parametros = new URLSearchParams(consulta)
  parametros.set('idioma', idioma)
  return `${ruta}?${parametros.toString()}`
}

/**
 * Fecha corta de un día (`YYYY-MM-DD`) en el idioma del visitante: «3 sep»,
 * «Sep 3», «3 set.», «3 sept.», «9月3日».
 *
 * Se formatea con `timeZone: 'UTC'` sobre la medianoche UTC de ese día. No es
 * un instante sino un día del calendario: con la zona del proceso (o la del
 * navegador del huésped, en Madrid o en Shanghái) el mismo `2026-09-03` podría
 * salir como el 2 o el 4. Es el mismo cuidado que `formatoFechaCorta`.
 */
export function fechaCortaEn(iso: string, idioma: Idioma): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return new Intl.DateTimeFormat(ETIQUETA_BCP47[idioma], {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

/**
 * El idioma de la página desde la que se hizo clic, si es del mismo sitio.
 *
 * Existe para que un enlace sin prefijo (`/reservar`, un correo viejo, un
 * enlace del panel) no le cambie el idioma a quien ya lo eligió: sin esto, un
 * huésped que pasó a inglés con el selector volvía al idioma de su navegador
 * en el primer clic. Se exige el mismo origen para que un sitio ajeno no
 * pueda decidir en qué idioma se ve el nuestro.
 */
export function idiomaDeReferencia(
  referencia: string | null | undefined,
  origen: string,
): Idioma | null {
  if (!referencia) return null
  try {
    const url = new URL(referencia)
    if (url.origin !== origen) return null
    const primero = url.pathname.split('/')[1]
    return esIdioma(primero) ? primero : null
  } catch {
    return null
  }
}

/** «jue, 5 nov 2026» en el idioma del visitante. Mismo cuidado de zona que `fechaCortaEn`. */
export function fechaLargaEn(iso: string, idioma: Idioma): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return new Intl.DateTimeFormat(ETIQUETA_BCP47[idioma], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}
