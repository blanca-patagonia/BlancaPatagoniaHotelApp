import 'server-only'
import type { crearClienteServidor } from '@/lib/supabase/server'
import { terminoBusqueda, patronOr } from '@/lib/listados'

/**
 * Consulta compartida del listado de reservas.
 *
 * La usan tanto la pantalla como la exportación a CSV: así el archivo que baja
 * el usuario contiene exactamente las filas que está viendo, con los mismos
 * filtros aplicados.
 *
 * ⚠️ El builder de PostgREST es *thenable*. Si una función `async` lo devolviera,
 * el `await` de quien la llama ejecutaría la consulta en lugar de entregar el
 * builder para seguir encadenando. Por eso la parte asíncrona (`filtroTermino`)
 * está separada y devuelve texto plano, y `consultaReservas` es **síncrona**.
 */

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>

export interface FiltrosReservas {
  q?: string
  estado?: string
  canal?: string
  desde?: string
  hasta?: string
  grupo?: string
}

export const SELECT_RESERVAS =
  'id, codigo, estado, total, canal, creada_en, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email), estadias!inner(periodo)'

/** Tope de ids de huésped que se inyectan en el filtro `in` de la búsqueda. */
const MAX_HUESPEDES_BUSQUEDA = 200

/**
 * Traduce el término libre a la expresión `or` de PostgREST.
 *
 * No se pueden combinar en un mismo `or` columnas de la tabla madre con las de
 * una tabla embebida, así que primero se resuelven los huéspedes que coinciden
 * y después se filtra por `codigo` **o** por esos ids.
 *
 * Devuelve `null` cuando no hay término que aplicar.
 */
export async function filtroTermino(supabase: Cliente, q: string | undefined): Promise<string | null> {
  const termino = terminoBusqueda(q)
  if (!termino) return null

  const { data } = await supabase
    .from('huespedes')
    .select('id')
    .or(
      `apellido.ilike.${patronOr(termino)},nombre.ilike.${patronOr(termino)},email.ilike.${patronOr(termino)}`,
    )
    .limit(MAX_HUESPEDES_BUSQUEDA)

  const ids = (data ?? []).map((h) => h.id as string)
  const porCodigo = `codigo.ilike.${patronOr(termino)}`
  return ids.length ? `${porCodigo},huesped_id.in.(${ids.join(',')})` : porCodigo
}

/**
 * Arma la consulta con los filtros aplicados. Quien la llama decide después el
 * `range()` (listado paginado) o el `limit()` (exportación).
 *
 * @param orTermino resultado de `filtroTermino`, ya resuelto por el llamador.
 */
export function consultaReservas(supabase: Cliente, f: FiltrosReservas, orTermino: string | null) {
  let q = supabase
    .from('reservas')
    .select(SELECT_RESERVAS, { count: 'exact' })
    .order('creada_en', { ascending: false })

  if (f.grupo) q = q.eq('grupo_id', f.grupo)
  if (f.estado) q = q.eq('estado', f.estado)
  if (f.canal) q = q.eq('canal', f.canal)

  // Reservas cuya estadía se superpone con la ventana pedida.
  if (f.desde && f.hasta) q = q.filter('estadias.periodo', 'ov', `[${f.desde},${f.hasta})`)

  if (orTermino) q = q.or(orTermino)

  return q
}
