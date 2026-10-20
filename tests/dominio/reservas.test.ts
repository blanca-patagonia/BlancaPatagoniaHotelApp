import { describe, it, expect } from 'vitest'
import {
  ESTADOS_RESERVA,
  ETIQUETAS_ESTADO_RESERVA,
  puedeTransicionar,
  transicionesPosibles,
  esTerminal,
  ocupaInventario,
  parsearBusquedaFechas,
} from '@/lib/domain/reservas'

describe('máquina de estados de la reserva', () => {
  it('define una etiqueta para cada estado', () => {
    for (const e of ESTADOS_RESERVA) {
      expect(ETIQUETAS_ESTADO_RESERVA[e]).toBeTruthy()
    }
  })

  it('permite el flujo feliz pendiente → confirmada → pagada → in_house → checkout', () => {
    expect(puedeTransicionar('pendiente', 'confirmada')).toBe(true)
    expect(puedeTransicionar('confirmada', 'pagada')).toBe(true)
    expect(puedeTransicionar('pagada', 'in_house')).toBe(true)
    expect(puedeTransicionar('in_house', 'checkout')).toBe(true)
  })

  it('rechaza transiciones inválidas', () => {
    expect(puedeTransicionar('pendiente', 'checkout')).toBe(false)
    expect(puedeTransicionar('checkout', 'in_house')).toBe(false)
    expect(puedeTransicionar('cancelada', 'confirmada')).toBe(false)
  })

  it('marca los estados terminales', () => {
    expect(esTerminal('checkout')).toBe(true)
    expect(esTerminal('cancelada')).toBe(true)
    expect(esTerminal('no_show')).toBe(true)
    expect(esTerminal('pendiente')).toBe(false)
  })

  it('identifica los estados que ocupan inventario', () => {
    expect(ocupaInventario('confirmada')).toBe(true)
    expect(ocupaInventario('in_house')).toBe(true)
    expect(ocupaInventario('cancelada')).toBe(false)
    expect(ocupaInventario('checkout')).toBe(false)
  })

  it('una reserva confirmada puede cancelarse o marcarse no-show', () => {
    expect(transicionesPosibles('confirmada')).toContain('cancelada')
    expect(transicionesPosibles('confirmada')).toContain('no_show')
  })
})

/*
 * Bug de regresión (auditoría de calidad 2026-09-09): con el check-out
 * anterior o igual al check-in, `app/panel/reservas/nueva` no mostraba nada
 * — ni resultados ni error, un botón "Buscar disponibilidad" que parecía no
 * hacer nada. La pantalla ahora usa esta función pura para decidir qué
 * mostrar; este test cubre exactamente el caso que rompía.
 */
describe('parsearBusquedaFechas (alta de mostrador)', () => {
  it('un rango válido queda "buscado" y no "inválido"', () => {
    const r = parsearBusquedaFechas('2026-09-10', '2026-09-13')
    expect(r.buscado).toBe(true)
    expect(r.invalida).toBe(false)
  })

  it('check-out anterior al check-in: inválida, no buscada — y no en blanco', () => {
    const r = parsearBusquedaFechas('2026-09-15', '2026-09-10')
    expect(r.buscado).toBe(false)
    expect(r.invalida).toBe(true)
  })

  it('check-out igual al check-in (cero noches): también inválida', () => {
    const r = parsearBusquedaFechas('2026-09-10', '2026-09-10')
    expect(r.buscado).toBe(false)
    expect(r.invalida).toBe(true)
  })

  it('sin haber buscado todavía (primera carga de la pantalla): ni buscado ni inválida', () => {
    const r = parsearBusquedaFechas(undefined, undefined)
    expect(r.buscado).toBe(false)
    expect(r.invalida).toBe(false)
  })

  it('solo un parámetro presente: tampoco es un intento de búsqueda inválido', () => {
    expect(parsearBusquedaFechas('2026-09-10', undefined).invalida).toBe(false)
    expect(parsearBusquedaFechas(undefined, '2026-09-10').invalida).toBe(false)
  })

  it('un parámetro con formato raro cuenta como inválida si el otro sí llegó', () => {
    const r = parsearBusquedaFechas('10/09/2026', '2026-09-13')
    expect(r.checkIn).toBe('')
    expect(r.invalida).toBe(true)
  })
})
