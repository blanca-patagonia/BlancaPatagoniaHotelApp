// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { claveBorradorReserva } from '@/lib/domain/borrador-reserva'

/**
 * El alta de reserva del mostrador guarda un BORRADOR en `sessionStorage`
 * (auditoría QA/UX 2026-09-09): quien está cargando una reserva y navega afuera
 * no pierde lo que escribió. Hasta ahora sólo se había probado a mano —incluido
 * el bug de hidratación que tuvo la primera versión—.
 */

vi.mock('@/app/(front-gestion)/panel/reservas/actions', () => ({
  crearReservaAction: vi.fn(async () => ({})),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

const { FormularioReserva } = await import('@/app/(front-gestion)/panel/reservas/nueva/formulario')

const BUSQUEDA = { checkIn: '2026-11-10', checkOut: '2026-11-12', huespedes: 2 }
const CLAVE = claveBorradorReserva(BUSQUEDA.checkIn, BUSQUEDA.checkOut, BUSQUEDA.huespedes)

function formulario() {
  return render(
    <FormularioReserva
      opciones={[
        {
          tipoUnidadId: 't1',
          nombre: 'Superior',
          categoria: 'habitacion',
          capacidadMax: 3,
          disponibles: 4,
          total: 300,
          faltanTarifas: false,
        },
      ]}
      unidadesPorTipo={{ t1: [] }}
      agencias={[]}
      promociones={[]}
      noches={2}
      {...BUSQUEDA}
    />,
  )
}

const campoApellido = () => screen.getByRole('textbox', { name: /Apellido/ })

beforeEach(() => sessionStorage.clear())
afterEach(cleanup)

describe('FormularioReserva: borrador', () => {
  it('lo que se escribe queda guardado para ESTA búsqueda', async () => {
    formulario()
    await userEvent.type(campoApellido(), 'Almirón')
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE) ?? '{}')
    expect(guardado.apellido).toBe('Almirón')
  })

  it('al volver, se recupera y lo avisa; «Descartar» lo borra', async () => {
    sessionStorage.setItem(CLAVE, JSON.stringify({ apellido: 'Pérez', tipo_unidad_id: 't1' }))
    formulario()
    expect(await screen.findByText(/Recuperamos lo que tenías cargado/)).toBeTruthy()
    await waitFor(() => expect(campoApellido()).toHaveProperty('value', 'Pérez'))

    await userEvent.click(screen.getByRole('button', { name: 'Descartar y empezar de cero' }))
    expect(screen.queryByText(/Recuperamos lo que tenías cargado/)).toBeNull()
    expect(campoApellido()).toHaveProperty('value', '')
    expect(sessionStorage.getItem(CLAVE)).toBeNull()
  })

  it('el borrador de OTRAS fechas no se mezcla', async () => {
    sessionStorage.setItem(
      claveBorradorReserva('2026-12-01', '2026-12-03', 2),
      JSON.stringify({ apellido: 'De otra búsqueda' }),
    )
    formulario()
    expect(screen.queryByText(/Recuperamos lo que tenías cargado/)).toBeNull()
    expect(campoApellido()).toHaveProperty('value', '')
  })
})
