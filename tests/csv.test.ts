import { describe, it, expect } from 'vitest'
import { aCsv, escaparCampo, SEPARADOR } from '@/lib/csv'

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
