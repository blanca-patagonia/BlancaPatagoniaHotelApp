import { describe, it, expect } from 'vitest'
import {
  ventaPorTipo,
  totalesDeVenta,
  agruparPorCategoria,
  type EstadiaDeTipo,
  type TipoConInventario,
} from '@/lib/domain/metricas-categoria'

const MES = '2026-09' // 30 días

const STD: TipoConInventario = {
  id: 'tipo-std',
  codigo: 'STD',
  nombre: 'Standard',
  categoria: 'hosteria',
  unidades: 2,
}
const CA2: TipoConInventario = {
  id: 'tipo-ca2',
  codigo: 'CA2',
  nombre: 'Cabaña 2',
  categoria: 'cabana',
  unidades: 1,
}

/** Una estadía de `noches` noches arrancando el 1 de septiembre. */
const estadia = (tipoUnidadId: string, desde: string, hasta: string, precio: number): EstadiaDeTipo => ({
  tipoUnidadId,
  periodo: `[${desde},${hasta})`,
  precio_noche: precio,
})

describe('venta por categoría · el reparto entre tipos', () => {
  it('imputa cada estadía al tipo con el que se vendió', () => {
    const filas = ventaPorTipo(
      [
        estadia(STD.id, '2026-09-01', '2026-09-04', 100), // 3 noches
        estadia(CA2.id, '2026-09-01', '2026-09-03', 200), // 2 noches
      ],
      [STD, CA2],
      MES,
    )

    const std = filas.find((f) => f.codigo === 'STD')!
    const ca2 = filas.find((f) => f.codigo === 'CA2')!
    expect(std.nochesVendidas).toBe(3)
    expect(std.ingreso).toBe(300)
    expect(ca2.nochesVendidas).toBe(2)
    expect(ca2.ingreso).toBe(400)
  })

  it('devuelve también los tipos que no vendieron nada', () => {
    // Un tipo ausente de la tabla se lee como «no lo miré». Un tipo en cero es
    // justamente el dato que hay que ver.
    const filas = ventaPorTipo([estadia(STD.id, '2026-09-01', '2026-09-04', 100)], [STD, CA2], MES)
    const ca2 = filas.find((f) => f.codigo === 'CA2')!
    expect(ca2.nochesVendidas).toBe(0)
    expect(ca2.ingreso).toBe(0)
    expect(ca2.adr).toBeNull()
  })

  it('ordena por ingreso, no por código', () => {
    // La pregunta del hotel es cuál le deja más plata, igual que en canales.
    const filas = ventaPorTipo(
      [
        estadia(STD.id, '2026-09-01', '2026-09-03', 50), // 100
        estadia(CA2.id, '2026-09-01', '2026-09-03', 400), // 800
      ],
      [STD, CA2],
      MES,
    )
    expect(filas.map((f) => f.codigo)).toEqual(['CA2', 'STD'])
  })

  it('sólo cuenta las noches que caen dentro del mes', () => {
    // Una estadía a caballo entre agosto y septiembre aporta al informe de
    // septiembre únicamente sus noches de septiembre.
    const filas = ventaPorTipo([estadia(STD.id, '2026-08-28', '2026-09-03', 100)], [STD], MES)
    expect(filas[0].nochesVendidas).toBe(2)
    expect(filas[0].ingreso).toBe(200)
  })
})

describe('venta por categoría · ocupación y participación', () => {
  it('calcula la ocupación contra el inventario de ESE tipo', () => {
    // 2 unidades × 30 días = 60 noches disponibles; se venden 3.
    const filas = ventaPorTipo([estadia(STD.id, '2026-09-01', '2026-09-04', 100)], [STD], MES)
    expect(filas[0].nochesDisponibles).toBe(60)
    expect(filas[0].ocupacionPct).toBe(5)
  })

  it('reparte la participación sobre el ingreso total del mes', () => {
    const filas = ventaPorTipo(
      [
        estadia(STD.id, '2026-09-01', '2026-09-02', 250), // 250
        estadia(CA2.id, '2026-09-01', '2026-09-02', 750), // 750
      ],
      [STD, CA2],
      MES,
    )
    expect(filas.find((f) => f.codigo === 'CA2')!.participacionPct).toBe(75)
    expect(filas.find((f) => f.codigo === 'STD')!.participacionPct).toBe(25)
  })

  it('sin ingreso en el mes, la participación es null y no cero', () => {
    // 0 % dice «no vendió nada de la torta»; null dice «no hay torta». Con el
    // hotel cerrado son cosas distintas.
    const filas = ventaPorTipo([], [STD, CA2], MES)
    expect(filas.every((f) => f.participacionPct === null)).toBe(true)
  })
})

