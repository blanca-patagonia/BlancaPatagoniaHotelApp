// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * El chat del asistente, renderizado de verdad (ADR 0041).
 *
 * Lo que importa de esta pantalla no se ve en un test de servidor: que la
 * tarjeta de una propuesta mande lo que la PERSONA dejó escrito —no lo que
 * propuso la IA—, que avise cuando la acción no tiene vuelta atrás y que
 * «Descartar» no llame a nada.
 */

const ejecutarPropuesta = vi.fn<(p: Record<string, unknown>) => Promise<{ ok?: string; error?: string }>>(
  async () => ({ ok: 'Mensaje en la bandeja.' }),
)
vi.mock('@/app/(front-gestion)/panel/ia/acciones', () => ({ ejecutarPropuesta }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}))

const { ChatIA } = await import('@/app/(front-gestion)/panel/ia/chat')

const UUID = '11111111-1111-4111-8111-111111111111'

/** El servidor del chat, simulado: responde con texto y las propuestas dadas. */
function servidorResponde(propuestas: unknown[], respuesta = 'Te dejo la tarjeta para revisar.') {
  const fetchFalso = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify({ respuesta, propuestas }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchFalso)
  return fetchFalso
}

async function preguntar(texto: string) {
  const usuario = userEvent.setup()
  await usuario.type(screen.getByLabelText('Tu pregunta'), texto)
  await usuario.keyboard('{Enter}')
  return usuario
}

beforeEach(() => {
  ejecutarPropuesta.mockClear()
  // `scrollIntoView` no existe en jsdom; el chat lo usa para bajar al último mensaje.
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChatIA: tarjeta de propuesta', () => {
  it('manda el mensaje CORREGIDO por la persona, no el que redactó la IA', async () => {
    servidorResponde([
      { tipo: 'mensaje_huesped', reservaId: UUID, codigoReserva: 'BP-1', mensaje: 'Texto de la IA, con un error.' },
    ])
    render(<ChatIA />)
    const usuario = await preguntar('Escribile al huésped de BP-1')

    const campo = await screen.findByLabelText(/Mensaje \(podés corregirlo\)/)
    expect(campo).toHaveProperty('value', 'Texto de la IA, con un error.')
    await usuario.clear(campo)
    await usuario.type(campo, 'Te esperamos el viernes desde las 15.')
    await usuario.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(ejecutarPropuesta).toHaveBeenCalledTimes(1))
    expect(ejecutarPropuesta.mock.calls[0][0]).toMatchObject({
      tipo: 'mensaje_huesped',
      reservaId: UUID,
      mensaje: 'Te esperamos el viernes desde las 15.',
    })
    expect(await screen.findByText('Mensaje en la bandeja.')).toBeTruthy()
  })

  it('una cancelación avisa que no tiene vuelta atrás', async () => {
    servidorResponde([
      { tipo: 'estado_reserva', reservaId: UUID, codigoReserva: 'BP-2', estado: 'cancelada', cargo: 'Sin cargo.' },
    ])
    render(<ChatIA />)
    await preguntar('Cancelá la BP-2')
    expect(await screen.findByText(/No tiene vuelta atrás/)).toBeTruthy()
  })

  it('«Descartar» no ejecuta nada', async () => {
    servidorResponde([{ tipo: 'aviso', mensaje: 'Mañana se fumiga el comedor.' }])
    render(<ChatIA />)
    const usuario = await preguntar('Avisale al equipo de la fumigación')
    await usuario.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(screen.getByText(/Descartada: no se hizo nada/)).toBeTruthy()
    expect(ejecutarPropuesta).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza, el error queda en la tarjeta y se puede reintentar', async () => {
    ejecutarPropuesta.mockResolvedValueOnce({ error: 'Tu rol no puede hacer esta acción.' })
    servidorResponde([{ tipo: 'aviso', mensaje: 'Corte de luz a las 10.' }])
    render(<ChatIA />)
    const usuario = await preguntar('Avisá del corte de luz')
    await usuario.click(await screen.findByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Tu rol no puede hacer esta acción.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
  })
})

describe('ChatIA: la conversación', () => {
  it('manda la pantalla de origen y el historial al servidor', async () => {
    const fetchFalso = servidorResponde([], 'Hay 3 llegadas hoy.')
    render(<ChatIA pantalla="/panel/ocupacion" />)
    await preguntar('¿Quién llega hoy?')
    expect(await screen.findByText('Hay 3 llegadas hoy.')).toBeTruthy()
    const cuerpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body))
    expect(cuerpo).toEqual({
      mensajes: [{ rol: 'user', contenido: '¿Quién llega hoy?' }],
      pantalla: '/panel/ocupacion',
    })
  })

  it('un error del servidor se muestra y la pregunta no se pierde del historial', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'El asistente se quedó sin cupo.' }), { status: 503 })),
    )
    render(<ChatIA />)
    await preguntar('¿Cómo viene el mes?')
    expect(await screen.findByText('El asistente se quedó sin cupo.')).toBeTruthy()
    expect(screen.getByText('¿Cómo viene el mes?')).toBeTruthy()
  })
})
