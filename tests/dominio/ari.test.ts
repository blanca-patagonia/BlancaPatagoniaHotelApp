import { describe, it, expect } from 'vitest'
import {
  calcularAri,
  cupoPublicable,
  motivoNoPublicar,
  ocupacionPorTipoYNoche,
  restriccionDelDia,
  resumirAri,
  DIAS_DE_VENTANA,
  MENSAJES_NO_PUBLICAR,
  type EstadiaOcupada,
  type MapeoTipo,
  type MotivoNoPublicar,
  type PrecioDelDia,
} from '@/lib/domain/ari'

/**
 * ARI — lo que el hotel le publica al canal (Bloque E, hallazgo P1-1).
 *
 * `publicarDisponibilidad` existía en el puerto desde la modernización WinPAX y
 * **no lo llamaba nadie**. Estas reglas son la mitad pura del arreglo.
 */

const TIPO = 'tipo-doble'
const VENTANA = { moneda: 'USD', desde: '2026-10-01', hasta: '2026-10-04' }

const mapeo = (over: Partial<MapeoTipo> = {}): MapeoTipo => ({
  tipoUnidadId: TIPO,
  codigoCanal: 'DBL-LAGO',
  unidadesActivas: 3,
  topeCupo: null,
  minimoNoches: null,
  cerrado: false,
  ...over,
})

const precios = (fechas: readonly string[], precio = 100): PrecioDelDia[] =>
  fechas.map((fecha) => ({ tipoUnidadId: TIPO, fecha, precio }))

const TRES_DIAS = ['2026-10-01', '2026-10-02', '2026-10-03']

describe('cupo publicable', () => {
  it('es lo que queda libre', () => {
    expect(cupoPublicable(3, 1, null)).toBe(2)
  })

  it('nunca es negativo', () => {
    /*
      Si un bloqueo manual dejara más unidades ocupadas que activas, la resta daría
      negativo. Un canal rechazaría la fila entera —o peor, la interpretaría como
      otra cosa—.
    */
    expect(cupoPublicable(2, 5, null)).toBe(0)
  })

  it('el tope recorta, y es lo que permite guardarse inventario', () => {
    // Un hotel que publica todo en una OTA se queda sin nada que vender por
    // teléfono en temporada, y paga comisión por el 100 % de lo que vende.
    expect(cupoPublicable(10, 0, 4)).toBe(4)
    // Pero el tope no INVENTA cupo: si hay menos libre que el tope, manda lo libre.
    expect(cupoPublicable(3, 2, 4)).toBe(1)
  })
})

describe('ocupación por tipo y noche', () => {
  it('cuenta unidades distintas, no estadías', () => {
    /*
      Dos estadías de la misma unidad la misma noche no pueden existir —lo impide
      la exclusión GiST del ADR 0002— pero contarlas dos veces daría el tipo por
      más lleno de lo que está, y el canal dejaría de vender noches vendibles.
    */
    const estadias: EstadiaOcupada[] = [
      { unidadId: 'u1', tipoUnidadId: TIPO, checkIn: '2026-10-01', checkOut: '2026-10-03' },
      { unidadId: 'u1', tipoUnidadId: TIPO, checkIn: '2026-10-01', checkOut: '2026-10-02' },
    ]
    const mapa = ocupacionPorTipoYNoche(estadias, '2026-10-01', '2026-10-04')

    expect(mapa.get(TIPO)?.get('2026-10-01')?.size).toBe(1)
  })

  it('recorta las estadías que se salen de la ventana', () => {
    const estadias: EstadiaOcupada[] = [
      { unidadId: 'u1', tipoUnidadId: TIPO, checkIn: '2026-09-20', checkOut: '2026-10-02' },
    ]
    const mapa = ocupacionPorTipoYNoche(estadias, '2026-10-01', '2026-10-04')

    expect(mapa.get(TIPO)?.get('2026-10-01')?.size).toBe(1)
    expect(mapa.get(TIPO)?.get('2026-09-20')).toBeUndefined()
  })

  it('la noche de salida NO está ocupada', () => {
    // El período es `[check_in, check_out)`: la habitación se libera ese día.
    const estadias: EstadiaOcupada[] = [
      { unidadId: 'u1', tipoUnidadId: TIPO, checkIn: '2026-10-01', checkOut: '2026-10-02' },
    ]
    const mapa = ocupacionPorTipoYNoche(estadias, '2026-10-01', '2026-10-04')

    expect(mapa.get(TIPO)?.get('2026-10-02')).toBeUndefined()
  })
})

