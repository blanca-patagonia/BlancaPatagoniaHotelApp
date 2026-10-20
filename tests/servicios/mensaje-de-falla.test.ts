import { describe, it, expect, vi } from 'vitest'

const registrados: unknown[] = []
vi.mock('@/lib/registro', () => ({
  registrarErrorSync: (evento: string, datos: unknown) => registrados.push({ evento, datos }),
}))
vi.mock('next/navigation', () => ({ redirect: () => {} }))

import { mensajeDeFalla } from '@/lib/acciones'

describe('mensajeDeFalla · Postgres no llega en inglés a la pantalla', () => {
  it('un duplicado se explica en español, sin el texto de la base', () => {
    const m = mensajeDeFalla(
      { code: '23505', message: 'duplicate key value violates unique constraint "huespedes_email_key"' },
      'huespedes:crear',
      'No se pudo crear el huésped',
    )
    expect(m).toMatch(/^No se pudo crear el huésped: ya existe/)
    expect(m).not.toMatch(/duplicate|constraint/)
  })

  it('el detalle técnico va al registro', () => {
    registrados.length = 0
    mensajeDeFalla({ code: '23503', message: 'violates foreign key' }, 'agencias:crear', 'No se pudo crear la agencia')
    expect(registrados).toEqual([
      {
        evento: 'escritura_fallida',
        datos: { contexto: 'agencias:crear', codigo: '23503', detalle: 'violates foreign key' },
      },
    ])
  })

  it('un error sin código tiene un mensaje genérico útil', () => {
    expect(mensajeDeFalla({ message: 'fetch failed' }, 'x', 'No se pudo guardar')).toMatch(
      /^No se pudo guardar\. Probá de nuevo/,
    )
  })
})
