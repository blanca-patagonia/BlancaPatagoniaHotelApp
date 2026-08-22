import { describe, it, expect } from 'vitest'
import { CAPITULOS, GLOSARIO, guiaPara, tituloCapitulo } from '@/lib/domain/ayuda'
import { ROLES } from '@/lib/domain/roles'
import { puedeAcceder, estaOculta, ETIQUETAS_AREA } from '@/lib/domain/permisos'

describe('ayuda · la guía no promete lo que el rol no puede hacer', () => {
  it('a cada rol solo le muestra capítulos de áreas a las que accede', () => {
    // Es la regla que da sentido al módulo: explicarle a housekeeping cómo
    // facturar lo mandaría a buscar un botón que no existe.
    for (const rol of ROLES) {
      for (const capitulo of guiaPara(rol)) {
        expect(
          puedeAcceder(rol, capitulo.area),
          `${rol} no debería ver el capítulo de ${capitulo.area}`,
        ).toBe(true)
      }
    }
  })

  it('housekeeping no ve facturación, cobranzas ni contratos', () => {
    const areas = guiaPara('housekeeping').map((c) => c.area)
    expect(areas).not.toContain('reservas')
    expect(areas).not.toContain('agencias')
    expect(areas).not.toContain('contratos')
    expect(areas).not.toContain('usuarios')
  })

  it('housekeeping igual recibe la guía de su trabajo', () => {
    const areas = guiaPara('housekeeping').map((c) => c.area)
    expect(areas).toContain('housekeeping')
    expect(areas).toContain('mantenimiento')
  })

  it('el administrador ve todos los capítulos de las áreas encendidas', () => {
    // La guía se filtra con `puedeAcceder`, así que el capítulo de un módulo apagado
    // desaparece solo. Es lo que se quiere: la Ayuda no puede explicar una pantalla
    // que no está en el menú.
    const encendidos = CAPITULOS.filter((c) => !estaOculta(c.area))
    expect(guiaPara('admin')).toHaveLength(encendidos.length)
    expect(encendidos.length, 'se apagaron todos los capítulos').toBeGreaterThan(0)
  })

  it('recepción ve reservas pero no usuarios ni proveedores', () => {
    const areas = guiaPara('recepcion').map((c) => c.area)
    expect(areas).toContain('reservas')
    expect(areas).toContain('huespedes')
    expect(areas).not.toContain('usuarios')
    expect(areas).not.toContain('proveedores')
  })
})

describe('ayuda · consistencia del contenido', () => {
  it('ningún capítulo queda sin pasos', () => {
    for (const c of CAPITULOS) {
      expect(c.pasos.length, `el capítulo de ${c.area} está vacío`).toBeGreaterThan(0)
      expect(c.resumen.length).toBeGreaterThan(10)
    }
  })

  it('no hay dos capítulos para la misma área', () => {
    const areas = CAPITULOS.map((c) => c.area)
    expect(new Set(areas).size).toBe(areas.length)
  })

  it('el título del capítulo sale de la etiqueta del menú', () => {
    // Si la guía se titulara distinto que el menú, buscar la sección explicada
    // se volvería un acertijo.
    for (const c of CAPITULOS) {
      expect(tituloCapitulo(c)).toBe(ETIQUETAS_AREA[c.area])
    }
  })

  it('el glosario no repite términos', () => {
    const terminos = GLOSARIO.map((t) => t.termino.toLowerCase())
    expect(new Set(terminos).size).toBe(terminos.length)
  })
})
