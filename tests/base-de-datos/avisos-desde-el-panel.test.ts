import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { clienteDePrueba, sufijoUnico } from '../apoyo/db'
import { crearUsuarioConRol, hayRoles, limpiarUsuarios, type UsuarioDePrueba } from '../apoyo/roles'
import { fijarEstadoUnidad } from '@/lib/housekeeping/estado'

/**
 * Un aviso pedido desde el panel, con la sesión de una persona, llega a la
 * bandeja.
 *
 * Origen (2026-10-20): `notificaciones` sólo acepta escrituras de
 * `service_role` (0075), y once acciones del panel encolaban con el cliente de
 * la sesión. Fallaba con «permission denied», `encolar` no corta, y el aviso
 * no existía: el «habitación lista» de housekeeping, el correo de cancelación
 * y de no-show, los avisos de cobro, el de reprogramación, el de un incidente
 * de mantenimiento y el mensaje al huésped del asistente. El registro de
 * errores tenía la evidencia desde septiembre. Ahora `encolar` exige el tipo
 * `ClienteServicio` y el error aparece al compilar; este test lo prueba de
 * punta a punta con una mucama de verdad.
 */
describe.skipIf(!hayRoles)('avisos pedidos desde el panel con la sesión de una persona', () => {
  const db = clienteDePrueba()
  const sufijo = sufijoUnico()
  let mucama: UsuarioDePrueba
  let unidad: { id: string; nombre: string }
  const desde = new Date().toISOString()

  beforeAll(async () => {
    mucama = await crearUsuarioConRol('housekeeping', sufijo)
    const { data: tipo } = await db.from('tipos_unidad').select('id').limit(1).single()
    const { data, error } = await db
      .from('unidades')
      .insert({ nombre: `Aviso ${sufijo}`, tipo_unidad_id: tipo!.id, estado: 'limpia', activo: true })
      .select('id, nombre')
      .single()
    if (error) throw error
    unidad = data
  })

  afterAll(async () => {
    await db.from('notificaciones').delete().eq('evento', 'interno_habitacion_lista').gte('creado_en', desde)
    await db.from('unidades').delete().eq('id', unidad.id)
    await limpiarUsuarios()
  })

  it('housekeeping marca la habitación inspeccionada → recepción recibe el aviso en la bandeja', async () => {
    const r = await fijarEstadoUnidad(mucama.cliente, unidad.id, 'inspeccionada')
    expect(r).toEqual({ ok: true })

    const { data, error } = await db
      .from('notificaciones')
      .select('evento, canal, variables')
      .eq('evento', 'interno_habitacion_lista')
      .gte('creado_en', desde)
    expect(error).toBeNull()
    const delTest = (data ?? []).filter(
      (n) => (n.variables as Record<string, unknown>)?.unidad === unidad.nombre,
    )
    expect(delTest, 'el aviso «habitación lista» no llegó a la bandeja').toHaveLength(1)
    expect(delTest[0].canal).toBe('interno')
  })
})
