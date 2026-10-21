import { describe, it, expect } from 'vitest'
import {
  aplicarVariables,
  enHorario,
  mensajeAutomatico,
  pareceRemitenteAutomatico,
  primerNombre,
  resumenHorario,
  rotuloDeDia,
  seAgrupa,
  validarAjustes,
  type ConfigAutomatica,
} from '@/lib/domain/bandeja'

/**
 * Horario de atención, mensajes automáticos, variables y ajustes (ADR 0044).
 *
 * El hotel está en UTC−3 todo el año. Los instantes de abajo están en UTC y los
 * comentarios dicen qué hora es en El Calafate: la prueba que importa es que un
 * servidor en UTC no se equivoque de horario.
 */

// 2026-10-21 es miércoles.
const MIERCOLES_10_HS = new Date('2026-10-21T13:00:00Z') // 10:00 en el hotel
const MIERCOLES_22_HS = new Date('2026-10-22T01:00:00Z') // 22:00 en el hotel
const MIERCOLES_7_HS = new Date('2026-10-21T10:00:00Z') // 07:00 en el hotel
const SABADO_1_HS = new Date('2026-10-24T04:00:00Z') // sábado 01:00 en el hotel (UTC: sábado 04:00)

const TODOS = [1, 2, 3, 4, 5, 6, 7]

describe('enHorario', () => {
  const dia = { desde: '08:00', hasta: '21:00', dias: TODOS }

  it('usa la hora del HOTEL, no la del servidor (UTC)', () => {
    // 13:00 UTC son las 10:00 del hotel: dentro. Con la hora UTC también daría dentro,
    // así que el caso que lo distingue es el de las 22:00 del hotel (01:00 UTC).
    expect(enHorario(dia, MIERCOLES_10_HS)).toBe(true)
    expect(enHorario(dia, MIERCOLES_22_HS)).toBe(false)
    expect(enHorario(dia, MIERCOLES_7_HS)).toBe(false)
  })

  it('el límite de apertura entra y el de cierre no', () => {
    expect(enHorario(dia, new Date('2026-10-21T11:00:00Z'))).toBe(true) // 08:00 justo
    expect(enHorario(dia, new Date('2026-10-22T00:00:00Z'))).toBe(false) // 21:00 justo
  })

  it('un día que no atiende está fuera aunque la hora coincida', () => {
    expect(enHorario({ ...dia, dias: [1, 2, 3, 4, 5] }, new Date('2026-10-24T15:00:00Z'))).toBe(false) // sábado 12:00
  })

  it('el domingo cuenta como día 7', () => {
    expect(enHorario({ ...dia, dias: [7] }, new Date('2026-10-25T15:00:00Z'))).toBe(true)
  })

  it('un horario que cruza la medianoche cuenta el tramo de después de las 0 como del día anterior', () => {
    const noche = { desde: '20:00', hasta: '02:00', dias: [5] } // sólo viernes
    expect(enHorario(noche, new Date('2026-10-24T01:00:00Z'))).toBe(true) // viernes 22:00
    expect(enHorario(noche, SABADO_1_HS)).toBe(true) // sábado 01:00: sigue la guardia del viernes
    expect(enHorario(noche, new Date('2026-10-24T07:00:00Z'))).toBe(false) // sábado 04:00
    expect(enHorario(noche, new Date('2026-10-22T01:00:00Z'))).toBe(false) // miércoles
  })

  it('desde = hasta es 24 horas de ese día', () => {
    const miercoles = { desde: '00:00', hasta: '00:00', dias: [3] }
    expect(enHorario(miercoles, MIERCOLES_10_HS)).toBe(true)
    expect(enHorario(miercoles, MIERCOLES_22_HS)).toBe(true) // 01:00 UTC del jueves, pero miércoles 22:00 en el hotel
    expect(enHorario(miercoles, new Date('2026-10-22T13:00:00Z'))).toBe(false) // jueves 10:00 en el hotel
  })

  it('acepta HH:MM:SS (así devuelve Postgres una columna time)', () => {
    expect(enHorario({ desde: '08:00:00', hasta: '21:00:00', dias: TODOS }, MIERCOLES_10_HS)).toBe(true)
  })
})

