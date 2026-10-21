/**
 * La respuesta del asistente, partida en párrafos, listas, negritas y enlaces
 * internos del panel. Devuelve DATOS, no HTML: el chat los arma con React.
 */

export interface Segmento {
  texto: string
  negrita: boolean
  /** Ruta interna del panel, si el segmento es un enlace (`/panel/reservas`). */
  enlace?: string
}

/**
 * Sólo rutas internas del panel se vuelven enlaces. Una URL externa que el
 * modelo escriba queda como texto: un enlace que sale del sistema, sugerido por
 * una IA, es la forma más simple de llevar a alguien a una página falsa.
 */
const RUTA_PANEL = /((?<![\w.:/-])\/panel(?:\/[a-z0-9-]+)*)/

export type BloqueRespuesta =
  | { tipo: 'parrafo'; segmentos: Segmento[] }
  | { tipo: 'lista'; items: Segmento[][] }

/**
 * `[texto](/panel/…)`: un enlace en Markdown, SÓLO con destino interno. Uno
 * externo (`[x](https://…)`) no coincide y queda como texto.
 */
const ENLACE_MARKDOWN = /\[([^\]]{1,80})\]\((\/panel(?:\/[a-z0-9-]+)*)\)/

/** Una ruta pelada a una ficha (`/panel/reservas/<uuid>`) se muestra con un texto legible. */
function textoDeEnlace(ruta: string): string {
  return /^\/panel\/reservas\/[0-9a-f-]{36}$/.test(ruta) ? 'abrir la reserva' : ruta
}

/** `[texto](/panel/…)` y `**así**` y `/panel/…`; el resto, texto tal cual. */
function segmentos(linea: string): Segmento[] {
  const partes = linea.split(new RegExp(ENLACE_MARKDOWN.source, 'g'))
  // `split` con dos grupos de captura intercala [texto, etiqueta, ruta, texto, …].
  const resultado: Segmento[] = []
  for (let i = 0; i < partes.length; i += 3) {
    if (partes[i]) resultado.push(...segmentosSinMarkdown(partes[i]))
    if (partes[i + 1] !== undefined) {
      resultado.push({ texto: partes[i + 1].replaceAll('**', ''), negrita: false, enlace: partes[i + 2] })
    }
  }
  return resultado
}

function segmentosSinMarkdown(linea: string): Segmento[] {
  return linea
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .flatMap((t): Segmento[] => {
      const negrita = t.startsWith('**') && t.endsWith('**')
      const cuerpo = negrita ? t.slice(2, -2) : t
      return cuerpo
        .split(RUTA_PANEL)
        .filter(Boolean)
        .map((parte) =>
          RUTA_PANEL.test(parte) && parte.match(RUTA_PANEL)?.[0] === parte
            ? { texto: textoDeEnlace(parte), negrita, enlace: parte }
            : { texto: parte, negrita },
        )
    })
}

/**
 * La respuesta del modelo, partida en párrafos y listas.
 *
 * Los modelos contestan en Markdown (`**negrita**`, viñetas con `*` o `-`), y
 * mostrado crudo el chat se llenaba de asteriscos. Esto reconoce sólo esas dos
 * cosas y devuelve DATOS, no HTML: la pantalla los arma con elementos de React,
 * que escapan el texto. Interpretar más Markdown (enlaces, HTML) abriría la
 * puerta a que una respuesta inyecte algo en la página.
 */
export function partirRespuesta(texto: string): BloqueRespuesta[] {
  const bloques: BloqueRespuesta[] = []
  for (const cruda of texto.split('\n')) {
    const linea = cruda.trim()
    if (!linea) continue
    const vineta = /^[-*•]\s+(.*)$/.exec(linea)
    if (vineta) {
      const ultimo = bloques.at(-1)
      if (ultimo?.tipo === 'lista') ultimo.items.push(segmentos(vineta[1]))
      else bloques.push({ tipo: 'lista', items: [segmentos(vineta[1])] })
    } else {
      bloques.push({ tipo: 'parrafo', segmentos: segmentos(linea.replace(/^#+\s*/, '')) })
    }
  }
  return bloques
}
