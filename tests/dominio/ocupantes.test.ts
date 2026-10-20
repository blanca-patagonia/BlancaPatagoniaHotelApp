import { describe, it, expect } from 'vitest'
import {
  OCUPANTES_VACIO,
  desgloseCoincide,
  paxQueOcupa,
  personasAlojadas,
  textoOcupantes,
  validarOcupantes,
  type Ocupantes,
} from '@/lib/domain/ocupantes'
import {
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  GARANTIAS,
  PLANES,
  SEGMENTOS,
  noShowEsCobrable,
  segmentoDeCanal,
} from '@/lib/domain/reservas'

/**
 * El desglose de ocupantes decide dos cosas con consecuencias reales: cómo se
 * prepara la habitación (cuna o cama) y cuántas plazas se consumen. Lo que se
 * prueba acá, sobre todo, es que **los bebés no cuenten para la capacidad**:
 * contarlos haría que una cabaña para 4 rechace a una familia de dos adultos, un
 * menor y un bebé, que es una reserva perfectamente válida.
 */

function ocupantes(over: Partial<Ocupantes> = {}): Ocupantes {
  return { ...OCUPANTES_VACIO, ...over }
}

describe('paxQueOcupa', () => {
  it('suma adultos y menores', () => {
    expect(paxQueOcupa({ adultos: 2, menores: 1 })).toBe(3)
  })

  it('NO cuenta los bebés', () => {
    // Es la regla central del módulo. Un bebé en cuna no consume una cama.
    expect(paxQueOcupa(ocupantes({ adultos: 2, menores: 1, bebes: 2 }))).toBe(3)
  })

  it('nunca devuelve menos de 1', () => {
    // `estadias.huespedes` tiene un check `> 0`: una estadía sin nadie no existe.
    expect(paxQueOcupa({ adultos: 0, menores: 0 })).toBe(1)
  })

  it('tolera valores no finitos sin propagar NaN', () => {
    expect(paxQueOcupa({ adultos: Number.NaN, menores: 2 })).toBe(2)
  })

  it('trunca decimales en vez de aceptar medio huésped', () => {
    expect(paxQueOcupa({ adultos: 2.7, menores: 0 })).toBe(2)
  })
})

describe('personasAlojadas', () => {
  it('sí cuenta los bebés: es para la planilla de cocina, no para la capacidad', () => {
    expect(personasAlojadas(ocupantes({ adultos: 2, menores: 1, bebes: 1 }))).toBe(4)
  })

  it('coincide con el pax cuando no hay bebés', () => {
    const o = ocupantes({ adultos: 3 })
    expect(personasAlojadas(o)).toBe(paxQueOcupa(o))
  })
})

describe('validarOcupantes', () => {
  it('acepta un desglose normal', () => {
    expect(validarOcupantes(ocupantes({ adultos: 2, menores: 1, bebes: 1, cunas: 1 }))).toEqual([])
  })

  it('exige al menos un adulto', () => {
    expect(validarOcupantes(ocupantes({ adultos: 0, menores: 2 }))).toContain(
      'Tiene que haber al menos un adulto.',
    )
  })

  it('rechaza negativos y decimales', () => {
    expect(validarOcupantes(ocupantes({ menores: -1 }))).not.toEqual([])
    expect(validarOcupantes(ocupantes({ bebes: 1.5 }))).not.toEqual([])
  })

  it('rechaza pasarse de la capacidad', () => {
    const motivos = validarOcupantes(ocupantes({ adultos: 4, menores: 1 }), 4)
    expect(motivos.length).toBeGreaterThan(0)
    expect(motivos[0]).toContain('Entran 4')
  })

  it('los bebés NO hacen que se pase de la capacidad', () => {
    // Una cabaña para 4: dos adultos, un menor y dos bebés entran. Si los bebés
    // contaran, el sistema rechazaría esta reserva.
    expect(validarOcupantes(ocupantes({ adultos: 2, menores: 1, bebes: 2, cunas: 2 }), 4)).toEqual([])
  })

  it('las camas extra amplían la capacidad: para eso existen', () => {
    // Una doble (capacidad 2) con una cama extra entra 3. Sin sumarla, la cama
    // extra no serviría para nada.
    expect(validarOcupantes(ocupantes({ adultos: 3, camasExtra: 1 }), 2)).toEqual([])
    expect(validarOcupantes(ocupantes({ adultos: 3, camasExtra: 0 }), 2)).not.toEqual([])
  })

  it('avisa si hay cuna sin bebé, que casi siempre es un tipeo', () => {
    expect(validarOcupantes(ocupantes({ adultos: 2, cunas: 1, bebes: 0 }))).toContain(
      'Se pidió una cuna pero no hay bebés cargados. Revisá el desglose.',
    )
  })

  it('sin capacidad indicada no valida el tope', () => {
    expect(validarOcupantes(ocupantes({ adultos: 20 }))).toEqual([])
  })
})

