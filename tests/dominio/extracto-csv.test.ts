import { describe, it, expect } from 'vitest'
import {
  importeConSigno,
  leerExtracto,
  ubicarEncabezados,
  MAX_FILAS_PREAMBULO,
} from '@/lib/conciliacion/extracto-csv'
import { partirCsv } from '@/lib/canales/csv'

/**
 * Lector del extracto bancario (Bloque C, objetivo 10).
 *
 * Los tres problemas que este formato trae de verdad, cada uno con su caso:
 * el preámbulo antes de la tabla, las dos formas de expresar el importe, y el
 * formato local de los números.
 */

const PREAMBULO = `Banco de prueba;;;
Titular: HOTEL BLANCA PATAGONIA SRL;;;
Cuenta corriente en pesos 000-12345/6;;;
Período: 01/09/2026 al 30/09/2026;;;
`

const CON_DEBITO_CREDITO = `${PREAMBULO}Fecha;Descripción;Débito;Crédito;Saldo
05/09/2026;COMPRA TARJ DEB ANONIMA;3.500,50;;1.200.000,00
06/09/2026;TRANSFERENCIA RECIBIDA MP;;148.000,00;1.348.000,00
30/09/2026;SALDO AL CIERRE;;;1.348.000,00
`

describe('ubicar los encabezados', () => {
  it('los encuentra después del preámbulo del banco', () => {
    /*
      El export del banco antepone titular, cuenta y período. Un lector que asuma
      que la fila 1 son los encabezados no encuentra ninguna columna y devuelve
      cero movimientos **sin fallar**, que es el peor resultado posible.
    */
    const ubicacion = ubicarEncabezados(partirCsv(CON_DEBITO_CREDITO))

    expect(ubicacion).not.toBeNull()
    expect(ubicacion?.fila, 'la tabla empieza en la 5.ª línea del archivo').toBe(4)
    expect(ubicacion?.mapa.debito).toBe(2)
    expect(ubicacion?.mapa.credito).toBe(3)
  })

  it('no busca para siempre', () => {
    const relleno = Array.from({ length: MAX_FILAS_PREAMBULO + 3 }, () => 'basura;basura').join('\n')
    const tarde = `${relleno}\nFecha;Descripción;Importe\n05/09/2026;X;100`

    expect(ubicarEncabezados(partirCsv(tarde))).toBeNull()
  })

  it('sin columna de importe no sirve, aunque haya fecha', () => {
    expect(ubicarEncabezados(partirCsv('Fecha;Descripción\n05/09/2026;X'))).toBeNull()
  })
})

describe('el importe con signo', () => {
  it('el débito sale en negativo y el crédito en positivo', () => {
    /*
      El error que este caso previene: leer dos columnas positivas como si fueran
      una sola con signo convierte todos los gastos en ingresos, y el mes cierra
      exactamente al revés.
    */
    const mapa = { fecha: 0, descripcion: 1, importe: null, debito: 2, credito: 3, referencia: null }

    expect(importeConSigno(['', '', '3.500,50', ''], mapa)).toBe(-3500.5)
    expect(importeConSigno(['', '', '', '148.000,00'], mapa)).toBe(148_000)
  })

  it('con una sola columna se respeta el signo del archivo', () => {
    const mapa = { fecha: 0, descripcion: 1, importe: 2, debito: null, credito: null, referencia: null }

    expect(importeConSigno(['', '', '-3.500,50'], mapa)).toBe(-3500.5)
    expect(importeConSigno(['', '', '148.000,00'], mapa)).toBe(148_000)
  })

  it('una fila sin importe no vale cero: no vale', () => {
    // Devolver 0 la metería en el resumen del mes como un movimiento real de $0.
    const mapa = { fecha: 0, descripcion: 1, importe: null, debito: 2, credito: 3, referencia: null }
    expect(importeConSigno(['', '', '', ''], mapa)).toBeNull()
  })
})

