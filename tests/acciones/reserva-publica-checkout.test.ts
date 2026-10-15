import { describe, it, expect } from 'vitest'
import { crearReservaPublica } from '@/app/reservar/actions'

/*
  Validaciones del checkout público que se resuelven ANTES de tocar la base.

  Importan porque el formulario es un endpoint HTTP: el `required` del
  navegador se saltea con un envío directo. Las condiciones incluyen la
  política de cancelación —una promesa de plata— y sin aceptación expresa no
  puede nacer una reserva.
*/
function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

const BASE = {
  tipo: '00000000-0000-0000-0000-000000000001',
  check_in: '2030-11-04',
  check_out: '2030-11-07',
  huespedes: '2',
  apellido: 'Pérez',
  email: 'ana@example.com',
  medio: 'despues',
}

describe('crearReservaPublica · validaciones del checkout', () => {
  it('sin aceptar las condiciones no reserva, y lo dice en el idioma de la pantalla', async () => {
    expect(await crearReservaPublica({}, formulario({ ...BASE, idioma: 'es' }))).toEqual({
      error: 'Para reservar tenés que aceptar las condiciones.',
    })
    expect(await crearReservaPublica({}, formulario({ ...BASE, idioma: 'en' }))).toEqual({
      error: 'To book you need to accept the conditions.',
    })
  })

  it('un email inválido se rechaza antes que las condiciones', async () => {
    const r = await crearReservaPublica(
      {},
      formulario({ ...BASE, email: 'no-es-un-email', condiciones: 'on', idioma: 'fr' }),
    )
    expect(r).toEqual({ error: 'Indiquez un e-mail valide.' })
  })

  it('un idioma desconocido responde en español', async () => {
    const r = await crearReservaPublica({}, formulario({ ...BASE, idioma: 'xx' }))
    expect(r.error).toBe('Para reservar tenés que aceptar las condiciones.')
  })
})
