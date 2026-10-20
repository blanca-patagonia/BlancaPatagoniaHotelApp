import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `ejecutarPropuesta` (ADR 0041): lo que corre cuando alguien aprieta
 * «Confirmar» en una tarjeta del asistente. Tiene que delegar en la MISMA
 * Server Action del módulo y no hacer nada con una propuesta inválida o fuera
 * del rol.
 */

let rol = 'admin'
vi.mock('@/lib/auth/session', () => ({
  requerirAcceso: async () => ({ userId: 'u1', email: 'a@b.c', nombre: 'A', rol }),
}))
vi.mock('@/lib/registro', () => ({ registrarInfo: vi.fn(), registrarAviso: vi.fn() }))

const publicarAviso = vi.fn(async () => ({ ok: 'Aviso publicado.' }))
const crearOrden = vi.fn(async () => ({ ok: 'Orden creada.' }))
const crearObjeto = vi.fn(async () => ({ ok: 'Objeto registrado.' }))
const cargarConsumo = vi.fn(
  async (): Promise<{ ok: true } | { ok: false; clave: string; mensaje: string }> => ({ ok: true }),
)
vi.mock('@/app/(front-gestion)/panel/avisos/actions', () => ({ publicarAviso }))
const cambiarEstadoOrden = vi.fn(async (fd: FormData): Promise<void> => {
  throw redireccion(`/panel/mantenimiento/${fd.get('id')}`)
})
const marcarDevuelto = vi.fn(async (): Promise<void> => {
  throw redireccion('/panel/objetos-perdidos?error=devuelto')
})
vi.mock('@/app/(front-gestion)/panel/mantenimiento/actions', () => ({ crearOrden, cambiarEstadoOrden }))
vi.mock('@/app/(front-gestion)/panel/objetos-perdidos/actions', () => ({ crearObjeto, marcarDevuelto }))
vi.mock('@/lib/reservas/consumos', () => ({ cargarConsumo }))
vi.mock('@/lib/housekeeping/estado', () => ({ fijarEstadoUnidad: vi.fn(async () => ({ ok: true })) }))

