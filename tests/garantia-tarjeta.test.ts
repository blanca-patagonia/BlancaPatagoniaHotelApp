import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIAS_VIGENCIA_VERIFICACION,
  ESTADOS_VERIFICACION,
  MENSAJES_GARANTIA,
  garantiaSirveParaCobrar,
  motivoGarantiaNoSirve,
  tarjetaEnmascarada,
  ultimoDiaDeVigencia,
  type GarantiaTarjeta,
} from '@/lib/domain/garantia-tarjeta'
import { obtenerProveedor } from '@/lib/payments'

const LLEGADA = '2026-09-15'

function garantia(g: Partial<GarantiaTarjeta>): GarantiaTarjeta {
  return { estado: 'sin_verificar', verificadaEn: null, vencimiento: null, ...g }
}

describe('garantía de tarjeta · cuándo sirve para cobrar', () => {
  it('una verificación reciente y una tarjeta vigente sirven', () => {
    const g = garantia({
      estado: 'verificada',
      verificadaEn: '2026-09-01',
      vencimiento: '12/28',
    })
    expect(garantiaSirveParaCobrar(g, LLEGADA)).toBe(true)
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBeNull()
  })

  it('sin tarjeta cargada, no hay garantía', () => {
    expect(motivoGarantiaNoSirve(garantia({}), LLEGADA)).toBe('sin_tarjeta')
  })

  it('una tarjeta cargada pero sin verificar no alcanza', () => {
    const g = garantia({ estado: 'sin_verificar', vencimiento: '12/28' })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBe('no_verificada')
    expect(garantiaSirveParaCobrar(g, LLEGADA)).toBe(false)
  })

  it('si el emisor la rechazó, NO sirve y el mensaje manda a pedir otra', () => {
    const g = garantia({
      estado: 'rechazada',
      verificadaEn: '2026-09-10',
      vencimiento: '12/28',
    })
    expect(garantiaSirveParaCobrar(g, LLEGADA)).toBe(false)
    expect(MENSAJES_GARANTIA.rechazada).toMatch(/pedile otra/i)
  })

  it('«no se pudo verificar» es distinto de «la rechazaron»', () => {
    // Es la distinción que justifica el campo `noSoportado` del puerto: sin ella,
    // recepción le pediría otra tarjeta a alguien cuya tarjeta está perfecta.
    const g = garantia({
      estado: 'no_soportado',
      verificadaEn: '2026-09-10',
      vencimiento: '12/28',
    })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBe('sin_pasarela')
    expect(MENSAJES_GARANTIA.sin_pasarela).not.toMatch(/pedile otra/i)
  })

  it(`una verificación de más de ${DIAS_VIGENCIA_VERIFICACION} días ya no dice nada`, () => {
    const g = garantia({
      estado: 'verificada',
      verificadaEn: '2026-07-01', // 76 días antes de la llegada
      vencimiento: '12/28',
    })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBe('verificacion_vencida')
  })

  it('justo en el límite de la vigencia todavía sirve', () => {
    const g = garantia({
      estado: 'verificada',
      verificadaEn: '2026-08-16', // exactamente 30 días antes
      vencimiento: '12/28',
    })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBeNull()
  })

  it('una tarjeta vencida a la fecha de la estadía no sirve, aunque esté verificada', () => {
    const g = garantia({
      estado: 'verificada',
      verificadaEn: '2026-09-10',
      vencimiento: '08/26', // venció en agosto; la llegada es en septiembre
    })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBe('tarjeta_vencida')
  })

  it('una tarjeta vence al FINAL del mes impreso, no al principio', () => {
    // `09/26` sirve todo septiembre de 2026, incluido el día 15.
    const g = garantia({
      estado: 'verificada',
      verificadaEn: '2026-09-10',
      vencimiento: '09/26',
    })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBeNull()
    expect(ultimoDiaDeVigencia('09/26')).toBe('2026-09-30')
    expect(ultimoDiaDeVigencia('02/28')).toBe('2028-02-29') // bisiesto
  })

  it('el rechazo del emisor gana sobre la verificación vencida', () => {
    // El orden del mensaje importa: señala lo que de verdad hay que resolver.
    const g = garantia({
      estado: 'rechazada',
      verificadaEn: '2026-01-01',
      vencimiento: '01/20',
    })
    expect(motivoGarantiaNoSirve(g, LLEGADA)).toBe('rechazada')
  })

  it('un vencimiento con formato inválido no se interpreta como vigente', () => {
    expect(ultimoDiaDeVigencia('13/26')).toBeNull()
    expect(ultimoDiaDeVigencia('9/26')).toBeNull()
    expect(ultimoDiaDeVigencia('')).toBeNull()
    expect(ultimoDiaDeVigencia(null)).toBeNull()
  })

  it('cada motivo tiene mensaje y dice qué hacer', () => {
    for (const motivo of Object.keys(MENSAJES_GARANTIA) as (keyof typeof MENSAJES_GARANTIA)[]) {
      expect(MENSAJES_GARANTIA[motivo].length).toBeGreaterThan(40)
    }
  })

  it('la tarjeta se muestra enmascarada, nunca completa', () => {
    expect(tarjetaEnmascarada('4242', 'Visa')).toBe('Visa •••• 4242')
    expect(tarjetaEnmascarada(null, 'Visa')).toBe('Sin tarjeta')
  })
})

