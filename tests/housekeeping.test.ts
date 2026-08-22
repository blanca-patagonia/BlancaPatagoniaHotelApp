import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_PRIORIDAD,
  MOTIVOS_PRIORIDAD,
  PRIORIDADES,
  accionMucama,
  avance,
  contadores,
  contadoresPorMucama,
  ordenarPorPrioridad,
  prioridadDe,
  siguienteEstadoMucama,
  type UnidadHousekeeping,
} from '@/lib/domain/housekeeping'

/**
 * Lo que se prueba acá es la **prioridad**, que es lo único que convierte una lista
 * de veinte habitaciones en un orden de trabajo. El caso que importa: una sucia con
 * llegada hoy es urgente, porque es el único en que la demora tiene consecuencia
 * visible para el huésped — llegar a una habitación sin hacer.
 */

let n = 0
function unidad(over: Partial<UnidadHousekeeping> = {}): UnidadHousekeeping {
  n++
  return {
    id: `u${n}`,
    nombre: `10${n}`,
    estado: 'sucia',
    asignadaA: null,
    tipo: 'Doble',
    ocupada: false,
    saleHoy: false,
    llegaHoy: false,
    enReparacion: false,
    ...over,
  }
}

describe('prioridadDe', () => {
  it('sucia con llegada hoy es URGENTE', () => {
    expect(prioridadDe(unidad({ estado: 'sucia', llegaHoy: true }))).toBe('urgente')
  })

  it('sucia que se desocupó hoy es alta', () => {
    expect(prioridadDe(unidad({ estado: 'sucia', saleHoy: true }))).toBe('alta')
  })

  it('la llegada gana sobre la salida', () => {
    // Rotación en el día: sale uno a las 10 y entra otro a las 15. Lo que manda es
    // que hay alguien esperando.
    expect(prioridadDe(unidad({ estado: 'sucia', saleHoy: true, llegaHoy: true }))).toBe('urgente')
  })

  it('sucia sin movimiento es normal', () => {
    expect(prioridadDe(unidad({ estado: 'sucia' }))).toBe('normal')
  })

  it('limpia e inspeccionada no tienen tarea', () => {
    expect(prioridadDe(unidad({ estado: 'limpia' }))).toBe('sin_tarea')
    expect(prioridadDe(unidad({ estado: 'inspeccionada' }))).toBe('sin_tarea')
  })

  it('bloqueada no es tarea de limpieza, ni siquiera con llegada hoy', () => {
    // Mandar a alguien a limpiar una habitación con una cañería rota es hacerle
    // perder el viaje. Si además hay una llegada, el problema es de recepción.
    expect(prioridadDe(unidad({ estado: 'bloqueada', llegaHoy: true }))).toBe('sin_tarea')
  })

  it('en reparación tampoco, aunque el estado diga sucia', () => {
    expect(prioridadDe(unidad({ estado: 'sucia', enReparacion: true, llegaHoy: true }))).toBe(
      'sin_tarea',
    )
  })

  it('cada prioridad tiene etiqueta y motivo', () => {
    // «Urgente» sin motivo no dice qué hacer.
    for (const p of PRIORIDADES) {
      expect(ETIQUETAS_PRIORIDAD[p]).toBeTruthy()
      expect(MOTIVOS_PRIORIDAD[p]).toBeTruthy()
    }
  })
})

describe('ordenarPorPrioridad', () => {
  it('pone las urgentes primero y las sin tarea al final', () => {
    const lista = [
      unidad({ nombre: '105', estado: 'limpia' }),
      unidad({ nombre: '103', estado: 'sucia' }),
      unidad({ nombre: '101', estado: 'sucia', llegaHoy: true }),
      unidad({ nombre: '102', estado: 'sucia', saleHoy: true }),
    ]

    expect(ordenarPorPrioridad(lista).map((u) => u.nombre)).toEqual(['101', '102', '103', '105'])
  })

  it('dentro de la misma prioridad ordena por nombre de unidad', () => {
    // Para que el recorrido sea el del pasillo y no cambie en cada carga.
    const lista = [
      unidad({ nombre: '110', estado: 'sucia', llegaHoy: true }),
      unidad({ nombre: '102', estado: 'sucia', llegaHoy: true }),
      unidad({ nombre: '9', estado: 'sucia', llegaHoy: true }),
    ]

    // Orden numérico, no alfabético: «9» va antes que «102».
    expect(ordenarPorPrioridad(lista).map((u) => u.nombre)).toEqual(['9', '102', '110'])
  })

  it('no muta la lista original', () => {
    const lista = [unidad({ nombre: 'B' }), unidad({ nombre: 'A' })]
    ordenarPorPrioridad(lista)
    expect(lista[0].nombre).toBe('B')
  })
})

