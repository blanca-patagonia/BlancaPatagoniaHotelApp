import { describe, it, expect } from 'vitest'
import { vencimientoPagoAgencia, pagoAgenciaVencido } from '@/lib/domain/cuentas'

/*
  Regla pedida por el dueño del hotel (2026-09): una agencia tiene que abonar
  la reserva con un mes de anticipación al check-in del huésped. El vencimiento
  se deriva del check-in, nunca se guarda (migración 0103).
*/

describe('vencimientoPagoAgencia', () => {
  it('resta 30 días al check-in', () => {
    expect(vencimientoPagoAgencia('2026-10-31')).toBe('2026-10-01')
  })

  it('cruza de mes correctamente', () => {
    expect(vencimientoPagoAgencia('2026-01-15')).toBe('2025-12-16')
  })
})

describe('pagoAgenciaVencido', () => {
  const base = { checkIn: '2026-10-31', totalReserva: 1000, totalPagado: 0 }

  it('no está vencido antes de la fecha límite, aunque no haya pagado nada', () => {
    expect(pagoAgenciaVencido(base, '2026-09-30')).toBe(false)
  })

  it('está vencido el mismo día del vencimiento si no pagó nada', () => {
    expect(pagoAgenciaVencido(base, '2026-10-01')).toBe(true)
  })

  it('sigue vencido cualquier día después, mientras no pague', () => {
    expect(pagoAgenciaVencido(base, '2026-10-20')).toBe(true)
  })

  it('no está vencido si ya pagó el total, aunque haya pasado la fecha límite', () => {
    expect(pagoAgenciaVencido({ ...base, totalPagado: 1000 }, '2026-10-15')).toBe(false)
  })

  it('sigue vencido si pagó una parte pero no cubrió el total', () => {
    expect(pagoAgenciaVencido({ ...base, totalPagado: 500 }, '2026-10-15')).toBe(true)
  })

  it('no revienta con un pago que supera el total (redondeo, vuelto, etc.)', () => {
    expect(pagoAgenciaVencido({ ...base, totalPagado: 1000.004 }, '2026-10-15')).toBe(false)
  })

  it('una reserva sin total (todavía sin cotizar) nunca está vencida', () => {
    expect(pagoAgenciaVencido({ ...base, totalReserva: 0 }, '2026-10-15')).toBe(false)
  })
})
