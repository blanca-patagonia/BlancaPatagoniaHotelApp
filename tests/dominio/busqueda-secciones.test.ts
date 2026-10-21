import { describe, it, expect } from 'vitest'
import {
  normalizar,
  seccionesQueCoinciden,
  terminosQueCoinciden,
} from '@/lib/domain/busqueda'
import { RUTA_AREA } from '@/lib/domain/navegacion'
import { AREAS, puedeAcceder } from '@/lib/domain/permisos'
import { ROLES } from '@/lib/domain/roles'

/**
 * El buscador global encuentra SECCIONES del sistema, no solo datos.
 *
 * La idea que fijan estos tests: quien no encuentra algo casi nunca sabe cómo se
 * llama el módulo. Escribe lo que quiere hacer —«factura», «mucama»,
 * «overbooking»— y ninguna de esas palabras es el título de una sección. Por eso
 * la búsqueda mira adentro del contenido de la Ayuda, que ya explica cada módulo
 * en castellano llano.
 */

describe('normalizar', () => {
  it('saca acentos y mayúsculas, así «ocupacion» encuentra «Ocupación»', () => {
    expect(normalizar('Ocupación')).toBe('ocupacion')
    expect(normalizar('HUÉSPEDES')).toBe('huespedes')
    expect(normalizar('Configuración')).toBe('configuracion')
  })

  it('no rompe con texto que no tiene nada que normalizar', () => {
    expect(normalizar('reservas')).toBe('reservas')
    expect(normalizar('')).toBe('')
  })
})

describe('seccionesQueCoinciden', () => {
  it('encuentra un módulo por su nombre, escrito sin acento', () => {
    const r = seccionesQueCoinciden('admin', 'ocupacion')
    expect(r.map((s) => s.area)).toContain('ocupacion')
    expect(r.find((s) => s.area === 'ocupacion')?.porNombre).toBe(true)
  })

  it('encuentra un módulo por lo que se HACE ahí, aunque la palabra no esté en el nombre', () => {
    // Éste es el caso que justifica todo: «factura» no es el nombre de ninguna
    // sección, pero facturar se hace desde Reservas.
    const r = seccionesQueCoinciden('admin', 'factura')
    expect(r.map((s) => s.area)).toContain('reservas')
  })

  it('explica POR QUÉ apareció un resultado que no coincide por nombre', () => {
    const r = seccionesQueCoinciden('admin', 'factura')
    const reservas = r.find((s) => s.area === 'reservas')
    // Sin este texto, «Reservas» al buscar «factura» parece un error del sistema.
    expect(reservas?.motivo).toBeTruthy()
    expect(reservas?.porNombre).toBe(false)
  })

  it('pone primero las coincidencias por nombre', () => {
    const r = seccionesQueCoinciden('admin', 'reserva')
    const porNombre = r.findIndex((s) => s.porNombre)
    const porContenido = r.findIndex((s) => !s.porNombre)
    if (porNombre !== -1 && porContenido !== -1) {
      expect(porNombre).toBeLessThan(porContenido)
    }
  })

  it('NUNCA ofrece una sección a la que el rol no puede entrar', () => {
    // La garantía que no se puede romper: el buscador no es una puerta lateral
    // al menú. Se comprueba contra los cuatro roles y las 22 áreas.
    for (const rol of ROLES) {
      for (const q of ['a', 'e', 'o', 'reserva', 'usuario', 'auditoria', 'respaldo', 'pago']) {
        for (const s of seccionesQueCoinciden(rol, q)) {
          expect(puedeAcceder(rol, s.area)).toBe(true)
        }
      }
    }
  })

  it('housekeeping no llega a las secciones de plata', () => {
    const areas = seccionesQueCoinciden('housekeeping', 'pago').map((s) => s.area)
    expect(areas).not.toContain('reservas')
    expect(areas).not.toContain('agencias')
    expect(areas).not.toContain('proveedores')
  })

  it('no busca con menos de dos caracteres: traería medio sistema', () => {
    expect(seccionesQueCoinciden('admin', '')).toEqual([])
    expect(seccionesQueCoinciden('admin', 'a')).toEqual([])
  })

  it('devuelve vacío cuando de verdad no hay nada, en vez de inventar', () => {
    expect(seccionesQueCoinciden('admin', 'zxqwv')).toEqual([])
  })

  it('cada resultado trae una ruta real del panel', () => {
    for (const s of seccionesQueCoinciden('admin', 'reserva')) {
      expect(s.href).toBe(RUTA_AREA[s.area])
      expect(s.href.startsWith('/panel')).toBe(true)
    }
  })
})

describe('RUTA_AREA', () => {
  it('cubre las 22 áreas: si se agrega una, este test la reclama', () => {
    for (const area of AREAS) {
      expect(RUTA_AREA[area], `falta la ruta de «${area}»`).toBeTruthy()
    }
  })

  it('el tablero es /panel a secas, no /panel/dashboard', () => {
    // Es la única que no se deriva del nombre del área, y por eso la tabla es
    // explícita en vez de una función con una excepción escondida.
    expect(RUTA_AREA.dashboard).toBe('/panel')
  })
})

describe('terminosQueCoinciden', () => {
  it('explica una palabra del oficio y lleva al glosario', () => {
    const r = terminosQueCoinciden('rack')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].href).toBe('/panel/ayuda#glosario')
    expect(r[0].definicion).toBeTruthy()
  })

  it('también busca dentro de la definición, no solo en el término', () => {
    const r = terminosQueCoinciden('mostrador')
    expect(r.length).toBeGreaterThan(0)
  })

  it('no busca con menos de dos caracteres', () => {
    expect(terminosQueCoinciden('a')).toEqual([])
  })
})
