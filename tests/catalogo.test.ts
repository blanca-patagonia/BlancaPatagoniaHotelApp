import { describe, it, expect } from 'vitest'
import {
  filtroValido,
  filtrarPorCategoria,
  ordenarCatalogo,
  precioDesde,
  conIva,
  ordenarPrecios,
  textoCapacidad,
  textoRango,
  fotoDe,
  type TipoCatalogo,
  type PrecioTemporada,
} from '@/lib/domain/catalogo'

function tipo(p: Partial<TipoCatalogo> & { codigo: string }): TipoCatalogo {
  return {
    id: p.codigo,
    nombre: p.nombre ?? p.codigo,
    categoria: p.categoria ?? 'hosteria',
    capacidadMax: p.capacidadMax ?? 2,
    descripcion: p.descripcion ?? '',
    amenities: p.amenities ?? [],
    ...p,
  }
}

describe('filtro por categoría', () => {
  it('cae en «todas» ante cualquier valor inesperado', () => {
    // Un enlace viejo o mal copiado tiene que mostrar el catálogo, no vaciarlo.
    expect(filtroValido(undefined)).toBe('todas')
    expect(filtroValido('')).toBe('todas')
    expect(filtroValido('CABAÑAS')).toBe('todas')
    expect(filtroValido('<script>')).toBe('todas')
  })

  it('respeta los valores válidos', () => {
    expect(filtroValido('hosteria')).toBe('hosteria')
    expect(filtroValido('cabana')).toBe('cabana')
    expect(filtroValido('todas')).toBe('todas')
  })

  it('filtra o deja pasar todo según corresponda', () => {
    const tipos = [
      tipo({ codigo: 'H1', categoria: 'hosteria' }),
      tipo({ codigo: 'C1', categoria: 'cabana' }),
    ]
    expect(filtrarPorCategoria(tipos, 'todas')).toHaveLength(2)
    expect(filtrarPorCategoria(tipos, 'cabana').map((t) => t.codigo)).toEqual(['C1'])
    expect(filtrarPorCategoria(tipos, 'hosteria').map((t) => t.codigo)).toEqual(['H1'])
  })

  it('no modifica el arreglo original', () => {
    const tipos = [tipo({ codigo: 'H1' })]
    filtrarPorCategoria(tipos, 'cabana')
    expect(tipos).toHaveLength(1)
  })
})

describe('orden del catálogo', () => {
  it('pone la hostería antes que las cabañas y ordena por capacidad', () => {
    const tipos = [
      tipo({ codigo: 'CAB-3D-7P', categoria: 'cabana', capacidadMax: 7 }),
      tipo({ codigo: 'HOST-TRIPLE', categoria: 'hosteria', capacidadMax: 3 }),
      tipo({ codigo: 'CAB-1D-3P', categoria: 'cabana', capacidadMax: 3 }),
      tipo({ codigo: 'HOST-SINGLE', categoria: 'hosteria', capacidadMax: 1 }),
    ]
    expect(ordenarCatalogo(tipos).map((t) => t.codigo)).toEqual([
      'HOST-SINGLE',
      'HOST-TRIPLE',
      'CAB-1D-3P',
      'CAB-3D-7P',
    ])
  })

  it('desempata por nombre, respetando los acentos del español', () => {
    const tipos = [
      tipo({ codigo: 'B', nombre: 'Ñandú', capacidadMax: 2 }),
      tipo({ codigo: 'A', nombre: 'Calafate', capacidadMax: 2 }),
    ]
    expect(ordenarCatalogo(tipos).map((t) => t.nombre)).toEqual(['Calafate', 'Ñandú'])
  })

  it('no modifica el arreglo original', () => {
    const tipos = [
      tipo({ codigo: 'C1', categoria: 'cabana' }),
      tipo({ codigo: 'H1', categoria: 'hosteria' }),
    ]
    ordenarCatalogo(tipos)
    expect(tipos[0].codigo).toBe('C1')
  })
})

