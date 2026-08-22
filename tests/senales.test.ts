import { describe, it, expect } from 'vitest'
import { senalEscasez } from '@/lib/domain/senales'

describe('senalEscasez', () => {
  it('avisa cuando queda exactamente una libre', () => {
    expect(senalEscasez(1)).toEqual({
      nivel: 'ultima',
      texto: 'Última libre en estas fechas',
    })
  })

  it('NO avisa con 2 o 3 libres', () => {
    // Es la corrección que motivó el módulo: con el inventario real del hotel
    // —seis de los diez tipos tienen una sola unidad y el máximo es 3— avisar
    // con 3 o menos hacía aparecer la señal en las nueve opciones, todos los
    // días, aunque no hubiera ni una reserva. Una alerta permanente no informa.
    expect(senalEscasez(2)).toBeNull()
    expect(senalEscasez(3)).toBeNull()
  })

  it('no dice nada cuando hay lugar de sobra', () => {
    expect(senalEscasez(4)).toBeNull()
    expect(senalEscasez(15)).toBeNull()
  })

  it('no dice nada cuando no queda nada', () => {
    // Sin lugar la tarjeta ya muestra «Sin lugar»: una señal de disponibilidad
    // ahí sería contradictoria.
    expect(senalEscasez(0)).toBeNull()
    expect(senalEscasez(-1)).toBeNull()
  })

  it('tolera un valor no numérico sin romper la pantalla', () => {
    expect(senalEscasez(Number('x'))).toBeNull()
  })
})
