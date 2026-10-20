import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { HERRAMIENTAS_IA } from '@/lib/domain/ia-herramientas'
import { IMPLEMENTACIONES } from '@/app/(front-gestion)/panel/ia/herramientas'
import { AREA_DE_PROPUESTA } from '@/lib/domain/ia-acciones'

/**
 * Contrato: el catálogo del asistente (`lib/domain/ia-herramientas.ts`) y las
 * implementaciones (`panel/ia/herramientas/`) dicen lo mismo.
 *
 * Una herramienta declarada sin código se le ofrece al modelo, el modelo la
 * llama y recibe «Herramienta desconocida»: la persona ve un asistente que
 * dice que no puede, sin que nada haya fallado al compilar. Una implementada
 * sin declarar es código muerto que nadie puede invocar.
 */
describe('contrato: cada herramienta del catálogo tiene implementación', () => {
  const declaradas = HERRAMIENTAS_IA.map((h) => h.nombre)
  const implementadas = Object.keys(IMPLEMENTACIONES)

  it('ninguna declarada sin implementar', () => {
    expect(declaradas.filter((n) => !implementadas.includes(n))).toEqual([])
  })

  it('ninguna implementada sin declarar', () => {
    expect(implementadas.filter((n) => !declaradas.includes(n))).toEqual([])
  })

  it('no hay nombres repetidos en el catálogo', () => {
    expect(new Set(declaradas).size).toBe(declaradas.length)
  })

  it('cada propuesta del dominio tiene una herramienta proponer_* que la arma', () => {
    // El tipo de propuesta y el área de la herramienta que lo prepara coinciden:
    // si no, un rol vería la herramienta y no podría confirmar la tarjeta.
    const areasProponer = new Set(
      HERRAMIENTAS_IA.filter((h) => h.nombre.startsWith('proponer_')).map((h) => h.area),
    )
    for (const area of new Set(Object.values(AREA_DE_PROPUESTA))) {
      expect(areasProponer.has(area), `ninguna proponer_* del área ${area}`).toBe(true)
    }
  })
})
