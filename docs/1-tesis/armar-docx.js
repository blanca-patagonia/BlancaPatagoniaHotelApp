#!/usr/bin/env node
/**
 * Arma el documento Word de la tesis a partir de los capítulos en Markdown.
 *
 *   node docs/1-tesis/armar-docx.js <salida.docx> [paginas.json] [--marcas]
 *
 * - `paginas.json` trae la página de cada título y de cada figura; con él se escriben los
 *   índices ya completos. Sin él, los índices salen con «0» (primera pasada).
 * - `--marcas` agrega a cada título y epígrafe una marca invisible que permite ubicar su
 *   página en el PDF de la primera pasada. La orquestación está en `armar-docx.sh`.
 *
 * Formato exigido por la cátedra: A4, márgenes de 2,5 cm, Arial 11, interlineado 1,3, texto
 * justificado con partición de palabras, carátula, índice general, índice de figuras,
 * membrete, número de página y epígrafe en toda figura.
 */
const fs = require('fs')
const path = require('path')
const D = require('docx')

const AQUI = __dirname
const [, , SALIDA, ...resto] = process.argv
const MARCAS = resto.includes('--marcas')
const archivoPaginas = resto.find((a) => a.endsWith('.json'))
const PAGINAS = archivoPaginas ? JSON.parse(fs.readFileSync(archivoPaginas, 'utf8')) : {}
const DIR_IMG = process.env.TESIS_IMG || AQUI // carpeta con las figuras (reducidas para el Word)

const AZUL = '1F4E79'
const GRIS = '595959'
const ANCHO = 9070 // ancho útil en DXA: A4 (11906) menos dos márgenes de 2,5 cm (1418)
const CM = 567 // 1 cm en DXA
const FUENTE = 'Arial'

// ───────────────────────── utilidades ─────────────────────────

/** Ancho y alto en píxeles de un PNG o JPEG, leídos de su encabezado. */
function medidas(buf) {
  if (buf[0] === 0x89) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  let i = 2
  while (i < buf.length) {
    const marca = buf[i + 1]
    const largo = buf.readUInt16BE(i + 2)
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + largo
  }
  throw new Error('No se pudo medir la imagen')
}

function imagen(rel, maxAnchoCm, maxAltoCm) {
  const archivo = fs.existsSync(path.join(DIR_IMG, rel)) ? path.join(DIR_IMG, rel) : path.join(AQUI, rel)
  const data = fs.readFileSync(archivo)
  const { w, h } = medidas(data)
  const pxPorCm = 96 / 2.54
  let ancho = maxAnchoCm * pxPorCm
  let alto = (ancho * h) / w
  if (alto > maxAltoCm * pxPorCm) {
    alto = maxAltoCm * pxPorCm
    ancho = (alto * w) / h
  }
  // Una imagen chica no se estira más allá de su tamaño natural a 150 ppp.
  const natural = (w / 150) * 2.54 * pxPorCm
  if (ancho > natural && natural > 3 * pxPorCm) {
    ancho = natural
    alto = (ancho * h) / w
  }
  return new D.ImageRun({
    type: archivo.endsWith('.png') ? 'png' : 'jpg',
    data,
    transformation: { width: Math.round(ancho), height: Math.round(alto) },
  })
}

/** Texto con **negrita**, *cursiva* y `código` → corridas de Word. */
function corridas(texto, base = {}) {
  const partes = []
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g
  let ultimo = 0
  const empujar = (t, extra = {}) => {
    if (!t) return
    const trozos = t.split('\\\n')
    trozos.forEach((trozo, i) => {
      partes.push(new D.TextRun({ text: trozo, ...base, ...extra, ...(i > 0 ? { break: 1 } : {}) }))
    })
  }
  for (const m of texto.matchAll(re)) {
    empujar(texto.slice(ultimo, m.index))
    const t = m[0]
    if (t.startsWith('**')) empujar(t.slice(2, -2), { bold: true })
    else if (t.startsWith('`')) empujar(t.slice(1, -1), { font: 'Consolas', size: (base.size || 22) - 1 })
    else empujar(t.slice(1, -1), { italics: true })
    ultimo = m.index + t.length
  }
  empujar(texto.slice(ultimo))
  return partes
}

