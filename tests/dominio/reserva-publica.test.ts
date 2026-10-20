import { describe, it, expect } from 'vitest'
import {
  campoInvalido,
  esFechaReal,
  problemaDeFechas,
  mismoApellido,
  LARGO_MAXIMO,
  MAX_NOCHES_PUBLICO,
} from '@/lib/domain/reserva-publica'
import { diasEntre } from '@/lib/fechas'

const validos = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@x.com', telefono: '+54 9 (2902) 49-1234' }

describe('datos del checkout público', () => {
  it('acepta datos comunes, con tildes, apóstrofos y guiones', () => {
    expect(campoInvalido(validos)).toBeNull()
    expect(campoInvalido({ ...validos, nombre: "D'Angelo", apellido: 'García-Márquez' })).toBeNull()
    expect(campoInvalido({ ...validos, nombre: '', telefono: '' })).toBeNull()
  })

  it('rechaza un nombre con saltos de línea y un enlace (texto propio en el correo del hotel)', () => {
    const ataque = 'Juan\n\nTu reserva fue CANCELADA. Pagá acá: https://pagos-falsos.com/x'
    expect(campoInvalido({ ...validos, nombre: ataque })).toBe('nombre')
    expect(campoInvalido({ ...validos, nombre: 'Visitá www.falso.com' })).toBe('nombre')
    expect(campoInvalido({ ...validos, apellido: 'Pérez\tX' })).toBe('apellido')
  })

  it('rechaza los caracteres que abren markup', () => {
    expect(campoInvalido({ ...validos, nombre: '<b>Ana</b>' })).toBe('nombre')
    expect(campoInvalido({ ...validos, apellido: 'x" onmouseover="y' })).toBe('apellido')
  })

  it('pone tope de largo a cada campo', () => {
    expect(campoInvalido({ ...validos, apellido: 'a'.repeat(LARGO_MAXIMO.apellido + 1) })).toBe('apellido')
    expect(campoInvalido({ ...validos, nombre: 'a'.repeat(LARGO_MAXIMO.nombre + 1) })).toBe('nombre')
    expect(campoInvalido({ ...validos, email: `${'a'.repeat(250)}@x.com` })).toBe('email')
    expect(campoInvalido({ ...validos, telefono: '1'.repeat(LARGO_MAXIMO.telefono + 1) })).toBe('telefono')
  })

  it('exige apellido y un email con forma de email, y un teléfono sin letras', () => {
    expect(campoInvalido({ ...validos, apellido: '' })).toBe('apellido')
    expect(campoInvalido({ ...validos, email: 'ana' })).toBe('email')
    expect(campoInvalido({ ...validos, telefono: 'llamame' })).toBe('telefono')
  })
})

describe('fechas de una reserva pública', () => {
  const hoy = '2026-10-17'

  it('una fecha tiene que existir en el calendario, no sólo tener forma', () => {
    expect(esFechaReal('2026-02-28')).toBe(true)
    expect(esFechaReal('2028-02-29')).toBe(true)
    expect(esFechaReal('2026-02-29')).toBe(false)
    expect(esFechaReal('2026-13-45')).toBe(false)
    expect(esFechaReal('2026-1-5')).toBe(false)
    expect(esFechaReal(undefined)).toBe(false)
  })

  it('acepta una estadía futura normal y una que llega hoy', () => {
    expect(problemaDeFechas('2026-11-10', '2026-11-13', hoy, diasEntre)).toBeNull()
    expect(problemaDeFechas(hoy, '2026-10-18', hoy, diasEntre)).toBeNull()
  })

  it('rechaza llegadas en el pasado, rangos invertidos y estadías demasiado largas', () => {
    expect(problemaDeFechas('2026-01-10', '2026-01-12', hoy, diasEntre)).toBe('pasado')
    expect(problemaDeFechas('2026-11-13', '2026-11-10', hoy, diasEntre)).toBe('orden')
    expect(problemaDeFechas('2026-11-10', '2026-11-10', hoy, diasEntre)).toBe('orden')
    expect(problemaDeFechas('2026-11-01', '2026-12-15', hoy, diasEntre)).toBe('max_noches')
    expect(problemaDeFechas('2026-13-45', '2026-11-10', hoy, diasEntre)).toBe('formato')
  })

  it('el tope de noches es inclusivo', () => {
    const salida = '2026-12-01'
    expect(diasEntre('2026-11-01', salida)).toBe(MAX_NOCHES_PUBLICO)
    expect(problemaDeFechas('2026-11-01', salida, hoy, diasEntre)).toBeNull()
  })
})

describe('reutilizar la ficha de un huésped existente', () => {
  it('coincide el apellido sin importar mayúsculas, tildes ni espacios', () => {
    expect(mismoApellido('Pérez', 'perez')).toBe(true)
    expect(mismoApellido(' García  Márquez ', 'garcia marquez')).toBe(true)
  })

  it('un apellido distinto no reutiliza la ficha ajena', () => {
    expect(mismoApellido('Pérez', 'Gómez')).toBe(false)
  })
})

describe('identificador del alojamiento', () => {
  it('sólo pasa lo que tiene forma de uuid', async () => {
    const { esUuid } = await import('@/lib/domain/reserva-publica')
    expect(esUuid('00000000-0000-0000-0000-000000000001')).toBe(true)
    expect(esUuid('x')).toBe(false)
    expect(esUuid("1' or '1'='1")).toBe(false)
    expect(esUuid(undefined)).toBe(false)
  })
})
