import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { obtenerProveedorCanal } from '@/lib/canales'
import { ProveedorBookingIcal, leerFeeds } from '@/lib/canales/booking-ical'

/**
 * Tests del adaptador de canales.
 *
 * Lo central acá es el **descriptor de capacidades**. El contrato del puerto tiene
 * cinco métodos y ningún proveedor real los cumple todos: los dos que se pueden
 * usar sin ser partner certificado de Booking son de solo lectura. Antes de
 * declarar las capacidades había dos salidas y las dos malas —mentir con
 * `ok: true` o lanzar— y este archivo fija que no se vuelva a ninguna de las dos.
 *
 * El test que más importa es el que verifica que `publicaDisponibilidad` sea
 * `false`: de ahí se deriva la advertencia de overbooking que la pantalla muestra.
 */

const feedFalso = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270310',
  'DTEND;VALUE=DATE:20270313',
  'SUMMARY:CLOSED - Prueba',
  'UID:feed-1@booking.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const fetchOriginal = globalThis.fetch

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('leerFeeds', () => {
  it('lee pares CODIGO=url separados por coma', () => {
    const feeds = leerFeeds('HOST-DOBLE=https://a.com/1,CAB-4PAX=https://b.com/2')
    expect(feeds).toEqual([
      { tipoUnidadCodigo: 'HOST-DOBLE', url: 'https://a.com/1' },
      { tipoUnidadCodigo: 'CAB-4PAX', url: 'https://b.com/2' },
    ])
  })

  it('acepta salto de línea como separador y espacios alrededor', () => {
    // Quien pega estas URLs las copia del extranet a mano.
    const feeds = leerFeeds('  HOST-DOBLE = https://a.com/1 \n CAB-4PAX=https://b.com/2  ')
    expect(feeds).toHaveLength(2)
    expect(feeds[0].tipoUnidadCodigo).toBe('HOST-DOBLE')
    expect(feeds[0].url).toBe('https://a.com/1')
  })

  it('corta en el PRIMER signo igual: la URL del extranet trae varios', () => {
    // `?hotel_id=123&token=abc` tiene dos `=` que no separan nada.
    const feeds = leerFeeds('HOST-DOBLE=https://admin.booking.com/ical?hotel_id=123&t=abc')
    expect(feeds[0].url).toBe('https://admin.booking.com/ical?hotel_id=123&t=abc')
  })

  it('descarta las entradas mal formadas sin tirar el resto', () => {
    // Que un espacio de más rompa la sincronización completa sería desproporcionado.
    const feeds = leerFeeds('basura,HOST-DOBLE=https://a.com/1,=https://b.com,X=noesurl')
    expect(feeds).toEqual([{ tipoUnidadCodigo: 'HOST-DOBLE', url: 'https://a.com/1' }])
  })

  it('sin configuración devuelve lista vacía, no error', () => {
    expect(leerFeeds(undefined)).toEqual([])
    expect(leerFeeds('')).toEqual([])
    expect(leerFeeds('   ')).toEqual([])
  })
})

describe('capacidades del proveedor iCal', () => {
  const p = new ProveedorBookingIcal([])

  it('NO publica disponibilidad: de ahí sale la advertencia de overbooking', () => {
    // Es el test más importante del archivo. Si esto pasara a `true` sin que el
    // proveedor de verdad empuje cupo, la pantalla dejaría de advertir que Booking
    // puede vender una unidad ya vendida.
    expect(p.capacidades().publicaDisponibilidad).toBe(false)
  })

  it('sí trae reservas', () => {
    expect(p.capacidades().traeReservas).toBe(true)
  })

  it('no recibe webhooks ni confirma recepción', () => {
    expect(p.capacidades().recibeWebhook).toBe(false)
    expect(p.capacidades().confirmaRecepcion).toBe(false)
  })

  it('declara que no informa importes ni contacto ni cantidad de huéspedes', () => {
    // La pantalla lo usa para no mostrar «USD 0» como si fuera un precio real.
    const t = p.capacidades().trae
    expect(t.importes).toBe(false)
    expect(t.contacto).toBe(false)
    expect(t.huespedes).toBe(false)
    // El tipo de unidad sí, pero por configuración: cada feed es una habitación.
    expect(t.tipoUnidad).toBe(true)
  })
})