describe('mensajeAutomatico', () => {
  const config: ConfigAutomatica = {
    saludoActivo: true,
    saludoMensaje: 'Hola {{nombre}}',
    fueraHorarioActivo: true,
    fueraHorarioMensaje: 'Fuera de horario',
    horario: { desde: '08:00', hasta: '21:00', dias: TODOS },
  }
  const base = { config, esConversacionNueva: true, esPrimeraVez: true, ahora: MIERCOLES_10_HS }

  it('en horario y primera vez: saludo', () => {
    expect(mensajeAutomatico(base)).toEqual({ tipo: 'saludo', texto: 'Hola {{nombre}}' })
  })

  it('fuera de horario gana sobre el saludo, y nunca salen los dos', () => {
    expect(mensajeAutomatico({ ...base, ahora: MIERCOLES_22_HS })).toEqual({ tipo: 'fuera_de_horario', texto: 'Fuera de horario' })
  })

  it('el saludo es una vez por contacto; el fuera de horario, una vez por conversación nueva', () => {
    expect(mensajeAutomatico({ ...base, esPrimeraVez: false })).toBeNull()
    expect(mensajeAutomatico({ ...base, esPrimeraVez: false, ahora: MIERCOLES_22_HS })?.tipo).toBe('fuera_de_horario')
  })

  it('con la conversación ya en curso no se manda nada', () => {
    expect(mensajeAutomatico({ ...base, esConversacionNueva: false, ahora: MIERCOLES_22_HS })).toBeNull()
  })

  it('con todo apagado no se manda nada', () => {
    expect(mensajeAutomatico({ ...base, config: { ...config, saludoActivo: false, fueraHorarioActivo: false } })).toBeNull()
  })

  it('no le contesta a una casilla de máquina (evita bucles de autorrespuesta)', () => {
    expect(mensajeAutomatico({ ...base, remitenteEmail: 'no-reply@banco.com' })).toBeNull()
    expect(mensajeAutomatico({ ...base, remitenteEmail: 'MAILER-DAEMON@x.com' })).toBeNull()
    expect(mensajeAutomatico({ ...base, remitenteEmail: 'ana@gmail.com' })?.tipo).toBe('saludo')
  })

  it('pareceRemitenteAutomatico no confunde nombres comunes', () => {
    expect(pareceRemitenteAutomatico('reply@hotel.com')).toBe(false)
    expect(pareceRemitenteAutomatico('noreply@hotel.com')).toBe(true)
    expect(pareceRemitenteAutomatico(null)).toBe(false)
  })
})

describe('variables', () => {
  it('primerNombre descarta teléfonos, usuarios y correos', () => {
    expect(primerNombre('Ana María López')).toBe('Ana')
    expect(primerNombre('+5492902123456')).toBe('')
    expect(primerNombre('@ana_viaja')).toBe('')
    expect(primerNombre('ana@mail.com')).toBe('')
    expect(primerNombre(null)).toBe('')
  })

  it('reemplaza las conocidas', () => {
    expect(aplicarVariables('Hola {{nombre}}, soy {{agente}}.', { nombre: 'Ana', agente: 'Laura' })).toBe('Hola Ana, soy Laura.')
    expect(aplicarVariables('{{ nombre_completo }}', { nombre_completo: 'Ana López' })).toBe('Ana López')
  })

  it('sin nombre conocido se quita con su espacio: «Hola, …» y no «Hola , …»', () => {
    expect(aplicarVariables('Hola {{nombre}}, ¿cómo estás?', { nombre: '' })).toBe('Hola, ¿cómo estás?')
    expect(aplicarVariables('{{nombre}}, gracias', { nombre: '' })).toBe(', gracias'.replace(/^, /, ', '))
  })

  it('una variable desconocida se deja tal cual, para que quien escribe la vea', () => {
    expect(aplicarVariables('Tu reserva {{codigo}}', { nombre: 'Ana' })).toBe('Tu reserva {{codigo}}')
  })
})