describe('calcular el ARI', () => {
  it('arma una fila por tipo y por noche', () => {
    const { filas } = calcularAri([mapeo()], [], precios(TRES_DIAS), VENTANA)

    expect(filas).toHaveLength(3)
    expect(filas[0]).toMatchObject({
      tipoUnidadCodigo: 'DBL-LAGO',
      fecha: '2026-10-01',
      cupo: 3,
      precio: 100,
      moneda: 'USD',
      cerrado: false,
    })
  })

  it('descuenta lo ocupado', () => {
    const estadias: EstadiaOcupada[] = [
      { unidadId: 'u1', tipoUnidadId: TIPO, checkIn: '2026-10-01', checkOut: '2026-10-02' },
      { unidadId: 'u2', tipoUnidadId: TIPO, checkIn: '2026-10-01', checkOut: '2026-10-02' },
    ]
    const { filas } = calcularAri([mapeo()], estadias, precios(TRES_DIAS), VENTANA)

    expect(filas.find((f) => f.fecha === '2026-10-01')?.cupo).toBe(1)
    expect(filas.find((f) => f.fecha === '2026-10-02')?.cupo).toBe(3)
  })

  it('un día SIN tarifa no se publica, y se cuenta aparte', () => {
    /*
      La decisión más importante del módulo. Las dos alternativas son peores:

      · Publicar `0` es publicar una noche gratis. Ya pasó en este sistema, del
        lado público: el «USD 0 al reservar» de la Fase 18 fue exactamente esto.
      · Publicar el precio de otro día es inventar una tarifa.
    */
    const { filas, sinPrecio } = calcularAri(
      [mapeo()],
      [],
      precios(['2026-10-01', '2026-10-02']),
      VENTANA,
    )

    expect(filas).toHaveLength(2)
    expect(sinPrecio).toBe(1)
    expect(filas.some((f) => f.precio === 0), 'publicó una noche gratis').toBe(false)
  })

  it('un precio de cero cuenta como sin precio', () => {
    const { filas, sinPrecio } = calcularAri([mapeo()], [], precios(TRES_DIAS, 0), VENTANA)

    expect(filas).toHaveLength(0)
    expect(sinPrecio).toBe(3)
  })

  it('cupo cero se publica como CERRADO, no se omite', () => {
    /*
      Omitir un día deja al canal con el valor anterior, que es justamente el que
      hay que corregir. Y cupo 0 sin la marca puede seguir aceptando reservas «en
      lista de espera» en algunos canales.
    */
    const estadias: EstadiaOcupada[] = Array.from({ length: 3 }, (_, i) => ({
      unidadId: `u${i}`,
      tipoUnidadId: TIPO,
      checkIn: '2026-10-01',
      checkOut: '2026-10-02',
    }))
    const { filas } = calcularAri([mapeo()], estadias, precios(TRES_DIAS), VENTANA)

    const primera = filas.find((f) => f.fecha === '2026-10-01')
    expect(primera, 'omitió el día lleno en vez de cerrarlo').toBeDefined()
    expect(primera?.cupo).toBe(0)
    expect(primera?.cerrado).toBe(true)
  })

  it('un tipo cerrado a mano se publica cerrado aunque haya lugar', () => {
    const { filas } = calcularAri([mapeo({ cerrado: true })], [], precios(TRES_DIAS), VENTANA)

    expect(filas.every((f) => f.cupo === 0 && f.cerrado)).toBe(true)
  })

  it('el mínimo de noches sólo viaja si es mayor que 1', () => {
    // Mandar `minimoNoches: 1` es ruido: es el valor por omisión de cualquier canal.
    const conUno = calcularAri([mapeo({ minimoNoches: 1 })], [], precios(TRES_DIAS), VENTANA)
    const conDos = calcularAri([mapeo({ minimoNoches: 2 })], [], precios(TRES_DIAS), VENTANA)

    expect(conUno.filas[0].minimoNoches).toBeUndefined()
    expect(conDos.filas[0].minimoNoches).toBe(2)
  })

  it('una ventana vacía no produce filas', () => {
    const { filas } = calcularAri([mapeo()], [], precios(TRES_DIAS), {
      ...VENTANA,
      hasta: VENTANA.desde,
    })
    expect(filas).toEqual([])
  })

  it('publica un año hacia adelante', () => {
    // Es el horizonte que aceptan Booking y los channel managers, y lo que un
    // hotel de temporada necesita: quien reserva El Calafate para enero mira en
    // marzo.
    expect(DIAS_DE_VENTANA).toBe(365)
  })
})

