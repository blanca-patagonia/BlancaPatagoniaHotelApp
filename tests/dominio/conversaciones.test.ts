import { describe, it, expect } from 'vitest'
import {
  MAX_MENSAJE,
  puedeParticipar,
  canalesVisibles,
  normalizarMensaje,
  mensajeValido,
  agrupaConAnterior,
} from '@/lib/domain/conversaciones'
import type { Rol } from '@/lib/domain/roles'

const CANALES = [
  { clave: 'general', roles: ['admin', 'gerencia', 'recepcion', 'housekeeping'] as Rol[] },
  { clave: 'recepcion', roles: ['admin', 'gerencia', 'recepcion'] as Rol[] },
  { clave: 'housekeeping', roles: ['admin', 'gerencia', 'housekeeping'] as Rol[] },
]

describe('participación en canales', () => {
  it('el rol listado participa', () => {
    expect(puedeParticipar('recepcion', ['recepcion', 'gerencia'])).toBe(true)
  })

  it('el rol no listado queda afuera', () => {
    expect(puedeParticipar('housekeeping', ['recepcion', 'gerencia'])).toBe(false)
  })

  it('admin entra a todos los canales, incluso a los que no lo listan', () => {
    expect(puedeParticipar('admin', [])).toBe(true)
    expect(puedeParticipar('admin', ['recepcion'])).toBe(true)
  })

  it('filtra los canales según el rol', () => {
    expect(canalesVisibles('recepcion', CANALES).map((c) => c.clave)).toEqual([
      'general',
      'recepcion',
    ])
    expect(canalesVisibles('housekeeping', CANALES).map((c) => c.clave)).toEqual([
      'general',
      'housekeeping',
    ])
    expect(canalesVisibles('admin', CANALES)).toHaveLength(3)
  })
})

describe('validación de mensajes', () => {
  it('recorta espacios', () => {
    expect(normalizarMensaje('  hola  ')).toBe('hola')
  })

  it('rechaza mensajes vacíos o solo espacios', () => {
    expect(mensajeValido('')).toBe(false)
    expect(mensajeValido('    ')).toBe(false)
    expect(mensajeValido('\n\t')).toBe(false)
  })

  it('acepta un mensaje con contenido', () => {
    expect(mensajeValido('llegó el huésped de la 201')).toBe(true)
  })

  it('limita el largo máximo', () => {
    const largo = 'a'.repeat(MAX_MENSAJE + 500)
    expect(normalizarMensaje(largo)).toHaveLength(MAX_MENSAJE)
  })
})

describe('agrupación de mensajes consecutivos', () => {
  const base = { autor_id: 'u1', creado_en: '2026-08-02T10:00:00Z' }

  it('el primer mensaje nunca se agrupa', () => {
    expect(agrupaConAnterior(base, undefined)).toBe(false)
  })

  it('agrupa mensajes seguidos del mismo autor', () => {
    expect(
      agrupaConAnterior({ autor_id: 'u1', creado_en: '2026-08-02T10:02:00Z' }, base),
    ).toBe(true)
  })

  it('no agrupa autores distintos', () => {
    expect(
      agrupaConAnterior({ autor_id: 'u2', creado_en: '2026-08-02T10:01:00Z' }, base),
    ).toBe(false)
  })

  it('no agrupa si pasó demasiado tiempo', () => {
    expect(
      agrupaConAnterior({ autor_id: 'u1', creado_en: '2026-08-02T10:30:00Z' }, base),
    ).toBe(false)
  })
})
