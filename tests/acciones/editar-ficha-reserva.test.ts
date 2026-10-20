import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hayDB } from '../apoyo/db'
import { nuevoContexto, limpiar, destinoDe, formulario, type Contexto } from './entorno'

/**
 * Edición de ficha de reserva (auditoría QA/UX 2026-10): hasta ahora, una vez
 * creada, una reserva solo se podía reprogramar, mudar de unidad o cancelar y
 * volver a cargar. No había forma de corregir el plan, el segmento, el
 * voucher, las notas, las cunas, «no mover» ni la composición sin pasar por
 * uno de esos tres caminos, que tocan cosas que esta acción no toca (fechas,
 * unidad, estado, precio).
 *
 * Lo más importante que se prueba acá:
 * · `huespedes` se recalcula del desglose, igual que en `crear_reserva`.
 * · La capacidad de la unidad se respeta (los bebés no cuentan).
 * · `reservas.total` nunca se toca: ninguno de estos campos entra en el precio.
 * · Las dos escrituras quedan auditadas (migración 0110).
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/auth/session', async () => {
  const { sesionActual } = await import('./entorno')
  return { requerirAcceso: async () => sesionActual() }
})
vi.mock('@/lib/supabase/server', async () => {
  const { clienteDePrueba } = await import('../apoyo/db')
  return { crearClienteServidor: async () => clienteDePrueba() }
})

describe.skipIf(!hayDB)('Server Actions · editar ficha de reserva', () => {
  let ctx: Contexto
  let editarFichaReserva: typeof import('@/app/(front-gestion)/panel/reservas/actions')['editarFichaReserva']
  let tipoId: string
  let unidadId: string

  beforeAll(async () => {
    ctx = nuevoContexto()
    const acciones = await import('@/app/(front-gestion)/panel/reservas/actions')
    editarFichaReserva = acciones.editarFichaReserva

    const { data: tipo } = await ctx.db
      .from('tipos_unidad')
      .insert({ codigo: `TEST-FICHA-${ctx.sufijo}`.toUpperCase(), nombre: 'Test', categoria: 'hosteria', capacidad_max: 3 })
      .select('id')
      .single()
    tipoId = (tipo as { id: string }).id
    ctx.aBorrar.push({ tabla: 'tipos_unidad', id: tipoId })

    const { data: unidad } = await ctx.db
      .from('unidades')
      .insert({ tipo_unidad_id: tipoId, nombre: `Test ficha ${ctx.sufijo}` })
      .select('id')
      .single()
    unidadId = (unidad as { id: string }).id
    ctx.aBorrar.push({ tabla: 'unidades', id: unidadId })
  })

  afterAll(async () => {
    await limpiar(ctx)
  })

  /** Reserva + estadia mínimas, insertadas directo (sin pasar por `crear_reserva`). */
  async function reservaConEstadia(periodo: string) {
    const { data: huesped } = await ctx.db
      .from('huespedes')
      .insert({ nombre: 'Test', apellido: `Ficha ${ctx.sufijo}-${Math.random().toString(36).slice(2, 6)}` })
      .select('id')
      .single()
    const huespedId = (huesped as { id: string }).id
    ctx.aBorrar.push({ tabla: 'huespedes', id: huespedId })

    const { data: reserva } = await ctx.db
      .from('reservas')
      .insert({ huesped_id: huespedId, estado: 'confirmada', total: 100, plan: 'desayuno', segmento: 'particular' })
      .select('id')
      .single()
    const reservaId = (reserva as { id: string }).id
    ctx.aBorrar.push({ tabla: 'reservas', id: reservaId })

    const { data: estadia } = await ctx.db
      .from('estadias')
      .insert({
        reserva_id: reservaId,
        unidad_id: unidadId,
        tipo_unidad_id: tipoId,
        periodo,
        estado: 'confirmada',
        adultos: 2,
        menores: 0,
        bebes: 0,
        cunas: 0,
        huespedes: 2,
      })
      .select('id')
      .single()
    ctx.aBorrar.push({ tabla: 'estadias', id: (estadia as { id: string }).id })

    return reservaId
  }

  it('guarda plan, segmento, voucher, notas y recalcula huespedes del desglose', async () => {
    const reservaId = await reservaConEstadia('[2032-01-10,2032-01-15)')

    const destino = await destinoDe(() =>
      editarFichaReserva(
        formulario({
          reserva_id: reservaId,
          plan: 'media_pension',
          segmento: 'corporativo',
          voucher: 'VCH-123',
          notas: 'Pidió piso bajo',
          adultos: 2,
          menores: 1,
          bebes: 1,
          cunas: 1,
          no_mover: '1',
        }),
      ),
    )
    expect(destino).toBe(`/panel/reservas/${reservaId}?ok=ficha`)

    const { data: r } = await ctx.db
      .from('reservas')
      .select('plan, segmento, voucher, notas, total')
      .eq('id', reservaId)
      .single()
    const fila = r as { plan: string; segmento: string; voucher: string; notas: string; total: number | string }
    expect(fila.plan).toBe('media_pension')
    expect(fila.segmento).toBe('corporativo')
    expect(fila.voucher).toBe('VCH-123')
    expect(fila.notas).toBe('Pidió piso bajo')
    // Ninguno de estos campos entra en el precio: el total no se tocó.
    expect(Number(fila.total)).toBe(100)

    const { data: e } = await ctx.db
      .from('estadias')
      .select('adultos, menores, bebes, cunas, no_mover, huespedes')
      .eq('reserva_id', reservaId)
      .single()
    const estadia = e as {
      adultos: number
      menores: number
      bebes: number
      cunas: number
      no_mover: boolean
      huespedes: number
    }
    expect(estadia.adultos).toBe(2)
    expect(estadia.menores).toBe(1)
    expect(estadia.bebes).toBe(1)
    expect(estadia.cunas).toBe(1)
    expect(estadia.no_mover).toBe(true)
    // adultos + menores, SIN el bebé: no ocupa plaza (lib/domain/ocupantes.ts).
    expect(estadia.huespedes).toBe(3)
  })

  it('rechaza una composición que supera la capacidad de la unidad (capacidad 3)', async () => {
    const reservaId = await reservaConEstadia('[2032-02-10,2032-02-15)')

    const destino = await destinoDe(() =>
      editarFichaReserva(
        formulario({
          reserva_id: reservaId,
          plan: 'desayuno',
          segmento: 'particular',
          voucher: '',
          notas: '',
          adultos: 3,
          menores: 2,
          bebes: 0,
          cunas: 0,
          no_mover: '0',
        }),
      ),
    )
    // El motivo puntual viaja en `detalle` (auditoría QA/UX 2026-10-14): antes
    // se perdía detrás de un mensaje fijo que listaba las tres condiciones
    // posibles en vez de decir cuál falló. Lo tecleado (`v_*`) vuelve también,
    // para repoblar el formulario en vez de mostrarlo vacío.
    const [ruta, query] = destino.split('?')
    const sp = new URLSearchParams(query)
    expect(ruta).toBe(`/panel/reservas/${reservaId}`)
    expect(sp.get('error')).toBe('ficha_ocupantes')
    expect(sp.get('detalle')).toBe(
      'Entran 3 persona(s) (capacidad 3) y se cargaron 5. Los bebés en cuna no cuentan.',
    )
    expect(sp.get('v_adultos')).toBe('3')
    expect(sp.get('v_menores')).toBe('2')

    // No se guardó nada: ni el intento de plan ni la composición.
    const { data: e } = await ctx.db.from('estadias').select('adultos, menores').eq('reserva_id', reservaId).single()
    expect((e as { adultos: number; menores: number }).adultos).toBe(2)
  })

  it('si el update de estadias falla, revierte TAMBIÉN el de reservas ya escrito (migración 0113)', async () => {
    // El bug real que esto prueba: la primera versión de `editar_ficha_reserva`
    // (migración 0112) usaba un `return` en vez de un `raise exception` después
    // de escribir `reservas` — el `update reservas` quedaba confirmado igual,
    // aunque la función entera dijera `ok: false`. Se llama al RPC directo, sin
    // pasar por la Server Action, para poder mandarle un `p_estadia_id` que no
    // coincide con `p_reserva_id` y forzar el fallo DESPUÉS de la primera escritura.
    const reservaId = await reservaConEstadia('[2032-05-10,2032-05-15)')
    const { data: previo } = await ctx.db.from('reservas').select('plan').eq('id', reservaId).single()
    expect((previo as { plan: string }).plan).toBe('desayuno')

    const estadiaAjenaId = '00000000-0000-0000-0000-000000000000'
    const { error } = await ctx.db.rpc('editar_ficha_reserva', {
      p_reserva_id: reservaId,
      p_estadia_id: estadiaAjenaId,
      p_plan: 'pension_completa',
      p_segmento: 'grupo',
      p_voucher: 'NO-DEBERIA-QUEDAR',
      p_notas: 'no debería quedar',
      p_adultos: 2,
      p_menores: 0,
      p_bebes: 0,
      p_cunas: 0,
      p_no_mover: false,
    })
    expect(error, 'la función tiene que fallar, no devolver ok:false silencioso').not.toBeNull()

    const { data: despues } = await ctx.db.from('reservas').select('plan, voucher').eq('id', reservaId).single()
    const fila = despues as { plan: string; voucher: string }
    expect(fila.plan, 'el update de reservas tiene que haberse revertido entero').toBe('desayuno')
    expect(fila.voucher).toBe('')
  })

  it('rechaza un plan o segmento inválidos sin tocar la base', async () => {
    const reservaId = await reservaConEstadia('[2032-03-10,2032-03-15)')

    const destinoPlan = await destinoDe(() =>
      editarFichaReserva(
        formulario({ reserva_id: reservaId, plan: 'inventado', segmento: 'particular', adultos: 2, menores: 0, bebes: 0, cunas: 0 }),
      ),
    )
    // Acá también lo tecleado vuelve en `v_*` (auditoría QA/UX 2026-10-14).
    expect(destinoPlan.split('?')[0]).toBe(`/panel/reservas/${reservaId}`)
    expect(new URLSearchParams(destinoPlan.split('?')[1]).get('error')).toBe('ficha_plan')

    const destinoSegmento = await destinoDe(() =>
      editarFichaReserva(
        formulario({ reserva_id: reservaId, plan: 'desayuno', segmento: 'inventado', adultos: 2, menores: 0, bebes: 0, cunas: 0 }),
      ),
    )
    expect(destinoSegmento.split('?')[0]).toBe(`/panel/reservas/${reservaId}`)
    expect(new URLSearchParams(destinoSegmento.split('?')[1]).get('error')).toBe('ficha_segmento')
  })

  it('deja rastro en auditoria, tanto de reservas como de estadias', async () => {
    const reservaId = await reservaConEstadia('[2032-04-10,2032-04-15)')
    const { data: estadiaPrevia } = await ctx.db
      .from('estadias')
      .select('id')
      .eq('reserva_id', reservaId)
      .single()
    const estadiaId = (estadiaPrevia as { id: string }).id

    // `bebes` pasa de 0 a 1: hace falta un cambio real en la composición para
    // que dispare `estadias_ficha_auditoria` (su `when` exige una diferencia).
    await destinoDe(() =>
      editarFichaReserva(
        formulario({
          reserva_id: reservaId,
          plan: 'pension_completa',
          segmento: 'ota',
          voucher: '',
          notas: '',
          adultos: 2,
          menores: 0,
          bebes: 1,
          cunas: 0,
        }),
      ),
    )

    const { data: auditReserva } = await ctx.db
      .from('auditoria')
      .select('id')
      .eq('tabla', 'reservas')
      .eq('registro_id', reservaId)
      .eq('accion', 'UPDATE')
    expect((auditReserva ?? []).length, 'el cambio de plan/segmento tiene que auditarse').toBeGreaterThan(0)

    const { data: auditEstadia } = await ctx.db
      .from('auditoria')
      .select('id')
      .eq('tabla', 'estadias')
      .eq('registro_id', estadiaId)
      .eq('accion', 'UPDATE')
    expect((auditEstadia ?? []).length, 'el cambio de composición tiene que auditarse').toBeGreaterThan(0)
  })
})
