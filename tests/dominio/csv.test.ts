import { describe, it, expect } from 'vitest'
import { aCsv, decimal, escaparCampo, SEPARADOR } from '@/lib/csv'

describe('escapado de campos CSV', () => {
  it('deja pasar el texto simple sin comillas', () => {
    expect(escaparCampo('Ushuaia')).toBe('Ushuaia')
  })

  it('representa null e undefined como campo vacío', () => {
    expect(escaparCampo(null)).toBe('')
    expect(escaparCampo(undefined)).toBe('')
  })

  it('entrecomilla cuando aparece el separador', () => {
    expect(escaparCampo(`Pérez${SEPARADOR} Ana`)).toBe(`"Pérez${SEPARADOR} Ana"`)
  })

  it('duplica las comillas internas', () => {
    expect(escaparCampo('Cabaña "Lenga"')).toBe('"Cabaña ""Lenga"""')
  })

  it('entrecomilla los saltos de línea', () => {
    expect(escaparCampo('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
  })

  it('neutraliza la inyección de fórmulas', () => {
    // Un campo que empiece con = sería ejecutado por Excel al abrir el archivo.
    expect(escaparCampo('=1+1')).toBe("'=1+1")
    expect(escaparCampo('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escaparCampo('-2+3')).toBe("'-2+3")
  })

  it('un importe negativo sigue siendo un número, no texto', () => {
    // El `-` inicial es el mismo del caso de arriba, pero acá escaparlo rompe el
    // archivo: con el apóstrofo, Excel deja de sumar la celda. Todo saldo a
    // favor, nota de crédito y diferencia contra un canal se escribe así, y el
    // total de la columna quedaría mal sin que nada lo delate.
    expect(escaparCampo('-50.00')).toBe('-50.00')
    expect(escaparCampo(-1234.5)).toBe('-1234,5')
    expect(escaparCampo('-50,00')).toBe('-50,00')
    expect(escaparCampo('-0.01')).toBe('-0.01')
  })

  it('la excepción no le abre la puerta a ninguna fórmula', () => {
    // El permiso es solo para un decimal escrito entero. Cualquier otra cosa que
    // empiece con un carácter peligroso se sigue escapando.
    expect(escaparCampo('-1-1')).toBe("'-1-1")
    expect(escaparCampo('-1e9')).toBe("'-1e9")
    expect(escaparCampo('-cmd|calc')).toBe("'-cmd|calc")
    expect(escaparCampo('+50')).toBe("'+50")
    expect(escaparCampo('=-5')).toBe("'=-5")
    // `Number('\t')` da 0: si la excepción se hubiera escrito con `Number`, un
    // campo que empieza con tabulador se habría colado como «número».
    expect(escaparCampo('\t')).toBe("'\t")
  })
})

describe('armado del CSV', () => {
  interface Fila {
    codigo: string
    total: number
  }
  const columnas = [
    { titulo: 'Código', valor: (f: Fila) => f.codigo },
    { titulo: 'Total', valor: (f: Fila) => f.total },
  ]

  it('escribe el encabezado aunque no haya filas', () => {
    expect(aCsv<Fila>([], columnas)).toBe(`Código${SEPARADOR}Total`)
  })

  it('separa las filas con CRLF', () => {
    const csv = aCsv([{ codigo: 'BP-001', total: 1200 }], columnas)
    expect(csv).toBe(`Código${SEPARADOR}Total\r\nBP-001${SEPARADOR}1200`)
  })

  it('aplica el escapado a cada celda', () => {
    const csv = aCsv([{ codigo: `BP${SEPARADOR}1`, total: 0 }], columnas)
    expect(csv.split('\r\n')[1]).toBe(`"BP${SEPARADOR}1"${SEPARADOR}0`)
  })
})

describe('decimales para Excel en es-AR', () => {
  // Con `;` como separador de columnas, Excel usa `,` como separador decimal:
  // «145.20» no es un número ahí (queda como texto o se vuelve una fecha).
  it('escribe los importes con coma decimal y sin separador de miles', () => {
    expect(decimal(145.2)).toBe('145,20')
    expect(decimal('1234567.891')).toBe('1234567,89')
    expect(decimal(0)).toBe('0,00')
    expect(decimal(-50)).toBe('-50,00')
  })

  it('no inventa un cero cuando no hay dato', () => {
    expect(decimal(null)).toBe('')
    expect(decimal(undefined)).toBe('')
    expect(decimal('')).toBe('')
    expect(decimal('no es un número')).toBe('')
  })

  it('no deja un cero con signo', () => {
    expect(decimal(-0.001)).toBe('0,00')
  })

  it('respeta los decimales pedidos', () => {
    expect(decimal(66.666, 1)).toBe('66,7')
  })

  it('un number con decimales que llega directo también sale con coma', () => {
    expect(escaparCampo(72.5)).toBe('72,5')
    expect(escaparCampo(1200)).toBe('1200')
  })

  it('un importe negativo con coma sigue siendo número, no texto', () => {
    expect(escaparCampo(decimal(-12.5))).toBe('-12,50')
  })
})
