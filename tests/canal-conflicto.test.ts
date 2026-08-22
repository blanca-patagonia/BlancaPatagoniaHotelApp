import { describe, it, expect } from 'vitest'
import {
  detectarConflictoDeCupo,
  type EntranteParaCupo,
  type OcupacionNoche,
} from '@/lib/domain/canales'

/**
 * Deteccion temprana del choque de cupo.
 *
 * NO evita el overbooking -eso exige publicar disponibilidad, o sea un channel
 * manager (ADR 0021)- pero lo hace visible el dia en que el informe entra, en vez de
 * cuando alguien aprieta «Importar» o, peor, en el check-in.
 */

const CUPO = { DBL: 2, SGL: 1 }

function entrante(over: Partial<EntranteParaCupo> = {}): EntranteParaCupo {
  return {
    externalId: 'BK-1',
    tipoUnidadCodigo: 'DBL',
    checkIn: '2027-05-10',
    checkOut: '2027-05-12',
    operacion: 'nueva',
    ...over,
  }
}

describe('conflicto de cupo del canal', () => {
  it('sin ocupacion previa y con cupo, no hay conflicto', () => {
    expect(detectarConflictoDeCupo([entrante()], [], CUPO).size).toBe(0)
  })

  it('cupo justo: la ultima unidad libre no es conflicto', () => {
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-10', ocupadas: 1 },
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 1 },
    ]
    expect(detectarConflictoDeCupo([entrante()], ocupacion, CUPO).size).toBe(0)
  })

  it('excedido por una unidad: conflicto', () => {
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-10', ocupadas: 2 },
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 2 },
    ]
    expect([...detectarConflictoDeCupo([entrante()], ocupacion, CUPO)]).toEqual(['BK-1'])
  })

  it('alcanza que UNA sola noche del rango este llena', () => {
    // Una estadia de tres noches con la del medio ocupada no se puede alojar en la
    // misma unidad, aunque las otras dos esten libres.
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 2 },
    ]
    const e = entrante({ checkIn: '2027-05-10', checkOut: '2027-05-13' })
    expect(detectarConflictoDeCupo([e], ocupacion, CUPO).size).toBe(1)
  })

  it('EL CASO CLAVE: dos entrantes que caben por separado y NO juntas', () => {
    // Queda una unidad libre y llegan dos reservas. Cada una mirada sola «cabe», asi
    // que una comprobacion fila por fila no detectaria nada. Las dos quedan marcadas:
    // cual se acomoda es decision de quien atiende, no del orden del archivo.
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-10', ocupadas: 1 },
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 1 },
    ]
    const dos = [entrante({ externalId: 'A' }), entrante({ externalId: 'B' })]
    const r = detectarConflictoDeCupo(dos, ocupacion, CUPO)

    // La primera entra en la unidad que quedaba; la segunda ya no tiene donde.
    expect(r.has('B')).toBe(true)
    expect(r.size).toBe(1)
  })

  it('tres entrantes sobre cupo 2 marcan solo la que sobra', () => {
    const tres = ['A', 'B', 'C'].map((id) => entrante({ externalId: id }))
    const r = detectarConflictoDeCupo(tres, [], CUPO)
    expect([...r]).toEqual(['C'])
  })

  it('una cancelada no ocupa nada ni se marca', () => {
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-10', ocupadas: 2 },
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 2 },
    ]
    const r = detectarConflictoDeCupo(
      [entrante({ operacion: 'cancelada' })],
      ocupacion,
      CUPO,
    )
    expect(r.size).toBe(0)
  })

  it('una cancelada no consume cupo de las que vienen despues', () => {
    const dos = [
      entrante({ externalId: 'A', operacion: 'cancelada' }),
      entrante({ externalId: 'B' }),
    ]
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-10', ocupadas: 1 },
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 1 },
    ]
    expect(detectarConflictoDeCupo(dos, ocupacion, CUPO).size).toBe(0)
  })

  it('una entrante YA IMPORTADA no se cuenta dos veces', () => {
    // Su cupo ya esta en `ocupacion`: sumarlo otra vez marcaria un conflicto que no
    // existe, y esa entrante volveria a aparecer en el KPI en cada sincronizacion.
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-10', ocupadas: 2 },
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 2 },
    ]
    const r = detectarConflictoDeCupo([entrante({ yaImportada: true })], ocupacion, CUPO)
    expect(r.size).toBe(0)
  })

  it('los tipos no se mezclan entre si', () => {
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'SGL', fecha: '2027-05-10', ocupadas: 1 },
      { tipoUnidadCodigo: 'SGL', fecha: '2027-05-11', ocupadas: 1 },
    ]
    // La DBL no se ve afectada por la SGL llena.
    expect(detectarConflictoDeCupo([entrante()], ocupacion, CUPO).size).toBe(0)
    // Y la SGL si.
    expect(
      detectarConflictoDeCupo([entrante({ tipoUnidadCodigo: 'SGL' })], ocupacion, CUPO).size,
    ).toBe(1)
  })

  it('un tipo desconocido NO se marca como conflicto', () => {
    // La importacion va a fallar con un motivo mejor («ese codigo de tipo no existe»).
    // Marcar ademas un conflicto de cupo seria un segundo mensaje que no ayuda.
    const r = detectarConflictoDeCupo([entrante({ tipoUnidadCodigo: 'NO-EXISTE' })], [], CUPO)
    expect(r.size).toBe(0)
  })

  it('una estadia de una sola noche cuenta una noche', () => {
    // `[checkIn, checkOut)`: del 10 al 11 es UNA noche, la del 10.
    const ocupacion: OcupacionNoche[] = [
      { tipoUnidadCodigo: 'DBL', fecha: '2027-05-11', ocupadas: 2 },
    ]
    const e = entrante({ checkIn: '2027-05-10', checkOut: '2027-05-11' })
    // La noche del 11 esta llena pero no forma parte de esta estadia.
    expect(detectarConflictoDeCupo([e], ocupacion, CUPO).size).toBe(0)
  })

  it('un cupo de cero marca conflicto siempre', () => {
    // Pasa si todas las unidades de un tipo estan desactivadas.
    expect(detectarConflictoDeCupo([entrante()], [], { DBL: 0 }).size).toBe(1)
  })

  it('una lista vacia no rompe', () => {
    expect(detectarConflictoDeCupo([], [], CUPO).size).toBe(0)
  })
})
