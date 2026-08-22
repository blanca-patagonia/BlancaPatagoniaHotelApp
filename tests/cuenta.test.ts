import { describe, it, expect } from 'vitest'
import { validarCambioPassword, LARGO_MINIMO_PASSWORD } from '@/lib/domain/cuenta'

const base = { actual: 'vieja1234', nueva: 'nueva1234', repetida: 'nueva1234' }

describe('validarCambioPassword', () => {
  it('acepta un cambio correcto', () => {
    expect(validarCambioPassword(base)).toBeNull()
  })

  it('exige la contraseña actual', () => {
    expect(validarCambioPassword({ ...base, actual: '' })).toMatch(/actual/i)
  })

  it('exige la contraseña nueva', () => {
    expect(validarCambioPassword({ ...base, nueva: '', repetida: '' })).toMatch(/nueva/i)
  })

  it('rechaza una contraseña más corta que el mínimo', () => {
    const corta = 'a'.repeat(LARGO_MINIMO_PASSWORD - 1)
    expect(validarCambioPassword({ ...base, nueva: corta, repetida: corta })).toMatch(
      new RegExp(String(LARGO_MINIMO_PASSWORD)),
    )
  })

  it('acepta exactamente el mínimo', () => {
    const justa = 'a'.repeat(LARGO_MINIMO_PASSWORD)
    expect(validarCambioPassword({ ...base, nueva: justa, repetida: justa })).toBeNull()
  })

  it('rechaza si la repetición no coincide', () => {
    expect(validarCambioPassword({ ...base, repetida: 'otra12345' })).toMatch(/coinciden/i)
  })

  it('rechaza repetir la contraseña actual', () => {
    // Sin esto el cambio "funciona" y deja a quien lo hizo creyendo que rotó la
    // clave cuando no cambió nada.
    expect(validarCambioPassword({ actual: 'igual123', nueva: 'igual123', repetida: 'igual123' })).toMatch(
      /distinta/i,
    )
  })
})
