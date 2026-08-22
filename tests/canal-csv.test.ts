import { describe, it, expect } from 'vitest'
import {
  detectarDelimitador,
  esColumnaProhibida,
  interpretarCsvBooking,
  interpretarFecha,
  interpretarImporte,
  interpretarOperacion,
  mapearColumnas,
  normalizarEncabezado,
  obligatoriosFaltantes,
  partirCsv,
  partirNombre,
} from '@/lib/canales/csv'

/**
 * El informe de reservas de Booking es un archivo que no controlamos: cambia de
 * separador según la configuración regional de quien lo exportó, de encabezados
 * según el idioma de la cuenta, y de formato de fecha e importe según las dos
 * cosas. Lo que se prueba acá son esos bordes, porque **ninguno falla de forma
 * visible**: un separador mal detectado devuelve columnas vacías, y un día
 * confundido con un mes devuelve una reserva plausible en la fecha equivocada.
 */

describe('detectarDelimitador', () => {
  it('detecta el punto y coma, que es lo que exporta Excel en español', () => {
    expect(detectarDelimitador('Numero de reserva;Nombre del cliente;Fecha de entrada')).toBe(';')
  })

  it('detecta la coma', () => {
    expect(detectarDelimitador('Book number,Guest name,Arrival')).toBe(',')
  })

  it('detecta la tabulación', () => {
    expect(detectarDelimitador('A\tB\tC')).toBe('\t')
  })

  it('no se deja engañar por una coma dentro de comillas', () => {
    // Con punto y coma como separador real, la coma de «Apellido, Nombre» no
    // separa nada. Contarla a secas podría hacerla ganar la votación.
    expect(detectarDelimitador('Numero;"Apellido, Nombre";Entrada')).toBe(';')
  })
})