describe('el proveedor simulado NO miente sobre la verificación', () => {
  it('declara que no puede verificar tarjetas', () => {
    const p = obtenerProveedor('mercadopago')!
    expect(p.capacidades().verificaTarjeta).toBe(false)
  })

  it('devuelve `noSoportado`, no un «válida» inventado', () => {
    /*
      Es la garantía central del ADR 0025. Un stub que devolviera `ok: true`
      generaría exactamente la confianza falsa que el ADR 0021 evitó con el
      overbooking: recepción dejaría pasar un check-in confiando en una tarjeta
      que nadie probó.
    */
    return obtenerProveedor('stripe')!
      .verificarTarjeta({
        numero: '4111111111111111',
        vencimiento: '12/28',
        titular: 'Prueba',
        cvv: '123',
      })
      .then((r) => {
        expect(r.ok).toBe(false)
        expect(r.noSoportado).toBe(true)
        expect(r.token).toBeUndefined()
      })
  })

  it('no devuelve el número de tarjeta ni el CVV, solo los últimos cuatro', async () => {
    const r = await obtenerProveedor('stripe')!.verificarTarjeta({
      numero: '4111111111111111',
      vencimiento: '12/28',
      titular: 'Prueba',
      cvv: '123',
    })
    expect(r.ultimos4).toBe('1111')
    const serializado = JSON.stringify(r)
    expect(serializado).not.toContain('4111111111111111')
    expect(serializado).not.toContain('123456')
  })
})

/**
 * TEST-CONTRATO DE PCI-DSS.
 *
 * WinPAX guardaba número, vencimiento, autorización y PIN. Este sistema no lo
 * hace, y **eso es una decisión que hay que sostener en el tiempo**, no un
 * estado accidental. Sin este test, la primera migración que agregue una columna
 * `tarjeta_numero` pasaría el CI sin que nadie se entere.
 *
 * Es el mismo criterio del test que ya existe sobre el lector de CSV de Booking.
 */
describe('contrato PCI-DSS · ninguna columna puede guardar un número de tarjeta', () => {
  const DIR = join(process.cwd(), 'supabase', 'migrations')
  const sql = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ archivo: f, texto: readFileSync(join(DIR, f), 'utf8') }))

  /** Nombres que delatan que alguien guardó datos de tarjeta. */
  const PROHIBIDOS = [
    'tarjeta_numero',
    'numero_tarjeta',
    'nro_tarjeta',
    'card_number',
    'pan',
    'cvv',
    'cvc',
    'codigo_seguridad',
    'tarjeta_pin',
    'pin_tarjeta',
  ]

  it('ninguna migración crea una columna con nombre de dato de tarjeta', () => {
    const hallazgos: string[] = []

    for (const { archivo, texto } of sql) {
      // Solo las líneas que definen columnas: los comentarios explicativos SÍ
      // mencionan «PAN» y «CVV», y tienen que poder seguir haciéndolo. De hecho
      // explican por qué no se guardan.
      const lineas = texto
        .split('\n')
        .filter((l) => /^\s*(add column|alter table .* add column|\s+\w+\s+(text|varchar|char|numeric|int))/i.test(l))
        .filter((l) => !l.trim().startsWith('--'))

      for (const linea of lineas) {
        for (const prohibido of PROHIBIDOS) {
          // `\b` para que `pan` no matchee «padron» ni «expandir».
          if (new RegExp(`\\b${prohibido}\\b`, 'i').test(linea)) {
            hallazgos.push(`${archivo}: ${linea.trim()}`)
          }
        }
      }
    }

    expect(
      hallazgos,
      'Se agregó una columna que puede contener datos de tarjeta. Eso saca al hotel del alcance SAQ-A de PCI-DSS (ADR 0025).',
    ).toEqual([])
  })

  it('la migración 0059 declara las restricciones que rechazan un PAN', () => {
    // Las barreras que de verdad impiden guardarlo son de la base, no del
    // código: si desaparecen, este test lo dice.
    const m0059 = sql.find((s) => s.archivo.startsWith('0059'))
    expect(m0059, 'falta la migración 0059').toBeTruthy()
    expect(m0059!.texto).toContain('reservas_tarjeta_token_no_parece_pan')
    expect(m0059!.texto).toContain('reservas_tarjeta_detalle_sin_pan')
    expect(m0059!.texto).toMatch(/\[0-9\]\{12,\}/)
  })

  it('el tipo DatosTarjeta que recibe el puerto NO se persiste en ningún lado', () => {
    // `datos.numero` solo puede aparecer dentro de lib/payments (donde se usa
    // para llamar a la pasarela y se descarta). Si aparece en una acción o en
    // una página, alguien lo está por guardar.
    const libPayments = readFileSync(
      join(process.cwd(), 'lib', 'payments', 'index.ts'),
      'utf8',
    )
    // Se usa para calcular los últimos 4 y nada más.
    expect(libPayments).toContain('datos.numero.replace')
    // Y nunca se devuelve entero.
    expect(libPayments).not.toMatch(/numero:\s*datos\.numero/)
  })

  it('los estados de verificación del dominio coinciden con el enum de la base', () => {
    const m0059 = sql.find((s) => s.archivo.startsWith('0059'))!
    for (const estado of ESTADOS_VERIFICACION) {
      expect(m0059.texto, `el enum de la base no tiene «${estado}»`).toContain(`'${estado}'`)
    }
  })
})
