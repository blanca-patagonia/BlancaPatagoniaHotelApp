import { describe, it, expect } from 'vitest'
import {
  aAaaammdd,
  armarComprobante,
  cierraElTotal,
  codigoAlicuota,
  codigoComprobante,
  conceptoDeFactura,
  documentoReceptor,
  exigeFechasDeServicio,
  lineasIva,
  monedaArca,
  motivoMonedaInvalida,
  CONCEPTO,
  DOC_TIPO,
  MENSAJES_MONEDA_INVALIDA,
  MENSAJES_NO_ARMABLE,
  type EntradaComprobante,
  type MotivoMonedaInvalida,
  type MotivoNoArmable,
} from '@/lib/domain/wsfev1'

/**
 * Traducción al formato WSFEv1 de ARCA (Bloque D de la auditoría).
 *
 * `SolicitudCae` llevaba lo mínimo para que el simulador devolviera catorce
 * dígitos. Estas son las reglas que WSFEv1 exige de verdad, escritas ahora para
 * no descubrirlas el día del certificado contra una API que rechaza el
 * comprobante entero por un campo y no dice cuál.
 */

const BASE: EntradaComprobante = {
  cuitEmisor: '30712345678',
  tipo: 'A',
  esNotaCredito: false,
  puntoVenta: 1,
  numero: 1234,
  fecha: '2026-09-07',
  total: 121,
  neto: 100,
  exento: 0,
  iva: 21,
  alicuota: 21,
  discriminaIva: true,
  cuitReceptor: '30701234567',
  condicionReceptor: 'responsable_inscripto',
  moneda: 'ARS',
  cotizacion: null,
  tieneProductos: false,
  servicioDesde: '2026-09-01',
  servicioHasta: '2026-09-05',
}

const armar = (over: Partial<EntradaComprobante> = {}) => armarComprobante({ ...BASE, ...over })

describe('códigos de comprobante', () => {
  it('la nota de crédito es otro código, no una bandera', () => {
    /*
      El error más caro posible del módulo: un adapter que ignore la diferencia
      emitiría una FACTURA por el importe que se quería devolver.
    */
    expect(codigoComprobante('A', false)).toBe(1)
    expect(codigoComprobante('A', true)).toBe(3)
    expect(codigoComprobante('B', false)).toBe(6)
    expect(codigoComprobante('B', true)).toBe(8)
    expect(codigoComprobante('C', false)).toBe(11)
    expect(codigoComprobante('C', true)).toBe(13)
  })
})

describe('concepto', () => {
  it('una estadía es un SERVICIO', () => {
    // Mandarlo como producto para «simplificar» hace que el comprobante declare
    // algo que no es.
    expect(conceptoDeFactura(false)).toBe(CONCEPTO.servicios)
  })

  it('con consumos del frigobar es mixto', () => {
    expect(conceptoDeFactura(true)).toBe(CONCEPTO.productosYServicios)
  })

  it('servicios y mixto exigen las fechas del período', () => {
    expect(exigeFechasDeServicio(CONCEPTO.servicios)).toBe(true)
    expect(exigeFechasDeServicio(CONCEPTO.productosYServicios)).toBe(true)
    expect(exigeFechasDeServicio(CONCEPTO.productos)).toBe(false)
  })
})

describe('documento del receptor', () => {
  it('con CUIT va CUIT', () => {
    expect(documentoReceptor('30-70123456-7')).toEqual({ docTipo: 80, docNro: '30701234567' })
  })

  it('sin CUIT es consumidor final: 99 con documento 0', () => {
    /*
      ⚠️ Hay documentación de terceros circulando que dice `5`. Es incorrecta.
      Verificarlo contra el manual oficial es lo que evita que el primer
      comprobante real se rechace.
    */
    expect(documentoReceptor(null)).toEqual({ docTipo: DOC_TIPO.consumidorFinal, docNro: '0' })
    expect(documentoReceptor('')).toEqual({ docTipo: 99, docNro: '0' })
  })

  it('un CUIT incompleto NO se informa como si fuera válido', () => {
    // Mejor consumidor final que un CUIT de 8 dígitos que ARCA va a rechazar.
    expect(documentoReceptor('3070123').docTipo).toBe(99)
  })
})

describe('el arreglo Iva', () => {
  it('la base imponible es el neto MENOS lo exento', () => {
    /*
      En este sistema `exento` es un subconjunto de `neto` y no un sumando
      (ADR 0024, y el check de la 0058 lo impone). Mandar el neto entero como base
      declararía IVA sobre una porción que la ley exime.
    */
    const [linea] = lineasIva({ neto: 100, exento: 40, iva: 12.6, alicuota: 21 })

    expect(linea.baseImp).toBe(60)
    expect(linea.importe).toBe(12.6)
    expect(linea.id, '21 % es el código 5').toBe(5)
  })

  it('todo exento no lleva línea de IVA', () => {
    expect(lineasIva({ neto: 100, exento: 100, iva: 0, alicuota: 21 })).toEqual([])
  })

  it('una alícuota que ARCA no conoce se omite en vez de aproximarse', () => {
    // Un comprobante sin discriminar es visiblemente incorrecto; uno con la
    // alícuota más cercana es sutilmente falso, que es peor.
    expect(lineasIva({ neto: 100, exento: 0, iva: 15, alicuota: 15 })).toEqual([])
    expect(codigoAlicuota(15)).toBeNull()
  })

  it('los códigos son los de ARCA', () => {
    expect(codigoAlicuota(0)).toBe(3)
    expect(codigoAlicuota(10.5)).toBe(4)
    expect(codigoAlicuota(21)).toBe(5)
    expect(codigoAlicuota(27)).toBe(6)
  })
})

