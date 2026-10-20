/**
 * Lector del export de **reseñas** del extranet.
 *
 * ── Por qué es un lector aparte y no una rama del de reservas ───────────────
 *
 * Los dos leen un CSV del mismo extranet, pero no tienen nada más en común: distintas
 * columnas, distintos campos obligatorios, distinto destino y distinta clave de
 * idempotencia. Meterlos en la misma función habría exigido un `if` por cada
 * diferencia.
 *
 * Lo que **sí** se reutiliza es la parte difícil, que ya está resuelta y probada en
 * `csv.ts`: detectar el delimitador, partir respetando RFC 4180, normalizar
 * encabezados, interpretar fechas ambiguas, y la guarda de columnas prohibidas.
 *
 * ⚠️ Este export **no** trae datos de tarjeta, pero pasa por `esColumnaProhibida`
 * igual: el contrato heredado de WinPAX vale para todos los caminos de importación, no
 * solo para el que se sospecha.
 */

import {
  esColumnaProhibida,
  interpretarFecha,
  normalizarEncabezado,
  partirCsv,
} from './csv'
import { huellaResena } from '@/lib/domain/resenas-canal'

/** Campos que el lector de reseñas busca. */
export type CampoResena =
  | 'externalId'
  | 'reservaExternalId'
  | 'autor'
  | 'pais'
  | 'puntaje'
  | 'titulo'
  | 'positivo'
  | 'negativo'
  | 'publicadaEn'
  | 'respuesta'

export const CAMPOS_RESENA: readonly CampoResena[] = [
  'externalId',
  'reservaExternalId',
  'autor',
  'pais',
  'puntaje',
  'titulo',
  'positivo',
  'negativo',
  'publicadaEn',
  'respuesta',
]

export const ETIQUETAS_CAMPO_RESENA: Record<CampoResena, string> = {
  externalId: 'Número de la reseña',
  reservaExternalId: 'Número de reserva',
  autor: 'Quién la escribió',
  pais: 'País',
  puntaje: 'Puntaje (0 a 10)',
  titulo: 'Título',
  positivo: 'Lo positivo',
  negativo: 'Lo negativo',
  publicadaEn: 'Fecha de publicación',
  respuesta: 'Respuesta del hotel',
}

/**
 * Lo mínimo para que una reseña sirva.
 *
 * Solo dos: quién y qué dijo. El puntaje sin texto es un número sin contexto, y el
 * texto sin autor no se puede ligar a nadie — pero exigir el puntaje dejaría afuera las
 * reseñas que Booking publica solo con comentario.
 */
export const CAMPOS_OBLIGATORIOS_RESENA: readonly CampoResena[] = ['autor']

const ALIAS_RESENA: Record<CampoResena, readonly string[]> = {
  externalId: ['id de la resena', 'numero de resena', 'review id', 'id'],
  reservaExternalId: [
    'numero de reserva',
    'n de reserva',
    'id de reserva',
    'book number',
    'reservation number',
    'booking number',
  ],
  autor: ['autor', 'huesped', 'cliente', 'nombre del cliente', 'guest name', 'reviewer', 'guest'],
  pais: ['pais', 'country'],
  puntaje: ['puntaje', 'puntuacion', 'nota', 'calificacion', 'score', 'rating'],
  titulo: ['titulo', 'title', 'headline'],
  positivo: ['positivo', 'lo positivo', 'lo bueno', 'positive', 'liked', 'pros'],
  negativo: ['negativo', 'lo negativo', 'lo malo', 'negative', 'disliked', 'cons'],
  publicadaEn: [
    'fecha de la resena',
    'fecha de publicacion',
    'publicada el',
    'fecha',
    'review date',
    'date',
  ],
  respuesta: ['respuesta', 'respuesta del hotel', 'reply', 'response'],
}