const marca = (clave) =>
  MARCAS ? [new D.TextRun({ text: `⟦${clave}⟧`, size: 2, color: 'FFFFFF' })] : []

// ───────────────────────── lectura del Markdown ─────────────────────────

const titulos = [] // { nivel, texto, clave }
const figuras = [] // { numero, texto, clave }
let instanciaLista = 0

function parrafo(texto, opciones = {}) {
  return new D.Paragraph({ children: corridas(texto), ...opciones })
}

function tabla(filas) {
  const celdas = filas.map((f) =>
    f
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim()),
  )
  const cabecera = celdas[0]
  const cuerpo = celdas.slice(2)
  const n = cabecera.length
  const sinCabecera = cabecera.every((c) => c === '')
  // Anchos proporcionales al contenido, con un piso para que ninguna columna quede ilegible.
  const pesos = Array.from({ length: n }, (_, i) =>
    Math.min(60, Math.max(8, ...celdas.filter((_, k) => k !== 1).map((f) => (f[i] || '').replace(/[*`]/g, '').length))),
  )
  const raices = pesos.map((p) => Math.sqrt(p))
  const total = raices.reduce((a, b) => a + b, 0)
  const anchos = raices.map((r) => Math.floor((r / total) * ANCHO))
  anchos[n - 1] += ANCHO - anchos.reduce((a, b) => a + b, 0)
  const borde = { style: D.BorderStyle.SINGLE, size: 4, color: 'A6B8CC' }
  const celda = (texto, i, encabezado, primera) =>
    new D.TableCell({
      width: { size: anchos[i], type: D.WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      borders: { top: borde, bottom: borde, left: borde, right: borde },
      shading: encabezado
        ? { type: D.ShadingType.CLEAR, fill: 'D6E6F5', color: 'auto' }
        : sinCabecera && primera
          ? { type: D.ShadingType.CLEAR, fill: 'EEF4FA', color: 'auto' }
          : undefined,
      children: [
        new D.Paragraph({
          alignment: D.AlignmentType.LEFT,
          spacing: { after: 0, line: 264 },
          children: corridas(texto || '', { size: 19, bold: encabezado || undefined }),
        }),
      ],
    })
  const filasTabla = []
  if (!sinCabecera) {
    filasTabla.push(
      new D.TableRow({ tableHeader: true, cantSplit: true, children: cabecera.map((c, i) => celda(c, i, true)) }),
    )
  }
  for (const f of cuerpo) {
    filasTabla.push(
      new D.TableRow({ cantSplit: true, children: Array.from({ length: n }, (_, i) => celda(f[i], i, false, i === 0)) }),
    )
  }
  return [
    new D.Table({ width: { size: ANCHO, type: D.WidthType.DXA }, columnWidths: anchos, rows: filasTabla }),
    new D.Paragraph({ spacing: { after: 120 }, children: [] }),
  ]
}

function bloqueDeFirmas() {
  const sinBorde = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const bordes = { top: sinBorde, bottom: sinBorde, left: sinBorde, right: sinBorde }
  const linea = (texto, extra) =>
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { after: 0 },
      border: extra ? { top: { style: D.BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } } : undefined,
      children: corridas(texto, { size: 20 }),
    })
  const vacio = (alto) => new D.Paragraph({ spacing: { before: alto, after: 0 }, children: [] })
  const mitad = Math.floor(ANCHO / 2)
  const columna = (hijos) =>
    new D.TableCell({
      width: { size: mitad, type: D.WidthType.DXA },
      borders: bordes,
      margins: { left: 400, right: 400 },
      verticalAlign: D.VerticalAlign.BOTTOM,
      children: hijos,
    })
  return [
    new D.Table({
      width: { size: mitad * 2, type: D.WidthType.DXA },
      columnWidths: [mitad, mitad],
      rows: [
        new D.TableRow({
          cantSplit: true,
          children: [
            columna([
              new D.Paragraph({
                alignment: D.AlignmentType.CENTER,
                spacing: { after: 0, line: 240, lineRule: D.LineRuleType.AUTO },
                children: [imagen('figuras/anexos/firma-comitente-recorte.png', 4.6, 3.6)],
              }),
              linea('**Franco Theo Cheli**', true),
              linea('Director — Blanca Patagonia S.A.S.'),
              linea('Comitente'),
            ]),
            columna([
              vacio(1100),
              linea('**Morán Santiago** — DNI 45.693.596', true),
              vacio(900),
              linea('**Fakiani Octavio** — DNI 44.970.369', true),
              linea('Equipo de proyecto'),
            ]),
          ],
        }),
      ],
    }),
    new D.Paragraph({ spacing: { after: 200 }, children: [] }),
  ]
}

/** Convierte un texto Markdown (subconjunto propio) en bloques de Word. */
function convertir(md, { desplazar = 0, conNotas = false } = {}) {
  const lineas = md.replace(/<!--[\s\S]*?-->/g, (c) => (c.includes('bloque de firmas') ? '@@FIRMAS@@' : '')).split('\n')
  const salida = []
  let i = 0
  const vacia = (l) => l.trim() === ''
  while (i < lineas.length) {
    const l = lineas[i]
    if (vacia(l)) { i++; continue }
    if (l.trim() === '@@FIRMAS@@') { salida.push(...bloqueDeFirmas()); i++; continue }

    if (l.startsWith('>')) {
      const cita = []
      while (i < lineas.length && lineas[i].startsWith('>')) cita.push(lineas[i++].replace(/^>\s?/, ''))
      if (conNotas) {
        salida.push(
          new D.Paragraph({
            shading: { type: D.ShadingType.CLEAR, fill: 'FFF4D6', color: 'auto' },
            children: corridas(cita.join(' '), { italics: true }),
          }),
        )
      }
      continue
    }

    if (l.startsWith('```')) {
      i++
      const codigo = []
      while (i < lineas.length && !lineas[i].startsWith('```')) codigo.push(lineas[i++])
      i++
      codigo.forEach((c, k) =>
        salida.push(
          new D.Paragraph({
            alignment: D.AlignmentType.LEFT,
            keepLines: true,
            keepNext: k < codigo.length - 1,
            spacing: { after: k === codigo.length - 1 ? 160 : 0, line: 252 },
            indent: { left: 200 },
            shading: { type: D.ShadingType.CLEAR, fill: 'F2F4F7', color: 'auto' },
            children: [new D.TextRun({ text: c.replace(/ /g, ' ') || ' ', font: 'Consolas', size: 17 })],
          }),
        ),
      )
      continue
    }

    const t = /^(#{1,4})\s+(.*)$/.exec(l)
    if (t) {
      const nivel = Math.min(4, t[1].length + desplazar)
      const texto = t[2].trim()
      const clave = `h${titulos.length}`
      const esParte = nivel === 1 && /^PARTE /.test(texto)
      if (nivel <= 3) titulos.push({ nivel, texto: texto.replace(/[*`]/g, ''), clave, esParte })
      salida.push(
        new D.Paragraph({
          heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4][nivel - 1],
          pageBreakBefore: nivel === 1,
          alignment: esParte ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
          spacing: esParte ? { before: 4200, after: 400 } : undefined,
          children: [...corridas(texto, esParte ? { size: 44 } : {}), ...(nivel <= 3 ? marca(clave) : [])],
        }),
      )
      i++
      continue
    }

    const img = /^!\[[^\]]*\]\(([^)]+)\)\s*$/.exec(l)
    if (img) {
      salida.push(
        new D.Paragraph({
          alignment: D.AlignmentType.CENTER,
          keepNext: true,
          spacing: { before: 160, after: 80, line: 240, lineRule: D.LineRuleType.AUTO },
          children: [imagen(img[1], 16, 19)],
        }),
      )
      i++
      continue
    }

    const ep = /^\*\*Figura (\d+)\.\*\*\s*(.*)$/.exec(l)
    if (ep) {
      const numero = Number(ep[1])
      const clave = `f${numero}`
      let texto = ep[2]
      i++
      while (i < lineas.length && !vacia(lineas[i])) texto += ' ' + lineas[i++].trim()
      figuras.push({ numero, texto, clave })
      salida.push(
        new D.Paragraph({
          style: 'Caption',
          alignment: D.AlignmentType.CENTER,
          children: [
            new D.TextRun({ text: 'Figura ', bold: true }),
            new D.SimpleField('SEQ Figura \\* ARABIC', String(numero)),
            new D.TextRun({ text: '. ', bold: true }),
            ...corridas(texto, { size: 18, italics: true }),
            ...marca(clave),
          ],
        }),
      )
      continue
    }

    if (l.startsWith('|')) {
      const filas = []
      while (i < lineas.length && lineas[i].startsWith('|')) filas.push(lineas[i++])
      salida.push(...tabla(filas))
      continue
    }

    const item = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(l)
    if (item) {
      const numerada = /\d/.test(item[2])
      instanciaLista++
      while (i < lineas.length) {
        const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(lineas[i])
        if (!m) break
        let texto = m[3]
        i++
        while (i < lineas.length && /^\s{2,}\S/.test(lineas[i]) && !/^\s*(-|\d+\.)\s/.test(lineas[i])) texto += ' ' + lineas[i++].trim()
        salida.push(
          new D.Paragraph({
            numbering: { reference: numerada ? 'numeros' : 'vinetas', level: 0, instance: instanciaLista },
            spacing: { after: 60 },
            children: corridas(texto),
          }),
        )
        while (i < lineas.length && vacia(lineas[i]) && /^(-|\d+\.)\s/.test(lineas[i + 1] || '')) i++
      }
      salida.push(new D.Paragraph({ spacing: { after: 60 }, children: [] }))
      continue
    }

    // Párrafo: líneas seguidas hasta una línea vacía. Una barra invertida al final corta la línea.
    const partes = []
    while (i < lineas.length && !vacia(lineas[i]) && !/^(#{1,4}\s|\||```|!\[|>)/.test(lineas[i])) partes.push(lineas[i++].trim())
    const texto = partes.join(' ').replace(/\\ /g, '\\\n')
    const soloNegrita = /^\*\*[^*]+\*\*:?$/.test(texto)
    const conCortes = texto.includes('\\\n')
    salida.push(parrafo(texto, soloNegrita ? { keepNext: true, alignment: D.AlignmentType.LEFT } : conCortes ? { alignment: D.AlignmentType.LEFT } : {}))
  }
  return salida
}

// ───────────────────────── contenido ─────────────────────────

const leer = (n) => fs.readFileSync(path.join(AQUI, n), 'utf8')
const p1 = leer('parte-1-relevamiento.md')
const corteAnexos = p1.indexOf('\n# 4. Anexos')
const p1Cuerpo = p1.slice(0, corteAnexos)
const p1Final = p1.slice(corteAnexos).replace('# 4. Anexos', '# Anexos').replace('# 5. Glosario', '# Glosario')
const p2 = leer('parte-2-analisis-y-diseno.md').replace(/ Se incluye a continuación \(`diccionario-de-datos\.md`\)\./, '')
const dic = leer('diccionario-de-datos.md')
  .split('\n')
  .slice(1)
  .filter((l) => !l.startsWith('Generado del esquema'))
  .join('\n')
  .replace(/^## Otras tablas del sistema/m, '#### Otras tablas del sistema')
  .replace(/^## (\S+)$/gm, '#### Tabla `$1`')
const p3 = leer('parte-3-implementacion-y-especificaciones.md')
const corteAgr = p3.indexOf('\n# Agradecimientos')
const agradecimientos = p3.slice(corteAgr)
const p3Cuerpo = p3.slice(0, corteAgr)

const bloquesAgr = convertir(agradecimientos, { conNotas: true })

const cuerpo = [
  ...convertir(p1Cuerpo),
  ...convertir(p2),
  ...convertir(dic),
  ...convertir(p3Cuerpo),
  ...convertir(p1Final),
]

// Las figuras tienen que estar numeradas de corrido: es lo que Word va a mostrar al actualizar.
figuras.forEach((f, k) => {
  if (f.numero !== k + 1) throw new Error(`Figura fuera de orden: se esperaba ${k + 1} y vino ${f.numero} («${f.texto.slice(0, 40)}»)`)
})

// ───────────────────────── índices (se completan después, en el XML) ─────────────────────────

const indices = [
  new D.Paragraph({ style: 'TituloSinNumero', pageBreakBefore: true, children: [new D.TextRun('Índice general')] }),
  new D.Paragraph({ children: [new D.TextRun('@@TOC@@')] }),
  new D.Paragraph({ style: 'TituloSinNumero', pageBreakBefore: true, children: [new D.TextRun('Índice de figuras')] }),
  new D.Paragraph({ children: [new D.TextRun('@@TOF@@')] }),
]
fs.writeFileSync(
  SALIDA.replace(/\.docx$/, '.indices.json'),
  JSON.stringify({
    titulos: titulos.map((t) => ({ ...t, pagina: PAGINAS[t.clave] ?? 0 })),
    figuras: figuras.map((f) => ({ ...f, texto: f.texto.replace(/[*`]/g, ''), pagina: PAGINAS[f.clave] ?? 0 })),
  }),
)

// ───────────────────────── carátula ─────────────────────────

const centro = (hijos, extra = {}) => new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: hijos, ...extra })
const caratula = [
  centro([imagen('figuras/anexos/logo-ies.png', 3.4, 3)], { spacing: { before: 600, after: 160, line: 240, lineRule: D.LineRuleType.AUTO } }),
  centro([new D.TextRun({ text: 'Colegio Universitario IES Siglo 21', size: 28, bold: true, color: AZUL })], { spacing: { after: 60 } }),
  centro([new D.TextRun({ text: 'Carrera: Analista de Sistemas', size: 24, color: GRIS })], { spacing: { after: 1300 } }),
  centro([new D.TextRun({ text: 'PROYECTO DE TESIS', size: 24, color: GRIS, characterSpacing: 60 })], { spacing: { after: 240 } }),
  centro([new D.TextRun({ text: 'Sistema de Gestión de Hotelería', size: 60, bold: true, color: AZUL })], {
    spacing: { after: 160 },
    border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: AZUL, space: 10 } },
  }),
  centro([new D.TextRun({ text: 'Hotel Blanca Patagonia', size: 40, color: '262626' })], { spacing: { before: 240, after: 80 } }),
  centro([new D.TextRun({ text: 'El Calafate, Santa Cruz', size: 24, color: GRIS })], { spacing: { after: 1700 } }),
  centro([new D.TextRun({ text: 'Integrantes', size: 22, color: GRIS, characterSpacing: 40 })], { spacing: { after: 100 } }),
  centro([new D.TextRun({ text: 'Morán, Santiago — DNI 45.693.596', size: 26 })], { spacing: { after: 60 } }),
  centro([new D.TextRun({ text: 'Fakiani, Octavio — DNI 44.970.369', size: 26 })], { spacing: { after: 1000 } }),
  centro([new D.TextRun({ text: '2026', size: 32, bold: true, color: AZUL })]),
]

// ───────────────────────── documento ─────────────────────────

const titulo = (size, before, after) => ({
  run: { font: FUENTE, size, bold: true, color: AZUL },
  paragraph: { spacing: { before, after }, keepNext: true, keepLines: true, alignment: D.AlignmentType.LEFT },
})
const estiloIndice = (id, nombre, izquierda, extra = {}) => ({
  id,
  name: nombre,
  basedOn: 'Normal',
  next: 'Normal',
  run: { font: FUENTE, size: 20, ...extra },
  paragraph: {
    alignment: D.AlignmentType.LEFT,
    spacing: { after: 40, line: 276 },
    indent: { left: izquierda },
    tabStops: [{ type: D.TabStopType.RIGHT, position: ANCHO, leader: D.LeaderType.DOT }],
  },
})

const margen = { top: Math.round(2.5 * CM), bottom: Math.round(2.5 * CM), left: Math.round(2.5 * CM), right: Math.round(2.5 * CM), header: 480, footer: 480 }
const membrete = new D.Header({
  children: [
    new D.Paragraph({
      alignment: D.AlignmentType.LEFT,
      spacing: { after: 0, line: 240, lineRule: D.LineRuleType.AUTO },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: AZUL, space: 4 } },
      tabStops: [{ type: D.TabStopType.RIGHT, position: ANCHO }],
      children: [
        imagen('figuras/anexos/logo-ies.png', 1.25, 1),
        new D.TextRun({ text: '\tSistema de Gestión de Hotelería — Hotel Blanca Patagonia', size: 17, color: GRIS }),
      ],
    }),
  ],
})
const pie = new D.Footer({
  children: [
    new D.Paragraph({
      alignment: D.AlignmentType.LEFT,
      spacing: { after: 0 },
      border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: 'A6B8CC', space: 4 } },
      tabStops: [{ type: D.TabStopType.RIGHT, position: ANCHO }],
      children: [
        new D.TextRun({ text: 'Morán · Fakiani — Analista de Sistemas, IES Siglo 21', size: 17, color: GRIS }),
        new D.TextRun({ text: '\tPágina ', size: 17, color: GRIS }),
        new D.TextRun({ children: [D.PageNumber.CURRENT], size: 17, color: GRIS }),
        new D.TextRun({ text: ' de ', size: 17, color: GRIS }),
        new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], size: 17, color: GRIS }),
      ],
    }),
  ],
})

const doc = new D.Document({
  creator: 'Santiago Morán y Octavio Fakiani',
  title: 'Sistema de Gestión de Hotelería — Hotel Blanca Patagonia',
  description: 'Tesis de Analista de Sistemas — Colegio Universitario IES Siglo 21',
  styles: {
    default: {
      document: {
        run: { font: FUENTE, size: 22, language: { value: 'es-AR' } },
        paragraph: { spacing: { line: 312, lineRule: D.LineRuleType.AUTO, after: 140 }, alignment: D.AlignmentType.JUSTIFIED },
      },
      heading1: titulo(34, 0, 280),
      heading2: titulo(27, 320, 160),
      heading3: titulo(24, 260, 120),
      heading4: titulo(22, 220, 100),
    },
    paragraphStyles: [
      { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', run: { font: FUENTE, size: 18, color: '404040' }, paragraph: { alignment: D.AlignmentType.CENTER, spacing: { after: 240, line: 252 } } },
      { id: 'TituloSinNumero', name: 'Título de índice', basedOn: 'Normal', next: 'Normal', run: { font: FUENTE, size: 34, bold: true, color: AZUL }, paragraph: { alignment: D.AlignmentType.LEFT, spacing: { after: 280 } } },
      estiloIndice('TOC1', 'toc 1', 0, { bold: true }),
      estiloIndice('TOC2', 'toc 2', 280),
      estiloIndice('TOC3', 'toc 3', 560, { size: 19 }),
      estiloIndice('TableofFigures', 'table of figures', 0),
    ],
  },
  numbering: {
    config: [
      { reference: 'vinetas', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } }] },
      { reference: 'numeros', levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 320 } } } }] },
    ],
  },
  features: { updateFields: false },
  sections: [
    { properties: { page: { margin: margen } }, children: caratula },
    {
      properties: { page: { margin: margen } },
      headers: { default: membrete },
      footers: { default: pie },
      children: [...bloquesAgr, ...indices, ...cuerpo],
    },
  ],
})

D.Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(SALIDA, buf)
  console.log(`${path.basename(SALIDA)}: ${titulos.length} títulos, ${figuras.length} figuras, ${(buf.length / 1e6).toFixed(1)} MB`)
})
