import { describe, it, expect } from 'vitest'
import {
  DIAS_VENTANA_RESENA,
  emparejarResenaConReserva,
  huellaResena,
  ETIQUETAS_VINCULO,
  VINCULOS_RESENA,
  type CandidataResena,
} from '@/lib/domain/resenas-canal'

/**
 * El criterio que decide todo: UNA RESEÑA MAL LIGADA ES PEOR QUE UNA SIN LIGAR.
 *
 * Sin ligar es un dato incompleto que alguien completa en un clic. Mal ligada ensucia
 * el historial de un huesped que no dijo eso y el reporte de una unidad que no tuvo ese
 * problema — y nadie lo detecta, porque no hay nada que se vea roto.
 */

function candidata(over: Partial<CandidataResena> = {}): CandidataResena {
  return {
    reservaId: 'r-1',
    externalId: 'BK-100',
    apellido: 'Pérez',
    checkIn: '2027-05-10',
    checkOut: '2027-05-13',
    ...over,
  }
}

describe('reseñas · emparejar por número de reserva', () => {
  it('liga sola cuando el número coincide', () => {
    const r = emparejarResenaConReserva(
      { reservaExternalId: 'BK-100', autor: 'Cualquiera' },
      [candidata()],
    )
    expect(r.reservaId).toBe('r-1')
    expect(r.vinculo).toBe('automatico')
  })

  it('el número gana sobre el apellido', () => {
    // Si el export trae el número, no hay nada que interpretar.
    const r = emparejarResenaConReserva(
      { reservaExternalId: 'BK-200', autor: 'Pérez', publicadaEn: '2027-05-14' },
      [candidata(), candidata({ reservaId: 'r-2', externalId: 'BK-200', apellido: 'Otro' })],
    )
    expect(r.reservaId).toBe('r-2')
  })

  it('un número que no tenemos NO se liga, y lo dice', () => {
    // Es informacion: esa reserva no se importo, o es de antes de usar el sistema.
    const r = emparejarResenaConReserva(
      { reservaExternalId: 'BK-999', autor: 'Pérez' },
      [candidata()],
    )
    expect(r.reservaId).toBeNull()
    expect(r.motivo).toContain('BK-999')
  })
})

