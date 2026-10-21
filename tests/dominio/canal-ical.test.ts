import { describe, it, expect } from 'vitest'
import {
  desdoblar,
  extraerEventos,
  interpretarFechaIcal,
  interpretarIcalBooking,
  nombreDeSummary,
  parsearPropiedad,
} from '@/lib/canales/ical'

/**
 * El feed iCal de Booking es la vía más barata para reflejar la ocupación, y la
 * que trae menos datos. Lo que se prueba acá:
 *
 * · el **desdoblado** de líneas de RFC 5545, sin el cual un `SUMMARY` largo queda
 *   partido y el apellido se pierde;
 * · que `DTEND` se tome **como viene**, porque ya es exclusivo — restarle un día
 *   dejaría todas las estadías una noche cortas;
 * · que un feed sin nombre de huésped no se descarte: la ocupación vale igual.
 */

/** Feed con la forma que devuelve el extranet de Booking. */
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Booking.com//Calendar//EN',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260925',
  'DTEND;VALUE=DATE:20260928',
  'SUMMARY:CLOSED - Pérez',
  'UID:4123456789-1@booking.com',
  'DESCRIPTION:Reserva de Booking.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261001',
  'DTEND;VALUE=DATE:20261003',
  'SUMMARY:CLOSED',
  'UID:4987654321-1@booking.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('desdoblar', () => {
  it('une la línea de continuación que empieza con espacio', () => {
    // RFC 5545 corta a 75 octetos. Sin desdoblar, el apellido se pierde.
    const texto = 'SUMMARY:CLOSED - Un apellido muy\r\n  largo que sigue acá'
    expect(desdoblar(texto)).toEqual(['SUMMARY:CLOSED - Un apellido muy largo que sigue acá'])
  })

  it('une también con tabulación', () => {
    expect(desdoblar('SUMMARY:algo\n\tmas')).toEqual(['SUMMARY:algomas'])
  })

  it('no toca las líneas normales', () => {
    expect(desdoblar('A:1\r\nB:2')).toEqual(['A:1', 'B:2'])
  })

  it('una continuación al principio no rompe', () => {
    expect(desdoblar(' huerfana')).toEqual([' huerfana'])
  })
})

describe('parsearPropiedad', () => {
  it('separa nombre, parámetros y valor', () => {
    expect(parsearPropiedad('DTSTART;VALUE=DATE:20260925')).toEqual({
      nombre: 'DTSTART',
      parametros: { VALUE: 'DATE' },
      valor: '20260925',
    })
  })

  it('funciona sin parámetros', () => {
    expect(parsearPropiedad('UID:abc@booking.com')).toEqual({
      nombre: 'UID',
      parametros: {},
      valor: 'abc@booking.com',
    })
  })

  it('el valor puede contener dos puntos', () => {
    // Sólo el PRIMER `:` separa. Un URL en el valor tiene otro.
    const p = parsearPropiedad('DESCRIPTION:ver https://booking.com/x')
    expect(p?.valor).toBe('ver https://booking.com/x')
  })

  it('respeta las comillas de un parámetro', () => {
    // Un `:` o `;` dentro de un parámetro entrecomillado no separa nada.
    const p = parsearPropiedad('X-PROP;NOTA="a:b;c":valor')
    expect(p?.nombre).toBe('X-PROP')
    expect(p?.parametros.NOTA).toBe('a:b;c')
    expect(p?.valor).toBe('valor')
  })

  it('devuelve null si no hay separador', () => {
    expect(parsearPropiedad('sin dos puntos')).toBeNull()
    expect(parsearPropiedad('')).toBeNull()
  })

  it('el nombre de la propiedad se normaliza a mayúsculas', () => {
    expect(parsearPropiedad('summary:x')?.nombre).toBe('SUMMARY')
  })
})

