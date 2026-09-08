import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { INFORMES, rutaDeInforme, informePorId, mesValido } from '@/lib/domain/informes'

const DIR_INFORMES = join(process.cwd(), 'app', 'panel', 'reportes')

describe('catálogo de informes', () => {
  it('no tiene ids repetidos', () => {
    const ids = INFORMES.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada informe declara título, descripción y la pregunta que contesta', () => {
    for (const i of INFORMES) {
      expect(i.titulo.length, i.id).toBeGreaterThan(0)
      expect(i.descripcion.length, i.id).toBeGreaterThan(0)
      // La pregunta es lo que hace usable el índice: sin ella las tarjetas son
      // una lista de nombres y hay que abrirlas todas para saber cuál sirve.
      expect(i.pregunta.length, i.id).toBeGreaterThan(0)
    }
  })

  it('se encuentra cada informe por su id, y uno inventado no', () => {
    for (const i of INFORMES) expect(informePorId(i.id)?.titulo).toBe(i.titulo)
    expect(informePorId('no-existe')).toBeUndefined()
  })
})

describe('catálogo de informes · cada uno tiene su pantalla', () => {
  /*
    Test-contrato: el catálogo es lo que dibuja las tarjetas del índice, así que
    un informe declarado sin pantalla es un botón que lleva a un 404. Se
    comprueba contra el disco y no contra una lista escrita a mano, que es lo
    que se olvidaría de actualizar.
  */
  it('todo informe del catálogo tiene su carpeta con page.tsx', () => {
    for (const i of INFORMES) {
      expect(existsSync(join(DIR_INFORMES, i.id, 'page.tsx')), i.id).toBe(true)
    }
  })

  it('toda pantalla de informe está declarada en el catálogo', () => {
    // Al revés: una pantalla que existe y no está en el catálogo es un informe
    // al que sólo se llega escribiendo la dirección a mano.
    const carpetas = readdirSync(DIR_INFORMES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name)

    const declarados = new Set<string>(INFORMES.map((i) => i.id))
    for (const carpeta of carpetas) {
      expect(declarados.has(carpeta), `${carpeta} no está en INFORMES`).toBe(true)
    }
  })
})

describe('catálogo de informes · rutas', () => {
  it('lleva el mes sólo a los informes que dependen del mes', () => {
    // Ponerle el mes a un histórico haría creer que el número mostrado es el de
    // ese mes, que es justo lo que no es.
    const porMes = INFORMES.find((i) => i.porMes)!
    const historico = INFORMES.find((i) => !i.porMes)!
    expect(rutaDeInforme(porMes, '2026-09')).toContain('?mes=2026-09')
    expect(rutaDeInforme(historico, '2026-09')).not.toContain('mes=')
  })

  it('sin mes, la ruta no lleva query', () => {
    const porMes = INFORMES.find((i) => i.porMes)!
    expect(rutaDeInforme(porMes)).toBe(`/panel/reportes/${porMes.id}`)
  })
})

describe('validación del mes de la URL', () => {
  it('acepta un mes bien escrito', () => {
    expect(mesValido('2026-09', '2026-01')).toBe('2026-09')
  })

  it('cae en el valor por defecto con basura, vacío o undefined', () => {
    for (const crudo of ['', '2026', '2026-9', 'ayer', "2026-09' or 1=1", undefined]) {
      expect(mesValido(crudo, '2026-01')).toBe('2026-01')
    }
  })
})
