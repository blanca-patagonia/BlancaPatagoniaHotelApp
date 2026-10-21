import 'server-only'
import type { crearClienteServidor } from '@/lib/supabase/server'
import type { EstadoReserva } from '@/lib/domain/reservas'
import {
  ambitosPara,
  seccionesQueCoinciden,
  terminoBuscado,
  terminosQueCoinciden,
  type Ambito,
  type SeccionEncontrada,
  type TerminoEncontrado,
} from '@/lib/domain/busqueda'
import { patronOr } from '@/lib/listados'
import { registrarFalla } from '@/lib/acciones'
import type { Rol } from '@/lib/domain/roles'

/**
 * Búsqueda global: la consulta, en un solo lugar.
 *
 * Antes vivía entera dentro de `/panel/buscar/page.tsx`. Se extrae acá para
 * que el buscador "en vivo" del encabezado (`GET /api/buscar`, que responde
 * JSON mientras se escribe) use EXACTAMENTE la misma consulta que la
 * pantalla de resultados completa — no una segunda versión que con el tiempo
 * diverja, la misma situación que ya pasó con `saldarSiCorresponde` y con
 * `MUESTRA_PLANTILLAS`.
 */

/** Tope por ámbito: la búsqueda es para encontrar algo puntual, no para listar. */
export const TOPE_BUSQUEDA = 8

export interface ReservaHit {
  id: string
  codigo: string
  estado: EstadoReserva
  huesped: { apellido: string; nombre: string } | null
  estadias: { periodo: string }[]
}

export interface HuespedHit {
  id: string
  apellido: string
  nombre: string
  email: string | null
  doc_numero: string | null
}

export interface AgenciaHit {
  id: string
  nombre: string
  tipo?: string
}

export interface ProveedorHit {
  id: string
  nombre: string
  rubro?: string
}

export interface UnidadHit {
  id: string
  nombre: string
  piso: number | null
  activo: boolean
  tipo: { nombre: string } | null
}

export interface TipoUnidadHit {
  id: string
  nombre: string
  capacidad_max: number
}

export interface ProductoHit {
  id: string
  nombre: string
  precio: number | string
  departamento: { nombre: string } | null
}

export interface PromocionHit {
  id: string
  nombre: string
  activa: boolean
}

/**
 * `perfiles` tiene `nombre` y `rol`; el email vive en `auth.users`, que el
 * cliente del usuario no lee. La versión anterior pedía `email` y
 * `nombre_completo`, que no existen: la búsqueda de usuarios nunca devolvió
 * nada y, como se descartaba el error, nadie lo notó (2026-10-20).
 */
export interface UsuarioHit {
  id: string
  nombre: string
  rol: string | null
}

export interface ResultadoBusqueda {
  termino: string | null
  ambitos: Ambito[]
  secciones: SeccionEncontrada[]
  glosario: TerminoEncontrado[]
  reservas: ReservaHit[]
  huespedes: HuespedHit[]
  agencias: AgenciaHit[]
  proveedores: ProveedorHit[]
  unidades: UnidadHit[]
  tipos_unidad: TipoUnidadHit[]
  productos: ProductoHit[]
  promociones: PromocionHit[]
  usuarios: UsuarioHit[]
  /** Los huéspedes salieron de la búsqueda aproximada (no hubo coincidencia exacta). */
  huespedesAproximados: boolean
  total: number
}

/** Parecido mínimo (0 a 1, pg_trgm) para ofrecer un huésped como «quizás quisiste decir». */
export const UMBRAL_PARECIDO = 0.35

/**
 * Las filas de una lectura, registrando el error si lo hubo.
 *
 * Un ámbito que falla se muestra vacío —el resto de la búsqueda sigue sirviendo—,
 * pero queda en `/panel/errores`: antes se descartaba el `error` y un buscador
 * roto se veía igual que uno que no encontró nada.
 */
function filas<T>(contexto: string) {
  return (r: { data: unknown; error: { message: string } | null }): T[] => {
    registrarFalla(r.error, `busqueda:${contexto}`)
    return (r.data ?? []) as T[]
  }
}

export interface OpcionesBusqueda {
  /**
   * No buscar personas (huéspedes ni usuarios) y no leer el nombre del huésped
   * de las reservas. Lo usa el asistente de IA: lo que encuentra viaja a un
   * tercero y los datos personales no salen del sistema (ADR 0039).
   */
  sinPersonas?: boolean
}

