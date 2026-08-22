import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_FOLIO,
  FOLIOS,
  agruparPorDepartamento,
  esFolio,
  folioBEnUso,
  folioOpuesto,
  foliosCierran,
  importeLinea,
  puedeMoverDeFolio,
  totalesDeCuenta,
  totalesDeFolio,
  type LineaCuenta,
} from '@/lib/domain/folios'

/**
 * La invariante que estos tests protegen: **la suma de los folios es siempre igual
 * al total general**. Un cargo tiene que estar en exactamente un folio. Si el split
 * puede perder o duplicar una línea, la cuenta deja de cerrar y nadie sabe dónde
 * está el error — y se descubre con el huésped enfrente, al cobrar.
 */

let n = 0
function linea(over: Partial<LineaCuenta> = {}): LineaCuenta {
  n++
  return {
    id: `l${n}`,
    clase: 'consumo',
    fecha: '2027-04-10',
    concepto: 'Cerveza',
    comprobante: '',
    departamento: 'Frigobar',
    subdepartamento: 'Bebidas',
    folio: 'A',
    cantidad: 1,
    importeUnitario: 7,
    ...over,
  }
}

describe('importeLinea', () => {
  it('multiplica cantidad por importe unitario', () => {
    expect(importeLinea({ cantidad: 3, importeUnitario: 7 })).toBe(21)
  })

  it('redondea a dos decimales', () => {
    expect(importeLinea({ cantidad: 3, importeUnitario: 7.335 })).toBe(22.01)
  })

  it('no propaga NaN', () => {
    expect(importeLinea({ cantidad: Number.NaN, importeUnitario: 7 })).toBe(0)
  })
})

describe('folios', () => {
  it('son dos y tienen etiqueta', () => {
    expect(FOLIOS).toEqual(['A', 'B'])
    for (const f of FOLIOS) expect(ETIQUETAS_FOLIO[f]).toBeTruthy()
  })

  it('valida lo que llega de un formulario', () => {
    expect(esFolio('A')).toBe(true)
    expect(esFolio('C')).toBe(false)
  })

  it('el opuesto alterna', () => {
    expect(folioOpuesto('A')).toBe('B')
    expect(folioOpuesto('B')).toBe('A')
  })
})

describe('totalesDeFolio', () => {
  const lineas = [
    linea({ clase: 'alojamiento', departamento: 'Alojamiento', subdepartamento: '', importeUnitario: 300, folio: 'B' }),
    linea({ cantidad: 2, importeUnitario: 7, folio: 'A' }),
    linea({ cantidad: 1, importeUnitario: 18, folio: 'A' }),
    linea({ clase: 'anticipo', concepto: 'Seña', importeUnitario: -100, folio: 'B', departamento: 'Alojamiento', subdepartamento: '' }),
  ]

  it('suma sólo las líneas de su folio', () => {
    expect(totalesDeFolio(lineas, 'A').cargos).toBe(32)
    expect(totalesDeFolio(lineas, 'B').cargos).toBe(300)
  })

  it('los anticipos se muestran en positivo aunque se guarden en negativo', () => {
    // Guardarlos en negativo permite que sumar la columna dé el saldo; mostrar
    // «anticipo −200» sería confuso.
    expect(totalesDeFolio(lineas, 'B').anticipos).toBe(100)
  })

  it('el anticipo no cuenta como línea de cargo', () => {
    expect(totalesDeFolio(lineas, 'B').lineas).toBe(1)
  })

  it('el saldo descuenta los anticipos del mismo folio', () => {
    expect(totalesDeFolio(lineas, 'B').saldo).toBe(200)
  })

  it('el saldo NUNCA es negativo', () => {
    // Si alguien pagó de más, el excedente es un asunto de devolución. Un saldo
    // negativo que después se resta del otro folio descuadra la cuenta entera.
    const conExceso = [
      linea({ importeUnitario: 50, folio: 'A' }),
      linea({ clase: 'anticipo', importeUnitario: -200, folio: 'A' }),
    ]
    expect(totalesDeFolio(conExceso, 'A').saldo).toBe(0)
  })

  it('un folio vacío da todo en cero', () => {
    expect(totalesDeFolio([], 'A')).toEqual({
      folio: 'A',
      cargos: 0,
      anticipos: 0,
      saldo: 0,
      lineas: 0,
    })
  })
})

