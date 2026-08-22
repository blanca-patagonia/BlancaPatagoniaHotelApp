import { describe, it, expect } from 'vitest'
import {
  cargoPorCancelacion,
  montoCancelacion,
  nochePromedioConIva,
  primeraNocheRealConIva,
  type ReglaCancelacion,
} from '@/lib/domain/cancelacion'

// Política estándar del Tarifario Blanca Patagonia.
const reglas: ReglaCancelacion[] = [
  { desde_dias: 14, cargo: 'ninguno' },
  { desde_dias: 7, cargo: 'primera_noche' },
  { desde_dias: 0, cargo: 'total' },
]

describe('cargoPorCancelacion', () => {
  it('no cobra si se cancela con más de 14 días', () => {
    expect(cargoPorCancelacion(reglas, 20)).toBe('ninguno')
    expect(cargoPorCancelacion(reglas, 14)).toBe('ninguno')
  })
  it('cobra la primera noche entre 14 y 7 días', () => {
    expect(cargoPorCancelacion(reglas, 10)).toBe('primera_noche')
    expect(cargoPorCancelacion(reglas, 7)).toBe('primera_noche')
  })
  it('cobra el total dentro de los 7 días', () => {
    expect(cargoPorCancelacion(reglas, 6)).toBe('total')
    expect(cargoPorCancelacion(reglas, 0)).toBe('total')
  })
})

describe('montoCancelacion', () => {
  const base = { totalEstadia: 500, primeraNocheConIva: 120 }

  it('traduce cada tipo de cargo a un monto', () => {
    expect(montoCancelacion({ ...base, cargo: 'ninguno' })).toBe(0)
    expect(montoCancelacion({ ...base, cargo: 'primera_noche' })).toBe(120)
    expect(montoCancelacion({ ...base, cargo: 'total' })).toBe(500)
  })

  it('el no-show cobra el 100% de la estadía', () => {
    expect(montoCancelacion({ ...base, cargo: 'ninguno', noShow: true })).toBe(500)
  })
})

describe('nochePromedioConIva', () => {
  /**
   * La pantalla de la reserva pasaba `estadias.precio_noche` —que es
   * `totalNeto / noches`, o sea SIN IVA y promediado— junto a `reserva.total`,
   * que sí lleva IVA. Los dos montos que deciden el cargo estaban en unidades
   * distintas y al huésped se le anunciaba un número mal calculado.
   */
  it('lleva la noche a la misma unidad que el total', () => {
    // 3 noches, total con IVA 605 (neto 500 + 21%).
    expect(nochePromedioConIva(605, 3)).toBe(201.67)
  })

  it('el resultado ya NO es el precio neto guardado', () => {
    const totalConIva = 605
    const precioNocheGuardado = 500 / 3 // lo que hay en estadias.precio_noche
    expect(nochePromedioConIva(totalConIva, 3)).not.toBeCloseTo(precioNocheGuardado, 2)
  })

  it('una sola noche devuelve el total entero', () => {
    expect(nochePromedioConIva(242, 1)).toBe(242)
  })

  it('cero noches no divide por cero', () => {
    expect(nochePromedioConIva(605, 0)).toBe(0)
    expect(nochePromedioConIva(605, -2)).toBe(0)
  })

  it('redondea a centavos sin arrastrar punto flotante', () => {
    expect(nochePromedioConIva(0.3, 3)).toBe(0.1)
  })

  it('la suma de las noches reconstruye el total, salvo el centavo de redondeo', () => {
    const total = 605
    const noches = 3
    const porNoche = nochePromedioConIva(total, noches)
    expect(Math.abs(porNoche * noches - total)).toBeLessThanOrEqual(0.01)
  })
})

describe('cancelación · la primera noche real, no el promedio', () => {
  it('con todas las noches iguales da lo mismo que el promedio', () => {
    // Reemplaza al promedio sin cambiar ningún caso que hoy esté bien.
    expect(primeraNocheRealConIva(363, [100, 100, 100])).toBe(nochePromedioConIva(363, 3))
  })

  it('con temporadas distintas cobra la noche que se pierde, no el promedio', () => {
    // Entrada en baja (100) y las dos siguientes en alta (200). El promedio daría
    // 500/3 = 166,67, pero la noche que efectivamente se pierde vale 100.
    const total = 605 // 500 de neto + 21 % de IVA
    const real = primeraNocheRealConIva(total, [100, 200, 200])
    const promedio = nochePromedioConIva(total, 3)

    expect(real).toBeCloseTo(121, 2) // 605 × (100/500)
    expect(real).toBeLessThan(promedio)
  })

  it('también corrige cuando la primera noche es la CARA', () => {
    // El error va en los dos sentidos: acá el promedio cobraría de menos.
    const real = primeraNocheRealConIva(605, [300, 100, 100])
    expect(real).toBeGreaterThan(nochePromedioConIva(605, 3))
  })

  it('reparte el descuento y el IVA igual que el total original', () => {
    // No recalcula nada: toma el total ya guardado —que ya trae descuento, promoción e
    // IVA— y lo distribuye. Por eso la suma de las tres noches devuelve el total.
    const total = 605
    const precios = [100, 200, 200]
    const partes = precios.map(
      (_, i) => primeraNocheRealConIva(total, [precios[i], ...precios.filter((_, j) => j !== i)]),
    )
    // Cada parte es la proporción de su propia noche sobre la misma suma.
    expect(partes.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 1)
  })

  it('una sola noche cobra el total', () => {
    expect(primeraNocheRealConIva(121, [100])).toBe(121)
  })

  it('sin noches devuelve cero', () => {
    expect(primeraNocheRealConIva(500, [])).toBe(0)
  })

  it('con precios en cero cae al promedio, NO a cero', () => {
    // Devolver cero seria afirmar «no se cobra nada», y este dato no respalda esa
    // afirmación sobre el dinero.
    expect(primeraNocheRealConIva(300, [0, 0, 0])).toBe(100)
  })
})
