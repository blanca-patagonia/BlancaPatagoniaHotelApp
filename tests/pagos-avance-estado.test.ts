import { describe, it, expect } from 'vitest'
import {
  puedeAvanzarEstadoPago,
  resumenPagos,
  estadoSegunPagos,
  type Pago,
} from '@/lib/domain/pagos'
import { caminoDeEstados } from '@/lib/domain/reservas'

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

  it('no mueve un pago cuya plata ya se movió', () => {
    expect(puedeAvanzarEstadoPago('aprobado', 'rechazado')).toBe(false)
    expect(puedeAvanzarEstadoPago('reembolsado', 'aprobado')).toBe(false)
  })

  /*
    El reintento. Es el caso que aparece recién con una pasarela real conectada
    y el que más caro sale: la tarjeta se rechaza por fondos, el huésped pone
    otra y aprueba. Los dos intentos llegan con el MISMO `external_id`, porque
    identifica la intención de pago y no la entrega.

    Si el rechazo trabara la fila, la reserva no se saldaría nunca con la plata
    ya cobrada.
  */
  it('deja que un pago rechazado pase a aprobado cuando el huésped reintenta', () => {
    expect(puedeAvanzarEstadoPago('rechazado', 'aprobado')).toBe(true)
  })

  it('un rechazo no se puede reembolsar: no hay qué devolver', () => {
    expect(puedeAvanzarEstadoPago('rechazado', 'reembolsado')).toBe(false)
  })

  it('un rechazo atrasado no degrada el cobro que ya aprobó', () => {
    // El orden inverso del reintento: la pasarela entrega primero el intento
    // que aprobó y después el que había fallado. `aprobado` es terminal, así
    // que el evento atrasado no toca nada.
    expect(puedeAvanzarEstadoPago('aprobado', 'rechazado')).toBe(false)
  })

  it('ningún estado vuelve a pendiente', () => {
    expect(puedeAvanzarEstadoPago('aprobado', 'pendiente')).toBe(false)
    expect(puedeAvanzarEstadoPago('rechazado', 'pendiente')).toBe(false)
    expect(puedeAvanzarEstadoPago('reembolsado', 'pendiente')).toBe(false)
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

/**
 * La seña confirma la reserva.
 *
 * ── El bug que fija este bloque ────────────────────────────────────────────
 *
 * Apareció al conectar el cobro del portal público, y era el más caro de todos:
 * una reserva de la web nace `pendiente`, y `pendiente → pagada` **no es una
 * transición válida** (`TRANSICIONES` en lib/domain/reservas.ts). El pago se
 * registraba, la transición se descartaba en silencio por inválida y la reserva
 * quedaba `pendiente`. La expiración la liberaba a los 5 días y el hotel
 * revendía la unidad **con la plata del huésped ya cobrada**.
 */
describe('estadoSegunPagos · la seña confirma, la cuenta cubierta paga', () => {
  const impaga = { saldada: false, tieneSenia: false }
  const conSenia = { saldada: false, tieneSenia: true }
  const cubierta = { saldada: true, tieneSenia: true }

  it('una reserva pendiente con la seña cobrada pasa a confirmada', () => {
    // Es la regla del Tarifario: «la reserva se bloquea con el pago de la seña».
    expect(estadoSegunPagos('pendiente', conSenia)).toBe('confirmada')
  })

  it('una reserva pendiente sin ningún pago no se mueve', () => {
    expect(estadoSegunPagos('pendiente', impaga)).toBeNull()
  })

  it('con la cuenta cubierta va a pagada, venga de donde venga', () => {
    expect(estadoSegunPagos('pendiente', cubierta)).toBe('pagada')
    expect(estadoSegunPagos('confirmada', cubierta)).toBe('pagada')
  })

  it('una confirmada con seña pero sin saldar se queda como está', () => {
    // Ya está confirmada: la seña no tiene nada más que hacer.
    expect(estadoSegunPagos('confirmada', conSenia)).toBeNull()
  })

  it('una reserva ya alojada no vuelve a pagada', () => {
    // `in_house` es el dato que le importa a recepción; retroceder a `pagada`
    // haría desaparecer al huésped de la lista de alojados.
    expect(estadoSegunPagos('in_house', cubierta)).toBeNull()
    expect(estadoSegunPagos('checkout', cubierta)).toBeNull()
  })

  it('una cancelada o un no-show no se mueven por un cobro', () => {
    // Qué hacer con esa plata es una decisión del hotel, no del código.
    expect(estadoSegunPagos('cancelada', cubierta)).toBeNull()
    expect(estadoSegunPagos('no_show', cubierta)).toBeNull()
  })
})

describe('caminoDeEstados · el salto que la máquina no tiene', () => {
  it('de pendiente a pagada pasa por confirmada', () => {
    // El caso del huésped que reserva por la web y paga todo de una.
    expect(caminoDeEstados('pendiente', 'pagada')).toEqual(['confirmada', 'pagada'])
  })

  it('un paso directo es un camino de uno', () => {
    expect(caminoDeEstados('pendiente', 'confirmada')).toEqual(['confirmada'])
    expect(caminoDeEstados('confirmada', 'pagada')).toEqual(['pagada'])
  })

  it('al mismo estado el camino es vacío: no hay nada que escribir', () => {
    expect(caminoDeEstados('pagada', 'pagada')).toEqual([])
  })

  it('desde un estado terminal no hay camino a ningún lado', () => {
    expect(caminoDeEstados('cancelada', 'pagada')).toBeNull()
    expect(caminoDeEstados('checkout', 'pagada')).toBeNull()
  })

  it('no inventa caminos hacia atrás', () => {
    expect(caminoDeEstados('pagada', 'pendiente')).toBeNull()
    expect(caminoDeEstados('in_house', 'confirmada')).toBeNull()
  })
})