/** Ubica cada campo, respetando un mapeo guardado si hay. */
export function mapearColumnasResena(
  encabezados: readonly string[],
  guardado: Record<string, string> | null = null,
): Record<CampoResena, number | null> {
  // Las prohibidas se blanquean sin sacarlas de la lista: sacarlas correría los
  // índices de todas las columnas posteriores, en silencio.
  const norm = encabezados.map((h) => (esColumnaProhibida(h) ? '' : normalizarEncabezado(h)))
  const mapa = {} as Record<CampoResena, number | null>

  for (const campo of CAMPOS_RESENA) {
    mapa[campo] = null
    for (const alias of ALIAS_RESENA[campo]) {
      const exacto = norm.indexOf(alias)
      if (exacto !== -1) {
        mapa[campo] = exacto
        break
      }
    }
    if (mapa[campo] !== null) continue

    // Coincidencia parcial solo con alias de 5+ caracteres, igual que el lector de
    // reservas: con menos, `id` o `date` matchearían cualquier cosa.
    for (const alias of ALIAS_RESENA[campo]) {
      if (alias.length < 5) continue
      const parcial = norm.findIndex((h) => h.includes(alias))
      if (parcial !== -1) {
        mapa[campo] = parcial
        break
      }
    }
  }

  // El mapeo de una persona gana sobre la heurística.
  if (guardado) {
    for (const [campo, encabezado] of Object.entries(guardado)) {
      if (!CAMPOS_RESENA.includes(campo as CampoResena)) continue
      const idx = norm.indexOf(normalizarEncabezado(encabezado))
      if (idx !== -1) mapa[campo as CampoResena] = idx
    }
  }

  return mapa
}

export interface ResenaEntrante {
  externalId: string | null
  reservaExternalId: string | null
  autor: string
  pais: string | null
  puntaje: number | null
  titulo: string
  positivo: string
  negativo: string
  publicadaEn: string | null
  respuesta: string
  huella: string
}

export interface ResultadoResenas {
  resenas: ResenaEntrante[]
  rechazadas: { fila: number; motivos: string[] }[]
  faltantes: CampoResena[]
  encabezados: string[]
  leidas: number
}

/**
 * Interpreta el puntaje de Booking, que va de 0 a 10.
 *
 * Devuelve `null` si no se puede leer o queda fuera de rango, **no 0**: un cero es un
 * puntaje real y pésimo, y confundirlo con «no informó» arruinaría el promedio.
 */
export function interpretarPuntaje(valor: string): number | null {
  const limpio = valor.trim().replace(',', '.')
  if (!limpio) return null
  const n = Number(limpio)
  if (!Number.isFinite(n) || n < 0 || n > 10) return null
  return Math.round(n * 10) / 10
}

/** Lee el export completo de reseñas. */
export function interpretarCsvResenas(
  texto: string,
  mapeoGuardado: Record<string, string> | null = null,
): ResultadoResenas {
  const vacio: ResultadoResenas = {
    resenas: [],
    rechazadas: [],
    faltantes: [],
    encabezados: [],
    leidas: 0,
  }

  const filas = partirCsv(texto)
  if (filas.length < 2) return { ...vacio, faltantes: [...CAMPOS_OBLIGATORIOS_RESENA] }

  const encabezados = filas[0].map((h) => (esColumnaProhibida(h) ? '' : h))
  const mapa = mapearColumnasResena(filas[0], mapeoGuardado)

  const faltantes = CAMPOS_OBLIGATORIOS_RESENA.filter((c) => mapa[c] === null)
  if (faltantes.length > 0) return { ...vacio, encabezados, faltantes }

  const celda = (fila: string[], campo: CampoResena): string => {
    const i = mapa[campo]
    return i === null ? '' : (fila[i] ?? '').trim()
  }

  const resenas: ResenaEntrante[] = []
  const rechazadas: { fila: number; motivos: string[] }[] = []

  for (let n = 1; n < filas.length; n++) {
    const f = filas[n]
    const autor = celda(f, 'autor')

    if (!autor) {
      // +1 porque para quien abre el archivo en Excel la primera fila es la 1.
      rechazadas.push({ fila: n + 1, motivos: ['No dice quién escribió la reseña.'] })
      continue
    }

    const positivo = celda(f, 'positivo')
    const negativo = celda(f, 'negativo')
    const puntaje = interpretarPuntaje(celda(f, 'puntaje'))

    // Una fila sin texto y sin puntaje no aporta nada: es una fila vacía con nombre.
    if (!positivo && !negativo && puntaje === null) {
      rechazadas.push({
        fila: n + 1,
        motivos: ['No trae ni puntaje ni comentario: no hay reseña que guardar.'],
      })
      continue
    }

    const publicadaEn = interpretarFecha(celda(f, 'publicadaEn'))?.iso ?? null

    resenas.push({
      externalId: celda(f, 'externalId') || null,
      reservaExternalId: celda(f, 'reservaExternalId') || null,
      autor,
      pais: celda(f, 'pais') || null,
      puntaje,
      titulo: celda(f, 'titulo'),
      positivo,
      negativo,
      publicadaEn,
      respuesta: celda(f, 'respuesta'),
      huella: huellaResena({ autor, publicadaEn, positivo, negativo }),
    })
  }

  return { resenas, rechazadas, faltantes: [], encabezados, leidas: filas.length - 1 }
}
