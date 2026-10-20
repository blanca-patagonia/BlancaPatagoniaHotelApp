import { describe, it, expect } from 'vitest'
import { textoDeCancelacion, textoDeNoShow, type CargoDeCancelacion } from '@/lib/reservas/cancelacion'

/**
 * `textoDeCancelacion` — la frase que le llega al huésped por correo
 * (Fase 2.8 del pulido integral).
 *
 * El caso que importa es el de `cargo: null`: significa que no se pudo
 * calcular (falta la política, o `cotizarEstadia` falló), NO que el cargo
 * sea cero. El propio código lo marca con un ⚠️ porque confundir las dos
 * cosas es prometerle al huésped "no se te cobra nada" y después cobrarle.
 */
describe('textoDeCancelacion · nunca promete "no hay cargo" sin poder calcularlo', () => {
  it('con cargo null, remite al hotel — NO dice que no hay cargo', () => {
    const texto = textoDeCancelacion(null)
    expect(texto).not.toMatch(/no hay cargo/i)
    expect(texto).toBe('Si corresponde algún cargo por la cancelación, te lo confirmamos por este medio.')
  })

  it('con monto en cero, ahí sí dice que no hay cargo', () => {
    const cargo: CargoDeCancelacion = { dias: 20, cargo: 'ninguno', monto: 0 }
    expect(textoDeCancelacion(cargo)).toMatch(/no hay cargo/i)
  })

  it('primera_noche menciona el tramo y el monto', () => {
    const cargo: CargoDeCancelacion = { dias: 10, cargo: 'primera_noche', monto: 120 }
    const texto = textoDeCancelacion(cargo)
    expect(texto).toContain('primera noche')
    expect(texto).toContain('USD 120')
  })

  it('total menciona el total de la estadía y el monto', () => {
    const cargo: CargoDeCancelacion = { dias: 3, cargo: 'total', monto: 450 }
    const texto = textoDeCancelacion(cargo)
    expect(texto).toContain('total de la estadía')
    expect(texto).toContain('USD 450')
  })
})

describe('textoDeNoShow · siempre el 100%, no depende de los días', () => {
  it('menciona el 100% y el monto', () => {
    expect(textoDeNoShow(300)).toContain('100 %')
    expect(textoDeNoShow(300)).toContain('USD 300')
  })
})
