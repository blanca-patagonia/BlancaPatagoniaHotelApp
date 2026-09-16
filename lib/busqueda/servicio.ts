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

export interface ResultadoBusqueda {
  termino: string | null
  ambitos: Ambito[]
  secciones: SeccionEncontrada[]
  glosario: TerminoEncontrado[]
  reservas: ReservaHit[]
  huespedes: HuespedHit[]
  agencias: AgenciaHit[]
  proveedores: ProveedorHit[]
  total: number
}

export async function buscarGlobal(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  rol: Rol,
  qCrudo: string | undefined,
  tope: number = TOPE_BUSQUEDA,
): Promise<ResultadoBusqueda> {
  const termino = terminoBuscado(qCrudo)
  const ambitos = ambitosPara(rol)
  const puede = (a: string) => ambitos.includes(a as never)

  const [huespedes, agencias, proveedores] = termino
    ? await Promise.all([
        puede('huespedes')
          ? supabase
              .from('huespedes')
              .select('id, apellido, nombre, email, doc_numero')
              .or(
                `apellido.ilike.${patronOr(termino)},nombre.ilike.${patronOr(termino)},email.ilike.${patronOr(termino)},doc_numero.ilike.${patronOr(termino)}`,
              )
              .limit(tope)
              .then((r) => (r.data ?? []) as HuespedHit[])
          : Promise.resolve([]),
        puede('agencias')
          ? supabase
              .from('agencias')
              .select('id, nombre, tipo')
              .ilike('nombre', `%${termino}%`)
              .limit(tope)
              .then((r) => (r.data ?? []) as AgenciaHit[])
          : Promise.resolve([]),
        puede('proveedores')
          ? supabase
              .from('proveedores')
              .select('id, nombre, rubro')
              .ilike('nombre', `%${termino}%`)
              .limit(tope)
              .then((r) => (r.data ?? []) as ProveedorHit[])
          : Promise.resolve([]),
      ])
    : [[], [], []]

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
            'id, codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), estadias(periodo)',
          )
          .or(filtroReservas)
          .limit(tope)
          .then((r) => (r.data ?? []) as unknown as ReservaHit[])
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
    secciones.length +
    glosario.length

  return { termino, ambitos, secciones, glosario, reservas, huespedes, agencias, proveedores, total }
}
