import { describe, it, expect } from 'vitest'
import {
  ORDEN_CHIPS,
  VISTAS,
  VISTAS_RESERVAS,
  definicionDe,
  esVista,
  estadosDesconocidos,
  vistasSinChip,
} from '@/lib/domain/vistas-reservas'

/**
 * Las vistas operativas son los filtros del día de recepción. Lo que se prueba
 * acá son las decisiones discutibles de cada definición —qué estados entran en
 * «llegadas hoy», qué es un «particular»— porque son las que alguien va a querer
 * cambiar y las que, si se cambian sin pensar, dejan a recepción esperando a
 * alguien que canceló.
 */

describe('esVista', () => {
  it('acepta las vistas declaradas', () => {
    expect(esVista('llegadas')).toBe(true)
    expect(esVista('en_casa')).toBe(true)
  })

  it('rechaza lo que venga por la URL sin ser una vista', () => {
    // Es la guarda contra un parámetro inventado a mano en la barra de direcciones.
    expect(esVista('borrar_todo')).toBe(false)
    expect(esVista('')).toBe(false)
    expect(esVista(undefined)).toBe(false)
  })
})

describe('cobertura y coherencia de las definiciones', () => {
  it('toda vista declarada se muestra como chip', () => {
    // Una vista que se define y no se muestra es código muerto que nadie
    // descubre, porque no falla. Mismo criterio que `areasSinGrupo()`.
    expect(vistasSinChip()).toEqual([])
  })

  it('los chips no repiten ni inventan vistas', () => {
    expect(new Set(ORDEN_CHIPS).size).toBe(ORDEN_CHIPS.length)
    expect(ORDEN_CHIPS.length).toBe(VISTAS_RESERVAS.length)
  })

  it('todos los estados que nombran las vistas existen', () => {
    // Un estado mal escrito no rompe nada visible: el filtro devuelve cero filas
    // y la pantalla dice «no hay reservas», igual que si de verdad no hubiera.
    expect(estadosDesconocidos()).toEqual([])
  })

  it('cada vista tiene etiqueta y texto de vacío', () => {
    for (const v of VISTAS_RESERVAS) {
      expect(VISTAS[v].etiqueta.length).toBeGreaterThan(0)
      expect(VISTAS[v].vacio.length).toBeGreaterThan(0)
    }
  })

  it('cada vista filtra por algo: estado, fecha o agrupación', () => {
    // Una vista sin ningún filtro sería un «Todas» duplicado con otro nombre.
    for (const v of VISTAS_RESERVAS) {
      const d = VISTAS[v]
      expect(Boolean(d.estados || d.fecha || d.agrupacion)).toBe(true)
    }
  })
})

describe('«En el hotel» se define por estado, no por fecha', () => {
  it('es exactamente in_house', () => {
    // Que las fechas incluyan hoy no significa que la persona esté en el hotel:
    // significa que TENDRÍA que estar. La diferencia entre «está alojado» y «no
    // apareció» es justo lo que recepción necesita ver, y la marca el check-in.
    expect(definicionDe('en_casa').estados).toEqual(['in_house'])
    expect(definicionDe('en_casa').fecha).toBeUndefined()
  })
})

describe('«Llegadas hoy»', () => {
  const d = definicionDe('llegadas')

  it('filtra por fecha de entrada', () => {
    expect(d.fecha).toBe('llega')
  })

  it('incluye a quien ya se registró: es la planilla del día', () => {
    expect(d.estados).toContain('in_house')
  })

  it('incluye pendientes, confirmadas y pagadas', () => {
    expect(d.estados).toContain('pendiente')
    expect(d.estados).toContain('confirmada')
    expect(d.estados).toContain('pagada')
  })

  it('excluye canceladas y no-show: no van a llegar', () => {
    // Mostrarlas obligaría a leer la columna de estado para saber a quién esperar.
    expect(d.estados).not.toContain('cancelada')
    expect(d.estados).not.toContain('no_show')
  })
})

describe('«Salidas hoy»', () => {
  const d = definicionDe('salidas')

  it('filtra por fecha de salida', () => {
    expect(d.fecha).toBe('sale')
  })

  it('incluye check-out: quien ya se fue sigue en la planilla del día', () => {
    // Sin esto recepción no puede distinguir «ya salió» de «se fue sin avisar».
    expect(d.estados).toContain('checkout')
  })

  it('incluye a los que todavía están', () => {
    expect(d.estados).toContain('in_house')
  })

  it('excluye canceladas', () => {
    expect(d.estados).not.toContain('cancelada')
  })
})

describe('grupos y particulares', () => {
  it('grupos filtra por agrupación, no por estado', () => {
    expect(definicionDe('grupos').agrupacion).toBe('grupo')
    expect(definicionDe('grupos').estados).toBeUndefined()
  })

  it('particular significa sin grupo y sin agencia', () => {
    // Quien vino por agencia no es particular aunque haya venido solo. La
    // consulta traduce esto a `grupo_id is null AND agencia_id is null`.
    expect(definicionDe('particulares').agrupacion).toBe('particular')
  })

  it('grupos y particulares son excluyentes entre sí', () => {
    expect(definicionDe('grupos').agrupacion).not.toBe(definicionDe('particulares').agrupacion)
  })
})

describe('las vistas por fecha son solo dos', () => {
  it('llegadas y salidas, y ninguna otra', () => {
    // Si aparece una tercera hay que pasarle `hoy` desde la pantalla Y desde el
    // export CSV, o el CSV bajaría otra cosa que lo que se ve.
    const porFecha = VISTAS_RESERVAS.filter((v) => VISTAS[v].fecha)
    expect(porFecha).toEqual(['llegadas', 'salidas'])
  })
})
