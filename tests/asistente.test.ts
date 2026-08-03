import { describe, it, expect } from 'vitest'
import {
  normalizar,
  detectarIntencion,
  describirPoliticaCancelacion,
  componerRespuesta,
  componerDisponibilidad,
  extraerFechas,
  responder,
  type DatosHotel,
} from '@/lib/domain/asistente'
import type { ReglaCancelacion } from '@/lib/domain/cancelacion'

const REGLAS: ReglaCancelacion[] = [
  { desde_dias: 15, cargo: 'ninguno' },
  { desde_dias: 7, cargo: 'primera_noche' },
  { desde_dias: 0, cargo: 'total' },
]

const DATOS: DatosHotel = {
  horaCheckIn: '15:00',
  horaCheckOut: '10:00',
  reglasCancelacion: REGLAS,
  servicios: ['desayuno', 'wifi', 'estacionamiento'],
  direccion: 'El Calafate, Santa Cruz',
  admiteMascotas: false,
  rangoTarifas: { min: 120, max: 480 },
}

describe('normalización del texto', () => {
  it('pasa a minúsculas y saca tildes', () => {
    expect(normalizar('¿A qué HORA es el check-in?')).toBe('a que hora es el check in')
  })

  it('colapsa espacios y signos', () => {
    expect(normalizar('  hola!!!   ¿¿qué tal??  ')).toBe('hola que tal')
  })

  it('con texto vacío devuelve vacío', () => {
    expect(normalizar('   ')).toBe('')
  })
})

describe('detección de intención', () => {
  it('reconoce horarios de entrada y salida', () => {
    expect(detectarIntencion('¿A qué hora es el check-in?')).toBe('check_in_out')
    expect(detectarIntencion('horario de salida')).toBe('check_in_out')
  })

  it('reconoce cancelaciones', () => {
    expect(detectarIntencion('quiero cancelar mi reserva')).toBe('cancelacion')
    expect(detectarIntencion('¿me devuelven la plata?')).toBe('cancelacion')
  })

  it('prioriza cancelación sobre disponibilidad cuando aparecen las dos palabras', () => {
    // "cancelar mi reserva" contiene "reserva", que también dispara disponibilidad.
    expect(detectarIntencion('cancelar una reserva')).toBe('cancelacion')
  })

  it('reconoce consultas de precio y disponibilidad', () => {
    expect(detectarIntencion('¿cuánto sale la cabaña?')).toBe('tarifas')
    expect(detectarIntencion('¿tienen lugar para el finde?')).toBe('disponibilidad')
  })

  it('reconoce servicios, ubicación y mascotas', () => {
    expect(detectarIntencion('¿el desayuno está incluido?')).toBe('servicios')
    expect(detectarIntencion('¿dónde queda el hotel?')).toBe('ubicacion')
    expect(detectarIntencion('¿puedo llevar a mi perro?')).toBe('mascotas')
  })

  it('cae en desconocida cuando no matchea ninguna regla', () => {
    expect(detectarIntencion('¿tienen helipuerto propio?')).toBe('desconocida')
    expect(detectarIntencion('')).toBe('desconocida')
  })
})

describe('descripción de la política de cancelación', () => {
  it('se arma con las reglas cargadas, no con texto fijo', () => {
    const texto = describirPoliticaCancelacion(REGLAS)
    expect(texto).toContain('15 días o más')
    expect(texto).toContain('sin cargo')
    expect(texto).toContain('primera noche')
    expect(texto).toContain('100 %')
  })

  it('refleja un cambio de política sin tocar código', () => {
    const otras: ReglaCancelacion[] = [{ desde_dias: 30, cargo: 'ninguno' }]
    expect(describirPoliticaCancelacion(otras)).toContain('30 días o más')
  })

  it('tolera que no haya reglas cargadas', () => {
    expect(describirPoliticaCancelacion([])).toMatch(/consultá/i)
  })
})

