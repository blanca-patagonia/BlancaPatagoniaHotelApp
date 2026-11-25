import { describe, it, expect } from 'vitest'
import { describirEvento } from '@/lib/domain/errores'

/**
 * «Errores del sistema» mostraba el nombre técnico del evento y nada más. Lo que
 * se prueba es que cada evento caiga en una explicación en palabras del hotel,
 * incluidos los que todavía no existen.
 */
describe('describirEvento', () => {
  it('explica el evento que vio el docente en la demo', () => {
    const d = describirEvento('escritura_accesoria_fallida')
    expect(d.area).toBe('Paso secundario')
    expect(d.explicacion).toMatch(/operación principal se completó/)
  })

  it('agrupa por familia: todo lo del webhook de pagos es «Pagos en línea»', () => {
    expect(describirEvento('webhook_pago_firma_invalida').area).toBe('Pagos en línea')
    expect(describirEvento('webhook_pago_algo_nuevo').area).toBe('Pagos en línea')
  })

  it('no confunde un prefijo con el comienzo de otra palabra', () => {
    // «pagos_x» no es de la familia «pago» (que exige el guion bajo).
    expect(describirEvento('pagosx').area).toBe('Otro')
  })

  it('un evento desconocido tiene igual una explicación', () => {
    const d = describirEvento('evento_que_no_existe')
    expect(d.area).toBe('Otro')
    expect(d.explicacion.length).toBeGreaterThan(0)
  })
})