/** Un redirect de Next, como lo lanza `redirect()`. */
function redireccion(url: string) {
  return Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` })
}
const cambiarEstadoReserva = vi.fn<(fd: FormData) => Promise<void>>(async () => {
  throw redireccion('/panel/reservas/r1')
})
const crearReservaAction = vi.fn<(p: unknown, fd: FormData) => Promise<{ error?: string }>>(async () => {
  throw redireccion('/panel/reservas/nueva-id')
})
const reservasVacias = async () => undefined
vi.mock('@/app/(front-gestion)/panel/reservas/actions', () => ({ cambiarEstadoReserva, crearReservaAction }))
vi.mock('@/app/(front-gestion)/panel/reservas/cambios.actions', () => ({
  cambiarUnidadReserva: reservasVacias,
  reprogramarReserva: reservasVacias,
}))
vi.mock('@/app/(front-gestion)/panel/reservas/factura.actions', () => ({
  emitirFactura: reservasVacias,
  emitirNotaCredito: reservasVacias,
}))
const actualizarHuesped = vi.fn<(p: unknown, fd: FormData) => Promise<{ ok: string }>>(
  async () => ({ ok: 'Datos actualizados.' }),
)
vi.mock('@/app/(front-gestion)/panel/huespedes/actions', () => ({
  crearHuesped: vi.fn(async () => ({ ok: 'Se registró.' })),
  actualizarHuesped,
}))
const fichaActual = {
  apellido: 'Pérez',
  nombre: 'Ana',
  doc_tipo: 'DNI',
  doc_numero: '30111222',
  email: 'vieja@mail.com',
  telefono: '111',
  nacionalidad: 'Argentina',
  condicion_iva: 'consumidor_final',
  residente_exterior: false,
  notas: 'Prefiere planta baja',
}
const reservaConHuesped = {
  id: '11111111-1111-4111-8111-111111111111',
  codigo: 'BP-1',
  huesped: { id: 'h1', nombre: 'Ana', apellido: 'Pérez', email: 'ana@mail.com', telefono: null },
}
vi.mock('@/lib/supabase/server', () => ({
  crearClienteServidor: async () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tabla === 'reservas' ? reservaConHuesped : fichaActual, error: null }),
        }),
      }),
    }),
  }),
}))
const encolar = vi.fn<(c: unknown, p: Record<string, unknown>) => Promise<{ ok: boolean; motivo?: string }>>(
  async () => ({ ok: true }),
)
vi.mock('@/lib/notificaciones', () => ({ encolar }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { ejecutarPropuesta } = await import('@/app/(front-gestion)/panel/ia/acciones')

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function campos(fd: FormData) {
  return Object.fromEntries(fd.entries())
}

beforeEach(() => {
  rol = 'admin'
  for (const f of [publicarAviso, crearOrden, crearObjeto, cargarConsumo]) f.mockClear()
})

describe('ejecutarPropuesta', () => {
  it('un aviso va por la acción de Avisos, con el texto de la tarjeta', async () => {
    const r = await ejecutarPropuesta({ tipo: 'aviso', mensaje: 'Corte de luz a las 10' })
    expect(r).toEqual({ ok: 'Aviso publicado.' })
    const [, fd] = publicarAviso.mock.calls[0] as unknown as [unknown, FormData]
    expect(campos(fd)).toEqual({ mensaje: 'Corte de luz a las 10' })
  })

  it('una orden va por la acción de Mantenimiento, con la unidad resuelta', async () => {
    await ejecutarPropuesta({
      tipo: 'orden_mantenimiento',
      titulo: 'Pierde la ducha',
      descripcion: '',
      prioridad: 'media',
      unidadId: UUID_A,
      unidadNombre: 'Hab 12',
    })
    const [, fd] = crearOrden.mock.calls[0] as unknown as [unknown, FormData]
    expect(campos(fd)).toMatchObject({ titulo: 'Pierde la ducha', prioridad: 'media', unidad_id: UUID_A })
  })

  it('un consumo va por la misma regla de la ficha (`cargarConsumo`) y NO redirige', async () => {
    const r = await ejecutarPropuesta({
      tipo: 'consumo',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      productoId: UUID_B,
      producto: 'Desayuno',
      cantidad: 2,
      precioUnitario: 12,
    })
    expect(cargarConsumo).toHaveBeenCalledWith(expect.anything(), UUID_A, UUID_B, 2)
    expect(r.ok).toContain('BP-1')
  })

  it('si la cuenta está cerrada, el chat recibe el motivo (no una navegación)', async () => {
    cargarConsumo.mockResolvedValueOnce({ ok: false, clave: 'cargo_ya_facturada', mensaje: 'La cuenta ya se facturó.' })
    const r = await ejecutarPropuesta({
      tipo: 'consumo',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      productoId: UUID_B,
      producto: 'Desayuno',
      cantidad: 1,
      precioUnitario: 12,
    })
    expect(r).toEqual({ error: 'La cuenta ya se facturó.' })
  })

  it('una propuesta adulterada en el navegador no ejecuta nada', async () => {
    const r = await ejecutarPropuesta({ tipo: 'cancelar_reserva', reservaId: UUID_A })
    expect(r.error).toBeDefined()
    const r2 = await ejecutarPropuesta({ tipo: 'aviso', mensaje: '' })
    expect(r2.error).toBeDefined()
    expect(publicarAviso).not.toHaveBeenCalled()
  })

  it('un rol sin acceso al área no la ejecuta', async () => {
    rol = 'housekeeping'
    const r = await ejecutarPropuesta({
      tipo: 'consumo',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      productoId: UUID_B,
      producto: 'Desayuno',
      cantidad: 1,
      precioUnitario: 12,
    })
    expect(r.error).toMatch(/rol/)
    expect(cargarConsumo).not.toHaveBeenCalled()
  })
})

describe('ejecutarPropuesta: acciones de reservas y huéspedes (reusando las de las pantallas)', () => {
  it('check-in: llama a cambiarEstadoReserva y el redirect a la ficha es éxito, con enlace', async () => {
    const r = await ejecutarPropuesta({
      tipo: 'estado_reserva',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      estado: 'in_house',
      cargo: '',
    })
    const [fd] = cambiarEstadoReserva.mock.calls.at(-1)!
    expect(campos(fd)).toEqual({ reserva_id: UUID_A, nuevo_estado: 'in_house' })
    expect(r).toEqual({ ok: 'Check-in hecho.', enlace: '/panel/reservas/r1' })
  })

  it('un ?error= de la ficha se muestra con el MISMO texto que la ficha', async () => {
    cambiarEstadoReserva.mockImplementationOnce(async () => {
      throw redireccion('/panel/reservas/r1?error=transicion')
    })
    const r = await ejecutarPropuesta({
      tipo: 'estado_reserva',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      estado: 'checkout',
      cargo: '',
    })
    expect(r.error).toBeTruthy()
    expect(r.error).not.toMatch(/Abrí la pantalla/)
    expect(r.enlace).toBe('/panel/reservas/r1')
  })

  it('nueva reserva: arma el formulario del alta y devuelve el enlace a la ficha creada', async () => {
    const r = await ejecutarPropuesta({
      tipo: 'nueva_reserva',
      tipoUnidadId: UUID_A,
      tipoNombre: 'Superior',
      checkIn: '2026-11-10',
      checkOut: '2026-11-12',
      adultos: 2,
      menores: 1,
      apellido: 'García',
      nombre: 'Ana',
      totalEstimado: 814.57,
      email: 'ana@mail.com',
      docNumero: '',
    })
    const [, fd] = crearReservaAction.mock.calls.at(-1)!
    expect(campos(fd)).toMatchObject({
      tipo_unidad_id: UUID_A,
      check_in: '2026-11-10',
      huespedes: '3',
      adultos: '2',
      menores: '1',
      apellido: 'García',
      email: 'ana@mail.com',
      canal: 'directo',
    })
    expect(r).toEqual({ ok: 'Reserva creada.', enlace: '/panel/reservas/nueva-id' })
  })

  it('un error devuelto por el alta (sin redirect) llega tal cual a la tarjeta', async () => {
    crearReservaAction.mockImplementationOnce(async () => ({ error: 'No hay tarifa cargada para esas fechas.' }))
    const r = await ejecutarPropuesta({
      tipo: 'nueva_reserva',
      tipoUnidadId: UUID_A,
      tipoNombre: 'Superior',
      checkIn: '2026-11-10',
      checkOut: '2026-11-12',
      adultos: 2,
      menores: 0,
      apellido: 'García',
      nombre: '',
      totalEstimado: null,
      email: '',
      docNumero: '',
    })
    expect(r).toEqual({ error: 'No hay tarifa cargada para esas fechas.' })
  })

  it('editar un huésped cambia SÓLO lo completado y conserva el resto de la ficha', async () => {
    const r = await ejecutarPropuesta({
      tipo: 'huesped_editar',
      huespedId: UUID_B,
      nombreVisible: 'perez',
      email: '',
      telefono: '2902 555',
      docNumero: '',
      nacionalidad: '',
    })
    const [, fd] = actualizarHuesped.mock.calls.at(-1)!
    expect(campos(fd)).toMatchObject({
      huesped_id: UUID_B,
      telefono: '2902 555',
      email: 'vieja@mail.com',
      doc_numero: '30111222',
      notas: 'Prefiere planta baja',
      condicion_iva: 'consumidor_final',
    })
    expect(r.ok).toBe('Datos actualizados.')
  })

  it('editar un huésped sin completar nada no llama a la acción', async () => {
    actualizarHuesped.mockClear()
    const r = await ejecutarPropuesta({
      tipo: 'huesped_editar',
      huespedId: UUID_B,
      nombreVisible: 'perez',
      email: '',
      telefono: '',
      docNumero: '',
      nacionalidad: '',
    })
    expect(r.error).toMatch(/al menos un dato/)
    expect(actualizarHuesped).not.toHaveBeenCalled()
  })
})

describe('ejecutarPropuesta: mensaje al huésped', () => {
  it('va a la bandeja con la plantilla del hotel, el email leído en el servidor y el texto CORREGIDO', async () => {
    const r = await ejecutarPropuesta({
      tipo: 'mensaje_huesped',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      mensaje: 'Te esperamos el viernes: el check-in es desde las 15.',
    })
    const [, pedido] = encolar.mock.calls.at(-1)!
    expect(pedido).toMatchObject({
      evento: 'mensaje_del_hotel',
      destinatario: 'ana@mail.com',
      huespedId: 'h1',
      variables: { nombre: 'Ana', codigo: 'BP-1', mensaje: 'Te esperamos el viernes: el check-in es desde las 15.' },
    })
    expect(pedido.discriminante).toBeTruthy()
    expect(r).toMatchObject({ ok: expect.stringMatching(/bandeja/), enlace: '/panel/notificaciones' })
  })

  it('si la bandeja lo rechaza (por ejemplo, sin consentimiento), lo dice', async () => {
    encolar.mockResolvedValueOnce({ ok: false, motivo: 'El huésped pidió no recibir avisos.' } as never)
    const r = await ejecutarPropuesta({
      tipo: 'mensaje_huesped',
      reservaId: UUID_A,
      codigoReserva: 'BP-1',
      mensaje: 'Te esperamos el viernes.',
    })
    expect(r).toEqual({ error: 'El huésped pidió no recibir avisos.' })
  })
})

describe('ejecutarPropuesta: cerrar lo abierto en mantenimiento y objetos perdidos', () => {
  it('una orden resuelta va por `cambiarEstadoOrden` y devuelve el enlace a la orden', async () => {
    const r = await ejecutarPropuesta({ tipo: 'estado_orden', ordenId: UUID_A, titulo: 'Pierde la ducha', estado: 'resuelta' })
    const [fd] = cambiarEstadoOrden.mock.calls.at(-1) as unknown as [FormData]
    expect(campos(fd)).toEqual({ id: UUID_A, estado: 'resuelta', origen: 'detalle' })
    expect(r).toEqual({ ok: 'La orden «Pierde la ducha» quedó resuelta.', enlace: `/panel/mantenimiento/${UUID_A}` })
  })

  it('housekeeping puede cerrar una orden pero no marcar un objeto devuelto (no tiene el área)', async () => {
    rol = 'housekeeping'
    const ok = await ejecutarPropuesta({ tipo: 'estado_orden', ordenId: UUID_A, titulo: 'Ducha', estado: 'en_proceso' })
    expect(ok.ok).toContain('en proceso')
    const no = await ejecutarPropuesta({ tipo: 'objeto_devuelto', objetoId: UUID_B, descripcion: 'Campera azul' })
    expect(no).toEqual({ error: 'Tu rol no puede hacer esta acción.' })
    expect(marcarDevuelto).not.toHaveBeenCalled()
  })

  it('Objetos perdidos está apagada por el hotel (AREAS_OCULTAS): ni admin lo confirma', async () => {
    const r = await ejecutarPropuesta({ tipo: 'objeto_devuelto', objetoId: UUID_B, descripcion: 'Campera azul' })
    expect(r).toEqual({ error: 'Tu rol no puede hacer esta acción.' })
    expect(marcarDevuelto).not.toHaveBeenCalled()
  })

  it('si `cambiarEstadoOrden` vuelve con ?error=, la tarjeta lo dice', async () => {
    cambiarEstadoOrden.mockImplementationOnce(async () => {
      throw redireccion(`/panel/mantenimiento/${UUID_A}?error=estado_orden`)
    })
    const r = await ejecutarPropuesta({ tipo: 'estado_orden', ordenId: UUID_A, titulo: 'Ducha', estado: 'resuelta' })
    expect(r.error).toBe('No se pudo cambiar el estado de la orden.')
  })
})