describe('contadores', () => {
  const lista = [
    unidad({ estado: 'sucia', llegaHoy: true }),
    unidad({ estado: 'sucia' }),
    unidad({ estado: 'limpia' }),
    unidad({ estado: 'inspeccionada' }),
    unidad({ estado: 'bloqueada' }),
  ]

  it('cuenta cada estado', () => {
    const c = contadores(lista)
    expect(c.asignadas).toBe(5)
    expect(c.faltantes).toBe(2)
    expect(c.limpiadas).toBe(1)
    expect(c.inspeccionadas).toBe(1)
    expect(c.fueraDeServicio).toBe(1)
  })

  it('las faltantes NO incluyen las bloqueadas', () => {
    // Si las contara, el turno nunca cerraría en cero y el número dejaría de servir
    // para saber si falta trabajo.
    expect(contadores([unidad({ estado: 'bloqueada' })]).faltantes).toBe(0)
  })

  it('cuenta cuántas de las faltantes son urgentes', () => {
    expect(contadores(lista).urgentes).toBe(1)
  })

  it('una lista vacía da todo en cero', () => {
    expect(contadores([])).toEqual({
      asignadas: 0,
      limpiadas: 0,
      inspeccionadas: 0,
      faltantes: 0,
      fueraDeServicio: 0,
      urgentes: 0,
    })
  })
})

describe('avance', () => {
  it('mide sobre el trabajo real, descontando las fuera de servicio', () => {
    // Si no se descontaran, el avance nunca llegaría a 100 % y dejaría de significar
    // «terminé».
    const c = contadores([
      unidad({ estado: 'limpia' }),
      unidad({ estado: 'inspeccionada' }),
      unidad({ estado: 'bloqueada' }),
    ])
    expect(avance(c)).toBe(100)
  })

  it('la mitad hecha da 50', () => {
    const c = contadores([unidad({ estado: 'limpia' }), unidad({ estado: 'sucia' })])
    expect(avance(c)).toBe(50)
  })

  it('sin trabajo asignado da 100, no división por cero', () => {
    expect(avance(contadores([]))).toBe(100)
  })
})

describe('contadoresPorMucama', () => {
  it('agrupa por responsable', () => {
    const lista = [
      unidad({ asignadaA: 'm1', estado: 'sucia' }),
      unidad({ asignadaA: 'm1', estado: 'limpia' }),
      unidad({ asignadaA: 'm2', estado: 'sucia' }),
    ]

    const grupos = contadoresPorMucama(lista)
    expect(grupos).toHaveLength(2)
    expect(grupos.find((g) => g.mucamaId === 'm1')?.contadores.asignadas).toBe(2)
  })

  it('las sin asignar van al final: son el pendiente de organizar', () => {
    const lista = [
      unidad({ asignadaA: null, estado: 'sucia' }),
      unidad({ asignadaA: 'm1', estado: 'sucia' }),
    ]

    expect(contadoresPorMucama(lista).at(-1)?.mucamaId).toBeNull()
  })

  it('ordena por cuánto falta: primero quien tiene más pendiente', () => {
    const lista = [
      unidad({ asignadaA: 'tranquila', estado: 'limpia' }),
      unidad({ asignadaA: 'cargada', estado: 'sucia' }),
      unidad({ asignadaA: 'cargada', estado: 'sucia' }),
    ]

    expect(contadoresPorMucama(lista)[0].mucamaId).toBe('cargada')
  })
})

describe('siguienteEstadoMucama', () => {
  it('de sucia pasa a limpia con un toque', () => {
    expect(siguienteEstadoMucama('sucia')).toBe('limpia')
    expect(accionMucama('sucia')).toBe('Marcar limpia')
  })

  it('la mucama NO puede inspeccionar su propio trabajo', () => {
    // Si pudiera, el control de calidad lo firmaría quien lo hizo.
    expect(siguienteEstadoMucama('limpia')).toBeNull()
    expect(accionMucama('limpia')).toBeNull()
  })

  it('desde inspeccionada o bloqueada no avanza', () => {
    expect(siguienteEstadoMucama('inspeccionada')).toBeNull()
    expect(siguienteEstadoMucama('bloqueada')).toBeNull()
  })
})
