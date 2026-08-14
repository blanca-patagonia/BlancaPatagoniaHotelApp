import { describe, it, expect } from 'vitest'
import { puedeAvanzarEstadoPago, resumenPagos, type Pago } from '@/lib/domain/pagos'

/**
 * Regla que cubre un bug real del webhook (`app/api/webhooks/pagos/[proveedor]`).
 *
 * Una pasarela manda varios eventos sobre el mismo `external_id` a medida que la
 * operación avanza. El webhook insertaba y, ante la restricción única, descartaba
 * el evento repetido entero: la fila quedaba en `pendiente` para siempre.
 *
 * El daño no era cosmético. `resumenPagos` solo suma los pagos `aprobado`, así
 * que la reserva **no se saldaba nunca con la plata ya cobrada**: el huésped
 * llegaba al mostrador figurando como impago. El último bloque de este archivo
 * reproduce esa cadena completa.
 */

describe('puedeAvanzarEstadoPago', () => {
  it('deja que un pago pendiente pase a aprobado', () => {
    expect(puedeAvanzarEstadoPago('pendiente', 'aprobado')).toBe(true)
  })

  it('deja que un pago pendiente pase a rechazado o reembolsado', () => {
    expect(puedeAvanzarEstadoPago('pendiente', 'rechazado')).toBe(true)
    expect(puedeAvanzarEstadoPago('pendiente', 'reembolsado')).toBe(true)
  })

  it('no degrada un cobro ya aprobado si llega un evento atrasado', () => {
    // Las pasarelas no garantizan el orden de entrega: un `pendiente` puede
    // llegar después del `aprobado`.
    expect(puedeAvanzarEstadoPago('aprobado', 'pendiente')).toBe(false)
  })

  it('no mueve un pago que ya está en un estado final', () => {
    expect(puedeAvanzarEstadoPago('aprobado', 'rechazado')).toBe(false)
    expect(puedeAvanzarEstadoPago('rechazado', 'aprobado')).toBe(false)
    expect(puedeAvanzarEstadoPago('reembolsado', 'aprobado')).toBe(false)
  })

  it('un evento repetido con el mismo estado no genera escritura', () => {
    expect(puedeAvanzarEstadoPago('pendiente', 'pendiente')).toBe(false)
    expect(puedeAvanzarEstadoPago('aprobado', 'aprobado')).toBe(false)
  })
})

describe('el pago trabado en pendiente dejaba la reserva impaga', () => {
  const total = 1000

  it('un pago pendiente no salda, aunque el monto alcance', () => {
    const pagos: Pago[] = [{ tipo: 'saldo', monto: 1000, estado: 'pendiente' }]
    expect(resumenPagos(total, pagos).saldada).toBe(false)
  })

  it('el mismo pago, ya avanzado a aprobado, sí salda', () => {
    const pagos: Pago[] = [{ tipo: 'saldo', monto: 1000, estado: 'aprobado' }]
    const resumen = resumenPagos(total, pagos)
    expect(resumen.saldada).toBe(true)
    expect(resumen.saldo).toBe(0)
  })
})