describe('interpretarFechaIcal', () => {
  it('lee una fecha básica', () => {
    expect(interpretarFechaIcal('20260925')).toBe('2026-09-25')
  })

  it('ignora la parte de hora', () => {
    // La hora del calendario de Booking no es la del check-in real: el horario lo
    // fija el hotel (lib/domain/hotel.ts).
    expect(interpretarFechaIcal('20260925T140000Z')).toBe('2026-09-25')
  })

  it('rechaza valores imposibles en vez de inventar', () => {
    expect(interpretarFechaIcal('20261345')).toBeNull()
    expect(interpretarFechaIcal('2026')).toBeNull()
    expect(interpretarFechaIcal('')).toBeNull()
    expect(interpretarFechaIcal('no es fecha')).toBeNull()
  })
})

describe('nombreDeSummary', () => {
  it('saca el apellido de «CLOSED - Apellido»', () => {
    expect(nombreDeSummary('CLOSED - Pérez')).toBe('Pérez')
  })

  it('devuelve null cuando el summary es sólo estado', () => {
    // Booking usa el mismo calendario para bloqueos manuales; no siempre hay nombre.
    expect(nombreDeSummary('CLOSED')).toBeNull()
    expect(nombreDeSummary('Not available')).toBeNull()
    expect(nombreDeSummary('')).toBeNull()
  })

  it('acepta un nombre compuesto', () => {
    expect(nombreDeSummary('Reserva - Pérez García')).toBe('Pérez García')
  })

  it('desescapa las comas de iCal', () => {
    expect(nombreDeSummary('CLOSED - Pérez\\, Ana')).toBe('Pérez, Ana')
  })

  it('descarta trozos que son sólo números o fechas', () => {
    expect(nombreDeSummary('CLOSED - 20260925')).toBeNull()
  })
})

describe('extraerEventos', () => {
  it('extrae los VEVENT del feed', () => {
    const eventos = extraerEventos(FEED)
    expect(eventos).toHaveLength(2)
    expect(eventos[0]).toMatchObject({
      uid: '4123456789-1@booking.com',
      desde: '2026-09-25',
      hasta: '2026-09-28',
      summary: 'CLOSED - Pérez',
    })
  })

  it('ignora las cabeceras del calendario', () => {
    const eventos = extraerEventos(FEED)
    expect(eventos.every((e) => e.uid.includes('booking.com'))).toBe(true)
  })

  it('descarta un evento sin UID o sin fechas', () => {
    // Sin UID no hay idempotencia; sin fechas no hay ocupación.
    const feed = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260925',
      'DTEND;VALUE=DATE:20260928',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:sin-fechas@booking.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')

    expect(extraerEventos(feed)).toEqual([])
  })

  it('ignora bloques que no son VEVENT', () => {
    const feed = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE',
      'UID:no-soy-un-evento',
      'END:VTIMEZONE',
      'END:VCALENDAR',
    ].join('\n')

    expect(extraerEventos(feed)).toEqual([])
  })

  it('un feed vacío o basura no rompe', () => {
    expect(extraerEventos('')).toEqual([])
    expect(extraerEventos('cualquier cosa')).toEqual([])
  })
})

