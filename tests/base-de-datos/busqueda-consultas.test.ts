import { describe, it, expect, vi } from 'vitest'
import { clienteDePrueba, hayDB } from '../apoyo/db'

/**
 * El buscador global contra la base: cada consulta de cada ámbito tiene que
 * ser aceptada por Postgres.
 *
 * Origen (2026-10-20): la búsqueda de usuarios pedía `perfiles.email` y
 * `perfiles.nombre_completo`, y la de promociones `promociones.activa`. Ninguna
 * existe. Como el servicio descartaba el `error`, las dos secciones salían
 * vacías siempre y se veían igual que «no hay coincidencias». Se descubrió al
 * empezar a registrar esos errores. Este test ejecuta todas las consultas y
 * falla si alguna vuelve con error.
 */
const fallas: { contexto: string; mensaje: string }[] = []
vi.mock('@/lib/acciones', () => ({
  registrarFalla: (error: { message: string } | null | undefined, contexto: string) => {
    if (error) fallas.push({ contexto, mensaje: error.message })
  },
}))

const { buscarGlobal } = await import('@/lib/busqueda/servicio')

describe.skipIf(!hayDB)('buscador global contra la base', () => {
  for (const termino of ['an', 'BP', 'zzz-sin-coincidencias']) {
    it(`admin busca «${termino}»: ninguna consulta vuelve con error`, async () => {
      fallas.length = 0
      await buscarGlobal(clienteDePrueba() as never, 'admin', termino)
      expect(fallas).toEqual([])
    })
  }
})
