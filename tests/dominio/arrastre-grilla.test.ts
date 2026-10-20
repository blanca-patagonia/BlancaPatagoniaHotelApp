import { describe, it, expect } from 'vitest'
import {
  haySolape,
  motivoRechazoArrastre,
  ventanaAlcanza,
  MENSAJES_RECHAZO_ARRASTRE,
  type BloqueArrastrable,
} from '@/lib/domain/arrastre-grilla'
import { ESTADOS_RESERVA, ESTADOS_ACTIVOS } from '@/lib/domain/reservas'

const ORIGEN = 'unidad-origen'
const DESTINO = { id: 'unidad-destino', activa: true }
const LIBRE: never[] = []

const bloque = (extra: Partial<BloqueArrastrable> = {}): BloqueArrastrable => ({
  reservaId: 'reserva-1',
  unidadId: ORIGEN,
  estado: 'confirmada',
  desde: '2026-09-10',
  hasta: '2026-09-13',
  ...extra,
})

describe('arrastre en la grilla · solape de períodos', () => {
  it('el día de rotación NO es un conflicto', () => {
    // Una sale el 12 y otra entra el 12: la habitación se limpia y se vuelve a
    // vender el mismo día. Tratarlo como choque le costaría una noche al hotel
    // por cada salida.
    expect(
      haySolape({ desde: '2026-09-10', hasta: '2026-09-12' }, { desde: '2026-09-12', hasta: '2026-09-14' }),
    ).toBe(false)
  })

  it('una noche compartida sí es un conflicto', () => {
    expect(
      haySolape({ desde: '2026-09-10', hasta: '2026-09-13' }, { desde: '2026-09-12', hasta: '2026-09-14' }),
    ).toBe(true)
  })

  it('un período contenido dentro de otro se pisa', () => {
    expect(
      haySolape({ desde: '2026-09-10', hasta: '2026-09-20' }, { desde: '2026-09-12', hasta: '2026-09-14' }),
    ).toBe(true)
  })

  it('es simétrico: da lo mismo cuál se pregunta primero', () => {
    const a = { desde: '2026-09-10', hasta: '2026-09-13' }
    const b = { desde: '2026-09-11', hasta: '2026-09-20' }
    expect(haySolape(a, b)).toBe(haySolape(b, a))
  })
})

describe('arrastre en la grilla · cuándo se puede soltar', () => {
  it('deja soltar en una unidad libre', () => {
    expect(motivoRechazoArrastre(bloque(), DESTINO, LIBRE)).toBeNull()
  })

  it('rechaza si el destino ya está ocupado en esas fechas', () => {
    const ocupada = [{ desde: '2026-09-11', hasta: '2026-09-15' }]
    expect(motivoRechazoArrastre(bloque(), DESTINO, ocupada)).toBe('ocupada')
  })

  it('deja soltar si el destino se libera justo el día de llegada', () => {
    const sale = [{ desde: '2026-09-05', hasta: '2026-09-10' }]
    expect(motivoRechazoArrastre(bloque(), DESTINO, sale)).toBeNull()
  })

  it('deja soltar si el destino se vuelve a ocupar el día de salida', () => {
    const entra = [{ desde: '2026-09-13', hasta: '2026-09-18' }]
    expect(motivoRechazoArrastre(bloque(), DESTINO, entra)).toBeNull()
  })

  it('rechaza una unidad dada de baja aunque esté libre', () => {
    expect(motivoRechazoArrastre(bloque(), { id: 'x', activa: false }, LIBRE)).toBe('destino_inactivo')
  })

  it('rechaza soltar la reserva sobre su propia unidad', () => {
    expect(motivoRechazoArrastre(bloque(), { id: ORIGEN, activa: true }, LIBRE)).toBe('misma_unidad')
  })

  it('delega los estados en las reglas de mudanza y no los reimplementa', () => {
    // Si mañana cambia el conjunto de estados que ocupan inventario, el arrastre
    // lo sigue solo. Esa es la razón de que este módulo llame a mudanzas.
    for (const estado of ESTADOS_RESERVA) {
      const permitido = motivoRechazoArrastre(bloque({ estado }), DESTINO, LIBRE) === null
      expect(permitido).toBe(ESTADOS_ACTIVOS.includes(estado))
    }
  })

  it('el estado se revisa antes que la ocupación del destino', () => {
    // Una reserva cancelada arrastrada sobre una unidad ocupada tiene que decir
    // «no ocupa inventario», no «está ocupada»: el segundo mensaje manda a
    // liberar una habitación que no hace falta liberar.
    const ocupada = [{ desde: '2026-09-11', hasta: '2026-09-15' }]
    expect(motivoRechazoArrastre(bloque({ estado: 'cancelada' }), DESTINO, ocupada)).toBe(
      'sin_inventario',
    )
  })

  it('todo motivo de rechazo tiene un mensaje escrito', () => {
    const motivos = ESTADOS_RESERVA.map((estado) =>
      motivoRechazoArrastre(bloque({ estado }), { id: ORIGEN, activa: false }, [
        { desde: '2026-09-11', hasta: '2026-09-15' },
      ]),
    ).filter((m) => m !== null)

    for (const motivo of [...motivos, 'ocupada' as const, 'destino_inactivo' as const]) {
      expect(MENSAJES_RECHAZO_ARRASTRE[motivo]).toBeTruthy()
    }
  })
})

describe('arrastre en la grilla · hasta dónde alcanza lo que se ve', () => {
  const ventana = { desde: '2026-09-07', hasta: '2026-09-21' }

  it('un bloque entero dentro de la ventana se puede validar en pantalla', () => {
    // La grilla trae las estadías que se solapan con la ventana. Si el bloque
    // entra entero, cualquier choque posible se solapa con él y por lo tanto ya
    // está en pantalla.
    expect(ventanaAlcanza({ desde: '2026-09-10', hasta: '2026-09-13' }, ventana)).toBe(true)
  })

  it('un bloque que empieza antes de la ventana NO se puede validar en pantalla', () => {
    expect(ventanaAlcanza({ desde: '2026-09-01', hasta: '2026-09-13' }, ventana)).toBe(false)
  })

  it('un bloque que termina después de la ventana tampoco', () => {
    expect(ventanaAlcanza({ desde: '2026-09-10', hasta: '2026-10-02' }, ventana)).toBe(false)
  })

  it('los bordes exactos de la ventana cuentan como adentro', () => {
    expect(ventanaAlcanza({ desde: '2026-09-07', hasta: '2026-09-21' }, ventana)).toBe(true)
  })
})
