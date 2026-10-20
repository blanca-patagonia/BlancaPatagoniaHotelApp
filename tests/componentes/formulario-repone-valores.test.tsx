// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { falloConValores } from '@/lib/domain/formularios'

/**
 * React 19 resetea el `<form action={…}>` después de cada envío. Si la acción
 * falla, la persona veía el error arriba de un formulario VACÍO y tenía que
 * volver a escribir todo (pendiente de la auditoría, 00-pendientes.md:104).
 *
 * Estos tests simulan una acción que rechaza y verifican que lo escrito sigue
 * ahí —incluido un `<select>`, que sin el `key` vuelve a su opción de origen—
 * y que la contraseña NO se repone nunca.
 */

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/app/(front-gestion)/panel/agencias/actions', () => ({
  crearAgencia: vi.fn(async (_prev: unknown, fd: FormData) => falloConValores('El CUIT no es válido.', fd)),
}))
vi.mock('@/app/(front-gestion)/panel/usuarios/actions', () => ({
  crearUsuario: vi.fn(async (_prev: unknown, fd: FormData) => falloConValores('Ya hay un usuario con ese email.', fd)),
}))

const { FormularioAgencia } = await import('@/app/(front-gestion)/panel/agencias/formulario')
const { FormularioUsuario } = await import('@/app/(front-gestion)/panel/usuarios/formulario')

afterEach(cleanup)

function campo(nombre: string): HTMLInputElement | HTMLSelectElement {
  const el = document.querySelector(`[name="${nombre}"]`)
  if (!el) throw new Error(`No está el campo ${nombre}`)
  return el as HTMLInputElement | HTMLSelectElement
}

describe('Formularios: lo escrito sobrevive a un error de la acción', () => {
  it('alta de agencia: textos y el tipo elegido siguen después del rechazo', async () => {
    render(<FormularioAgencia />)
    await userEvent.type(campo('nombre') as HTMLInputElement, 'Patagonia Tours')
    await userEvent.type(campo('cuit') as HTMLInputElement, '30-1')
    await userEvent.selectOptions(campo('tipo') as HTMLSelectElement, 'empresa')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar cuenta' }))

    await waitFor(() => expect(screen.getByText('El CUIT no es válido.')).toBeTruthy())
    expect(campo('nombre').value).toBe('Patagonia Tours')
    expect(campo('cuit').value).toBe('30-1')
    // El caso caro: sin el `key`, el select volvía a «Agencia» y reenviar
    // guardaba la cuenta con el tipo equivocado.
    expect(campo('tipo').value).toBe('empresa')
  })

  it('alta de usuario: repone nombre, email y rol, pero NUNCA la contraseña', async () => {
    render(<FormularioUsuario />)
    await userEvent.type(campo('nombre') as HTMLInputElement, 'Lucía Paz')
    await userEvent.type(campo('email') as HTMLInputElement, 'lucia@hotel.test')
    await userEvent.type(campo('password') as HTMLInputElement, 'clave-secreta-123')
    await userEvent.selectOptions(campo('rol') as HTMLSelectElement, 'housekeeping')
    await userEvent.click(screen.getByRole('button', { name: /Crear/ }))

    await waitFor(() => expect(screen.getByText('Ya hay un usuario con ese email.')).toBeTruthy())
    expect(campo('nombre').value).toBe('Lucía Paz')
    expect(campo('email').value).toBe('lucia@hotel.test')
    expect(campo('rol').value).toBe('housekeeping')
    expect(campo('password').value).toBe('')
  })
})
