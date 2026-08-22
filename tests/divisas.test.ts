import { describe, it, expect } from 'vitest'
import {
  MINUTOS_ADVERTENCIA,
  MINUTOS_FRESCURA,
  antiguedadEnMinutos,
  convertirAUSD,
  convertirDesdeUSD,
  esMonedaExtranjera,
  formatearLocal,
  resolverVigente,
  textoAntiguedad,
  textoEstado,
  validarCotizacion,
  validarCotizacionManual,
  type Cotizacion,
} from '@/lib/domain/divisas'

const AHORA = new Date('2026-08-16T12:00:00Z')

/** Cotización de referencia: dólar oficial plausible para la fecha del sistema. */
const oficial: Cotizacion = {
  moneda: 'ARS',
  compra: 1420,
  venta: 1480,
  fuente: 'dolarapi',
  obtenidaEn: '2026-08-16T11:50:00Z',
}

/** Minutos antes de `AHORA`, en ISO. */
function haceMinutos(m: number): string {
  return new Date(AHORA.getTime() - m * 60_000).toISOString()
}

describe('esMonedaExtranjera', () => {
  it('acepta las tres que el mostrador cobra', () => {
    expect(esMonedaExtranjera('ARS')).toBe(true)
    expect(esMonedaExtranjera('BRL')).toBe(true)
    expect(esMonedaExtranjera('EUR')).toBe(true)
  })

  it('rechaza el USD: es la moneda base y no se convierte a sí misma', () => {
    // ADR 0003. Convertir USD a USD con una cotización cualquiera introduciría
    // un error de redondeo sobre la fuente de verdad del sistema.
    expect(esMonedaExtranjera('USD')).toBe(false)
  })

  it('rechaza cualquier otra cosa', () => {
    expect(esMonedaExtranjera('CLP')).toBe(false)
    expect(esMonedaExtranjera('')).toBe(false)
  })
})

describe('validarCotizacion', () => {
  it('acepta una cotización bien formada', () => {
    expect(validarCotizacion(oficial)).toEqual([])
  })

  it('rechaza el cero, que es el valor peligroso', () => {
    // Un cero que llega de la API y se cuela hasta el cobro convierte una cuenta
    // de USD 400 en «$ 0». Es el caso que justifica validar la entrada.
    expect(validarCotizacion({ ...oficial, venta: 0 })).toContain(
      'El valor de venta no es un número positivo.',
    )
    expect(validarCotizacion({ ...oficial, compra: 0 })).toContain(
      'El valor de compra no es un número positivo.',
    )
  })

  it('rechaza null y texto donde iba un número', () => {
    expect(validarCotizacion({ ...oficial, venta: null })).not.toEqual([])
    expect(validarCotizacion({ ...oficial, venta: 'mil' })).not.toEqual([])
    expect(validarCotizacion({ ...oficial, compra: undefined })).not.toEqual([])
  })

  it('rechaza valores negativos', () => {
    expect(validarCotizacion({ ...oficial, venta: -1480 })).not.toEqual([])
  })

  it('rechaza la venta menor que la compra: la fuente invirtió los campos', () => {
    // Ningún banco vende más barato de lo que compra. Si llega así, aplicar el
    // valor de compra como venta le regalaría el spread a cada huésped.
    expect(validarCotizacion({ compra: 1480, venta: 1420, obtenidaEn: oficial.obtenidaEn })).toContain(
      'La venta no puede ser menor que la compra.',
    )
  })

  it('acepta compra igual a venta: no es habitual, pero no es un error', () => {
    expect(validarCotizacion({ compra: 1480, venta: 1480, obtenidaEn: oficial.obtenidaEn })).toEqual([])
  })

  it('rechaza una fecha ilegible', () => {
    expect(validarCotizacion({ ...oficial, obtenidaEn: 'ayer' })).toContain(
      'La fecha de la cotización no es válida.',
    )
    expect(validarCotizacion({ ...oficial, obtenidaEn: 42 })).not.toEqual([])
  })

  it('junta todos los motivos en lugar de cortar en el primero', () => {
    // Quien tenga que corregirlo necesita la lista completa, no el primer síntoma.
    const motivos = validarCotizacion({ compra: 0, venta: -1, obtenidaEn: 'nunca' })
    expect(motivos.length).toBe(3)
  })
})

