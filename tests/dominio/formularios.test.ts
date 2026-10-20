import { describe, it, expect } from 'vitest'
import { valoresDelFormulario, falloConValores, esCampoSensible } from '@/lib/domain/formularios'

function fd(pares: [string, string | Blob][]): FormData {
  const f = new FormData()
  for (const [k, v] of pares) f.append(k, v)
  return f
}

describe('valoresDelFormulario', () => {
  it('copia los campos de texto tal como se enviaron', () => {
    expect(valoresDelFormulario(fd([['nombre', 'Ana'], ['cuit', '30-1']]))).toEqual({ nombre: 'Ana', cuit: '30-1' })
  })

  it('nunca devuelve contraseñas, tokens ni claves, aunque la acción no lo pida', () => {
    const v = valoresDelFormulario(
      fd([
        ['email', 'a@b.c'],
        ['password', 'x'],
        ['password_confirmacion', 'x'],
        ['token_portal', 't'],
        ['nueva_contrasena', 'y'],
      ]),
    )
    expect(v).toEqual({ email: 'a@b.c' })
  })

  it('omite archivos y los campos internos de Next', () => {
    const v = valoresDelFormulario(fd([['foto', new Blob(['x'])], ['$ACTION_ID_abc', ''], ['titulo', 'Pérdida']]))
    expect(v).toEqual({ titulo: 'Pérdida' })
  })

  it('respeta la lista de exclusión de la acción', () => {
    expect(valoresDelFormulario(fd([['a', '1'], ['b', '2']]), ['b'])).toEqual({ a: '1' })
  })

  it('un nombre repetido junta sus valores', () => {
    expect(valoresDelFormulario(fd([['dias', 'lun'], ['dias', 'mar']]))).toEqual({ dias: 'lun,mar' })
  })
})

describe('falloConValores', () => {
  it('arma el estado de error con lo escrito', () => {
    expect(falloConValores('Ingresá el nombre.', fd([['cuit', '30']]))).toEqual({
      error: 'Ingresá el nombre.',
      valores: { cuit: '30' },
    })
  })
})

describe('esCampoSensible', () => {
  it('compara por inclusión y sin importar mayúsculas', () => {
    expect(esCampoSensible('Password')).toBe(true)
    expect(esCampoSensible('cvv')).toBe(true)
    expect(esCampoSensible('apellido')).toBe(false)
  })
})
