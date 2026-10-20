import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { clienteDePrueba, sufijoUnico } from '../apoyo/db'
import { crearLosCuatroRoles, hayRoles, limpiarUsuarios, type UsuarioDePrueba } from '../apoyo/roles'
import type { Rol } from '@/lib/domain/roles'

/**
 * La numeración fiscal no la mueve cualquiera (migración 0120).
 *
 * Las dos funciones que avanzan el correlativo son SECURITY DEFINER y no tenían
 * guarda: con su token, una mucama podía gastar números de factura llamando a
 * la base directo, y la próxima factura real salía con un salto que ARCA
 * rechaza. Se prueba con usuarios reales de cada rol, por PostgREST, que es el
 * camino del ataque.
 */
describe.skipIf(!hayRoles)('numeración fiscal por rol (0120)', () => {
  const db = clienteDePrueba()
  let roles: Record<Rol, UsuarioDePrueba>
  let puntoVenta: number

  const contador = async () => {
    const { data } = await db
      .from('puntos_venta')
      .select('ultimo_numero, ultimo_nc')
      .eq('numero', puntoVenta)
      .single()
    return data as { ultimo_numero: number; ultimo_nc: number }
  }

  beforeAll(async () => {
    roles = await crearLosCuatroRoles(sufijoUnico())
    const { data } = await db.from('puntos_venta').select('numero').limit(1).single()
    puntoVenta = (data as { numero: number }).numero
  })
  afterAll(limpiarUsuarios)

  for (const rol of ['housekeeping', 'recepcion', 'gerencia', 'admin'] as const) {
    it(`${rol} NO puede llamar directo a siguiente_numero_comprobante`, async () => {
      const antes = await contador()
      const { error } = await roles[rol].cliente.rpc('siguiente_numero_comprobante', { p_punto_venta: puntoVenta })
      expect(error, `${rol} movió el contador de facturas`).not.toBeNull()
      expect((await contador()).ultimo_numero).toBe(antes.ultimo_numero)
    })
  }

  for (const rol of ['housekeeping', 'recepcion'] as const) {
    it(`${rol} NO puede gastar números de nota de crédito`, async () => {
      const antes = await contador()
      const { error } = await roles[rol].cliente.rpc('siguiente_numero_nota_credito', { p_punto_venta: puntoVenta })
      expect(error?.code).toBe('42501')
      expect((await contador()).ultimo_nc).toBe(antes.ultimo_nc)
    })
  }

  it('gerencia sí (es quien emite las notas de crédito, igual que dice RLS)', async () => {
    const antes = await contador()
    const { data, error } = await roles.gerencia.cliente.rpc('siguiente_numero_nota_credito', {
      p_punto_venta: puntoVenta,
    })
    expect(error).toBeNull()
    expect(data).toBe(antes.ultimo_nc + 1)
  })
})