describe('partirCsv', () => {
  it('parte filas y celdas', () => {
    expect(partirCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('respeta los campos entre comillas con el separador adentro', () => {
    const filas = partirCsv('nombre,nota\n"Pérez, Ana","vino, tarde"')
    expect(filas[1]).toEqual(['Pérez, Ana', 'vino, tarde'])
  })

  it('interpreta las comillas duplicadas como una comilla literal', () => {
    const filas = partirCsv('nota\n"dijo ""hola"""')
    expect(filas[1]).toEqual(['dijo "hola"'])
  })

  it('acepta saltos de línea dentro de un campo entrecomillado', () => {
    // Pasa con el campo de observaciones cuando el huésped escribió dos renglones.
    const filas = partirCsv('id,nota\n1,"primera\nsegunda"')
    expect(filas.length).toBe(2)
    expect(filas[1][1]).toBe('primera\nsegunda')
  })

  it('maneja CRLF de Windows', () => {
    expect(partirCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('saca el BOM que agrega Excel', () => {
    // Sin quitarlo, el primer encabezado no coincide con nada y el archivo entero
    // parece no tener columnas.
    const filas = partirCsv('﻿Numero,Nombre\n1,Ana')
    expect(filas[0][0]).toBe('Numero')
  })

  it('descarta la fila vacía que Excel deja al final', () => {
    expect(partirCsv('a,b\n1,2\n\n')).toHaveLength(2)
  })

  it('un texto vacío no rompe', () => {
    expect(partirCsv('')).toEqual([])
    expect(partirCsv('   ')).toEqual([])
  })
})

describe('normalizarEncabezado', () => {
  it('saca acentos, mayúsculas y puntuación', () => {
    expect(normalizarEncabezado('Fecha de Entrada')).toBe('fecha de entrada')
    expect(normalizarEncabezado('FECHA  DE  ENTRADA:')).toBe('fecha de entrada')
    expect(normalizarEncabezado('Comisión')).toBe('comision')
    expect(normalizarEncabezado('Dirección de correo electrónico')).toBe(
      'direccion de correo electronico',
    )
  })
})

describe('mapearColumnas', () => {
  it('ubica los campos del informe en español', () => {
    const mapa = mapearColumnas([
      'Número de reserva',
      'Nombre del cliente',
      'Fecha de entrada',
      'Fecha de salida',
      'Estado',
      'Precio',
    ])

    expect(mapa.externalId).toBe(0)
    expect(mapa.huesped).toBe(1)
    expect(mapa.checkIn).toBe(2)
    expect(mapa.checkOut).toBe(3)
    expect(mapa.estado).toBe(4)
    expect(mapa.importe).toBe(5)
  })

  it('ubica los campos del informe en inglés', () => {
    const mapa = mapearColumnas(['Book number', 'Guest name', 'Arrival', 'Departure'])
    expect(mapa.externalId).toBe(0)
    expect(mapa.huesped).toBe(1)
    expect(mapa.checkIn).toBe(2)
    expect(mapa.checkOut).toBe(3)
  })

  it('no confunde «Fecha de reserva» con «Número de reserva»', () => {
    // Es la razón por la que los alias más específicos van primero: un alias
    // «reserva» a secas capturaría las dos columnas.
    const mapa = mapearColumnas(['Fecha de reserva', 'Número de reserva'])
    expect(mapa.externalId).toBe(1)
    expect(mapa.reservadaEn).toBe(0)
  })

  it('encuentra un encabezado con texto extra alrededor', () => {
    const mapa = mapearColumnas(['Número de reserva', 'Precio (impuestos incluidos)'])
    expect(mapa.importe).toBe(1)
  })

  it('devuelve null para los campos que no están', () => {
    const mapa = mapearColumnas(['Número de reserva'])
    expect(mapa.email).toBeNull()
    expect(mapa.comision).toBeNull()
  })

  it('informa los obligatorios que faltan', () => {
    const mapa = mapearColumnas(['Número de reserva', 'Fecha de entrada'])
    const faltan = obligatoriosFaltantes(mapa)
    expect(faltan).toContain('huesped')
    expect(faltan).toContain('checkOut')
    expect(faltan).not.toContain('externalId')
  })
})

describe('interpretarFecha', () => {
  it('lee ISO sin ambigüedad', () => {
    expect(interpretarFecha('2026-09-10')).toEqual({ iso: '2026-09-10', ambigua: false })
  })

  it('lee día/mes/año, que es el formato del extranet en español', () => {
    expect(interpretarFecha('10/09/2026')).toEqual({ iso: '2026-09-10', ambigua: true })
  })

  it('cuando el primer número pasa de 12, es el día con certeza', () => {
    expect(interpretarFecha('25/09/2026')).toEqual({ iso: '2026-09-25', ambigua: false })
  })

  it('cuando el segundo número pasa de 12, el formato es mes/día', () => {
    // `09/25/2026` sólo puede ser el 25 de septiembre en formato anglosajón.
    expect(interpretarFecha('09/25/2026')).toEqual({ iso: '2026-09-25', ambigua: false })
  })

  it('marca como ambigua la fecha que se puede leer de las dos formas', () => {
    // `10/09/2026` es el 10 de septiembre o el 9 de octubre y NO se puede
    // resolver mirando el valor. Se asume día/mes y se avisa, para que la
    // pantalla lo advierta: elegir mal produce una reserva perfectamente
    // plausible en la fecha equivocada.
    expect(interpretarFecha('10/09/2026')?.ambigua).toBe(true)
    expect(interpretarFecha('01/02/2026')?.ambigua).toBe(true)
  })

  it('acepta guiones y puntos como separador', () => {
    expect(interpretarFecha('25-09-2026')?.iso).toBe('2026-09-25')
    expect(interpretarFecha('25.09.2026')?.iso).toBe('2026-09-25')
  })

  it('rechaza lo que no reconoce en vez de inventar una fecha', () => {
    expect(interpretarFecha('el jueves')).toBeNull()
    expect(interpretarFecha('')).toBeNull()
    expect(interpretarFecha('2026-13-45')).toBeNull()
    expect(interpretarFecha('40/40/2026')).toBeNull()
  })
})

describe('interpretarImporte', () => {
  it('lee formato europeo: el punto es de miles', () => {
    // Leerlo mal acá es equivocarse por un factor de mil.
    expect(interpretarImporte('1.234,56')).toBe(1234.56)
  })

  it('lee formato anglosajón: la coma es de miles', () => {
    expect(interpretarImporte('1,234.56')).toBe(1234.56)
  })

  it('lee un número simple', () => {
    expect(interpretarImporte('450')).toBe(450)
    expect(interpretarImporte('450.75')).toBe(450.75)
    expect(interpretarImporte('450,75')).toBe(450.75)
  })

  it('ignora el símbolo de moneda y los espacios', () => {
    expect(interpretarImporte('USD 1.500,00')).toBe(1500)
    expect(interpretarImporte('$ 320')).toBe(320)
  })

  it('devuelve null cuando no hay número', () => {
    expect(interpretarImporte('')).toBeNull()
    expect(interpretarImporte('sin cargo')).toBeNull()
  })
})

describe('interpretarOperacion', () => {
  it('reconoce cancelaciones en los dos idiomas', () => {
    expect(interpretarOperacion('cancelled_by_guest')).toBe('cancelada')
    expect(interpretarOperacion('Cancelada')).toBe('cancelada')
    expect(interpretarOperacion('Anulada')).toBe('cancelada')
  })

  it('reconoce modificaciones', () => {
    expect(interpretarOperacion('modified')).toBe('modificada')
    expect(interpretarOperacion('Modificada')).toBe('modificada')
  })

  it('un estado desconocido cae en «nueva», que es el caso conservador', () => {
    // Interpretar un estado desconocido como cancelada liberaría una unidad ya
    // vendida. Como nueva, aterriza en la zona de recepción y alguien la mira.
    expect(interpretarOperacion('algo_raro')).toBe('nueva')
    expect(interpretarOperacion('')).toBe('nueva')
    expect(interpretarOperacion('ok')).toBe('nueva')
  })
})

describe('partirNombre', () => {
  it('con coma, es «Apellido, Nombre»', () => {
    expect(partirNombre('Pérez, Ana María')).toEqual({ apellido: 'Pérez', nombre: 'Ana María' })
  })

  it('sin coma, la última palabra es el apellido', () => {
    expect(partirNombre('Ana Pérez')).toEqual({ apellido: 'Pérez', nombre: 'Ana' })
    expect(partirNombre('Ana María Pérez')).toEqual({ apellido: 'Pérez', nombre: 'Ana María' })
  })

  it('una sola palabra es el apellido', () => {
    expect(partirNombre('Pérez')).toEqual({ apellido: 'Pérez', nombre: '' })
  })

  it('vacío no rompe', () => {
    expect(partirNombre('   ')).toEqual({ apellido: '', nombre: '' })
  })
})

/* ─────────────────────────────────────────── el informe completo ──── */

/** Informe con la forma del extranet en español: punto y coma, día/mes/año. */
const INFORME_ES = [
  'Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida;Personas;Tipo de unidad;Precio;Divisa;Comisión;Estado;Dirección de correo electrónico;Teléfono;País;Observaciones',
  '4123456789;"Pérez, Ana";25/09/2026;28/09/2026;2;Habitación Doble;450,00;USD;67,50;ok;ana@example.com;+5492901000000;AR;Llegada tardía',
  '4987654321;"Smith, John";01/10/2026;03/10/2026;3;Cabaña;620,50;USD;93,08;cancelled_by_guest;john@example.com;;US;',
].join('\n')

describe('interpretarCsvBooking', () => {
  it('lee el informe en español completo', () => {
    const r = interpretarCsvBooking(INFORME_ES)

    expect(r.faltantes).toEqual([])
    expect(r.leidas).toBe(2)
    expect(r.reservas).toHaveLength(2)
    expect(r.rechazadas).toEqual([])

    const [primera] = r.reservas
    expect(primera.externalId).toBe('4123456789')
    expect(primera.canal).toBe('booking')
    expect(primera.huesped.apellido).toBe('Pérez')
    expect(primera.huesped.nombre).toBe('Ana')
    expect(primera.huesped.email).toBe('ana@example.com')
    expect(primera.huesped.pais).toBe('AR')
    expect(primera.checkIn).toBe('2026-09-25')
    expect(primera.checkOut).toBe('2026-09-28')
    expect(primera.huespedes).toBe(2)
    expect(primera.importeCanal).toBe(450)
    expect(primera.comision).toBe(67.5)
    expect(primera.operacion).toBe('nueva')
    expect(primera.notas).toBe('Llegada tardía')
  })

  it('reconoce la cancelada del informe', () => {
    const r = interpretarCsvBooking(INFORME_ES)
    expect(r.reservas[1].operacion).toBe('cancelada')
  })

  it('no importa nada si faltan encabezados obligatorios', () => {
    // Mejor no leer que leer mal: sin el número de reserva no hay idempotencia y
    // cada importación duplicaría todo.
    const r = interpretarCsvBooking('Nombre;Precio\nAna;100')
    expect(r.reservas).toEqual([])
    expect(r.faltantes.length).toBeGreaterThan(0)
    expect(r.faltantes).toContain('externalId')
  })

  it('rechaza las filas malas sin descartar las buenas', () => {
    // Si el archivo trae 3 reservas y entran 2, hay que poder ver la que falta.
    const texto = [
      'Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida',
      '111;"Pérez, Ana";25/09/2026;28/09/2026',
      ';"Sin numero";25/09/2026;28/09/2026',
      '333;"Fecha, Mala";el jueves;28/09/2026',
    ].join('\n')

    const r = interpretarCsvBooking(texto)
    expect(r.reservas).toHaveLength(1)
    expect(r.rechazadas).toHaveLength(2)
    expect(r.rechazadas[0].motivos).toContain('Falta el número de reserva.')
    expect(r.rechazadas[1].motivos).toContain('La fecha de entrada no se pudo interpretar.')
  })

  it('el número de fila rechazada coincide con lo que se ve en Excel', () => {
    const texto = [
      'Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida',
      '111;"Pérez, Ana";25/09/2026;28/09/2026',
      ';"Sin numero";25/09/2026;28/09/2026',
    ].join('\n')

    // El encabezado es la fila 1, la primera reserva la 2, la mala la 3.
    expect(interpretarCsvBooking(texto).rechazadas[0].fila).toBe(3)
  })

  it('rechaza una salida anterior o igual a la entrada', () => {
    const texto = [
      'Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida',
      '111;"Pérez, Ana";28/09/2026;25/09/2026',
    ].join('\n')

    expect(interpretarCsvBooking(texto).rechazadas[0].motivos).toContain(
      'La salida no puede ser anterior o igual a la entrada.',
    )
  })

  it('cuenta las fechas ambiguas para poder advertirlas', () => {
    const r = interpretarCsvBooking(INFORME_ES)
    // `25/09` y `28/09` no son ambiguas (25 y 28 pasan de 12), pero `01/10` y
    // `03/10` sí: la segunda fila entra en la cuenta.
    expect(r.fechasAmbiguas).toBe(1)
  })

  it('un archivo con sólo encabezado no rompe', () => {
    const r = interpretarCsvBooking('Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida')
    expect(r.reservas).toEqual([])
    expect(r.leidas).toBe(0)
  })

  it('funciona igual con coma como separador', () => {
    const texto = [
      'Book number,Guest name,Arrival,Departure,Price,Currency',
      '999,"Doe, Jane",2026-11-05,2026-11-08,"1,250.00",EUR',
    ].join('\n')

    const r = interpretarCsvBooking(texto)
    expect(r.reservas).toHaveLength(1)
    expect(r.reservas[0].importeCanal).toBe(1250)
    expect(r.reservas[0].monedaCanal).toBe('EUR')
  })

  it('sin tipo de unidad usa un marcador en vez de quedar vacío', () => {
    // El tipo del canal no siempre coincide con uno nuestro; resolverlo es parte
    // de importar. Pero la columna no puede quedar en blanco.
    const texto = [
      'Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida',
      '111;"Pérez, Ana";25/09/2026;28/09/2026',
    ].join('\n')

    expect(interpretarCsvBooking(texto).reservas[0].tipoUnidadCodigo).toBe('SIN-TIPO')
  })

  it('emitidaEn siempre es un timestamp completo, comparable como string', () => {
    // Si quedara como `2026-09-10`, la comparación de `esEventoMasReciente` diría
    // que es anterior a cualquier timestamp del mismo día y la fila del CSV nunca
    // ganaría contra una guardada.
    const r = interpretarCsvBooking(INFORME_ES)
    for (const reserva of r.reservas) {
      expect(reserva.emitidaEn).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(Number.isNaN(Date.parse(reserva.emitidaEn))).toBe(false)
    }
  })

  it('no trae ningún dato de tarjeta, porque el informe no lo exporta', () => {
    // Se fija como contrato: WinPAX guardaba PAN y PIN, y este sistema no puede
    // empezar a hacerlo por la puerta de una importación.
    const r = interpretarCsvBooking(INFORME_ES)
    const serializado = JSON.stringify(r.reservas)
    expect(serializado).not.toMatch(/tarjeta|card|pan|pin|cvv/i)
  })

  describe('columnas prohibidas', () => {
    /*
      El test de arriba prueba que un informe SIN columnas de tarjeta no las trae, lo
      cual es fácil. Lo que hay que fijar es el caso contrario: un archivo que SÍ las
      trae —porque alguien lo armó a mano, o porque el extranet agregó la columna— no
      puede meterlas en la base.

      Importa ahora y no dentro de tres pasos: el mapeo manual de columnas va a
      dejarle al usuario elegir qué columna es cuál, y sin esta guarda podría asignar
      «Tarjeta virtual» al campo de observaciones sin darse cuenta.
    */
    const CON_TARJETA = [
      'Número de reserva;Nombre del cliente;Fecha de entrada;Fecha de salida;Tarjeta virtual;CVC;Caducidad;Observaciones',
      '4123456789;"Pérez, Ana";25/09/2026;28/09/2026;4111111111111111;737;12/28;Llegada tardía',
    ].join('\n')

    it('reconoce los encabezados que no se pueden leer', () => {
      for (const h of [
        'Tarjeta virtual',
        'Número de tarjeta',
        'Credit card',
        'CVC',
        'CVV',
        'Caducidad',
        'Expiry date',
        'IBAN',
        'Titular de la tarjeta',
        'Cardholder name',
      ]) {
        expect(esColumnaProhibida(h), `«${h}» debería estar prohibida`).toBe(true)
      }
    })

    it('NO prohíbe columnas legítimas que se parecen', () => {
      // `pan` está con límites de palabra a propósito: «Panamá» y «acompañante» no
      // son datos de tarjeta, y prohibirlas dejaría al importador sin el país.
      for (const h of ['País', 'Panamá', 'Acompañantes', 'Cantidad', 'Comisión', 'Precio']) {
        expect(esColumnaProhibida(h), `«${h}» NO debería estar prohibida`).toBe(false)
      }
    })

    it('un informe CON columnas de tarjeta se lee, pero sin ellas', () => {
      // No se rechaza el archivo entero: la reserva es válida y perderla sería peor.
      // Lo que se pierde es la columna prohibida, y nada más.
      const r = interpretarCsvBooking(CON_TARJETA)
      expect(r.reservas).toHaveLength(1)
      expect(r.reservas[0].externalId).toBe('4123456789')
      // Las columnas legítimas que venían DESPUÉS de las prohibidas siguen alineadas:
      // por eso el encabezado se pone en blanco en vez de sacarse de la lista.
      expect(r.reservas[0].notas).toBe('Llegada tardía')
    })

    it('ni el PAN ni el CVC ni el vencimiento quedan en la reserva interpretada', () => {
      const r = interpretarCsvBooking(CON_TARJETA)
      const serializado = JSON.stringify(r.reservas)
      expect(serializado).not.toContain('4111111111111111')
      expect(serializado).not.toContain('737')
      expect(serializado).not.toContain('12/28')
    })
  })
})
