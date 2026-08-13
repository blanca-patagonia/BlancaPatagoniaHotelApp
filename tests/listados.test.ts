import { describe, it, expect } from 'vitest'
import {
  TAMANIO_PAGINA,
  paginaActual,
  rangoDePagina,
  totalPaginas,
  resumenRango,
  construirQuery,
  terminoBusqueda,
  patronOr,
} from '@/lib/listados'

describe('página actual', () => {
  it('cae en la 1 cuando el parámetro falta o es inválido', () => {
    expect(paginaActual(undefined)).toBe(1)
    expect(paginaActual('')).toBe(1)
    expect(paginaActual('abc')).toBe(1)
    expect(paginaActual('0')).toBe(1)
    expect(paginaActual('-3')).toBe(1)
    expect(paginaActual('1.5')).toBe(1)
  })

  it('respeta una página válida', () => {
    expect(paginaActual('4')).toBe(4)
  })
})

describe('rango para PostgREST', () => {
  it('la primera página arranca en 0', () => {
    expect(rangoDePagina(1, 25)).toEqual({ desde: 0, hasta: 24 })
  })

  it('las páginas siguientes no se superponen', () => {
    expect(rangoDePagina(2, 25)).toEqual({ desde: 25, hasta: 49 })
    expect(rangoDePagina(3, 10)).toEqual({ desde: 20, hasta: 29 })
  })

  it('usa el tamaño por defecto', () => {
    expect(rangoDePagina(2)).toEqual({ desde: TAMANIO_PAGINA, hasta: TAMANIO_PAGINA * 2 - 1 })
  })
})

describe('total de páginas', () => {
  it('siempre hay al menos una página', () => {
    expect(totalPaginas(0, 25)).toBe(1)
  })

  it('redondea hacia arriba', () => {
    expect(totalPaginas(25, 25)).toBe(1)
    expect(totalPaginas(26, 25)).toBe(2)
    expect(totalPaginas(214, 25)).toBe(9)
  })
})

describe('resumen del rango', () => {
  it('avisa cuando no hay resultados', () => {
    expect(resumenRango(1, 0, 25)).toBe('0 resultados')
  })

  it('describe la porción visible', () => {
    expect(resumenRango(2, 214, 25)).toBe('26–50 de 214')
  })

  it('no se pasa del total en la última página', () => {
    expect(resumenRango(9, 214, 25)).toBe('201–214 de 214')
  })
})

describe('construcción de la query', () => {
  it('devuelve cadena vacía cuando no queda ningún filtro', () => {
    expect(construirQuery({}, {})).toBe('')
    expect(construirQuery({ q: '' })).toBe('')
  })

  it('conserva los filtros vigentes y aplica el cambio', () => {
    expect(construirQuery({ estado: 'pendiente' }, { pagina: 3 })).toBe('?estado=pendiente&pagina=3')
  })

  it('quita el parámetro cuando el cambio lo vacía', () => {
    expect(construirQuery({ estado: 'pendiente', q: 'ana' }, { estado: undefined })).toBe('?q=ana')
  })

  it('codifica los valores', () => {
    expect(construirQuery({ q: 'Pérez Ana' })).toBe('?q=P%C3%A9rez+Ana')
  })
})

describe('término de búsqueda', () => {
  it('descarta lo vacío', () => {
    expect(terminoBusqueda(undefined)).toBeNull()
    expect(terminoBusqueda('   ')).toBeNull()
  })

  it('recorta los espacios', () => {
    expect(terminoBusqueda('  ana ')).toBe('ana')
  })

  it('escapa los comodines de ilike', () => {
    // Sin escapar, "100%" traería todas las filas.
    expect(terminoBusqueda('100%')).toBe('100\\%')
    expect(terminoBusqueda('a_b')).toBe('a\\_b')
  })
})

/**
 * La coma separa condiciones dentro de `or=(…)`. Estos tests fijan que el
 * término del usuario no pueda cerrar el patrón y agregar condiciones propias:
 * es la diferencia entre buscar y elegir el filtro.
 */
describe('patrón para or() de PostgREST', () => {
  it('encierra el patrón entre comillas dobles', () => {
    expect(patronOr('ana')).toBe('"%ana%"')
  })

  it('neutraliza la coma, que es el separador de condiciones', () => {
    // Pelado, esto partía el `or` y colaba `id.gt.0` como condición aparte.
    expect(patronOr('x,id.gt.0')).toBe('"%x,id.gt.0%"')
  })

  it('neutraliza los paréntesis, que agrupan condiciones', () => {
    expect(patronOr('a)or(b')).toBe('"%a)or(b%"')
  })

  it('escapa la comilla doble, lo único que puede cerrar el valor', () => {
    expect(patronOr('a"b')).toBe('"%a\\"b%"')
  })

  it('escapa la barra invertida para que no se coma la comilla siguiente', () => {
    // Sin esto, un término terminado en `\` dejaría `\"` y la comilla de cierre
    // pasaría a ser un carácter más: el valor quedaría abierto.
    expect(patronOr('a\\')).toBe('"%a\\\\%"')
  })

  it('deja pasar el escape de LIKE que ya hizo terminoBusqueda', () => {
    // `100%` → terminoBusqueda → `100\%` → patronOr → `"%100\\%%"`.
    // PostgREST desescapa `\\` a `\`, y LIKE lee `\%` como porcentaje literal.
    const t = terminoBusqueda('100%')
    expect(t).toBe('100\\%')
    expect(patronOr(t!)).toBe('"%100\\\\%%"')
  })
})