describe('totalesDeCuenta — la invariante', () => {
  it('LOS FOLIOS SUMAN EL TOTAL GENERAL', () => {
    const lineas = [
      linea({ importeUnitario: 300, folio: 'B', clase: 'alojamiento' }),
      linea({ cantidad: 2, importeUnitario: 7, folio: 'A' }),
      linea({ importeUnitario: 18, folio: 'A' }),
      linea({ importeUnitario: 35, folio: 'B' }),
    ]

    const t = totalesDeCuenta(lineas)
    expect(t.cargos).toBe(367)
    expect(t.porFolio[0].cargos + t.porFolio[1].cargos).toBe(t.cargos)
    expect(foliosCierran(lineas)).toBe(true)
  })

  it('mover una línea de folio no cambia el total general', () => {
    // Es el corazón del split: reparte, no crea ni destruye.
    const antes = [linea({ importeUnitario: 100, folio: 'A' }), linea({ importeUnitario: 50, folio: 'A' })]
    const despues = [
      { ...antes[0] },
      { ...antes[1], folio: 'B' as const },
    ]

    expect(totalesDeCuenta(antes).cargos).toBe(totalesDeCuenta(despues).cargos)
    expect(totalesDeCuenta(despues).porFolio[0].cargos).toBe(100)
    expect(totalesDeCuenta(despues).porFolio[1].cargos).toBe(50)
  })

  it('detecta cuando los folios NO cierran', () => {
    // El total general se calcula sobre TODAS las líneas, no sumando los folios: si
    // una tuviera un folio inválido quedaría afuera de los folios pero dentro del
    // total, y la diferencia se ve. Sumar los folios lo habría escondido.
    const conFolioRoto = [
      linea({ importeUnitario: 100, folio: 'A' }),
      // @ts-expect-error se fuerza un folio inválido para probar la detección
      linea({ importeUnitario: 50, folio: 'Z' }),
    ]

    expect(foliosCierran(conFolioRoto)).toBe(false)
    // Y el total general sí la incluye, así que la diferencia es visible.
    expect(totalesDeCuenta(conFolioRoto).cargos).toBe(150)
  })

  it('los anticipos de cualquier folio suman al anticipo general', () => {
    const lineas = [
      linea({ clase: 'anticipo', importeUnitario: -100, folio: 'A' }),
      linea({ clase: 'anticipo', importeUnitario: -50, folio: 'B' }),
      linea({ importeUnitario: 300, folio: 'A' }),
    ]

    const t = totalesDeCuenta(lineas)
    expect(t.anticipos).toBe(150)
    expect(t.saldo).toBe(150)
  })
})

describe('agruparPorDepartamento', () => {
  const lineas = [
    linea({ clase: 'alojamiento', departamento: 'Alojamiento', subdepartamento: '', importeUnitario: 300 }),
    linea({ departamento: 'Frigobar', subdepartamento: 'Bebidas', cantidad: 2, importeUnitario: 7 }),
    linea({ departamento: 'Frigobar', subdepartamento: 'Snacks', importeUnitario: 5 }),
    linea({ departamento: 'Excursiones', subdepartamento: 'Glaciares', importeUnitario: 90 }),
  ]

  it('agrupa por departamento y subdepartamento', () => {
    const grupos = agruparPorDepartamento(lineas)
    const frigobar = grupos.find((g) => g.departamento === 'Frigobar')

    expect(frigobar?.subgrupos).toHaveLength(2)
    expect(frigobar?.total).toBe(19)
  })

  it('el alojamiento va primero: es el cargo principal', () => {
    expect(agruparPorDepartamento(lineas)[0].departamento).toBe('Alojamiento')
  })

  it('las líneas sin subdepartamento quedan sueltas en su departamento', () => {
    const grupos = agruparPorDepartamento(lineas)
    const aloj = grupos.find((g) => g.departamento === 'Alojamiento')
    expect(aloj?.sueltas).toHaveLength(1)
    expect(aloj?.subgrupos).toHaveLength(0)
  })

  it('un departamento sin movimiento no aparece', () => {
    // La cuenta muestra lo que pasó, no el organigrama del hotel.
    const grupos = agruparPorDepartamento(lineas)
    expect(grupos.some((g) => g.departamento === 'Traslados')).toBe(false)
  })

  it('filtra por folio cuando se lo pide', () => {
    const mezcla = [
      linea({ departamento: 'Frigobar', importeUnitario: 7, folio: 'A' }),
      linea({ departamento: 'Excursiones', importeUnitario: 90, folio: 'B' }),
    ]

    expect(agruparPorDepartamento(mezcla, 'A')).toHaveLength(1)
    expect(agruparPorDepartamento(mezcla, 'A')[0].departamento).toBe('Frigobar')
  })

  it('los anticipos no se agrupan como cargo', () => {
    const conAnticipo = [
      linea({ departamento: 'Frigobar', importeUnitario: 7 }),
      linea({ clase: 'anticipo', departamento: 'Alojamiento', importeUnitario: -100 }),
    ]
    expect(agruparPorDepartamento(conAnticipo)).toHaveLength(1)
  })

  it('sin departamento cae en «Otros» en vez de desaparecer', () => {
    expect(agruparPorDepartamento([linea({ departamento: '' })])[0].departamento).toBe('Otros')
  })
})

describe('puedeMoverDeFolio', () => {
  it('un consumo y el alojamiento se pueden mover', () => {
    expect(puedeMoverDeFolio({ clase: 'consumo' })).toBeNull()
    expect(puedeMoverDeFolio({ clase: 'alojamiento' })).toBeNull()
  })

  it('un anticipo NO se mueve', () => {
    // Está imputado a un pago concreto: moverlo dejaría el pago apuntando a un
    // folio y el anticipo a otro.
    expect(puedeMoverDeFolio({ clase: 'anticipo' })).toContain('no se mueve de folio')
  })
})

describe('folioBEnUso', () => {
  it('con líneas en B, se muestra', () => {
    expect(folioBEnUso([linea({ folio: 'B' })], '')).toBe(true)
  })

  it('con titular declarado, se muestra aunque esté vacío', () => {
    expect(folioBEnUso([linea({ folio: 'A' })], 'Empresa SRL')).toBe(true)
  })

  it('vacío y sin titular, NO se muestra', () => {
    // Mostrarlo sería agregar una columna de ceros a todas las reservas para el
    // caso minoritario.
    expect(folioBEnUso([linea({ folio: 'A' })], '')).toBe(false)
    expect(folioBEnUso([], '   ')).toBe(false)
  })
})