describe('interpretarIcalBooking', () => {
  it('convierte los eventos en reservas del canal', () => {
    const r = interpretarIcalBooking(FEED, 'HOST-DOBLE')

    expect(r.leidos).toBe(2)
    expect(r.reservas).toHaveLength(2)
    expect(r.rechazados).toEqual([])

    const [primera] = r.reservas
    expect(primera.externalId).toBe('4123456789-1@booking.com')
    expect(primera.canal).toBe('booking')
    expect(primera.tipoUnidadCodigo).toBe('HOST-DOBLE')
    expect(primera.huesped.apellido).toBe('Pérez')
    expect(primera.checkIn).toBe('2026-09-25')
  })

  it('DTEND se toma tal cual: ya es exclusivo, NO se le resta un día', () => {
    // Del 25 al 28 son tres noches (25, 26 y 27), y el 28 la unidad está libre.
    // Es exactamente la semántica de nuestro `daterange [desde, hasta)`. Restarle
    // un día dejaría todas las estadías una noche cortas.
    const r = interpretarIcalBooking(FEED, 'HOST-DOBLE')
    expect(r.reservas[0].checkOut).toBe('2026-09-28')
  })

  it('un evento sin nombre entra igual, con un texto genérico', () => {
    // La ocupación vale aunque no sepamos de quién es: la habitación está vendida.
    const r = interpretarIcalBooking(FEED, 'HOST-DOBLE')
    expect(r.sinNombre).toBe(1)
    expect(r.reservas[1].huesped.apellido).toBe('Reserva Booking')
  })

  it('el tipo de unidad viene de afuera, porque el feed no lo dice', () => {
    // Cada URL del extranet corresponde a una habitación; qué habitación es lo
    // sabe quien configuró la URL, no el contenido del feed.
    const r = interpretarIcalBooking(FEED, 'CAB-4PAX')
    expect(r.reservas.every((x) => x.tipoUnidadCodigo === 'CAB-4PAX')).toBe(true)
  })

  it('rechaza un evento de cero noches', () => {
    const feed = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260925',
      'DTEND;VALUE=DATE:20260925',
      'UID:cero@booking.com',
      'END:VEVENT',
    ].join('\n')

    const r = interpretarIcalBooking(feed, 'X')
    expect(r.reservas).toEqual([])
    expect(r.rechazados[0].motivo).toContain('La salida no es posterior a la entrada.')
  })

  it('no inventa huéspedes ni importes', () => {
    // Poner la capacidad del tipo como pax ensuciaría la grilla y los reportes de
    // ocupación; inventar un importe ensuciaría la conciliación.
    const r = interpretarIcalBooking(FEED, 'HOST-DOBLE')
    expect(r.reservas.every((x) => x.huespedes === 1)).toBe(true)
    expect(r.reservas.every((x) => x.importeCanal === 0)).toBe(true)
    expect(r.reservas.every((x) => x.comision === null)).toBe(true)
  })

  it('no trae contacto: el feed no lo expone', () => {
    const r = interpretarIcalBooking(FEED, 'HOST-DOBLE')
    expect(r.reservas.every((x) => x.huesped.email === null)).toBe(true)
    expect(r.reservas.every((x) => x.huesped.telefono === null)).toBe(true)
  })

  it('emitidaEn es un timestamp válido y comparable', () => {
    const r = interpretarIcalBooking(FEED, 'HOST-DOBLE')
    for (const x of r.reservas) {
      expect(Number.isNaN(Date.parse(x.emitidaEn))).toBe(false)
    }
  })

  it('sobrevive a un feed con líneas plegadas', () => {
    // ⚠️ El espacio inicial de la línea de continuación **es el marcador de
    // plegado** y se descarta (RFC 5545 §3.1). Para que el texto original tenga
    // un espacio ahí, el feed tiene que traer DOS: uno marca el plegado y el otro
    // es el espacio de verdad. Es un detalle contraintuitivo y la razón por la
    // que este test existe con las dos variantes.
    const conEspacioReal = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260925',
      'DTEND;VALUE=DATE:20260928',
      'SUMMARY:CLOSED - Fernández',
      '  de la Torre',
      'UID:plegado@booking.com',
      'END:VEVENT',
    ].join('\r\n')

    expect(interpretarIcalBooking(conEspacioReal, 'X').reservas[0].huesped.apellido).toBe(
      'Fernández de la Torre',
    )
  })

  it('el plegado puede cortar una palabra al medio y se reconstruye entera', () => {
    // Es lo que pasa de verdad: el codificador corta a los 75 octetos, sin mirar
    // dónde terminan las palabras.
    const cortadoAlMedio = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260925',
      'DTEND;VALUE=DATE:20260928',
      'SUMMARY:CLOSED - Fernan',
      ' dez',
      'UID:cortado@booking.com',
      'END:VEVENT',
    ].join('\r\n')

    expect(interpretarIcalBooking(cortadoAlMedio, 'X').reservas[0].huesped.apellido).toBe(
      'Fernandez',
    )
  })
})
