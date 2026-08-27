import { describe, it, expect } from 'vitest'
import {
  acotarAncho,
  leerAnchoGuardado,
  ANCHO_MAXIMO,
  ANCHO_MINIMO,
  ANCHO_POR_DEFECTO,
} from '@/lib/domain/lateral'

/**
 * Ancho ajustable del menú lateral.
 *
 * Lo que se testea es el borde: que nadie pueda dejar la barra tan angosta que
 * no se vea, ni tan ancha que se coma la pantalla de trabajo. El caso feo es el
 * primero, porque una barra de dos píxeles no tiene de qué agarrarse para
 * recuperarla.
 */

describe('límites del ancho del menú', () => {
  it('respeta un ancho razonable tal como viene', () => {
    expect(acotarAncho(280)).toBe(280)
    expect(acotarAncho(ANCHO_POR_DEFECTO)).toBe(ANCHO_POR_DEFECTO)
  })

  it('no deja arrastrarlo hasta hacerlo desaparecer', () => {
    expect(acotarAncho(0)).toBe(ANCHO_MINIMO)
    expect(acotarAncho(12)).toBe(ANCHO_MINIMO)
    expect(acotarAncho(-500)).toBe(ANCHO_MINIMO)
  })

  it('no deja que se coma la pantalla de trabajo', () => {
    expect(acotarAncho(900)).toBe(ANCHO_MAXIMO)
    expect(acotarAncho(Number.MAX_SAFE_INTEGER)).toBe(ANCHO_MAXIMO)
  })

  it('los propios límites son válidos', () => {
    expect(acotarAncho(ANCHO_MINIMO)).toBe(ANCHO_MINIMO)
    expect(acotarAncho(ANCHO_MAXIMO)).toBe(ANCHO_MAXIMO)
    expect(ANCHO_MINIMO).toBeLessThan(ANCHO_POR_DEFECTO)
    expect(ANCHO_POR_DEFECTO).toBeLessThan(ANCHO_MAXIMO)
  })

  it('devuelve un entero: media resolución de píxel no existe', () => {
    expect(acotarAncho(240.7)).toBe(241)
    expect(Number.isInteger(acotarAncho(300.4))).toBe(true)
  })

  /*
    `NaN` e `Infinity` no son hipotéticos: el valor llega de `localStorage`, que
    devuelve texto y lo puede haber escrito a mano cualquiera desde las
    herramientas del navegador. Sin esta guarda, un `NaN` deja la barra sin
    ancho y sin nada de qué agarrarla.
  */
  it('un valor que no es número cae en el ancho de diseño', () => {
    expect(acotarAncho(Number.NaN)).toBe(ANCHO_POR_DEFECTO)
    expect(acotarAncho(Number.POSITIVE_INFINITY)).toBe(ANCHO_POR_DEFECTO)
    expect(acotarAncho(Number.NEGATIVE_INFINITY)).toBe(ANCHO_POR_DEFECTO)
  })
})

describe('lectura de lo guardado en el navegador', () => {
  it('sin preferencia guardada usa el ancho de diseño', () => {
    expect(leerAnchoGuardado(null)).toBe(ANCHO_POR_DEFECTO)
  })

  it('lee una preferencia válida', () => {
    expect(leerAnchoGuardado('320')).toBe(320)
  })

  it('acota una preferencia fuera de rango en vez de confiar en ella', () => {
    expect(leerAnchoGuardado('5')).toBe(ANCHO_MINIMO)
    expect(leerAnchoGuardado('9999')).toBe(ANCHO_MAXIMO)
  })

  it('no se rompe con basura', () => {
    expect(leerAnchoGuardado('')).toBe(ANCHO_POR_DEFECTO)
    expect(leerAnchoGuardado('ancho')).toBe(ANCHO_POR_DEFECTO)
    expect(leerAnchoGuardado('{}')).toBe(ANCHO_POR_DEFECTO)
  })
})