describe('publicarDisponibilidad del proveedor iCal', () => {
  it('devuelve noSoportado en vez de lanzar o de mentir con ok:true', async () => {
    const p = new ProveedorBookingIcal([])
    const r = await p.publicarDisponibilidad([
      { tipoUnidadCodigo: 'X', fecha: '2027-03-10', cupo: 1, precio: 100, moneda: 'USD' },
    ])

    expect(r.ok).toBe(false)
    expect(r.noSoportado).toBe(true)
    // El mensaje tiene que nombrar la consecuencia, no sólo la limitación.
    expect(r.error).toContain('sobrevender')
    expect(r.error).toContain('channel manager')
  })

  it('un error por no soportado se distingue de uno por falla', async () => {
    // Uno se reintenta, el otro no. Sin el flag serían indistinguibles.
    const p = new ProveedorBookingIcal([])
    const r = await p.publicarDisponibilidad([])
    expect(r.noSoportado).toBe(true)
  })
})

describe('traerReservas del proveedor iCal', () => {
  it('lee el feed y devuelve las reservas con el tipo configurado', async () => {
    globalThis.fetch = vi.fn(async () => new Response(feedFalso, { status: 200 })) as never

    const p = new ProveedorBookingIcal([
      { tipoUnidadCodigo: 'HOST-DOBLE', url: 'https://a.com/1' },
    ])
    const reservas = await p.traerReservas()

    expect(reservas).toHaveLength(1)
    expect(reservas[0].tipoUnidadCodigo).toBe('HOST-DOBLE')
    expect(reservas[0].checkIn).toBe('2027-03-10')
  })

  it('un feed caído NO frena a los demás', async () => {
    // Si un tipo de unidad quedó sin sincronizar es mejor tener los otros cuatro
    // que ninguno.
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      if (String(url).includes('roto')) return new Response('', { status: 503 })
      return new Response(feedFalso, { status: 200 })
    }) as never

    const p = new ProveedorBookingIcal([
      { tipoUnidadCodigo: 'ROTO', url: 'https://roto.com/1' },
      { tipoUnidadCodigo: 'HOST-DOBLE', url: 'https://a.com/2' },
    ])

    const reservas = await p.traerReservas()
    expect(reservas).toHaveLength(1)
    expect(reservas[0].tipoUnidadCodigo).toBe('HOST-DOBLE')
  })

  it('una excepción de red no se propaga', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    }) as never

    const p = new ProveedorBookingIcal([{ tipoUnidadCodigo: 'X', url: 'https://a.com/1' }])
    await expect(p.traerReservas()).resolves.toEqual([])
  })

  it('sin feeds configurados devuelve vacío sin llamar a nadie', async () => {
    const espia = vi.fn()
    globalThis.fetch = espia as never

    const p = new ProveedorBookingIcal([])
    expect(await p.traerReservas()).toEqual([])
    expect(espia).not.toHaveBeenCalled()
  })

  it('confirmarRecepcion devuelve true: no hay a quién avisar', async () => {
    // Un `false` haría que el llamador reintente para siempre.
    const p = new ProveedorBookingIcal([])
    expect(await p.confirmarRecepcion()).toBe(true)
  })
})

describe('selección del proveedor de canal', () => {
  it('el simulado declara que puede todo, pero avisa que no es real', () => {
    const p = obtenerProveedorCanal('simulado')
    expect(p.esReal()).toBe(false)
    expect(p.capacidades().publicaDisponibilidad).toBe(true)
  })

  it('el de iCal es real', () => {
    expect(obtenerProveedorCanal('booking-ical').esReal()).toBe(true)
  })

  it('en producción, sin variable declarada, falla en vez de quedar en el simulado', () => {
    // ADR 0018: un simulador activo en producción tiene que ser una decisión
    // declarada, no un descuido. Acá el descuido significaría que las reservas de
    // Booking no entran y nadie se enteraría.
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => obtenerProveedorCanal(undefined)).toThrow(/CANAL_PROVIDER/)
  })

  it('en producción, un nombre mal escrito falla', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => obtenerProveedorCanal('booking-ycal')).toThrow(/no corresponde/)
  })
})
