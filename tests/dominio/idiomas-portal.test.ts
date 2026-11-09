import { describe, it, expect } from 'vitest'
import {
  textos,
  rutaConIdioma,
  alternativasDeIdioma,
  lineasCancelacion,
  fechaCortaEn,
  idiomaDeReferencia,
  idiomaPreferido,
  textoCapacidadEn,
  IDIOMAS,
} from '@/lib/i18n'
import { describirPoliticaCancelacion } from '@/lib/domain/asistente'
import { es } from '@/lib/i18n/diccionarios/es'
import { _rutasConIdioma } from '@/proxy'

const { llevaIdioma } = _rutasConIdioma

describe('proxy: qué rutas llevan prefijo de idioma', () => {
  it('la portada, el catálogo, el detalle, reservar y el checkout lo llevan', () => {
    expect(llevaIdioma('/')).toBe(true)
    expect(llevaIdioma('/alojamientos')).toBe(true)
    expect(llevaIdioma('/alojamientos/doble-superior')).toBe(true)
    expect(llevaIdioma('/reservar')).toBe(true)
    // Regresión: sin esto el botón «Reservar» de los resultados daba 404.
    expect(llevaIdioma('/reservar/checkout')).toBe(true)
  })

  it('las direcciones con token que viajan por correo NO lo llevan', () => {
    expect(llevaIdioma('/reservar/confirmacion/abc123')).toBe(false)
    expect(llevaIdioma('/reservar/pagar/abc123')).toBe(false)
    expect(llevaIdioma('/reservar/factura/abc123')).toBe(false)
    expect(llevaIdioma('/encuesta/abc123')).toBe(false)
    expect(llevaIdioma('/panel')).toBe(false)
  })

  it('un prefijo parecido no se confunde con el catálogo', () => {
    expect(llevaIdioma('/alojamientosx')).toBe(false)
  })
})

describe('idiomaDeReferencia', () => {
  const origen = 'https://blancapatagonia.com'

  it('toma el idioma de la página del mismo sitio desde la que se hizo clic', () => {
    expect(idiomaDeReferencia('https://blancapatagonia.com/es/alojamientos', origen)).toBe('es')
  })

  it('ignora un sitio ajeno: otro dominio no decide el idioma del nuestro', () => {
    expect(idiomaDeReferencia('https://otro.com/es/algo', origen)).toBeNull()
  })

  it('devuelve null sin referencia, con una URL rota o sin prefijo de idioma', () => {
    expect(idiomaDeReferencia(null, origen)).toBeNull()
    expect(idiomaDeReferencia('no es una url', origen)).toBeNull()
    expect(idiomaDeReferencia('https://blancapatagonia.com/panel', origen)).toBeNull()
  })

  it('sin referencia se cae al español, también con un navegador en otro idioma', () => {
    expect(idiomaPreferido('pt-BR,pt;q=0.9')).toBe('es')
    expect(idiomaPreferido(null)).toBe('es')
  })
})

describe('rutas y alternativas por idioma', () => {
  it('rutaConIdioma conserva la consulta', () => {
    expect(rutaConIdioma('/reservar?tipo=1&check_in=2026-11-01', 'es')).toBe(
      '/es/reservar?tipo=1&check_in=2026-11-01',
    )
    expect(rutaConIdioma('/', 'es')).toBe('/es')
  })

  it('alternativasDeIdioma declara el idioma del sitio y la canónica propia', () => {
    const alt = alternativasDeIdioma('es', '/alojamientos')
    expect(alt.canonical).toBe('/es/alojamientos')
    expect(Object.keys(alt.languages)).toHaveLength(IDIOMAS.length)
    expect(alt.languages['es-AR']).toBe('/es/alojamientos')
  })

  it('un idioma inventado canoniza al de origen', () => {
    expect(alternativasDeIdioma('xx', '/').canonical).toBe('/es')
  })
})

describe('fechaCortaEn', () => {
  it('formatea el día del calendario sin correrlo por zona horaria', () => {
    // El 1 de noviembre tiene que seguir siendo el 1.
    expect(fechaCortaEn('2026-11-01', 'es')).toMatch(/^1 /)
  })

  it('devuelve el texto tal cual si no es una fecha', () => {
    expect(fechaCortaEn('cualquier cosa', 'es')).toBe('cualquier cosa')
  })
})

describe('lineasCancelacion', () => {
  const reglas = [
    { desde_dias: 0, cargo: 'total' as const },
    { desde_dias: 15, cargo: 'ninguno' as const },
    { desde_dias: 7, cargo: 'primera_noche' as const },
  ]

  it('en español dice EXACTAMENTE lo mismo que el asistente', () => {
    const delAsistente = describirPoliticaCancelacion(reglas)
      .split('\n')
      .map((l) => l.replace(/^·\s*/, ''))
    expect(lineasCancelacion(reglas, textos('es'))).toEqual(delAsistente)
  })
})

describe('diccionarios', () => {
  it('las listas de la portada tienen el mismo largo que las de español', () => {
    // Se emparejan por posición con los metrajes y las fotos de la página: un
    // idioma con una habitación de menos correría todos los metros cuadrados.
    for (const idioma of IDIOMAS) {
      const c = textos(idioma).contenido
      expect(c.habitaciones).toHaveLength(es.contenido.habitaciones.length)
      expect(c.cabanas).toHaveLength(es.contenido.cabanas.length)
      expect(c.excursiones).toHaveLength(es.contenido.excursiones.length)
      expect(c.alt.galeria).toHaveLength(es.contenido.alt.galeria.length)
      expect(c.preguntas).toHaveLength(es.contenido.preguntas.length)
    }
  })

  it('los marcadores de cada plantilla son los mismos que en español', () => {
    const marcadores = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    const recorrer = (base: unknown, otro: unknown, camino: string, idioma: string) => {
      if (typeof base === 'string') {
        expect(marcadores(otro as string), `${idioma}:${camino}`).toBe(marcadores(base))
        return
      }
      if (base && typeof base === 'object') {
        for (const [k, v] of Object.entries(base)) {
          recorrer(v, (otro as Record<string, unknown>)[k], `${camino}.${k}`, idioma)
        }
      }
    }
    for (const idioma of IDIOMAS) recorrer(es, textos(idioma), '', idioma)
  })

  it('textoCapacidadEn distingue singular y plural', () => {
    expect(textoCapacidadEn(textos('es'), 1)).toBe('1 persona')
    expect(textoCapacidadEn(textos('es'), 4)).toBe('hasta 4 personas')
  })
})

describe('destinoDeIdioma · las pantallas con token', () => {
  it('en una ruta con prefijo cambia el prefijo y conserva la búsqueda', async () => {
    const { destinoDeIdioma } = await import('@/lib/i18n/idiomas')
    expect(destinoDeIdioma('/es/reservar', 'check_in=2026-11-10', 'es')).toBe(
      '/es/reservar?check_in=2026-11-10',
    )
  })

  it('en una pantalla con token usa ?idioma= (un prefijo daba 404)', async () => {
    const { destinoDeIdioma } = await import('@/lib/i18n/idiomas')
    expect(destinoDeIdioma('/reservar/confirmacion/abc', '', 'es')).toBe(
      '/reservar/confirmacion/abc?idioma=es',
    )
  })
})
