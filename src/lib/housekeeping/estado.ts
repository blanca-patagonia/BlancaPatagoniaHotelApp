import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { avisarHabitacionLista } from '@/lib/notificaciones/eventos'
import { hoyISO } from '@/lib/fechas'
import type { EstadoHousekeeping } from '@/lib/domain/unidades'

/**
 * Cambia el estado de limpieza de una unidad y, si queda `inspeccionada`, le
 * avisa a recepción.
 *
 * Es la regla de la pantalla de housekeeping (`cambiarEstadoUnidad`) sacada a
 * una función que DEVUELVE el resultado, para que la use también el asistente
 * de IA (ADR 0041) sin el `redirect` que lo sacaba del chat.
 *
 * Inspeccionada = lista para entregar, y eso lo espera el mostrador. Se avisa en
 * `inspeccionada` y no en `limpia` porque son dos cosas distintas: `limpia` la
 * marca quien hizo el trabajo e `inspeccionada` la firma la gobernanta. Avisar
 * en la primera haría que recepción entregara habitaciones sin control de
 * calidad, que es justamente lo que separa a los dos estados.
 */
export async function fijarEstadoUnidad(
  supabase: SupabaseClient,
  unidadId: string,
  estado: EstadoHousekeeping,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const { error } = await supabase.from('unidades').update({ estado }).eq('id', unidadId)
  if (error) {
    registrarFalla(error, 'housekeeping:cambiar_estado')
    return { ok: false, mensaje: 'No se pudo cambiar el estado de la unidad.' }
  }
  if (estado === 'inspeccionada') await avisarUnidadLista(supabase, unidadId)
  return { ok: true }
}

/**
 * Le avisa al mostrador que una unidad quedó lista, y para quién.
 *
 * **Nunca corta.** La unidad ya está marcada; un aviso que no se pudo anotar no
 * puede volverse un error en la cara de la gobernanta.
 */
async function avisarUnidadLista(
  client: SupabaseClient,
  unidadId: string,
): Promise<void> {
  const { data: unidad, error: eUnidad } = await client
    .from('unidades')
    .select('nombre')
    .eq('id', unidadId)
    .maybeSingle<{ nombre: string }>()
  // Sigue sin cortar —la unidad ya quedó marcada, ver el comentario de la
  // función—, pero antes una lectura que fallaba se perdía sin dejar rastro.
  registrarFalla(eUnidad, 'housekeeping:unidad_para_avisar')
  if (!unidad) return

  /*
    A quién le toca esa habitación hoy.

    Es el dato que convierte «la 12 está lista» en algo accionable: recepción
    sabe si puede hacer entrar a alguien ya. Se busca la llegada de hoy en esa
    unidad; si no hay, el aviso sale igual sin nombre —el marcador es opcional—.

    Se filtra por `estadias.check_in`, que es una columna **generada** desde
    `periodo` (0037): existe justamente para no tener que escribir «las que
    llegan hoy» con operadores de rango negados, donde un signo cambiado da un
    resultado plausible y equivocado.

    `hoyISO()` y no `toISOString()`: el hotel está en UTC−3 y Vercel corre en UTC,
    así que después de las 21 el segundo devuelve mañana.
  */
  const hoy = hoyISO()
  const { data: llegada, error: eLlegada } = await client
    .from('estadias')
    .select('reserva:reservas!inner(huesped:huespedes!reservas_huesped_id_fkey(nombre, apellido))')
    .eq('unidad_id', unidadId)
    .eq('check_in', hoy)
    .limit(1)
    .maybeSingle()
  // Tampoco corta acá: el nombre es un marcador opcional (ver el comentario
  // de arriba). Solo se deja de perder en silencio si la lectura falla.
  registrarFalla(eLlegada, 'housekeeping:llegada_para_avisar')

  const h = (llegada as unknown as {
    reserva: { huesped: { nombre: string; apellido: string } | null } | null
  } | null)?.reserva?.huesped

  await avisarHabitacionLista(crearClienteAdmin(), {
    unidadId,
    unidad: unidad.nombre,
    dia: hoy,
    paraQuien: h ? `${h.nombre} ${h.apellido}`.trim() : undefined,
  })
}