describe('resumen del ARI', () => {
  it('separa noches abiertas de cerradas', () => {
    const estadias: EstadiaOcupada[] = Array.from({ length: 3 }, (_, i) => ({
      unidadId: `u${i}`,
      tipoUnidadId: TIPO,
      checkIn: '2026-10-01',
      checkOut: '2026-10-02',
    }))
    const { filas, sinPrecio } = calcularAri([mapeo()], estadias, precios(TRES_DIAS), VENTANA)
    const r = resumirAri(filas, sinPrecio)

    expect(r.filas).toBe(3)
    expect(r.nochesCerradas).toBe(1)
    expect(r.nochesAbiertas).toBe(2)
    expect(r.tipos).toBe(1)
  })
})

describe('por qué no se puede publicar', () => {
  it('sin mapeos no hay a qué publicarle', () => {
    expect(
      motivoNoPublicar({ mapeos: 0, publicaDisponibilidad: true, filas: 10 }),
    ).toBe('sin_mapeos')
  })

  it('un proveedor de solo lectura se declara, no se reporta como error', () => {
    /*
      La limitación del ADR 0021. Que tenga un motivo propio es lo que permite que
      la pantalla diga «este proveedor no publica» en vez de «falló la
      publicación»: son dos cosas distintas y llevan a acciones distintas —una se
      resuelve contratando un channel manager, la otra reintentando—.
    */
    expect(
      motivoNoPublicar({ mapeos: 2, publicaDisponibilidad: false, filas: 10 }),
    ).toBe('proveedor_no_publica')
  })

  it('con todo en orden, se puede', () => {
    expect(motivoNoPublicar({ mapeos: 2, publicaDisponibilidad: true, filas: 10 })).toBeNull()
  })

  it('sin filas suele ser que faltan tarifas', () => {
    expect(motivoNoPublicar({ mapeos: 2, publicaDisponibilidad: true, filas: 0 })).toBe('sin_filas')
  })

  it('todos los motivos tienen mensaje en español', () => {
    const motivos: MotivoNoPublicar[] = ['sin_mapeos', 'proveedor_no_publica', 'sin_filas']
    for (const m of motivos) expect(MENSAJES_NO_PUBLICAR[m], `falta el mensaje de ${m}`).toBeTruthy()
  })
})

