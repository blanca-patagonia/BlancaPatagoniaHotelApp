import { describe, it, expect } from 'vitest'
import { validarReservaExterna } from '@/lib/domain/canal-externo'

const VALIDO = {
  codigo_habitacion: 'HAB-DBL',
  check_in: '2026-10-10',
  check_out: '2026-10-13',
  huesped: { apellido: 'Pérez', nombre: 'Ana', email: 'ana@ejemplo.com' },
  adultos: 2,
  referencia_externa: 'CM-12345',
}

describe('validarReservaExterna', () => {
  it('acepta un payload completo', () => {
    const r = validarReservaExterna(VALIDO)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.datos.codigoHabitacion).toBe('HAB-DBL')
      expect(r.datos.huesped.apellido).toBe('Pérez')
      expect(r.datos.adultos).toBe(2)
      expect(r.datos.referenciaExterna).toBe('CM-12345')
    }
  })

  it('rechaza un cuerpo que no es un objeto', () => {
    expect(validarReservaExterna('texto').ok).toBe(false)
    expect(validarReservaExterna(null).ok).toBe(false)
    expect(validarReservaExterna([1, 2]).ok).toBe(false)
  })

  it('rechaza sin codigo_habitacion', () => {
    const r = validarReservaExterna({ ...VALIDO, codigo_habitacion: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/codigo_habitacion/)
  })

  it('rechaza fechas con formato inválido', () => {
    const r = validarReservaExterna({ ...VALIDO, check_in: '10/10/2026' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/AAAA-MM-DD/)
  })

  it('rechaza check_out anterior o igual a check_in', () => {
    const r = validarReservaExterna({ ...VALIDO, check_in: '2026-10-13', check_out: '2026-10-13' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/posterior/)
  })

  it('rechaza sin el objeto huesped', () => {
    const sinHuesped: Record<string, unknown> = { ...VALIDO }
    delete sinHuesped.huesped
    const r = validarReservaExterna(sinHuesped)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/huesped/)
  })

  it('rechaza sin apellido del huésped', () => {
    const r = validarReservaExterna({ ...VALIDO, huesped: { nombre: 'Ana' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/apellido/)
  })

  it('rechaza adultos menor a 1', () => {
    expect(validarReservaExterna({ ...VALIDO, adultos: 0 }).ok).toBe(false)
    expect(validarReservaExterna({ ...VALIDO, adultos: -1 }).ok).toBe(false)
  })

  it('rechaza sin referencia_externa: es la que evita duplicar en un reintento', () => {
    const sinReferencia: Record<string, unknown> = { ...VALIDO }
    delete sinReferencia.referencia_externa
    const r = validarReservaExterna(sinReferencia)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/referencia_externa/)
  })

  it('menores y bebes son opcionales y no pueden quedar negativos', () => {
    const r = validarReservaExterna({ ...VALIDO, menores: -3, bebes: -1 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.datos.menores).toBe(0)
      expect(r.datos.bebes).toBe(0)
    }
  })

  it('nombre y email del huésped son opcionales', () => {
    const r = validarReservaExterna({ ...VALIDO, huesped: { apellido: 'Solo Apellido' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.datos.huesped.nombre).toBe('')
      expect(r.datos.huesped.email).toBe('')
    }
  })
})