describe('reseñas · emparejar por apellido y fecha', () => {
  it('liga sola con coincidencia ÚNICA en la ventana', () => {
    const r = emparejarResenaConReserva(
      { autor: 'Pérez', publicadaEn: '2027-05-15' },
      [candidata()],
    )
    expect(r.reservaId).toBe('r-1')
    expect(r.vinculo).toBe('automatico')
  })

  it('compara apellidos por contención, en las dos direcciones', () => {
    // Booking publica el nombre como lo puso el huesped: «Pérez», «Ana Pérez»,
    // «Pérez Gómez». Exigir igualdad dejaria sin ligar la mayoria de los casos claros.
    for (const autor of ['Pérez', 'Ana Pérez', 'Pérez Gómez', 'PEREZ']) {
      const r = emparejarResenaConReserva({ autor, publicadaEn: '2027-05-15' }, [candidata()])
      expect(r.reservaId, `no ligó «${autor}»`).toBe('r-1')
    }
  })

  it('ignora acentos', () => {
    const r = emparejarResenaConReserva(
      { autor: 'Perez', publicadaEn: '2027-05-15' },
      [candidata({ apellido: 'Pérez' })],
    )
    expect(r.reservaId).toBe('r-1')
  })

  it('EL CASO CLAVE: dos candidatas del mismo apellido NO ligan ninguna', () => {
    // Dos huespedes con el mismo apellido en la misma semana existen. Elegir una
    // seria adivinar, y adivinar mal ensucia el historial de quien no dijo eso.
    const r = emparejarResenaConReserva({ autor: 'Pérez', publicadaEn: '2027-05-15' }, [
      candidata(),
      candidata({ reservaId: 'r-2', externalId: 'BK-101' }),
    ])
    expect(r.reservaId).toBeNull()
    expect(r.vinculo).toBe('sin_vincular')
    expect(r.motivo).toContain('2 reservas')
    // Y se ofrecen las dos para que alguien elija.
    expect(r.candidatas).toHaveLength(2)
  })

  it('una reseña publicada ANTES del check-out no liga', () => {
    // Booking pide la reseña despues de la estadia: una anterior es de otra cosa.
    const r = emparejarResenaConReserva(
      { autor: 'Pérez', publicadaEn: '2027-05-11' },
      [candidata()],
    )
    expect(r.reservaId).toBeNull()
  })

  it('el mismo día del check-out sí liga', () => {
    const r = emparejarResenaConReserva(
      { autor: 'Pérez', publicadaEn: '2027-05-13' },
      [candidata()],
    )
    expect(r.reservaId).toBe('r-1')
  })

  it('el último día de la ventana liga, el siguiente no', () => {
    const dentro = emparejarResenaConReserva(
      { autor: 'Pérez', publicadaEn: '2027-05-27' }, // 14 días después del 13
      [candidata()],
    )
    expect(dentro.reservaId).toBe('r-1')

    const fuera = emparejarResenaConReserva(
      { autor: 'Pérez', publicadaEn: '2027-05-28' },
      [candidata()],
    )
    expect(fuera.reservaId).toBeNull()
    expect(DIAS_VENTANA_RESENA).toBe(14)
  })

  it('sin fecha de publicación no liga, y lo explica', () => {
    const r = emparejarResenaConReserva({ autor: 'Pérez' }, [candidata()])
    expect(r.reservaId).toBeNull()
    expect(r.motivo).toContain('fecha de publicación')
  })

  it('sin autor no liga', () => {
    const r = emparejarResenaConReserva({ autor: '   ', publicadaEn: '2027-05-15' }, [candidata()])
    expect(r.reservaId).toBeNull()
  })

  it('sin candidatas explica que no hay ninguna cerca', () => {
    const r = emparejarResenaConReserva({ autor: 'Pérez', publicadaEn: '2027-05-15' }, [])
    expect(r.reservaId).toBeNull()
    expect(r.motivo).toContain('Pérez')
  })

  it('un apellido distinto no liga aunque la fecha calce', () => {
    const r = emparejarResenaConReserva(
      { autor: 'Gómez', publicadaEn: '2027-05-15' },
      [candidata()],
    )
    expect(r.reservaId).toBeNull()
  })
})

describe('reseñas · huella para no duplicar', () => {
  const base = {
    autor: 'Ana Pérez',
    publicadaEn: '2027-05-15',
    positivo: 'La vista',
    negativo: 'El wifi',
  }

  it('la misma reseña da la misma huella', () => {
    expect(huellaResena(base)).toBe(huellaResena({ ...base }))
  })

  it('sobrevive a cambios de espacios y mayúsculas al reexportar', () => {
    expect(huellaResena(base)).toBe(
      huellaResena({ ...base, autor: 'ANA   PÉREZ', positivo: 'la  vista' }),
    )
  })

  it('distingue reseñas distintas', () => {
    expect(huellaResena(base)).not.toBe(huellaResena({ ...base, negativo: 'El ruido' }))
    expect(huellaResena(base)).not.toBe(huellaResena({ ...base, publicadaEn: '2027-05-16' }))
    expect(huellaResena(base)).not.toBe(huellaResena({ ...base, autor: 'Otro' }))
  })

  it('tolera campos nulos', () => {
    expect(() => huellaResena({ autor: 'X' })).not.toThrow()
  })
})

describe('reseñas · catálogo completo', () => {
  it('cada vínculo tiene etiqueta en español', () => {
    for (const v of VINCULOS_RESENA) expect(ETIQUETAS_VINCULO[v]).toBeTruthy()
  })
})
