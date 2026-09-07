/**
 * Serialización a CSV para las exportaciones del panel.
 *
 * Se usa `;` como separador porque es lo que espera Excel en configuración
 * regional es-AR (con `,` interpretaría los decimales como columnas nuevas).
 */

export const SEPARADOR = ';'

/** Caracteres con los que Excel/Sheets interpretarían el campo como fórmula. */
const INICIO_FORMULA = ['=', '+', '-', '@', '\t', '\r']

/**
 * Un número negativo escrito entero: el `-`, dígitos, y nada más.
 *
 * ── Por qué hace falta la excepción ─────────────────────────────────────────
 *
 * El `-` está en `INICIO_FORMULA` porque `-2+3` es una fórmula. El problema es
 * que **todo importe negativo empieza igual**: un saldo a favor, una nota de
 * crédito, la diferencia contra la liquidación de un canal. Con el apóstrofo
 * delante, Excel deja de verlos como números y los muestra como texto, así que
 * la columna «Saldo» del archivo que se le manda al contador **suma mal**: los
 * positivos entran y los negativos, que son justamente los que corrigen, no.
 * Y el error es del tipo que no se ve —el total da un número, solo que otro—.
 *
 * El `-` es obligatorio, no opcional: un número positivo no empieza con ninguno
 * de los caracteres de `INICIO_FORMULA`, así que nunca llega hasta acá. La
 * condición es estricta a propósito y todo lo demás se sigue escapando: `-2+3`,
 * `-1e9`, `+50`, `=-5`, y un tabulador —que es la razón de no escribir esto con
 * `Number`, que convertiría `'\t'` en `0` y lo dejaría pasar como «número»—.
 */
const NUMERO_LLANO = /^-\d+(\.\d+)?$/

/**
 * Escapa un valor para que sea un campo CSV seguro.
 *
 * Además del entrecomillado estándar, neutraliza la **inyección de fórmulas**:
 * un huésped llamado `=1+1` no debe ejecutarse al abrir el archivo. Se antepone
 * un apóstrofo, que Excel muestra como texto plano.
 */
export function escaparCampo(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  let texto = String(valor)

  if (INICIO_FORMULA.some((c) => texto.startsWith(c)) && !NUMERO_LLANO.test(texto)) {
    texto = `'${texto}`
  }

  if (
    texto.includes(SEPARADOR) ||
    texto.includes('"') ||
    texto.includes('\n') ||
    texto.includes('\r')
  ) {
    return `"${texto.replaceAll('"', '""')}"`
  }
  return texto
}

export interface Columna<T> {
  titulo: string
  /** Cómo obtener el valor de la fila (permite formatear e ir a campos anidados). */
  valor: (fila: T) => unknown
}

/** Arma el contenido CSV completo (encabezado + filas). */
export function aCsv<T>(filas: readonly T[], columnas: readonly Columna<T>[]): string {
  const encabezado = columnas.map((c) => escaparCampo(c.titulo)).join(SEPARADOR)
  const cuerpo = filas.map((fila) =>
    columnas.map((c) => escaparCampo(c.valor(fila))).join(SEPARADOR),
  )
  return [encabezado, ...cuerpo].join('\r\n')
}

/**
 * Respuesta HTTP de descarga.
 *
 * Antepone el BOM de UTF-8 para que Excel respete los acentos y la ñ.
 */
export function respuestaCsv(contenido: string, nombreArchivo: string): Response {
  return new Response(`﻿${contenido}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
      // Datos operativos del hotel: nunca cachear en proxies intermedios.
      'Cache-Control': 'no-store',
    },
  })
}
