import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Test-contrato: `reservas.total` nunca se escribe con un `.update()` suelto
 * desde la aplicación (Fase 2.6 del pulido integral).
 *
 * `reservas.total` solo puede salir de `crear_reserva` o de
 * `aplicar_precio_reserva` (migración 0085) — las dos funciones SQL que lo
 * escriben en la MISMA transacción que el precio por noche de la estadía.
 * Antes de la 0085, reprogramar y mudar hacían exactamente esto que el test
 * prohíbe: un `update` de `estadias.precio_noche` y otro, aparte, de
 * `reservas.total`. Si el segundo fallaba después del primero, la reserva
 * quedaba facturando un precio que no correspondía a sus fechas reales —y no
 * se veía: la reserva figuraba normal en la grilla.
 *
 * Mismo enfoque de `tests/observabilidad-del-dinero.test.ts`: lee los
 * archivos del repo en vez de ejecutar nada, así corre siempre, sin base.
 */

const RAIZ = process.cwd()
const CARPETAS = ['app', 'lib']

function fuentes(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const completo = join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      salida.push(...fuentes(completo))
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(completo)
    }
  }
  return salida
}

/**
 * Busca `.from('reservas')...update({ ... })` y devuelve, de cada hallazgo,
 * el cuerpo del objeto que se escribe. Tolera que `.from` y `.update` queden
 * en líneas distintas (es el estilo de todo el repo) sin cruzar a otro
 * `.update()` de otra tabla.
 */
function cuerposDeUpdateReservas(contenido: string): string[] {
  const patron = /\.from\(\s*['"]reservas['"]\s*\)\s*\.update\(\s*\{([^}]*)\}/g
  return [...contenido.matchAll(patron)].map((m) => m[1])
}

describe('contrato: nada escribe `reservas.total` con un update suelto', () => {
  const archivos = [...CARPETAS.flatMap((c) => fuentes(resolve(RAIZ, c)))]

  it('ningún `.from(\'reservas\').update()` incluye `total`', () => {
    const hallazgos: string[] = []

    for (const archivo of archivos) {
      const contenido = readFileSync(archivo, 'utf8')
      for (const cuerpo of cuerposDeUpdateReservas(contenido)) {
        if (/\btotal\s*:/.test(cuerpo)) {
          hallazgos.push(archivo)
        }
      }
    }

    expect(
      hallazgos,
      'reservas.total se escribe con un update suelto en vez de aplicar_precio_reserva/crear_reserva: ' +
        hallazgos.join(', '),
    ).toEqual([])
  })

  it('el patrón de búsqueda funciona: detecta un caso armado a propósito', () => {
    const casoMalo = `
      await supabase
        .from('reservas')
        .update({ total: 999 })
        .eq('id', id)
    `
    const cuerpos = cuerposDeUpdateReservas(casoMalo)
    expect(cuerpos.some((c) => /\btotal\s*:/.test(c))).toBe(true)
  })
})
