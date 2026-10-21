import { describe, it, expect } from 'vitest'
import {
  avisosDelComprobante,
  claveDeComprobante,
  esNotaDeCredito,
  leerQrDeFactura,
  monedaDesdeArca,
  nombreDeComprobante,
  numeroVisible,
  MENSAJES_QR_INVALIDO,
  type MotivoQrInvalido,
} from '@/lib/domain/comprobante-qr'

/**
 * Lectura del QR de una factura electrónica argentina (objetivo 9 del pedido).
 *
 * ── Por qué el QR y no OCR ──────────────────────────────────────────────────
 *
 * El OCR **adivina**: un `8` leído como `3` en el importe da una factura
 * plausible y equivocada que nadie revisa, porque el sistema «ya la cargó». El QR
 * devuelve exactamente lo que el emisor le informó a ARCA. Mismo gesto para quien
 * lo usa —apuntar la cámara— y un resultado autoritativo en vez de probable.
 */

/** Arma un QR como el que imprime un emisor real. */
function qr(datos: Record<string, unknown>, host = 'www.arca.gob.ar'): string {
  const payload = Buffer.from(JSON.stringify(datos), 'utf8').toString('base64')
  return `https://${host}/fe/qr/?p=${payload}`
}

const FACTURA = {
  ver: 1,
  fecha: '2026-09-05',
  cuit: 30712345678,
  ptoVta: 3,
  tipoCmp: 1,
  nroCmp: 1234,
  importe: 185000.5,
  moneda: 'PES',
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 30701234567,
  tipoCodAut: 'E',
  codAut: 75123456789012,
}