describe('venta por categoría · un tipo sin inventario activo', () => {
  const dadoDeBaja = { ...STD, unidades: 0 }

  it('no reporta 0 % de ocupación: reporta que no hay denominador', () => {
    // Un tipo dado de baja que vendió noches no está vacío. Mostrar 0 % haría
    // ver como desocupado lo que se vendió entero.
    const filas = ventaPorTipo(
      [estadia(STD.id, '2026-09-01', '2026-09-04', 100)],
      [dadoDeBaja],
      MES,
    )
    expect(filas[0].sinInventario).toBe(true)
    expect(filas[0].ocupacionPct).toBeNull()
    expect(filas[0].revpar).toBeNull()
    expect(filas[0].nochesVendidas).toBe(3)
  })

  it('un tipo que ya no está en el catálogo igual suma su ingreso', () => {
    // Si se descartara, la columna de ingresos no cerraría con el total del mes
    // y nadie sabría por qué faltan dólares.
    const filas = ventaPorTipo(
      [
        estadia(STD.id, '2026-09-01', '2026-09-03', 100), // 200
        estadia('tipo-borrado', '2026-09-01', '2026-09-03', 500), // 1000
      ],
      [STD],
      MES,
    )
    expect(filas).toHaveLength(2)
    expect(totalesDeVenta(filas).ingreso).toBe(1200)
    expect(filas.find((f) => f.tipoId === 'tipo-borrado')!.sinInventario).toBe(true)
  })
})

describe('venta por categoría · totales', () => {
  const filas = () =>
    ventaPorTipo(
      [
        estadia(STD.id, '2026-09-01', '2026-09-11', 100), // 10 noches, 1000
        estadia(CA2.id, '2026-09-01', '2026-09-03', 500), // 2 noches, 1000
      ],
      [STD, CA2],
      MES,
    )

  it('el ADR total NO es el promedio de los ADR de cada tipo', () => {
    // Promedio de ADR daría (100 + 500) / 2 = 300. El correcto es 2000 / 12 =
    // 166,67: promediar promedios le da el mismo peso a dos noches que a diez.
    const t = totalesDeVenta(filas())
    expect(t.nochesVendidas).toBe(12)
    expect(t.ingreso).toBe(2000)
    expect(t.adr).toBeCloseTo(166.67, 2)
  })

  it('suma las noches disponibles de todos los tipos', () => {
    // (2 unidades + 1 unidad) × 30 días
    expect(totalesDeVenta(filas()).nochesDisponibles).toBe(90)
  })

  it('sin filas, los totales son null y no cero', () => {
    const t = totalesDeVenta([])
    expect(t.adr).toBeNull()
    expect(t.ocupacionPct).toBeNull()
    expect(t.revpar).toBeNull()
    expect(t.ingreso).toBe(0)
  })
})

describe('venta por categoría · agrupación', () => {
  it('separa hostería de cabañas conservando el orden por ingreso', () => {
    const grupos = agruparPorCategoria(
      ventaPorTipo(
        [
          estadia(STD.id, '2026-09-01', '2026-09-02', 100),
          estadia(CA2.id, '2026-09-01', '2026-09-02', 900),
        ],
        [STD, CA2],
        MES,
      ),
    )
    expect(grupos.map((g) => g.categoria)).toEqual(['cabana', 'hosteria'])
    expect(grupos[0].filas.map((f) => f.codigo)).toEqual(['CA2'])
  })
})
