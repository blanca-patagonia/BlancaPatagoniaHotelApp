import { describe, it, expect } from 'vitest'
import {
  puedeCambiarUnidad,
  motivoRechazoMudanza,
  requiereLimpieza,
  debeRecotizar,
  describirMudanza,
} from '@/lib/domain/mudanzas'
import { ESTADOS_RESERVA, ESTADOS_ACTIVOS } from '@/lib/domain/reservas'

const UNIDAD_A = 'unidad-a'
const UNIDAD_B = 'unidad-b'

describe('mudanzas · qué reservas se pueden mudar', () => {
  it('permite mudar exactamente las reservas que ocupan inventario', () => {
    // Esta equivalencia es la regla: si bloquea una unidad, se puede cambiar.
    for (const estado of ESTADOS_RESERVA) {
      expect(puedeCambiarUnidad(estado)).toBe(ESTADOS_ACTIVOS.includes(estado))
    }
  })

  it('rechaza una estadía que ya terminó', () => {
    expect(motivoRechazoMudanza('checkout', UNIDAD_A, UNIDAD_B)).toBe('finalizada')
  })

  it('rechaza una reserva cancelada o no-show por no ocupar unidad', () => {
    expect(motivoRechazoMudanza('cancelada', UNIDAD_A, UNIDAD_B)).toBe('sin_inventario')
    expect(motivoRechazoMudanza('no_show', UNIDAD_A, UNIDAD_B)).toBe('sin_inventario')
  })

  it('rechaza mudar a la misma unidad, incluso desde un estado válido', () => {
    expect(motivoRechazoMudanza('in_house', UNIDAD_A, UNIDAD_A)).toBe('misma_unidad')
  })

  it('la unidad repetida se detecta antes que el estado', () => {
    // Si no, un check-out a su propia unidad devolvería "finalizada", que es
    // un diagnóstico peor para quien lee el error.
    expect(motivoRechazoMudanza('checkout', UNIDAD_A, UNIDAD_A)).toBe('misma_unidad')
  })

  it('acepta la mudanza en los estados activos', () => {
    for (const estado of ESTADOS_ACTIVOS) {
      expect(motivoRechazoMudanza(estado, UNIDAD_A, UNIDAD_B)).toBeNull()
    }
  })
})

describe('mudanzas · limpieza de la unidad liberada', () => {
  it('solo ensucia si el huésped estaba alojado', () => {
    expect(requiereLimpieza('in_house')).toBe(true)
  })

  it('no le inventa trabajo a mucamas si todavía no hizo el check-in', () => {
    expect(requiereLimpieza('pendiente')).toBe(false)
    expect(requiereLimpieza('confirmada')).toBe(false)
    expect(requiereLimpieza('pagada')).toBe(false)
  })
})

describe('mudanzas · política de tarifa', () => {
  it('dentro del mismo tipo nunca recotiza, aunque se lo pidan', () => {
    // La tarifa se carga por tipo de unidad: recotizar no cambiaría el precio
    // y solo arriesgaría moverlo por un redondeo.
    expect(debeRecotizar('recotizar', false)).toBe(false)
    expect(debeRecotizar('mantener', false)).toBe(false)
  })

  it('recotiza al cambiar de tipo solo si se eligió esa política', () => {
    expect(debeRecotizar('recotizar', true)).toBe(true)
    expect(debeRecotizar('mantener', true)).toBe(false)
  })
})

describe('mudanzas · descripción para la auditoría', () => {
  it('incluye origen, destino y motivo', () => {
    expect(describirMudanza('A-101', 'A-205', 'Calefactor roto')).toBe(
      'Cambio de unidad: A-101 → A-205. Motivo: Calefactor roto',
    )
  })

  it('omite el motivo cuando viene vacío o en blanco', () => {
    expect(describirMudanza('A-101', 'A-205', '   ')).toBe('Cambio de unidad: A-101 → A-205')
  })
})
