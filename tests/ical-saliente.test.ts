import { describe, it, expect } from 'vitest'
import {
  calcularBloquesOcupados,
  describirUltimaLectura,
  generarIcal,
  type EstadiaOcupada,
} from '@/lib/canales/ical-saliente'

/**
 * Feed iCal de salida.
 *
 * Dos cosas se prueban acá y las dos pueden costar plata si se rompen:
 *
 *  · **Cerrar de más** publica como ocupada una noche que el hotel podía vender. Es
 *    el error caro y silencioso: no falla nada, simplemente entran menos reservas.
 *  · **El cuerpo del archivo no lleva datos personales.** La URL es un token al
 *    portador y cualquiera que la tenga lee el archivo entero.
 */

function estadia(unidadId: string, checkIn: string, checkOut: string): EstadiaOcupada {
  return { unidadId, checkIn, checkOut }
}

describe('bloques ocupados para el feed', () => {
  it('NO cierra una noche si queda una unidad libre del tipo', () => {
    // El error que le costaría ventas al hotel: marcar ocupado el tipo entero porque
    // se vendió una de las tres unidades.
    const bloques = calcularBloquesOcupados(
      [estadia('u1', '2026-09-01', '2026-09-05')],
      3,
      '2026-09-01',
      '2026-09-10',
    )

    expect(bloques).toEqual([])
  })

  it('cierra sólo cuando no queda ninguna libre', () => {
    const bloques = calcularBloquesOcupados(
      [
        estadia('u1', '2026-09-01', '2026-09-05'),
        estadia('u2', '2026-09-03', '2026-09-05'),
        estadia('u3', '2026-09-03', '2026-09-04'),
      ],
      3,
      '2026-09-01',
      '2026-09-10',
    )

    // Sólo la noche del 3: el 4 la u3 ya se fue y queda una libre.
    expect(bloques).toEqual([{ desde: '2026-09-03', hasta: '2026-09-04' }])
  })

  it('junta noches contiguas en un solo rango, con el fin excluido', () => {
    const bloques = calcularBloquesOcupados(
      [estadia('u1', '2026-09-01', '2026-09-04')],
      1,
      '2026-09-01',
      '2026-09-10',
    )

    // `hasta` es la primera noche LIBRE, igual que un `daterange` `[desde, hasta)`.
    // Si fuera inclusivo, el feed cerraría una noche vendible de más en cada bloque.
    expect(bloques).toEqual([{ desde: '2026-09-01', hasta: '2026-09-04' }])
  })

  it('separa dos rangos cuando hay una noche libre en el medio', () => {
    const bloques = calcularBloquesOcupados(
      [estadia('u1', '2026-09-01', '2026-09-03'), estadia('u1', '2026-09-04', '2026-09-06')],
      1,
      '2026-09-01',
      '2026-09-10',
    )

    expect(bloques).toEqual([
      { desde: '2026-09-01', hasta: '2026-09-03' },
      { desde: '2026-09-04', hasta: '2026-09-06' },
    ])
  })

  it('EL CASO QUE SE OLVIDA: sin unidades activas se cierra la ventana entera', () => {
    // Todas las unidades del tipo dadas de baja por refacción. Contar ocupación contra
    // cero daría «nada ocupado» y el canal seguiría vendiendo algo que no existe.
    const bloques = calcularBloquesOcupados([], 0, '2026-09-01', '2026-09-10')

    expect(bloques).toEqual([{ desde: '2026-09-01', hasta: '2026-09-10' }])
  })

  it('recorta las estadías que se salen de la ventana', () => {
    const bloques = calcularBloquesOcupados(
      [estadia('u1', '2026-08-20', '2026-09-15')],
      1,
      '2026-09-01',
      '2026-09-10',
    )

    expect(bloques).toEqual([{ desde: '2026-09-01', hasta: '2026-09-10' }])
  })

  it('ignora una estadía que no toca la ventana', () => {
    const bloques = calcularBloquesOcupados(
      [estadia('u1', '2026-07-01', '2026-07-05')],
      1,
      '2026-09-01',
      '2026-09-10',
    )

    expect(bloques).toEqual([])
  })

  it('una ventana vacía no produce nada', () => {
    // `rangoISO(hoy, hoy)` es un rango vacío, y esa confusión ya rompió el punto de
    // venta una vez. Acá tiene que dar lista vacía, no la ventana entera.
    expect(calcularBloquesOcupados([], 3, '2026-09-01', '2026-09-01')).toEqual([])
  })
})