describe('restricciones por fecha (migración 0087)', () => {
  const MAPEO = {
    tipoUnidadId: 't1',
    codigoCanal: 'DBL',
    unidadesActivas: 4,
    topeCupo: null,
    minimoNoches: null,
    cerrado: false,
  }

  const RESTRICCION = {
    tipoUnidadId: null,
    desde: '2027-10-09',
    hasta: '2027-10-13',
    minimoNoches: 3,
    cerrado: false,
    cerradoLlegada: false,
    cerradoSalida: false,
  }

  it('el rango tiene el fin EXCLUIDO', () => {
    /*
      ⚠️ El error de un día. `[2027-10-09, 2027-10-13)` alcanza al 9, 10, 11 y 12,
      **no al 13**. Con `<=` la restricción se pasaría un día: el hotel pediría
      tres noches mínimo el día que quería volver a vender sueltas, y nadie
      relacionaría el síntoma con esta línea.

      Es la misma convención de `estadias.periodo` y de los rangos de temporada.
    */
    expect(restriccionDelDia(MAPEO, [RESTRICCION], '2027-10-09').minimoNoches).toBe(3)
    expect(restriccionDelDia(MAPEO, [RESTRICCION], '2027-10-12').minimoNoches).toBe(3)
    expect(restriccionDelDia(MAPEO, [RESTRICCION], '2027-10-13').minimoNoches).toBeNull()
    expect(restriccionDelDia(MAPEO, [RESTRICCION], '2027-10-08').minimoNoches).toBeNull()
  })

  it('`tipoUnidadId: null` alcanza a TODOS los tipos', () => {
    // Es el caso más común: «del 24 al 26 no acepto llegadas» es del hotel
    // entero. Si `null` se interpretara como «ninguno», la restricción más usada
    // no haría nada y no habría error que lo delatara.
    expect(restriccionDelDia(MAPEO, [RESTRICCION], '2027-10-10').minimoNoches).toBe(3)

    const otroTipo = { ...MAPEO, tipoUnidadId: 't9' }
    expect(restriccionDelDia(otroTipo, [RESTRICCION], '2027-10-10').minimoNoches).toBe(3)
  })

  it('una restricción de otro tipo no alcanza a éste', () => {
    const soloT9 = { ...RESTRICCION, tipoUnidadId: 't9' }
    expect(restriccionDelDia(MAPEO, [soloT9], '2027-10-10').minimoNoches).toBeNull()
  })

  it('gana la MÁS restrictiva cuando dos reglas se pisan', () => {
    /*
      ⚠️ La decisión de este módulo.

      Quedarse corto vende una noche que el hotel no quería vender, y esa venta ya
      no se deshace sin cancelarle a alguien. Quedarse largo sólo pierde una
      reserva que todavía se puede recuperar por teléfono.
    */
    const conMinimoDeTipo = { ...MAPEO, minimoNoches: 2 }
    expect(restriccionDelDia(conMinimoDeTipo, [RESTRICCION], '2027-10-10').minimoNoches).toBe(3)

    const dosNoches = { ...RESTRICCION, minimoNoches: 2 }
    const cincoNoches = { ...RESTRICCION, minimoNoches: 5 }
    expect(
      restriccionDelDia(MAPEO, [dosNoches, cincoNoches], '2027-10-10').minimoNoches,
    ).toBe(5)

    // Y un cerrado no se «abre» porque otra regla no lo cierre.
    const cierra = { ...RESTRICCION, minimoNoches: null, cerrado: true }
    const noCierra = { ...RESTRICCION, minimoNoches: null, cerrado: false }
    expect(restriccionDelDia(MAPEO, [cierra, noCierra], '2027-10-10').cerrado).toBe(true)
  })

  it('cerrar por fecha pone el cupo en cero y marca la fila', () => {
    const cierra = { ...RESTRICCION, minimoNoches: null, cerrado: true }
    const { filas } = calcularAri(
      [MAPEO],
      [],
      [
        { tipoUnidadId: 't1', fecha: '2027-10-10', precio: 100 },
        { tipoUnidadId: 't1', fecha: '2027-10-20', precio: 100 },
      ],
      { moneda: 'USD', desde: '2027-10-10', hasta: '2027-10-21' },
      [cierra],
    )

    const cerrada = filas.find((f) => f.fecha === '2027-10-10')
    const abierta = filas.find((f) => f.fecha === '2027-10-20')

    expect(cerrada?.cupo, 'un día cerrado publicó cupo').toBe(0)
    expect(cerrada?.cerrado).toBe(true)
    // Fuera del rango, el hotel sigue vendiendo normal: cerrar unas fechas no
    // puede apagar el resto de la ventana.
    expect(abierta?.cupo).toBe(4)
    expect(abierta?.cerrado).toBe(false)
  })

  it('CTA y CTD sólo se informan cuando son true', () => {
    /*
      Son instrucciones, no estados. Mandar `cerradoLlegada: false` en las 365
      filas es ruido, y con algunos canales es peor: levanta una restricción que
      el hotel puso a mano desde el extranet.
    */
    const cta = { ...RESTRICCION, minimoNoches: null, cerradoLlegada: true }
    const { filas } = calcularAri(
      [MAPEO],
      [],
      [{ tipoUnidadId: 't1', fecha: '2027-10-10', precio: 100 }],
      { moneda: 'USD', desde: '2027-10-10', hasta: '2027-10-11' },
      [cta],
    )

    expect(filas[0].cerradoLlegada).toBe(true)
    expect(filas[0].cerradoSalida, 'se informó un CTD que nadie pidió').toBeUndefined()
    // Y no cierra la venta: se puede estar ese día, sólo que no empezar ahí.
    expect(filas[0].cupo).toBe(4)
  })

  it('sin restricciones, el resultado es exactamente el de antes', () => {
    // El parámetro es opcional para no romper a quien ya llamaba a `calcularAri`.
    const opciones = { moneda: 'USD', desde: '2027-10-10', hasta: '2027-10-12' } as const
    const precios = [
      { tipoUnidadId: 't1', fecha: '2027-10-10', precio: 100 },
      { tipoUnidadId: 't1', fecha: '2027-10-11', precio: 100 },
    ]

    const sin = calcularAri([MAPEO], [], precios, opciones)
    const conVacias = calcularAri([MAPEO], [], precios, opciones, [])

    expect(conVacias).toEqual(sin)
  })
})