describe('validarCotizacionManual', () => {
  it('devuelve null cuando el valor sirve', () => {
    expect(validarCotizacionManual(1420, 1480)).toBeNull()
  })

  it('pide un valor por vez, en el orden de los campos en pantalla', () => {
    // Enumerar tres errores juntos obliga a leer una lista para entender qué
    // corregir; es la convención de `validarCambioPassword`.
    expect(validarCotizacionManual(0, 0)).toBe('Escribí un valor de compra mayor que cero.')
    expect(validarCotizacionManual(1420, 0)).toBe('Escribí un valor de venta mayor que cero.')
  })

  it('rechaza la venta menor que la compra', () => {
    expect(validarCotizacionManual(1480, 1420)).toBe(
      'El valor de venta no puede ser menor que el de compra.',
    )
  })

  it('rechaza texto vacío, que es lo que manda un formulario sin completar', () => {
    expect(validarCotizacionManual('', '')).not.toBeNull()
  })
})

describe('antiguedadEnMinutos', () => {
  it('cuenta los minutos transcurridos', () => {
    expect(antiguedadEnMinutos(haceMinutos(10), AHORA)).toBe(10)
    expect(antiguedadEnMinutos(haceMinutos(0), AHORA)).toBe(0)
  })

  it('una fecha futura da 0 y no un negativo', () => {
    // Pasa por desfase de reloj entre el servidor de la API y el nuestro. Un
    // «hace -3 minutos» en pantalla es un error visible sin ser un problema real.
    expect(antiguedadEnMinutos(new Date(AHORA.getTime() + 300_000).toISOString(), AHORA)).toBe(0)
  })

  it('una fecha ilegible es infinitamente vieja', () => {
    // Así nunca gana una comparación de frescura contra una fecha real.
    expect(antiguedadEnMinutos('cualquier cosa', AHORA)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('textoAntiguedad', () => {
  it('usa singular y plural donde corresponde', () => {
    expect(textoAntiguedad(0)).toBe('hace menos de un minuto')
    expect(textoAntiguedad(1)).toBe('hace 1 minuto')
    expect(textoAntiguedad(20)).toBe('hace 20 minutos')
    expect(textoAntiguedad(60)).toBe('hace 1 hora')
    expect(textoAntiguedad(180)).toBe('hace 3 horas')
    expect(textoAntiguedad(60 * 24)).toBe('hace 1 día')
    expect(textoAntiguedad(60 * 72)).toBe('hace 3 días')
  })

  it('una antigüedad infinita no imprime «Infinity»', () => {
    expect(textoAntiguedad(Number.POSITIVE_INFINITY)).toBe('sin fecha')
  })
})

describe('convertirDesdeUSD', () => {
  it('convierte al valor de venta, no al de compra', () => {
    // El Tarifario dice «cotización oficial de venta billete del Banco Nación».
    // Además el hotel compra al precio de venta los dólares que va a rendir:
    // usar el de compra le regala el spread a cada huésped que pague en pesos.
    expect(convertirDesdeUSD(100, oficial)).toBe(148_000)
    expect(convertirDesdeUSD(100, oficial)).not.toBe(142_000)
  })

  it('redondea a dos decimales', () => {
    expect(convertirDesdeUSD(1, { venta: 1480.555 })).toBe(1480.56)
  })

  it('un importe no finito da 0 en vez de propagar NaN a la pantalla', () => {
    // Mismo criterio que `importe()` en lib/domain/moneda.ts.
    expect(convertirDesdeUSD(Number.NaN, oficial)).toBe(0)
    expect(convertirDesdeUSD(Number.POSITIVE_INFINITY, oficial)).toBe(0)
  })

  it('una cotización en cero da 0 y no Infinity', () => {
    expect(convertirDesdeUSD(100, { venta: 0 })).toBe(0)
  })
})

describe('convertirAUSD', () => {
  it('convierte de vuelta al mismo valor de venta', () => {
    expect(convertirAUSD(148_000, oficial)).toBe(100)
  })

  it('la ida y la vuelta cierran', () => {
    // Si una función usara compra y la otra venta, convertir ida y vuelta dejaría
    // diferencias de centavos imposibles de explicar en una conciliación.
    const enPesos = convertirDesdeUSD(250, oficial)
    expect(convertirAUSD(enPesos, oficial)).toBe(250)
  })

  it('una cotización en cero no divide por cero', () => {
    expect(convertirAUSD(148_000, { venta: 0 })).toBe(0)
  })
})

describe('formatearLocal', () => {
  it('pone el símbolo de cada moneda y dos decimales fijos', () => {
    // Dos decimales siempre: en una columna de precios, «145,2» parece un número
    // cortado. Es el mismo criterio que lib/domain/moneda.ts.
    expect(formatearLocal(1480, 'ARS')).toBe('$ 1.480,00')
    expect(formatearLocal(1480, 'BRL')).toBe('R$ 1.480,00')
    expect(formatearLocal(1480, 'EUR')).toBe('€ 1.480,00')
  })

  it('un NaN se muestra como cero', () => {
    expect(formatearLocal(Number.NaN, 'ARS')).toBe('$ 0,00')
  })
})

describe('resolverVigente', () => {
  it('elige la más reciente entre las candidatas', () => {
    const vigente = resolverVigente(
      [
        { cotizacion: { ...oficial, obtenidaEn: haceMinutos(120), venta: 1400 }, origen: 'almacenada' },
        { cotizacion: { ...oficial, obtenidaEn: haceMinutos(5), venta: 1480 }, origen: 'vivo' },
      ],
      AHORA,
    )
    expect(vigente?.venta).toBe(1480)
    expect(vigente?.origen).toBe('vivo')
  })

  it('un valor manual reciente le gana a uno automático viejo', () => {
    // La carga manual es una corrección deliberada de alguien que está mirando el
    // pizarrón del banco. Tratarla como último recurso incondicional la volvería
    // inútil justo cuando más sirve: cuando la API viene dando cualquier cosa.
    const vigente = resolverVigente(
      [
        { cotizacion: { ...oficial, obtenidaEn: haceMinutos(240), venta: 1400 }, origen: 'almacenada' },
        {
          cotizacion: { ...oficial, fuente: 'manual', obtenidaEn: haceMinutos(10), venta: 1500 },
          origen: 'manual',
        },
      ],
      AHORA,
    )
    expect(vigente?.venta).toBe(1500)
    expect(vigente?.origen).toBe('manual')
  })

  it('descarta las inválidas antes de comparar frescura', () => {
    // La más nueva viene en cero: no puede ganar sólo por ser reciente.
    const vigente = resolverVigente(
      [
        { cotizacion: { ...oficial, obtenidaEn: haceMinutos(1), venta: 0 }, origen: 'vivo' },
        { cotizacion: { ...oficial, obtenidaEn: haceMinutos(90), venta: 1480 }, origen: 'almacenada' },
      ],
      AHORA,
    )
    expect(vigente?.venta).toBe(1480)
    expect(vigente?.origen).toBe('almacenada')
  })

  it('devuelve null solo si no hay ninguna candidata válida', () => {
    expect(resolverVigente([], AHORA)).toBeNull()
    expect(
      resolverVigente([{ cotizacion: { ...oficial, venta: 0 }, origen: 'vivo' }], AHORA),
    ).toBeNull()
  })

  it('NUNCA rechaza una cotización por vieja: la marca, y se sigue operando', () => {
    // Es la regla más importante del módulo y un pedido explícito del usuario. Si
    // la API de terceros se cae un sábado a la tarde, la alternativa a cobrar con
    // el valor de la mañana es no poder cobrar. Un hotel que no puede tomar una
    // reserva porque un servicio gratuito no responde es un sistema peor.
    const vigente = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(60 * 24 * 3) }, origen: 'almacenada' }],
      AHORA,
    )
    expect(vigente).not.toBeNull()
    expect(vigente?.venta).toBe(1480)
    expect(vigente?.vencida).toBe(true)
    expect(vigente?.requiereAdvertencia).toBe(true)
  })

  it('marca vencida al cruzar el umbral de frescura', () => {
    const fresca = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(MINUTOS_FRESCURA - 1) }, origen: 'vivo' }],
      AHORA,
    )
    expect(fresca?.vencida).toBe(false)

    const vieja = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(MINUTOS_FRESCURA) }, origen: 'vivo' }],
      AHORA,
    )
    expect(vieja?.vencida).toBe(true)
  })

  it('pide advertencia solo pasado el turno completo, no a los 31 minutos', () => {
    // Vencida y peligrosa no son lo mismo: a los 40 minutos hay que refrescar,
    // a las 12 horas hay que avisarle a quien está cobrando.
    const vencidaNoMas = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(MINUTOS_FRESCURA + 10) }, origen: 'vivo' }],
      AHORA,
    )
    expect(vencidaNoMas?.vencida).toBe(true)
    expect(vencidaNoMas?.requiereAdvertencia).toBe(false)

    const peligrosa = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(MINUTOS_ADVERTENCIA) }, origen: 'vivo' }],
      AHORA,
    )
    expect(peligrosa?.requiereAdvertencia).toBe(true)
  })
})

describe('textoEstado', () => {
  it('siempre dice origen y antigüedad juntos', () => {
    // «$ 1.480» sin fecha al lado es el dato que alguien usa para cobrar creyendo
    // que es de hoy.
    const vigente = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(5) }, origen: 'vivo' }],
      AHORA,
    )!
    expect(textoEstado(vigente)).toBe('En vivo · hace 5 minutos')
  })

  it('suma el pedido de verificación cuando la cotización es muy vieja', () => {
    const vigente = resolverVigente(
      [{ cotizacion: { ...oficial, obtenidaEn: haceMinutos(60 * 20) }, origen: 'almacenada' }],
      AHORA,
    )!
    expect(textoEstado(vigente)).toContain('verificá antes de cobrar')
  })
})