describe('separadores y agrupación', () => {
  it('rotuloDeDia', () => {
    expect(rotuloDeDia('2026-10-21', '2026-10-21', '2026-10-20')).toBe('Hoy')
    expect(rotuloDeDia('2026-10-20', '2026-10-21', '2026-10-20')).toBe('Ayer')
    expect(rotuloDeDia('2026-10-01', '2026-10-21', '2026-10-20')).toBe('01/10/2026')
  })

  it('seAgrupa: mismo autor y tipo, hasta 5 minutos', () => {
    const a = { tipo: 'saliente', autor_id: 'x', creado_en: '2026-10-21T10:00:00Z' }
    expect(seAgrupa({ ...a, creado_en: '2026-10-21T10:04:00Z' }, a)).toBe(true)
    expect(seAgrupa({ ...a, creado_en: '2026-10-21T10:06:00Z' }, a)).toBe(false)
    expect(seAgrupa({ ...a, autor_id: 'y' }, a)).toBe(false)
    expect(seAgrupa({ ...a, tipo: 'nota' }, a)).toBe(false)
    expect(seAgrupa(a, undefined)).toBe(false)
  })
})

describe('validarAjustes', () => {
  const ok = {
    activa: true,
    saludoActivo: true,
    saludoMensaje: ' Hola ',
    fueraHorarioActivo: true,
    fueraHorarioMensaje: 'Fuera',
    horarioDesde: '08:00',
    horarioHasta: '21:00',
    dias: [3, 1, 3, 9, 0],
    asignacionAutomatica: false,
  }

  it('limpia: recorta, ordena los días y descarta los inválidos y repetidos', () => {
    const r = validarAjustes(ok)
    expect('datos' in r && r.datos.dias).toEqual([1, 3])
    expect('datos' in r && r.datos.saludoMensaje).toBe('Hola')
  })

  it('un mensaje activado y vacío no se acepta', () => {
    expect(validarAjustes({ ...ok, saludoMensaje: '  ' })).toHaveProperty('error', expect.stringMatching(/saludo/))
    expect(validarAjustes({ ...ok, fueraHorarioMensaje: '' })).toHaveProperty('error', expect.stringMatching(/fuera de horario/))
  })

  it('apagado y vacío sí', () => {
    expect(validarAjustes({ ...ok, saludoActivo: false, saludoMensaje: '' })).toHaveProperty('datos')
  })

  it('fuera de horario sin ningún día sería estar fuera SIEMPRE', () => {
    expect(validarAjustes({ ...ok, dias: [] })).toHaveProperty('error', expect.stringMatching(/día/))
    expect(validarAjustes({ ...ok, fueraHorarioActivo: false, dias: [] })).toHaveProperty('datos')
  })

  it('horas inválidas y mensajes largos', () => {
    expect(validarAjustes({ ...ok, horarioDesde: '25:00' })).toHaveProperty('error')
    expect(validarAjustes({ ...ok, horarioHasta: '9' })).toHaveProperty('error')
    expect(validarAjustes({ ...ok, saludoMensaje: 'x'.repeat(1001) })).toHaveProperty('error')
  })

  it('resumenHorario', () => {
    expect(resumenHorario({ desde: '08:00:00', hasta: '21:00', dias: TODOS })).toBe('todos los días, de 08:00 a 21:00')
    expect(resumenHorario({ desde: '09:00', hasta: '18:00', dias: [1, 2, 3, 4, 5] })).toBe('Lun a Vie, de 09:00 a 18:00')
    expect(resumenHorario({ desde: '09:00', hasta: '18:00', dias: [1, 3] })).toBe('Lun, Mié, de 09:00 a 18:00')
  })
})