describe('precio «desde»', () => {
  it('toma el más bajo de las temporadas cargadas', () => {
    expect(precioDesde([{ precio: 177 }, { precio: 120 }, { precio: 143 }])).toBe(120)
  })

  it('devuelve null cuando no hay tarifas', () => {
    // La pantalla dice «consultar» en lugar de «USD 0», que fue el bug de la
    // Fase 18: había lugar pero faltaba cargar la temporada.
    expect(precioDesde([])).toBeNull()
  })

  it('ignora los precios que no sirven en lugar de mostrarlos', () => {
    expect(precioDesde([{ precio: 0 }, { precio: 150 }])).toBe(150)
    expect(precioDesde([{ precio: Number.NaN }, { precio: 150 }])).toBe(150)
    expect(precioDesde([{ precio: -20 }, { precio: 150 }])).toBe(150)
    expect(precioDesde([{ precio: 0 }])).toBeNull()
  })
})

describe('precio con IVA', () => {
  it('suma el IVA, porque la columna se guarda sin él', () => {
    // Doble Standard, temporada alta: rack 177 sin IVA → 214,17 con 21 %.
    // Publicar 177 sería anunciar un precio que el checkout no respeta.
    expect(conIva(177, 21)).toBe(214.17)
    expect(conIva(120, 21)).toBe(145.2)
  })

  it('redondea a dos decimales igual que el motor de precios', () => {
    // Si el catálogo y `calcularEstadia` redondearan distinto, el «desde» y el
    // total de la reserva podrían diferir por un centavo.
    expect(conIva(155, 21)).toBe(187.55)
  })

  it('un IVA de 0 deja el precio como está', () => {
    expect(conIva(200, 0)).toBe(200)
  })

  it('no rompe si el IVA llega inválido', () => {
    expect(conIva(200, Number.NaN)).toBe(200)
  })
})

describe('orden de las temporadas', () => {
  it('respeta el orden del hotel: baja, media, alta', () => {
    const precios: PrecioTemporada[] = [
      { temporada: 'alta', nombre: 'Alta', orden: 3, precio: 177, rangos: [] },
      { temporada: 'baja', nombre: 'Baja', orden: 1, precio: 120, rangos: [] },
      { temporada: 'media', nombre: 'Media', orden: 2, precio: 143, rangos: [] },
    ]
    expect(ordenarPrecios(precios).map((p) => p.temporada)).toEqual(['baja', 'media', 'alta'])
  })
})

describe('texto de capacidad', () => {
  it('usa el singular cuando corresponde', () => {
    expect(textoCapacidad(1)).toBe('1 persona')
  })

  it('usa «hasta» para el resto', () => {
    expect(textoCapacidad(2)).toBe('hasta 2 personas')
    expect(textoCapacidad(7)).toBe('hasta 7 personas')
  })
})

describe('texto de un rango de temporada', () => {
  it('muestra la última noche real, no el fin excluido del rango', () => {
    // El seed carga la temporada alta como [2025-11-01, 2025-12-01): la última
    // noche a ese precio es el 30/11, y el 1/12 ya se cobra como media. Volcar
    // el rango tal cual publicaría un precio equivocado.
    expect(textoRango('2025-11-01', '2025-12-01')).toBe('01/11 al 30/11')
    expect(textoRango('2025-10-01', '2025-11-01')).toBe('01/10 al 31/10')
  })

  it('cruza el fin de mes y el fin de año sin romperse', () => {
    expect(textoRango('2025-12-20', '2026-01-06')).toBe('20/12 al 05/01')
  })

  it('un rango de una sola noche se dice una vez', () => {
    expect(textoRango('2026-04-05', '2026-04-06')).toBe('05/04')
  })
})

describe('fotos', () => {
  it('devuelve la ruta de la portada de un tipo conocido', () => {
    // Hasta la Fase 23 este test afirmaba que `fotoDe` devolvía `null` para
    // todo, porque `FOTOS` estaba vacío a la espera de las fotos del hotel.
    // Eso fijaba una situación transitoria, no el contrato: lo que la función
    // promete es resolver el código al archivo de su portada.
    expect(fotoDe('HOST-SUITE')).toBe('/alojamientos/suite-principal.jpg')
    expect(fotoDe('CAB-1D-3P')).toBe('/alojamientos/cabana-1-dormitorio.jpg')
  })

  it('devuelve null ante un código sin portada', () => {
    // Es el caso que mantiene viva la cabecera de marca de `PortadaAlojamiento`
    // para un tipo nuevo que todavía no tenga foto.
    expect(fotoDe('CODIGO-INEXISTENTE')).toBeNull()
  })
})
