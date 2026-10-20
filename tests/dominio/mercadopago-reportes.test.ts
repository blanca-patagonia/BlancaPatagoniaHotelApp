import { describe, it, expect } from 'vitest'
import { cubreElPeriodo, leerLiquidacion } from '@/lib/conciliacion/mercadopago-reportes'

/**
 * Reporte de liquidaciones de MercadoPago (Bloque C, objetivos 4 y 10).
 *
 * Sólo se prueba lo puro: la lectura del CSV y la elección del reporte. La parte
 * que habla por HTTP no se prueba acá — no hay forma honesta de hacerlo sin una
 * cuenta real, y un mock del `fetch` sólo verificaría que el mock devuelve lo que
 * le pusimos.
 */

/*
  Encabezados tomados de la documentación del reporte de liquidaciones. Los que
  este módulo usa: la referencia con la que se ata al pago del sistema, el neto
  liquidado, la comisión y la fecha.
*/
const CSV = `EXTERNAL_REFERENCE,SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_DATE,TRANSACTION_AMOUNT,FEE_AMOUNT,SETTLEMENT_NET_AMOUNT,SETTLEMENT_CURRENCY,DESCRIPTION
res-abc-123,900001,SETTLEMENT,2026-09-05T10:12:00.000-03:00,148000.00,-10360.00,137640.00,ARS,Pago de reserva
res-def-456,900002,SETTLEMENT,2026-09-06T11:00:00.000-03:00,74000.00,-5180.00,68820.00,ARS,Pago de reserva
,900003,SETTLEMENT,2026-09-07T09:00:00.000-03:00,20000.00,-1400.00,18600.00,ARS,Cobro desde el panel
sin-fecha,900004,SETTLEMENT,,1000.00,0.00,1000.00,ARS,Fila rota
`

describe('leer el reporte de liquidaciones', () => {
  const r = leerLiquidacion(CSV)

  it('guarda el NETO liquidado, no el bruto cobrado', () => {
    /*
      La decisión central del módulo.

      El neto es lo que de verdad entró a la cuenta, y es contra eso que tiene que
      cerrar el extracto del banco. Conciliar contra el bruto dejaría siempre una
      diferencia igual a la comisión, en todas las filas y para siempre.
    */
    expect(r.movimientos[0].monto).toBe(137_640)
  })

  it('la referencia es la del sistema, para que el emparejamiento sea exacto', () => {
    // `EXTERNAL_REFERENCE` es el mismo valor que este sistema le manda a
    // MercadoPago al crear el link y guarda en `pagos.external_id`.
    expect(r.movimientos[0].externalId).toBe('res-abc-123')
  })

  it('un cobro que el sistema no originó cae al id de la operación', () => {
    // Alguien cobró desde el panel de MercadoPago: no hay `external_reference`,
    // pero el movimiento existe y hay que poder verlo.
    expect(r.movimientos[2].externalId).toBe('900003')
  })

  it('deja el bruto y la comisión en la descripción, para explicar la diferencia', () => {
    expect(r.movimientos[0].descripcion).toContain('comisión 10360.00')
    expect(r.movimientos[0].descripcion).toContain('bruto 148000.00')
  })

  it('suma las comisiones del período: es el número del objetivo 4', () => {
    // 10.360 + 5.180 + 1.400. La fila rota no aporta.
    expect(r.comisiones).toBe(16_940)
  })

  it('descarta la fila sin fecha en vez de inventarle una', () => {
    expect(r.descartadas).toBe(1)
    expect(r.movimientos).toHaveLength(3)
  })

  it('toma la moneda de la liquidación', () => {
    expect(r.movimientos.every((m) => m.moneda === 'ARS')).toBe(true)
  })

  it('marca el origen para que la pantalla los pueda separar del banco', () => {
    expect(r.movimientos.every((m) => m.origen === 'mercadopago')).toBe(true)
  })

  it('un CSV sin las columnas de importe no inventa movimientos', () => {
    const sinImportes = leerLiquidacion('FOO,BAR\n1,2')
    expect(sinImportes.movimientos).toHaveLength(0)
    expect(sinImportes.descartadas).toBe(1)
  })

  it('un archivo vacío no rompe', () => {
    expect(leerLiquidacion('').movimientos).toHaveLength(0)
  })
})

describe('elegir el reporte que sirve', () => {
  const periodo = { desde: '2026-09-01', hasta: '2026-09-30' }

  it('sirve el que cubre todo el período', () => {
    expect(
      cubreElPeriodo({ begin_date: '2026-09-01T00:00:00Z', end_date: '2026-10-01T00:00:00Z' }, periodo),
    ).toBe(true)
  })

  it('NO sirve el que cubre sólo una parte', () => {
    // Descargar un reporte parcial y darlo por completo es peor que no traer
    // nada: el mes cerraría de menos y nadie vería un error.
    expect(
      cubreElPeriodo({ begin_date: '2026-09-10T00:00:00Z', end_date: '2026-09-30T00:00:00Z' }, periodo),
    ).toBe(false)
  })

  it('un reporte sin fechas no se usa', () => {
    expect(cubreElPeriodo({}, periodo)).toBe(false)
  })
})
