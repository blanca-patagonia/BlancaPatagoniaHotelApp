import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contrato de documentación: los índices de `src/lib/` dicen la verdad.
 *
 * `src/lib/README.md` y `src/lib/domain/README.md` son el mapa con el que se
 * recorre la lógica del sistema (y el que se muestra al presentar la tesis). Un
 * índice escrito a mano se desactualiza en silencio: el siguiente módulo nuevo
 * no aparece, y después nadie sabe que existe. Este test lo convierte en una
 * regla que falla.
 *
 * Además exige que cada módulo de `domain/` tenga al menos un test que lo
 * importe: son las reglas del negocio, y su prueba es lo que permite tocarlas.
 */

const RAIZ = process.cwd()
const LIB = join(RAIZ, 'src/lib')
const DOMAIN = join(LIB, 'domain')
const TESTS = join(RAIZ, 'tests')

/** Nombres escritos entre comillas invertidas en la primera columna de una tabla. */
function entradasDeTabla(readme: string): string[] {
  return [...readme.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1])
}

function archivosRecursivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre)
    return statSync(ruta).isDirectory() ? archivosRecursivos(ruta) : [ruta]
  })
}

describe('índice de src/lib/domain', () => {
  const modulos = readdirSync(DOMAIN).filter((f) => f.endsWith('.ts'))
  const listados = entradasDeTabla(readFileSync(join(DOMAIN, 'README.md'), 'utf8'))

  it('lista cada módulo de domain/', () => {
    expect(modulos.filter((m) => !listados.includes(m))).toEqual([])
  })

  it('no lista módulos que ya no existen', () => {
    expect(listados.filter((l) => !modulos.includes(l))).toEqual([])
  })

  it('no repite un módulo en dos temas', () => {
    expect(listados.filter((l, i) => listados.indexOf(l) !== i)).toEqual([])
  })

  it('cada módulo tiene al menos un test que lo importa', () => {
    const fuentes = archivosRecursivos(TESTS)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    const sinTest = modulos
      .map((m) => m.replace(/\.ts$/, ''))
      .filter((m) => !fuentes.includes(`@/lib/domain/${m}'`))
    expect(sinTest).toEqual([])
  })
})

describe('índice de src/lib', () => {
  const entradas = readdirSync(LIB).filter((f) => f !== 'README.md')
  const esperados = entradas.map((e) => (statSync(join(LIB, e)).isDirectory() ? `${e}/` : e))
  const listados = entradasDeTabla(readFileSync(join(LIB, 'README.md'), 'utf8'))

  it('lista cada carpeta y archivo suelto de lib/', () => {
    expect(esperados.filter((e) => !listados.includes(e))).toEqual([])
  })

  it('no lista nada que ya no existe', () => {
    expect(listados.filter((l) => !esperados.includes(l))).toEqual([])
  })
})