describe('moneda', () => {
  it('los códigos son de ARCA, no ISO 4217', () => {
    expect(monedaArca('ARS')).toBe('PES')
    expect(monedaArca('USD')).toBe('DOL')
    expect(monedaArca('CLP')).toBeNull()
  })

  it('en pesos no hace falta cotización', () => {
    expect(motivoMonedaInvalida('ARS', null)).toBeNull()
  })

  it('en moneda extranjera la cotización es obligatoria', () => {
    expect(motivoMonedaInvalida('USD', null)).toBe('sin_cotizacion')
  })

  it('y NO puede ser 1', () => {
    // Declararía que el dólar vale un peso.
    expect(motivoMonedaInvalida('USD', 1)).toBe('cotizacion_uno')
    expect(motivoMonedaInvalida('USD', 1480)).toBeNull()
  })

  it('todos los motivos tienen mensaje', () => {
    const motivos: MotivoMonedaInvalida[] = ['desconocida', 'sin_cotizacion', 'cotizacion_uno']
    for (const m of motivos) expect(MENSAJES_MONEDA_INVALIDA[m]).toBeTruthy()
  })
})

describe('armar el comprobante', () => {
  it('arma una factura A completa', () => {
    const { comprobante, motivo } = armar()

    expect(motivo).toBeNull()
    expect(comprobante).toMatchObject({
      cuitEmisor: '30712345678',
      cbteTipo: 1,
      ptoVta: 1,
      cbteDesde: 1234,
      cbteHasta: 1234,
      cbteFch: '20260907',
      concepto: CONCEPTO.servicios,
      docTipo: 80,
      impTotal: 121,
      impNeto: 100,
      impIVA: 21,
      impOpEx: 0,
      impTotConc: 0,
      impTrib: 0,
      monId: 'PES',
      monCotiz: 1,
      fchServDesde: '20260901',
      fchServHasta: '20260905',
      fchVtoPago: '20260907',
    })
  })

  it('la aritmética cierra, que es lo que ARCA valida', () => {
    /*
      `ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpIVA + ImpTrib`. ARCA rechaza
      el comprobante entero si no da, y el mensaje no dice cuál de los cinco está
      mal.
    */
    const { comprobante } = armar()
    expect(cierraElTotal(comprobante!)).toBe(true)
  })

  it('cierra también con parte exenta', () => {
    // 100 de neto, 40 exento → base 60, IVA 12,60, total 112,60.
    const { comprobante } = armar({ exento: 40, iva: 12.6, total: 112.6 })

    expect(comprobante?.impNeto).toBe(60)
    expect(comprobante?.impOpEx).toBe(40)
    expect(cierraElTotal(comprobante!)).toBe(true)
  })

  it('una factura B no discrimina IVA', () => {
    const { comprobante } = armar({
      tipo: 'B',
      discriminaIva: false,
      neto: 121,
      iva: 0,
      cuitReceptor: null,
    })

    expect(comprobante?.cbteTipo).toBe(6)
    expect(comprobante?.impIVA).toBe(0)
    expect(comprobante?.iva).toEqual([])
    expect(comprobante?.docTipo).toBe(99)
    expect(cierraElTotal(comprobante!)).toBe(true)
  })

  it('sin CUIT del hotel no se puede pedir un CAE', () => {
    expect(armar({ cuitEmisor: null }).motivo).toBe('sin_cuit_emisor')
  })

  it('sin las fechas del período tampoco', () => {
    // Es un servicio: ARCA las exige.
    expect(armar({ servicioDesde: null }).motivo).toBe('sin_fechas_de_servicio')
  })

  it('una nota de crédito tiene que decir qué corrige', () => {
    expect(armar({ esNotaCredito: true }).motivo).toBe('sin_asociado')

    const { comprobante } = armar({ esNotaCredito: true, numeroAsociado: 1200 })
    expect(comprobante?.cbteTipo, 'nota de crédito A').toBe(3)
    expect(comprobante?.cbtesAsoc?.[0], 'asocia la factura A, no otra nota').toEqual({
      tipo: 1,
      ptoVta: 1,
      nro: 1200,
    })
  })

  it('en dólares informa la cotización', () => {
    const { comprobante } = armar({ moneda: 'USD', cotizacion: 1480 })

    expect(comprobante?.monId).toBe('DOL')
    expect(comprobante?.monCotiz).toBe(1480)
  })

  it('en dólares sin cotización no se arma', () => {
    expect(armar({ moneda: 'USD', cotizacion: null }).motivo).toBe('moneda')
  })

  it('todos los motivos tienen mensaje', () => {
    const motivos: MotivoNoArmable[] = [
      'sin_cuit_emisor',
      'moneda',
      'sin_fechas_de_servicio',
      'sin_asociado',
    ]
    for (const m of motivos) expect(MENSAJES_NO_ARMABLE[m], `falta el mensaje de ${m}`).toBeTruthy()
  })
})

describe('formato de fecha', () => {
  it('WSFEv1 quiere yyyymmdd sin guiones', () => {
    expect(aAaaammdd('2026-09-07')).toBe('20260907')
  })
})