export async function buscarGlobal(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  rol: Rol,
  qCrudo: string | undefined,
  tope: number = TOPE_BUSQUEDA,
  opciones: OpcionesBusqueda = {},
): Promise<ResultadoBusqueda> {
  const termino = terminoBuscado(qCrudo)
  const ambitos = ambitosPara(rol)
  const personas = ['huespedes', 'usuarios']
  const puede = (a: string) =>
    ambitos.includes(a as never) && !(opciones.sinPersonas && personas.includes(a))

  const [huespedesExactos, agencias, proveedores, unidades, tipos_unidad, productos, promociones, usuarios] =
    termino
      ? await Promise.all([
          puede('huespedes')
            ? supabase
                .from('huespedes')
                .select('id, apellido, nombre, email, doc_numero')
                .or(
                  `apellido.ilike.${patronOr(termino)},nombre.ilike.${patronOr(termino)},email.ilike.${patronOr(termino)},doc_numero.ilike.${patronOr(termino)}`,
                )
                .limit(tope)
                .then(filas<HuespedHit>('huespedes'))
            : Promise.resolve([]),
          puede('agencias')
            ? supabase
                .from('agencias')
                .select('id, nombre, tipo')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<AgenciaHit>('agencias'))
            : Promise.resolve([]),
          puede('proveedores')
            ? supabase
                .from('proveedores')
                .select('id, nombre, rubro')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<ProveedorHit>('proveedores'))
            : Promise.resolve([]),
          puede('unidades')
            ? supabase
                .from('unidades')
                .select('id, nombre, piso, activo, tipo:tipos_unidad(nombre)')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<UnidadHit>('unidades'))
            : Promise.resolve([]),
          puede('tipos_unidad')
            ? supabase
                .from('tipos_unidad')
                .select('id, nombre, capacidad_max')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<TipoUnidadHit>('tipos_unidad'))
            : Promise.resolve([]),
          puede('productos')
            ? supabase
                .from('productos_servicios')
                .select('id, nombre, precio, departamento:departamentos(nombre)')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<ProductoHit>('productos'))
            : Promise.resolve([]),
          puede('promociones')
            ? supabase
                .from('promociones')
                // La columna es `activo`; se renombra para no tocar a quien lo usa.
                // Pedir `activa` fallaba y la búsqueda de promociones nunca anduvo.
                .select('id, nombre, activa:activo')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<PromocionHit>('promociones'))
            : Promise.resolve([]),
          puede('usuarios')
            ? supabase
                .from('perfiles')
                .select('id, nombre, rol')
                .ilike('nombre', `%${termino}%`)
                .limit(tope)
                .then(filas<UsuarioHit>('usuarios'))
            : Promise.resolve([]),
        ])
      : [[], [], [], [], [], [], [], []]

  /*
    Huéspedes con un error de tipeo («amiron» por «almiron»): si la búsqueda
    exacta no encontró a nadie, se prueba la aproximada de la base (0118,
    pg_trgm). Se marcan como aproximados para que la pantalla diga «quizás
    quisiste decir» y nadie los tome por una coincidencia segura.
  */
  let huespedes = huespedesExactos
  let huespedesAproximados = false
  if (termino && puede('huespedes') && huespedes.length === 0 && (qCrudo ?? '').trim().length >= 3) {
    const { data: parecidos, error: eParecidos } = await supabase.rpc('buscar_huespedes_parecidos', {
      p_termino: (qCrudo ?? '').trim(),
      p_limite: tope,
    })
    registrarFalla(eParecidos, 'busqueda:huespedes_parecidos')
    const ids = ((parecidos ?? []) as { id: string; parecido: number }[])
      .filter((p) => p.parecido >= UMBRAL_PARECIDO)
      .map((p) => p.id)
    if (ids.length > 0) {
      const { data, error: eAproximados } = await supabase
        .from('huespedes')
        .select('id, apellido, nombre, email, doc_numero')
        .in('id', ids)
      registrarFalla(eAproximados, 'busqueda:huespedes_aproximados')
      huespedes = ((data ?? []) as HuespedHit[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      huespedesAproximados = huespedes.length > 0
    }
  }

  /*
    Reservas: por código O por el huésped al que pertenecen.

    Se reusan los huéspedes que ya se encontraron arriba —misma consulta, sin
    pedirle a la base el mismo dato dos veces— y se buscan sus reservas por
    `huesped_id`, que es una columna propia de `reservas` y no necesita un
    filtro sobre la tabla embebida (la trampa de PostgREST documentada en
    AGENTS.md: un filtro sobre una tabla embebida sin `!inner` no filtra nada).
  */
  const idsHuespedes = huespedes.map((h) => h.id)
  const filtroReservas =
    idsHuespedes.length > 0
      ? `codigo.ilike.${patronOr(termino ?? '')},huesped_id.in.(${idsHuespedes.join(',')})`
      : `codigo.ilike.${patronOr(termino ?? '')}`

  const reservas =
    termino && puede('reservas')
      ? await supabase
          .from('reservas')
          .select(
            opciones.sinPersonas
              ? 'id, codigo, estado, estadias(periodo)'
              : 'id, codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), estadias(periodo)',
          )
          .or(filtroReservas)
          .limit(tope)
          .then(filas<ReservaHit>('reservas'))
      : []

  /*
    Secciones del sistema y palabras del glosario.

    Se calculan en memoria sobre las constantes del dominio: no hay consulta, así
    que no suman latencia ni pueden fallar. Y se usan el rol y el término CRUDO —no
    el que devuelve `terminoBuscado`—, porque ése viene con los comodines de
    PostgREST escapados y acá no hay ningún LIKE que interpretar.
  */
  const textoCrudo = (qCrudo ?? '').trim()
  const secciones = termino ? seccionesQueCoinciden(rol, textoCrudo) : []
  const glosario = termino ? terminosQueCoinciden(textoCrudo) : []

  const total =
    reservas.length +
    huespedes.length +
    agencias.length +
    proveedores.length +
    unidades.length +
    tipos_unidad.length +
    productos.length +
    promociones.length +
    usuarios.length +
    secciones.length +
    glosario.length

  return {
    termino,
    ambitos,
    secciones,
    glosario,
    reservas,
    huespedes,
    huespedesAproximados,
    agencias,
    proveedores,
    unidades,
    tipos_unidad,
    productos,
    promociones,
    usuarios,
    total,
  }
}
