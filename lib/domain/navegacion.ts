/**
 * Agrupación del menú lateral del panel.
 *
 * Por qué existe. El menú listaba las 18 áreas al mismo nivel visual, en una
 * columna plana. Para quien ya conoce el sistema da igual; para alguien que
 * entra a recepción por primera vez, encontrar «Objetos perdidos» entre
 * «Housekeeping» y «Avisos» obliga a leer la lista entera, y eso se paga todos
 * los días. Agrupar convierte una búsqueda lineal en dos saltos: primero el
 * grupo, después el ítem.
 *
 * El criterio de agrupación es **por momento de uso**, no por parecido temático:
 *
 *  · `Operación` — lo que se toca con un huésped enfrente o al teléfono.
 *  · `Unidades` — el estado físico de la casa, que mira otra gente y en otro
 *    momento del día (housekeeping y mantenimiento, más cocina).
 *  · `Comercial` — lo que se hace con terceros: agencias, proveedores, contratos.
 *  · `Equipo` — comunicación interna.
 *  · `Administración` — lo que mira gerencia y lo que se configura una vez.
 *
 * `Ayuda` queda fuera de todo grupo, al final: no compite con el trabajo y se
 * busca cuando algo no se entiende, así que conviene que esté siempre en el
 * mismo lugar.
 *
 * Este módulo es puro y **no decide permisos**: recibe las áreas que el rol ya
 * puede ver (`areasDe`) y solo las ordena. Un grupo sin áreas visibles no se
 * dibuja, así que housekeeping —que ve tres áreas— no termina con cuatro
 * encabezados vacíos.
 */

import { AREAS, type Area } from './permisos'

export interface GrupoNavegacion {
  /** `null` para el bloque final sin encabezado (Ayuda). */
  titulo: string | null
  areas: readonly Area[]
}

/**
 * Los grupos, en el orden en que se muestran.
 *
 * ⚠️ Toda área nueva tiene que entrar acá. `AREAS_AGRUPADAS` y el test que la
 * acompaña verifican que no falte ninguna: si se agrega un área a `permisos.ts`
 * y se olvida acá, el test falla nombrándola en vez de dejarla desaparecer en
 * silencio del menú.
 */
export const GRUPOS: readonly GrupoNavegacion[] = [
  { titulo: 'Operación', areas: ['dashboard', 'ocupacion', 'reservas', 'punto_venta', 'huespedes'] },
  { titulo: 'Unidades', areas: ['housekeeping', 'mantenimiento', 'servicio', 'objetos_perdidos'] },
  { titulo: 'Comercial', areas: ['agencias', 'proveedores', 'contratos', 'canales'] },
  { titulo: 'Equipo', areas: ['avisos', 'conversaciones'] },
  { titulo: 'Administración', areas: ['reportes', 'auditoria', 'config', 'usuarios', 'respaldos'] },
  { titulo: null, areas: ['ayuda'] },
]

/** Todas las áreas que aparecen en algún grupo, para verificar cobertura. */
export const AREAS_AGRUPADAS: readonly Area[] = GRUPOS.flatMap((g) => g.areas)

/** Áreas declaradas en `permisos.ts` que ningún grupo incluye. */
export function areasSinGrupo(): Area[] {
  return AREAS.filter((a) => !AREAS_AGRUPADAS.includes(a))
}

/**
 * Grupos con solo las áreas que el rol puede ver, sin los grupos que quedan
 * vacíos.
 *
 * Se conserva el orden de `GRUPOS` y, dentro de cada grupo, el orden declarado
 * —no el que traiga `visibles`—, para que el menú no cambie de forma según el
 * rol.
 */
export function agruparAreas(visibles: readonly Area[]): GrupoNavegacion[] {
  return GRUPOS.map((g) => ({
    titulo: g.titulo,
    areas: g.areas.filter((a) => visibles.includes(a)),
  })).filter((g) => g.areas.length > 0)
}
