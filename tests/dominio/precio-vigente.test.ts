import { describe, it, expect } from 'vitest'
import { precioVigente, fotosDe, fotoDe } from '@/lib/domain/catalogo'

// Calendario del tarifario (seed): sin temporada en junio, julio y agosto.
const rangos = [
  { temporada: 'baja', desde: '2026-09-01', hasta: '2026-10-01' },
  { temporada: 'media', desde: '2026-10-01', hasta: '2026-11-01' },
  { temporada: 'alta', desde: '2026-11-01', hasta: '2026-12-01' },
  { temporada: 'baja', desde: '2027-04-05', hasta: '2027-06-01' },
]
const precios = [
  { temporada: 'baja', precio: 100 },
  { temporada: 'media', precio: 130 },
  { temporada: 'alta', precio: 180 },
]

describe('precioVigente', () => {
  it('devuelve la tarifa de la temporada en la que cae hoy', () => {
    expect(precioVigente(precios, rangos, '2026-10-15')).toEqual({
      precio: 130,
      temporada: 'media',
      desde: '2026-10-01',
      hasta: '2026-11-01',
      esProxima: false,
    })
  })

  it('cambia sola el día que empieza la temporada siguiente', () => {
    expect(precioVigente(precios, rangos, '2026-10-31')?.temporada).toBe('media')
    // El fin del rango está excluido: el 1/11 ya es alta.
    expect(precioVigente(precios, rangos, '2026-11-01')?.precio).toBe(180)
  })

  it('fuera de temporada anuncia la próxima, marcada como próxima', () => {
    const v = precioVigente(precios, rangos, '2026-07-10')
    expect(v?.temporada).toBe('baja')
    expect(v?.desde).toBe('2026-09-01')
    expect(v?.esProxima).toBe(true)
  })

  it('sin temporada actual ni futura devuelve null, nunca un precio 0', () => {
    expect(precioVigente(precios, rangos, '2027-07-01')).toBeNull()
  })

  it('ignora temporadas sin tarifa o con tarifa en 0', () => {
    const v = precioVigente([{ temporada: 'media', precio: 0 }, { temporada: 'alta', precio: 180 }], rangos, '2026-10-15')
    // Hoy es media pero no tiene precio: se anuncia la alta, como próxima.
    expect(v).toMatchObject({ temporada: 'alta', esProxima: true })
  })
})

describe('fotosDe', () => {
  it('la primera foto es siempre la del propio tipo, sin repetirla', () => {
    const fotos = fotosDe('HOST-SUITE', 'hosteria')
    expect(fotos[0]).toBe(fotoDe('HOST-SUITE'))
    expect(new Set(fotos).size).toBe(fotos.length)
  })

  it('sin foto propia no arma galería con fotos ajenas', () => {
    expect(fotosDe('NO-EXISTE', 'hosteria')).toEqual([])
  })
})
