import { describe, it, expect } from 'vitest'
import { crearReservaPublica } from '@/app/(front-publico)/reservar/actions'

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
    expect(await crearReservaPublica({}, formulario({ ...BASE, idioma: 'es' }))).toMatchObject({
      error: 'Para reservar tenés que aceptar las condiciones.',
    })
    expect(await crearReservaPublica({}, formulario({ ...BASE, idioma: 'en' }))).toMatchObject({
      error: 'To book you need to accept the conditions.',
    })
  })

  it('un email inválido se rechaza antes que las condiciones', async () => {
    const r = await crearReservaPublica(
      {},
      formulario({ ...BASE, email: 'no-es-un-email', condiciones: 'on', idioma: 'fr' }),
    )
    expect(r).toMatchObject({ error: 'Indiquez un e-mail valide.' })
  })

  it('un idioma desconocido responde en español', async () => {
    const r = await crearReservaPublica({}, formulario({ ...BASE, idioma: 'xx' }))
    expect(r.error).toBe('Para reservar tenés que aceptar las condiciones.')
  })

  it('un error devuelve lo cargado, para que el formulario no se vacíe', async () => {
    const r = await crearReservaPublica(
      {},
      formulario({ ...BASE, nombre: 'Ana', telefono: '+54 2902', pedido: 'Cuna, por favor', idioma: 'es' }),
    )
    expect(r.valores).toMatchObject({
      nombre: 'Ana',
      apellido: 'Pérez',
      email: 'ana@example.com',
      telefono: '+54 2902',
      pedido: 'Cuna, por favor',
      condiciones: false,
    })
  })

  it('un nombre con saltos de línea y un enlace no llega al correo del hotel', async () => {
    const r = await crearReservaPublica(
      {},
      formulario({
        ...BASE,
        nombre: 'Juan\n\nTu reserva fue cancelada. Pagá en https://falso.com',
        condiciones: 'on',
        idioma: 'es',
      }),
    )
    expect(r.error).toMatch(/nombre/i)
  })

  it('una llegada en el pasado o una fecha imposible no reserva', async () => {
    const pasado = await crearReservaPublica(
      {},
      formulario({ ...BASE, check_in: '2020-01-10', check_out: '2020-01-12', condiciones: 'on' }),
    )
    expect(pasado.error).toMatch(/fechas no son válidas/)
    const imposible = await crearReservaPublica(
      {},
      formulario({ ...BASE, check_in: '2030-13-45', check_out: '2030-11-07', condiciones: 'on' }),
    )
    expect(imposible.error).toMatch(/fechas no son válidas/)
  })
})
