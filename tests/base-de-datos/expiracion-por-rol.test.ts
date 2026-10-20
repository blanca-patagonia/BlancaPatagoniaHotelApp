import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { clienteDePrueba, sufijoUnico } from '../apoyo/db'
import { crearLosCuatroRoles, hayRoles, limpiarUsuarios, type UsuarioDePrueba } from '../apoyo/roles'
import type { Rol } from '@/lib/domain/roles'

/**
 * La expiración de reservas pendientes sólo la corre el cron (migración 0121).
 *
 * Con su token, una persona de recepción podía llamar por PostgREST
 * `rpc/expirar_reservas_pendientes` con `p_dias: 0` y cancelar en bloque toda
 * reserva pendiente sin pago, sin aviso ni rastro. Se prueba con usuarios
 * reales de cada rol, por PostgREST, que es el camino del ataque.
 */
describe.skipIf(!hayRoles)('expirar_reservas_pendientes por rol (0121)', () => {
  const db = clienteDePrueba()
  let roles: Record<Rol, UsuarioDePrueba>

  beforeAll(async () => {
    roles = await crearLosCuatroRoles(sufijoUnico())
  })
  afterAll(limpiarUsuarios)

  for (const rol of ['housekeeping', 'recepcion', 'gerencia', 'admin'] as const) {
    it(`${rol} NO puede ejecutarla`, async () => {
      const { error } = await roles[rol].cliente.rpc('expirar_reservas_pendientes', { p_dias: 0 })
      expect(error, `${rol} pudo expirar reservas`).not.toBeNull()
      expect(error?.code).toBe('42501')
    })
  }

  it('el cron (service_role) sí, con p_dias válido', async () => {
    const { error } = await db.rpc('expirar_reservas_pendientes', { p_dias: 5 })
    expect(error).toBeNull()
  })

  it('p_dias menor que 1 se rechaza aun para service_role', async () => {
    for (const p_dias of [0, -10]) {
      const { error } = await db.rpc('expirar_reservas_pendientes', { p_dias })
      expect(error?.code, `p_dias=${p_dias}`).toBe('22023')
    }
  })
})
