import { describe, it, expect } from 'vitest'
import {
  sumarDias,
  diasEntre,
  listaDias,
  parsearPeriodo,
  contieneDia,
  nochesEnVentana,
  inicioFinDeMes,
  hoyISO,
  ZONA_HOTEL,
} from '@/lib/fechas'

describe('utilidades de fecha', () => {
  it('suma días cruzando meses', () => {
    expect(sumarDias('2025-11-28', 5)).toBe('2025-12-03')
  })

  it('cuenta noches entre dos fechas', () => {
    expect(diasEntre('2025-11-10', '2025-11-13')).toBe(3)
  })

  it('genera una lista de días consecutivos', () => {
    expect(listaDias('2025-11-10', 3)).toEqual(['2025-11-10', '2025-11-11', '2025-11-12'])
  })

  describe('«hoy» es el día del hotel, no el del servidor', () => {
    /*
      El hotel está en El Calafate (UTC−3) y Vercel corre en UTC. `hoyISO()`
      devolvía `new Date().toISOString().slice(0, 10)`, o sea el día **en UTC**:
      entre las 21:00 y la medianoche de El Calafate el sistema entero operaba
      con la fecha del día siguiente.

      Estos tests fijan instantes concretos en vez de leer el reloj, así que
      valen a cualquier hora y en cualquier máquina. Con la implementación vieja
      los tres primeros fallan.
    */

    it('a las 21:30 del hotel todavía es el mismo día, aunque en UTC ya sea otro', () => {
      // 00:30 UTC del 31 = 21:30 del 30 en El Calafate.
      const instante = new Date('2026-08-31T00:30:00Z')

      expect(instante.toISOString().slice(0, 10)).toBe('2026-08-31') // lo que daba antes
      expect(hoyISO(instante)).toBe('2026-08-30') // lo que corresponde
    })

    it('un minuto antes de la medianoche del hotel sigue siendo el día que termina', () => {
      // 02:59 UTC del 31 = 23:59 del 30 en El Calafate.
      expect(hoyISO(new Date('2026-08-31T02:59:00Z'))).toBe('2026-08-30')
    })

    it('cruza al día siguiente recién a las 03:00 UTC', () => {
      // 03:00 UTC del 31 = 00:00 del 31 en El Calafate.
      expect(hoyISO(new Date('2026-08-31T03:00:00Z'))).toBe('2026-08-31')
    })

    it('de día, cuando UTC y el hotel coinciden, no cambia nada', () => {
      // 15:00 UTC = 12:00 en El Calafate, mismo día.
      const instante = new Date('2026-08-30T15:00:00Z')
      expect(hoyISO(instante)).toBe('2026-08-30')
      expect(hoyISO(instante)).toBe(instante.toISOString().slice(0, 10))
    })

    it('no depende de la zona del proceso: la resuelve por la del hotel', () => {
      // Si `hoyISO()` mirara la zona local, en un runner distinto daría otra
      // cosa. Se compara contra la zona declarada, que es la única fuente.
      const ahora = new Date()
      const enElHotel = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_HOTEL,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(ahora)

      expect(hoyISO(ahora)).toBe(enElHotel)
    })

    it('la Argentina no aplica horario de verano: enero y julio son ambos UTC−3', () => {
      // Si alguien cambiara la zona por una con DST, esto lo delata.
      expect(hoyISO(new Date('2026-01-15T02:30:00Z'))).toBe('2026-01-14')
      expect(hoyISO(new Date('2026-07-15T02:30:00Z'))).toBe('2026-07-14')
    })

    it('devuelve el formato ISO que espera el resto del módulo', () => {
      expect(hoyISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  it('parsea un daterange de Postgres', () => {
    expect(parsearPeriodo('[2026-07-27,2026-07-30)')).toEqual({
      desde: '2026-07-27',
      hasta: '2026-07-30',
    })
  })

  it('evalúa la pertenencia de un día al período [desde, hasta)', () => {
    const p = { desde: '2025-11-10', hasta: '2025-11-13' }
    expect(contieneDia(p, '2025-11-10')).toBe(true)
    expect(contieneDia(p, '2025-11-12')).toBe(true)
    expect(contieneDia(p, '2025-11-13')).toBe(false) // check-out: libre
  })

  it('prorratea las noches de una estadía dentro de una ventana', () => {
    const { inicio, fin } = inicioFinDeMes('2025-11')
    expect(nochesEnVentana({ desde: '2025-11-10', hasta: '2025-11-13' }, inicio, fin)).toBe(3)
    // Estadía a caballo entre octubre y noviembre → solo cuentan las de noviembre.
    expect(nochesEnVentana({ desde: '2025-10-30', hasta: '2025-11-03' }, inicio, fin)).toBe(2)
    // Fuera de la ventana → 0.
    expect(nochesEnVentana({ desde: '2025-12-01', hasta: '2025-12-05' }, inicio, fin)).toBe(0)
  })

  it('calcula inicio y fin (exclusivo) de un mes, incluido diciembre', () => {
    expect(inicioFinDeMes('2025-11')).toEqual({ inicio: '2025-11-01', fin: '2025-12-01' })
    expect(inicioFinDeMes('2025-12')).toEqual({ inicio: '2025-12-01', fin: '2026-01-01' })
  })
})