describe('leer un extracto completo', () => {
  it('lee los movimientos y descarta la fila de saldo', () => {
    const r = leerExtracto(CON_DEBITO_CREDITO, { moneda: 'ARS', cuenta: 'CC $' })

    expect(r.error).toBeNull()
    expect(r.movimientos).toHaveLength(2)
    expect(r.movimientos[0]).toMatchObject({
      origen: 'banco',
      cuenta: 'CC $',
      fecha: '2026-09-05',
      monto: -3500.5,
      moneda: 'ARS',
    })
    expect(r.movimientos[1].monto).toBe(148_000)

    // «SALDO AL CIERRE» no tiene fecha en la columna de fecha: cae en descartadas
    // con su motivo, que es lo esperado y no un error.
    expect(r.descartadas).toHaveLength(1)
    expect(
      r.descartadas[0].fila,
      'la fila se cuenta desde el principio del archivo, sin las líneas en blanco',
    ).toBe(8)
  })

  it('el número de fila NO cuenta las líneas en blanco, y por eso no se promete «línea de Excel»', () => {
    /*
      `partirCsv` descarta las filas totalmente vacías. Este caso fija que el
      número que se muestra es la posición entre las filas con contenido: decir
      «línea 8» cuando en Excel es la 9 manda a mirar la fila equivocada.
    */
    const conBlanco = `Fecha;Concepto;Importe

05/09/2026;OK;-100
;SIN FECHA;-200
`
    const r = leerExtracto(conBlanco)

    expect(r.movimientos).toHaveLength(1)
    expect(r.descartadas[0].fila).toBe(3)
  })

  it('la moneda la pone quien importa, no el archivo', () => {
    /*
      El extracto de una caja de ahorro en pesos y el de una en dólares son
      idénticos salvo por el encabezado del banco. Deducirla mal sumaría dólares
      como pesos en el resumen del mes.
    */
    const r = leerExtracto(CON_DEBITO_CREDITO, { moneda: 'USD' })
    expect(r.movimientos.every((m) => m.moneda === 'USD')).toBe(true)
  })

  it('avisa cuando una fecha es ambigua', () => {
    // `03/04/2026` es el 3 de abril o el 4 de marzo, y el archivo no lo dice.
    const r = leerExtracto('Fecha;Concepto;Importe\n03/04/2026;X;-100')

    expect(r.fechasAmbiguas).toBe(true)
    expect(r.movimientos[0].fecha, 'se asume día/mes, como en el informe de Booking').toBe(
      '2026-04-03',
    )
  })

  it('el mismo archivo dos veces da los mismos identificadores', () => {
    // Es lo que hace que reimportarlo no duplique nada en la base.
    const a = leerExtracto(CON_DEBITO_CREDITO)
    const b = leerExtracto(CON_DEBITO_CREDITO)

    expect(b.movimientos.map((m) => m.externalId)).toEqual(a.movimientos.map((m) => m.externalId))
  })

  it('usa la referencia del banco cuando el archivo la trae', () => {
    const con = `Fecha;Concepto;Importe;Nro operación
05/09/2026;TRANSFERENCIA;148000;OP-77123`

    expect(leerExtracto(con).movimientos[0].externalId).toBe('OP-77123')
  })

  it('un archivo que no se entiende se rechaza, no importa cero filas en silencio', () => {
    const r = leerExtracto('esto;no;es;un;extracto\n1;2;3;4;5')

    expect(r.error).toContain('No se encontraron las columnas')
    expect(r.movimientos).toHaveLength(0)
  })

  it('un archivo vacío no rompe', () => {
    expect(leerExtracto('').error).toBe('El archivo está vacío.')
  })

  it('lee también un archivo separado por comas', () => {
    // Excel en configuración regional española exporta con punto y coma; el mismo
    // banco desde otra máquina puede exportar con coma.
    const r = leerExtracto('Fecha,Concepto,Importe\n2026-09-05,PAGO PROVEEDOR,"-1,234.56"')

    expect(r.movimientos).toHaveLength(1)
    expect(r.movimientos[0].monto).toBe(-1234.56)
  })
})
