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
    expect(llevaIdioma('/firmar/abc123')).toBe(false)
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
    expect(idiomaDeReferencia('https://blancapatagonia.com/en/alojamientos', origen)).toBe('en')
    expect(idiomaDeReferencia('https://blancapatagonia.com/zh', origen)).toBe('zh')
  })

  it('ignora un sitio ajeno: otro dominio no decide el idioma del nuestro', () => {
    expect(idiomaDeReferencia('https://otro.com/fr/algo', origen)).toBeNull()
  })

  it('devuelve null sin referencia, con una URL rota o sin prefijo de idioma', () => {
    expect(idiomaDeReferencia(null, origen)).toBeNull()
    expect(idiomaDeReferencia('no es una url', origen)).toBeNull()
    expect(idiomaDeReferencia('https://blancapatagonia.com/panel', origen)).toBeNull()
  })

  it('sin referencia se cae al idioma del navegador', () => {
    expect(idiomaPreferido('pt-BR,pt;q=0.9')).toBe('pt')
  })
})

describe('rutas y alternativas por idioma', () => {
  it('rutaConIdioma conserva la consulta', () => {
    expect(rutaConIdioma('/reservar?tipo=1&check_in=2026-11-01', 'en')).toBe(
      '/en/reservar?tipo=1&check_in=2026-11-01',
    )
    expect(rutaConIdioma('/', 'fr')).toBe('/fr')
    expect(rutaConIdioma('/es/alojamientos', 'pt')).toBe('/pt/alojamientos')
  })

  it('alternativasDeIdioma declara los cinco idiomas y la canónica propia', () => {
    const alt = alternativasDeIdioma('en', '/alojamientos')
    expect(alt.canonical).toBe('/en/alojamientos')
    expect(Object.keys(alt.languages)).toHaveLength(IDIOMAS.length)
    expect(alt.languages['pt-BR']).toBe('/pt/alojamientos')
  })

  it('un idioma inventado canoniza al de origen', () => {
    expect(alternativasDeIdioma('xx', '/').canonical).toBe('/es')
  })
})

describe('fechaCortaEn', () => {
  it('formatea el día del calendario sin correrlo por zona horaria', () => {
    // El 1 de noviembre tiene que seguir siendo el 1 en cualquier idioma.
    expect(fechaCortaEn('2026-11-01', 'es')).toMatch(/^1 /)
    expect(fechaCortaEn('2026-11-01', 'en')).toMatch(/\b1$/)
    expect(fechaCortaEn('2026-11-01', 'zh')).toContain('1日')
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

  it('en los otros idiomas traduce los mismos tramos, en el mismo orden', () => {
    const en = lineasCancelacion(reglas, textos('en'))
    expect(en).toEqual([
      '15 days or more in advance: free of charge.',
      'Between 7 and 14 days before: the first night is charged.',
      'Less than 7 days before: 100% of the stay is charged.',
    ])
  })
})

describe('diccionarios', () => {
  it('las listas de la portada tienen el mismo largo en todos los idiomas', () => {
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
    expect(textoCapacidadEn(textos('en'), 4)).toBe('up to 4 people')
  })
})