describe('textoOcupantes', () => {
  it('omite lo que está en cero', () => {
    // «2 adultos» se lee; «2 adultos, 0 menores, 0 bebés» en una tabla no.
    expect(textoOcupantes(ocupantes({ adultos: 2 }))).toBe('2 adultos')
  })

  it('usa singular y plural', () => {
    expect(textoOcupantes(ocupantes({ adultos: 1, menores: 1, bebes: 1 }))).toBe(
      '1 adulto, 1 menor, 1 bebé',
    )
    expect(textoOcupantes(ocupantes({ adultos: 2, menores: 2, bebes: 2 }))).toBe(
      '2 adultos, 2 menores, 2 bebés',
    )
  })

  it('separa los extras de la habitación con un punto medio', () => {
    expect(textoOcupantes(ocupantes({ adultos: 2, bebes: 1, cunas: 1, camasExtra: 1 }))).toBe(
      '2 adultos, 1 bebé · 1 cama extra, 1 cuna',
    )
  })

  it('un desglose vacío dice algo en vez de quedar en blanco', () => {
    expect(textoOcupantes(ocupantes({ adultos: 0 }))).toBe('sin ocupantes')
  })
})

describe('desgloseCoincide', () => {
  it('detecta cuando el desglose y el pax guardado no cierran', () => {
    // No hay `check` en la base que lo garantice (fue una decisión deliberada:
    // habría roto los update de mudanza y reprogramación). Esta función es la red
    // de seguridad para no mostrar en pantalla dos números que se contradicen.
    expect(desgloseCoincide({ adultos: 2, menores: 1 }, 3)).toBe(true)
    expect(desgloseCoincide({ adultos: 1, menores: 0 }, 4)).toBe(false)
  })
})

describe('planes, garantías y segmentos', () => {
  it('cada valor tiene su etiqueta', () => {
    for (const p of PLANES) expect(ETIQUETAS_PLAN[p]).toBeTruthy()
    for (const g of GARANTIAS) expect(ETIQUETAS_GARANTIA[g]).toBeTruthy()
    for (const s of SEGMENTOS) expect(ETIQUETAS_SEGMENTO[s]).toBeTruthy()
  })

  it('el plan por omisión del hotel incluye desayuno', () => {
    // Poner «solo alojamiento» por defecto haría que toda reserva nueva prometiera
    // menos de lo que el Tarifario da.
    expect(ETIQUETAS_PLAN.desayuno).toBe('Habitación y desayuno')
  })

  it('sin garantía, un no-show no se puede cobrar', () => {
    // Es el dato que decide si la política del Tarifario (no-show 100 %) es
    // ejecutable o letra muerta.
    expect(noShowEsCobrable('sin_garantia')).toBe(false)
    expect(noShowEsCobrable('tarjeta')).toBe(true)
    expect(noShowEsCobrable('deposito')).toBe(true)
    expect(noShowEsCobrable('agencia')).toBe(true)
    expect(noShowEsCobrable('contrato')).toBe(true)
  })

  it('el segmento se deriva del canal cuando el canal ya lo determina', () => {
    // Si entra por Booking el segmento es OTA por definición; pedirlo a mano sólo
    // habilita que los dos datos se contradigan.
    expect(segmentoDeCanal('booking')).toBe('ota')
    expect(segmentoDeCanal('expedia')).toBe('ota')
    expect(segmentoDeCanal('directo')).toBe('particular')
    expect(segmentoDeCanal('web')).toBe('particular')
  })
})
