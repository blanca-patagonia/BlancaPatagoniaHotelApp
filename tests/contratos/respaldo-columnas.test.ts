import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLAS_RESPALDO } from '@/lib/domain/respaldos'

/**
 * Contrato: las columnas que exporta el respaldo para `agencias` y
 * `proveedores` son exactamente las que la migración 0060 le deja leer al
 * staff. Con `select *` la lectura fallaba por permiso y el respaldo salía sin
 * esas tablas; con una columna de más, fallaría igual; con el `token`, se
 * filtraría una credencial de socio.
 */
const M0060 = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0060_tokens_de_socio_fuera_del_alcance_del_staff.sql'),
  'utf8',
)

function concedidas(tabla: string): string[] {
  const m = new RegExp(`grant select \\(([^)]*)\\)\\s*on ${tabla} to authenticated`).exec(M0060)
  if (!m) throw new Error(`la 0060 no concede columnas de ${tabla}`)
  return m[1].split(',').map((c) => c.trim()).filter(Boolean).sort()
}

describe('contrato: el respaldo exporta sólo las columnas legibles de los socios', () => {
  for (const tabla of ['agencias', 'proveedores']) {
    it(`${tabla}: mismas columnas que la 0060, y nunca el token`, () => {
      const definicion = TABLAS_RESPALDO.find((t) => t.tabla === tabla)
      expect(definicion?.columnas, `${tabla} necesita lista de columnas`).toBeDefined()
      const exportadas = definicion!.columnas!.split(',').map((c) => c.trim()).sort()
      expect(exportadas).toEqual(concedidas(tabla))
      expect(exportadas).not.toContain('token')
    })
  }
})