describe('archivo iCal', () => {
  const generadoEn = new Date('2026-08-22T14:30:00.000Z')

  const archivo = generarIcal({
    nombre: 'Doble Superior',
    calendarioId: 'tipo-HOST-DBL-SUP',
    bloques: [{ desde: '2026-09-03', hasta: '2026-09-06' }],
    generadoEn,
  })

  it('arma un VEVENT con las fechas en formato RFC 5545', () => {
    expect(archivo).toContain('BEGIN:VCALENDAR')
    expect(archivo).toContain('DTSTART;VALUE=DATE:20260903')
    expect(archivo).toContain('DTEND;VALUE=DATE:20260906')
    expect(archivo).toContain('DTSTAMP:20260822T143000Z')
    expect(archivo).toContain('END:VCALENDAR')
  })

  it('separa las líneas con CRLF y termina con salto', () => {
    // Hay parsers estrictos que rechazan el archivo sin esto.
    expect(archivo.includes('\r\n')).toBe(true)
    expect(archivo.endsWith('\r\n')).toBe(true)
    // Ningún `\n` suelto sin su `\r` delante.
    expect(/[^\r]\n/.test(archivo)).toBe(false)
  })

  it('EL CONTRATO DE SEGURIDAD: no hay ni un dato personal en el cuerpo', () => {
    /*
      La URL del feed es un token al portador: quien la tenga lee esto. El archivo
      dice cuándo está lleno el hotel y nada más — ni quién se aloja, ni por cuánto.
    */
    const conDatos = generarIcal({
      nombre: 'Doble Superior',
      calendarioId: 'tipo-HOST-DBL-SUP',
      bloques: [{ desde: '2026-09-03', hasta: '2026-09-06' }],
      generadoEn,
    })

    for (const prohibido of ['@example', 'Pérez', 'BP-', 'USD', 'huesped', 'reserva']) {
      expect(conDatos.toLowerCase()).not.toContain(prohibido.toLowerCase())
    }

    // El resumen es una constante, no el nombre de quien se aloja.
    expect(conDatos).toContain('SUMMARY:Ocupado')
    expect(conDatos.match(/SUMMARY:/g)).toHaveLength(1)
  })

  it('el UID es estable entre generaciones', () => {
    // Si cambiara en cada lectura, el cliente de calendario acumularía un evento
    // nuevo por cada sondeo en vez de actualizar el que ya tenía.
    const otro = generarIcal({
      nombre: 'Doble Superior',
      calendarioId: 'tipo-HOST-DBL-SUP',
      bloques: [{ desde: '2026-09-03', hasta: '2026-09-06' }],
      generadoEn: new Date('2027-01-01T00:00:00.000Z'),
    })

    const uid = (texto: string) => texto.split('\r\n').find((l) => l.startsWith('UID:'))
    expect(uid(otro)).toBe(uid(archivo))
  })

  it('escapa la coma del nombre, que en iCal separa valores', () => {
    const conComa = generarIcal({
      nombre: 'Cabaña 3 dorm, vista al lago',
      calendarioId: 'tipo-CAB-3D-6P',
      bloques: [],
      generadoEn,
    })

    expect(conComa).toContain('Cabaña 3 dorm\\, vista al lago')
  })

  it('pliega las líneas largas a 75 octetos sin partir un carácter', () => {
    const largo = generarIcal({
      nombre: 'Cabaña con muchísimo espacio para toda la familia y vista completa al lago Argentino',
      calendarioId: 'tipo-CAB-3D-7P',
      bloques: [],
      generadoEn,
    })

    const codificador = new TextEncoder()
    for (const linea of largo.split('\r\n')) {
      expect(codificador.encode(linea).length).toBeLessThanOrEqual(75)
    }

    // Y el nombre sigue leyéndose entero: sin caracteres rotos por el plegado.
    expect(largo.split('\r\n ').join('')).toContain('lago Argentino')
  })

  it('un calendario sin bloques es válido y no tiene eventos', () => {
    const vacio = generarIcal({
      nombre: 'Single',
      calendarioId: 'tipo-HOST-SINGLE',
      bloques: [],
      generadoEn,
    })

    expect(vacio).toContain('BEGIN:VCALENDAR')
    expect(vacio).not.toContain('BEGIN:VEVENT')
  })
})

describe('texto de la última lectura', () => {
  const ahora = new Date('2026-08-22T12:00:00.000Z')

  it('distingue el feed que nadie leyó nunca', () => {
    // Es el caso de una URL que se copió mal en el extranet: el hotel cree que
    // publica sus bloqueos y no publica nada.
    expect(describirUltimaLectura(null, ahora)).toBe('Todavía nadie pasó a buscarlo')
  })

  it('dice las horas dentro del día', () => {
    expect(describirUltimaLectura('2026-08-22T09:00:00.000Z', ahora)).toBe('Lo leyeron hace 3 h')
    expect(describirUltimaLectura('2026-08-22T11:40:00.000Z', ahora)).toBe(
      'Lo leyeron hace menos de una hora',
    )
  })

  it('a partir de dos días el texto pasa a ser un aviso', () => {
    // No es lo mismo informar que alertar: si dejaron de leer, hay que ir a mirar.
    expect(describirUltimaLectura('2026-08-21T10:00:00.000Z', ahora)).toBe('Lo leyeron ayer')
    expect(describirUltimaLectura('2026-08-16T10:00:00.000Z', ahora)).toBe(
      'Hace 6 días que no lo leen',
    )
  })

  it('nunca dice «sincronizado»: el iCal no da acuse de recibo', () => {
    const textos = [
      describirUltimaLectura(null, ahora),
      describirUltimaLectura('2026-08-22T09:00:00.000Z', ahora),
      describirUltimaLectura('2026-08-10T09:00:00.000Z', ahora),
    ]
    for (const t of textos) expect(t.toLowerCase()).not.toContain('sincroniz')
  })
})
