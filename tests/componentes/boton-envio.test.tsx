// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BotonEnvio } from '@/app/(front-gestion)/panel/_components/boton-envio'
import { ConfirmarProvider } from '@/app/(front-gestion)/panel/_components/confirmar'

/**
 * `BotonEnvio`: la red de seguridad de la interfaz contra el doble envío
 * («Registrar pago» dos veces son dos pagos) y la confirmación de lo que no
 * tiene vuelta atrás (emitir una factura, quitar un consumo).
 */

afterEach(cleanup)

function formulario(accion: (fd: FormData) => Promise<void>, props: Partial<Parameters<typeof BotonEnvio>[0]> = {}) {
  return render(
    <ConfirmarProvider>
      <form action={accion}>
        <input type="hidden" name="reserva_id" value="r1" />
        <BotonEnvio cargando="Registrando…" {...props}>
          Registrar pago
        </BotonEnvio>
      </form>
    </ConfirmarProvider>,
  )
}

describe('BotonEnvio', () => {
  it('envía el formulario con sus campos y con el par name/value del botón', async () => {
    const accion = vi.fn<(fd: FormData) => Promise<void>>(async () => {})
    formulario(accion, { name: 'decision', value: 'conciliar' })
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1))
    const fd = accion.mock.calls[0][0]
    expect(fd.get('reserva_id')).toBe('r1')
    expect(fd.get('decision')).toBe('conciliar')
  })

  it('mientras la acción está en curso se bloquea: un segundo clic no envía otra vez', async () => {
    let terminar: () => void = () => {}
    const accion = vi.fn(() => new Promise<void>((r) => (terminar = r)))
    formulario(accion)
    const usuario = userEvent.setup()
    await usuario.click(screen.getByRole('button', { name: 'Registrar pago' }))

    const boton = await screen.findByRole('button', { name: /Registrando…/ })
    expect(boton).toHaveProperty('disabled', true)
    await usuario.click(boton)
    expect(accion).toHaveBeenCalledTimes(1)

    terminar()
    expect(await screen.findByRole('button', { name: 'Registrar pago' })).toHaveProperty('disabled', false)
  })

  it('con `confirmar`, no envía hasta que la persona acepta; «Cancelar» no envía nada', async () => {
    const accion = vi.fn<(fd: FormData) => Promise<void>>(async () => {})
    formulario(accion, { confirmar: '¿Emitir la factura? No se puede anular.' })
    const usuario = userEvent.setup()

    await usuario.click(screen.getByRole('button', { name: 'Registrar pago' }))
    expect(await screen.findByText('¿Emitir la factura? No se puede anular.')).toBeTruthy()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(accion).not.toHaveBeenCalled()

    await usuario.click(screen.getByRole('button', { name: 'Registrar pago' }))
    await usuario.click(await screen.findByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1))
  })

  it('un botón de solo símbolo se anuncia con su nombre accesible', () => {
    render(
      <ConfirmarProvider>
        <form>
          <BotonEnvio aria-label="Quitar Desayuno de la cuenta">✕</BotonEnvio>
        </form>
      </ConfirmarProvider>,
    )
    expect(screen.getByRole('button', { name: 'Quitar Desayuno de la cuenta' })).toBeTruthy()
  })
})
