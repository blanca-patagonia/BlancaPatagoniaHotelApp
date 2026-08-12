import { describe, it, expect } from 'vitest'
import { AMBITOS, ambitosPara, puedeBuscar, terminoBuscado } from '@/lib/domain/busqueda'
import { ROLES } from '@/lib/domain/roles'
import { puedeAcceder } from '@/lib/domain/permisos'

describe('búsqueda global · qué puede buscar cada rol', () => {
  it('nunca ofrece un ámbito que el rol no puede ver en el menú', () => {
    // Si el buscador consultara de más, alguien podría llegar por texto a datos
    // que su navegación no le ofrece.
    for (const rol of ROLES) {
      for (const ambito of ambitosPara(rol)) {
        expect(puedeAcceder(rol, ambito), `${rol} no debería buscar en ${ambito}`).toBe(true)
      }
    }
  })

  it('housekeeping no busca huéspedes ni cuentas', () => {
    expect(ambitosPara('housekeeping')).toEqual([])
    expect(puedeBuscar('housekeeping', 'huespedes')).toBe(false)
    expect(puedeBuscar('housekeeping', 'reservas')).toBe(false)
  })

  it('recepción busca huéspedes, reservas y agencias, pero no proveedores', () => {
    const a = ambitosPara('recepcion')
    expect(a).toContain('reservas')
    expect(a).toContain('huespedes')
    expect(a).toContain('agencias')
    expect(a).not.toContain('proveedores')
  })

  it('el administrador busca en todos los ámbitos', () => {
    expect(ambitosPara('admin')).toEqual([...AMBITOS])
  })
})

describe('búsqueda global · qué se considera una búsqueda', () => {
  it('ignora vacío y una sola letra', () => {
    // Con una letra la consulta traería medio sistema.
    expect(terminoBuscado(undefined)).toBeNull()
    expect(terminoBuscado('')).toBeNull()
    expect(terminoBuscado('   ')).toBeNull()
    expect(terminoBuscado('a')).toBeNull()
  })

  it('acepta desde dos caracteres', () => {
    expect(terminoBuscado('Ru')).toBe('Ru')
  })

  it('recorta los espacios de los costados', () => {
    expect(terminoBuscado('  Quiroga  ')).toBe('Quiroga')
  })

  it('escapa los comodines para que no listen todo', () => {
    // Sin escapar, `%` en un ilike devuelve el sistema entero.
    expect(terminoBuscado('%')).toBeNull() // un solo carácter, ni llega
    expect(terminoBuscado('%%')).toBe('\\%\\%')
    expect(terminoBuscado('a_b')).toBe('a\\_b')
  })
})