describe('respuestas del asistente', () => {
  it('responde horarios con los datos reales', () => {
    const r = componerRespuesta('check_in_out', DATOS)
    expect(r.texto).toContain('15:00')
    expect(r.texto).toContain('10:00')
    expect(r.derivar).toBe(false)
  })

  it('deriva al buscador para tarifas y disponibilidad', () => {
    expect(componerRespuesta('tarifas', DATOS).accion?.href).toBe('/reservar')
    expect(componerRespuesta('disponibilidad', DATOS).accion?.href).toBe('/reservar')
  })

  it('informa el rango de tarifas real del tarifario', () => {
    const r = componerRespuesta('tarifas', DATOS)
    expect(r.texto).toContain('120')
    expect(r.texto).toContain('480')
  })

  it('sin tarifario cargado no inventa precios', () => {
    const r = componerRespuesta('tarifas', { ...DATOS, rangoTarifas: null })
    expect(r.texto).not.toMatch(/USD \d/)
  })

  it('marca para seguimiento solo lo desconocido', () => {
    expect(componerRespuesta('desconocida', DATOS).derivar).toBe(true)
    expect(componerRespuesta('servicios', DATOS).derivar).toBe(false)
  })

  it('respeta la política de mascotas del hotel', () => {
    expect(componerRespuesta('mascotas', DATOS).texto).toMatch(/no podemos recibir/i)
    expect(
      componerRespuesta('mascotas', { ...DATOS, admiteMascotas: true }).texto,
    ).toMatch(/s[ií], aceptamos/i)
  })

  it('el atajo responder() encadena detección y redacción', () => {
    const r = responder('¿a qué hora puedo entrar?', DATOS)
    expect(r.intencion).toBe('check_in_out')
    expect(r.texto).toContain('15:00')
  })

  it('toda respuesta tiene texto no vacío', () => {
    const r = responder('cualquier cosa rarísima', DATOS)
    expect(r.texto.length).toBeGreaterThan(0)
  })
})

describe('extracción de fechas de la pregunta', () => {
  const ANIO = 2026

  it('reconoce un rango en formato DD/MM', () => {
    expect(extraerFechas('¿tienen lugar del 10/09 al 13/09?', ANIO)).toEqual({
      desde: '2026-09-10',
      hasta: '2026-09-13',
    })
  })

  it('reconoce el año explícito', () => {
    expect(extraerFechas('del 10/09/2027 al 13/09/2027', ANIO)).toEqual({
      desde: '2027-09-10',
      hasta: '2027-09-13',
    })
  })

  it('reconoce el formato ISO', () => {
    expect(extraerFechas('entre 2026-09-10 y 2026-09-13', ANIO)).toEqual({
      desde: '2026-09-10',
      hasta: '2026-09-13',
    })
  })

  it('ordena las fechas aunque vengan al revés', () => {
    expect(extraerFechas('13/09 hasta 10/09', ANIO)?.desde).toBe('2026-09-10')
  })

  it('necesita DOS fechas para armar un rango', () => {
    expect(extraerFechas('llego el 10/09', ANIO)).toBeNull()
    expect(extraerFechas('no tengo fechas todavía', ANIO)).toBeNull()
  })

  it('descarta fechas imposibles', () => {
    expect(extraerFechas('del 31/02 al 05/03', ANIO)).toBeNull()
    expect(extraerFechas('del 45/13 al 99/99', ANIO)).toBeNull()
  })
})

describe('respuesta de disponibilidad real', () => {
  const RANGO = { desde: '2026-09-10', hasta: '2026-09-13' }

  it('lista los tipos con lugar y enlaza con las fechas cargadas', () => {
    const r = componerDisponibilidad(RANGO, [
      { nombre: 'Doble Standard', disponibles: 2, capacidadMax: 2 },
      { nombre: 'Cabaña Lenga', disponibles: 0, capacidadMax: 3 },
    ])
    expect(r.texto).toContain('Doble Standard')
    expect(r.texto).toContain('2 disponible(s)')
    // El tipo sin lugar no se ofrece.
    expect(r.texto).not.toContain('Cabaña Lenga')
    expect(r.accion?.href).toBe('/reservar?check_in=2026-09-10&check_out=2026-09-13')
  })

  it('avisa cuando no queda nada', () => {
    const r = componerDisponibilidad(RANGO, [
      { nombre: 'Doble Standard', disponibles: 0, capacidadMax: 2 },
    ])
    expect(r.texto).toMatch(/no nos queda disponibilidad/i)
    expect(r.accion?.etiqueta).toMatch(/otras fechas/i)
  })

  it('sin tipos configurados tampoco inventa disponibilidad', () => {
    expect(componerDisponibilidad(RANGO, []).texto).toMatch(/no nos queda/i)
  })
})