describe('leer el QR de una factura', () => {
  it('trae los datos del comprobante tal como los informó el emisor', () => {
    const { comprobante, motivo } = leerQrDeFactura(qr(FACTURA))

    expect(motivo).toBeNull()
    expect(comprobante).toMatchObject({
      cuitEmisor: '30712345678',
      puntoVenta: 3,
      numero: 1234,
      tipoCodigo: 1,
      letra: 'A',
      fecha: '2026-09-05',
      total: 185000.5,
      cae: '75123456789012',
      tipoAutorizacion: 'E',
    })
  })

  it('traduce la moneda de ARCA a ISO', () => {
    /*
      `PES` no existe en ISO 4217 y `DOL` tampoco: son códigos de ARCA. Guardarlos
      tal cual en una columna que el resto del sistema lee como ISO haría que un
      comprobante en pesos no se pueda sumar con nada.
    */
    expect(leerQrDeFactura(qr(FACTURA)).comprobante?.moneda).toBe('ARS')
    expect(leerQrDeFactura(qr({ ...FACTURA, moneda: 'DOL' })).comprobante?.moneda).toBe('USD')
  })

  it('una moneda que el sistema no sabe convertir se rechaza con su motivo', () => {
    // Dejarla pasar haría fallar el `insert` con un error de restricción ilegible.
    expect(leerQrDeFactura(qr({ ...FACTURA, moneda: 'GBP' })).motivo).toBe('moneda')
  })

  it('acepta el dominio histórico de AFIP y el nuevo de ARCA', () => {
    expect(leerQrDeFactura(qr(FACTURA, 'www.afip.gob.ar')).motivo).toBeNull()
    expect(leerQrDeFactura(qr(FACTURA, 'www.arca.gob.ar')).motivo).toBeNull()
  })

  it('acepta también el payload pelado', () => {
    // Algunos lectores devuelven la URL entera y otros sólo el parámetro. Que el
    // sistema acepte las dos evita que quien escanea tenga que saber cuál le tocó.
    const payload = Buffer.from(JSON.stringify(FACTURA), 'utf8').toString('base64')

    expect(leerQrDeFactura(payload).comprobante?.numero).toBe(1234)
  })

  it('acepta base64 url-safe', () => {
    const payload = Buffer.from(JSON.stringify(FACTURA), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    expect(leerQrDeFactura(payload).motivo).toBeNull()
  })

  it('el QR de otra cosa no se interpreta como factura', () => {
    // Un link de pago, la web del proveedor, un wifi. Se dice qué pasó.
    expect(leerQrDeFactura('https://www.google.com/algo').motivo).toBe('no_es_qr_de_factura')
    expect(leerQrDeFactura('https://www.arca.gob.ar/otra-cosa').motivo).toBe('no_es_qr_de_factura')
  })

  it('un QR vacío se distingue de uno ilegible', () => {
    expect(leerQrDeFactura('   ').motivo).toBe('vacio')
    // Caracteres que no son base64: se rechaza por la forma, antes de decodificar.
    expect(leerQrDeFactura('no es base64 ni json!!!').motivo).toBe('base64')
    // Base64 válido que decodifica a algo que no es JSON.
    expect(leerQrDeFactura(Buffer.from('hola', 'utf8').toString('base64')).motivo).toBe('json')
  })

  it('el motivo es el MISMO en el navegador y en el servidor', () => {
    /*
      `atob` lanza ante un carácter inválido y `Buffer.from(x,'base64')` lo ignora
      y devuelve basura. Sin validar la forma antes, el mismo QR ilegible daría
      `base64` en el teléfono y `json` en el servidor, y depurarlo a partir del
      mensaje que vio alguien sería innecesariamente difícil.
    */
    const original = globalThis.atob
    try {
      // @ts-expect-error se quita a propósito para forzar el camino de Node.
      delete globalThis.atob
      expect(leerQrDeFactura('no es base64 ni json!!!').motivo).toBe('base64')
    } finally {
      globalThis.atob = original
    }
  })

  it('una versión desconocida NO se interpreta con las reglas de la 1', () => {
    /*
      Si ARCA publica un formato 2 con otros campos, leerlo con las reglas del 1
      daría un comprobante equivocado con aspecto correcto. Se prefiere pedir
      carga manual.
    */
    expect(leerQrDeFactura(qr({ ...FACTURA, ver: 2 })).motivo).toBe('version')
  })

  it('si falta un dato obligatorio, no se completa con nada', () => {
    expect(leerQrDeFactura(qr({ ...FACTURA, codAut: '' })).motivo).toBe('campos')
    expect(leerQrDeFactura(qr({ ...FACTURA, cuit: 123 })).motivo).toBe('campos')
    expect(leerQrDeFactura(qr({ ...FACTURA, fecha: '05/09/2026' })).motivo).toBe('campos')
    expect(leerQrDeFactura(qr({ ...FACTURA, importe: 'mucho' })).motivo).toBe('campos')
  })

  it('sin cotización declarada vale 1, que no es una suposición', () => {
    // Un comprobante en pesos emitido en pesos no lleva conversión.
    const sinCtz = { ...FACTURA } as Record<string, unknown>
    delete sinCtz.ctz

    expect(leerQrDeFactura(qr(sinCtz)).comprobante?.cotizacion).toBe(1)
  })

  it('todos los motivos tienen mensaje en español', () => {
    const motivos: MotivoQrInvalido[] = [
      'vacio',
      'no_es_qr_de_factura',
      'base64',
      'json',
      'version',
      'campos',
      'moneda',
    ]
    for (const m of motivos) expect(MENSAJES_QR_INVALIDO[m], `falta el mensaje de ${m}`).toBeTruthy()
  })
})

describe('tipos de comprobante', () => {
  it('las notas de crédito restan', () => {
    // Cargar una nota de crédito como un gasto más infla lo que el hotel debe.
    expect(esNotaDeCredito(3)).toBe(true)
    expect(esNotaDeCredito(8)).toBe(true)
    expect(esNotaDeCredito(13)).toBe(true)
    expect(esNotaDeCredito(1)).toBe(false)
    expect(esNotaDeCredito(6)).toBe(false)
  })

  it('un código desconocido no se adivina', () => {
    // Inventar la letra de un comprobante fiscal es el error que después hay que
    // corregir con otro comprobante.
    expect(leerQrDeFactura(qr({ ...FACTURA, tipoCmp: 201 })).comprobante?.letra).toBeNull()
    expect(nombreDeComprobante(201)).toContain('201')
  })

  it('la moneda desconocida devuelve null en vez de pasarse tal cual', () => {
    expect(monedaDesdeArca('PES')).toBe('ARS')
    expect(monedaDesdeArca('CLP')).toBeNull()
  })
})

describe('identidad del comprobante', () => {
  const c = { cuitEmisor: '30712345678', tipoCodigo: 1, puntoVenta: 3, numero: 1234 }

  it('la clave natural es única en todo el país', () => {
    // CUIT del emisor + tipo + punto de venta + número. Es la clave de
    // idempotencia: escanear dos veces la misma factura —cosa que pasa cuando la
    // foto sale movida— no puede cargar el gasto dos veces.
    expect(claveDeComprobante(c)).toBe('30712345678-1-00003-00001234')
    expect(claveDeComprobante({ ...c, numero: 1235 })).not.toBe(claveDeComprobante(c))
    expect(claveDeComprobante({ ...c, tipoCodigo: 6 })).not.toBe(claveDeComprobante(c))
  })

  it('el número se muestra como en el papel', () => {
    expect(numeroVisible(3, 1234)).toBe('0003-00001234')
  })
})

describe('avisos al cargar un comprobante', () => {
  const base = leerQrDeFactura(qr(FACTURA)).comprobante!

  it('avisa si la factura no es para el hotel', () => {
    // El caso real: alguien fotografía la factura equivocada —la de otro cliente,
    // la de su consumo personal— y entraría como un gasto del hotel.
    const avisos = avisosDelComprobante(base, '30-99999999-9')
    expect(avisos.some((a) => a.includes('receptor'))).toBe(true)
  })

  it('no avisa cuando el receptor SÍ es el hotel', () => {
    // El CUIT del hotel se compara sin guiones: en el QR viene sin ellos.
    expect(avisosDelComprobante(base, '30-70123456-7')).toEqual([])
  })

  it('avisa que una nota de crédito resta', () => {
    const nota = leerQrDeFactura(qr({ ...FACTURA, tipoCmp: 3 })).comprobante!
    expect(avisosDelComprobante(nota, null).some((a) => a.includes('resta'))).toBe(true)
  })

  it('los avisos no bloquean: son advertencias', () => {
    // La carga sigue siendo posible. Bloquear obligaría a resolver por fuera del
    // sistema justamente el caso raro, que es el que conviene tener registrado.
    const nota = leerQrDeFactura(qr({ ...FACTURA, tipoCmp: 3 })).comprobante
    expect(nota).not.toBeNull()
  })
})
