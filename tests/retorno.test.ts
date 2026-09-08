import { describe, it, expect } from 'vitest'
import {
  origenDeMudanza,
  rutaDeRetorno,
  filtrosDeGrilla,
  FILTROS_GRILLA,
} from '@/lib/retorno'

const RESERVA = 'r-123'

/** Un lector de formulario armado con un objeto plano. */
const lector = (datos: Record<string, unknown>) => (clave: string) => datos[clave]

describe('retorno de la mudanza · la lista blanca', () => {
  it('reconoce los dos orígenes válidos', () => {
    expect(origenDeMudanza('ocupacion')).toBe('ocupacion')
    expect(origenDeMudanza('reserva')).toBe('reserva')
  })

  it('cualquier otra cosa cae en la ficha de la reserva', () => {
    // Incluye lo que un atacante mandaría para armar un redirect abierto. El
    // valor NUNCA se usa como ruta: sólo se compara contra la lista.
    const intentos = [
      null,
      undefined,
      '',
      'OCUPACION',
      '//evil.example',
      'https://evil.example',
      '/panel/../../etc',
      'javascript:alert(1)',
      123,
      { toString: () => 'ocupacion' },
    ]
    for (const intento of intentos) {
      expect(origenDeMudanza(intento), String(intento)).toBe('reserva')
    }
  })
})

describe('retorno de la mudanza · la ruta que se arma', () => {
  it('vuelve a la ficha cuando el origen es la reserva', () => {
    expect(rutaDeRetorno('reserva', RESERVA)).toBe('/panel/reservas/r-123')
  })

  it('lleva el aviso a la ficha', () => {
    expect(rutaDeRetorno('reserva', RESERVA, {}, { ok: 'mudanza' })).toBe(
      '/panel/reservas/r-123?ok=mudanza',
    )
  })

  it('vuelve a la grilla conservando sus filtros', () => {
    const ruta = rutaDeRetorno(
      'ocupacion',
      RESERVA,
      { desde: '2026-09-10', dias: '30', cat: 'cabana' },
      { error: 'ocupada' },
    )
    expect(ruta.startsWith('/panel/ocupacion?')).toBe(true)
    expect(ruta).toContain('desde=2026-09-10')
    expect(ruta).toContain('dias=30')
    expect(ruta).toContain('cat=cabana')
    expect(ruta).toContain('error=ocupada')
  })

  it('los filtros de la grilla NO pueden cambiar la ruta', () => {
    /*
      El caso que este test cuida: un filtro con barras o con `?` tiene que salir
      escapado en la query. Si se concatenara sin codificar, un `desde` con
      `../..` o con `//otro-sitio` sacaría al usuario del panel.
    */
    const ruta = rutaDeRetorno('ocupacion', RESERVA, {
      desde: '//evil.example/x?a=b',
      cat: '../../etc/passwd',
    })
    expect(ruta.startsWith('/panel/ocupacion?')).toBe(true)
    // Después del `?` no queda ninguna barra sin codificar.
    expect(ruta.slice('/panel/ocupacion?'.length)).not.toContain('/')
  })

  it('sin filtros ni avisos, la grilla queda en su vista por defecto', () => {
    expect(rutaDeRetorno('ocupacion', RESERVA)).toBe('/panel/ocupacion')
  })
})

describe('retorno de la mudanza · leer los filtros del formulario', () => {
  it('toma los campos con prefijo g_ y les saca el prefijo', () => {
    const filtros = filtrosDeGrilla(lector({ g_desde: '2026-09-10', g_hk: 'sucia' }))
    expect(filtros).toEqual({ desde: '2026-09-10', hk: 'sucia' })
  })

  it('ignora los vacíos y los que son sólo espacios', () => {
    // Sin esto, un filtro vacío viajaría como `?cat=` y la grilla mostraría un
    // «Limpiar filtros» para un filtro que no filtra nada.
    const filtros = filtrosDeGrilla(lector({ g_desde: '', g_cat: '   ', g_dias: '14' }))
    expect(filtros).toEqual({ dias: '14' })
  })

  it('no toma campos sin el prefijo', () => {
    // `motivo` y `politica_tarifa` son campos de la mudanza, no filtros. El
    // prefijo existe justamente para que no se mezclen.
    const filtros = filtrosDeGrilla(
      lector({ desde: '2026-09-10', motivo: 'calefactor', politica_tarifa: 'recotizar' }),
    )
    expect(filtros).toEqual({})
  })

  it('cubre exactamente los filtros que tiene la grilla', () => {
    // Si mañana la grilla suma un filtro y nadie lo agrega acá, se pierde al
    // volver de una mudanza. Esta lista es la que hay que tocar.
    expect([...FILTROS_GRILLA]).toEqual(['desde', 'dias', 'cat', 'bloque', 'piso', 'hk'])
  })
})
