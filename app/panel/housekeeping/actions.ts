'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { requerirAcceso } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { cortarSiFalla } from '@/lib/acciones'
import { siguienteEstadoMucama } from '@/lib/domain/housekeeping'
import { avisarHabitacionLista } from '@/lib/notificaciones/eventos'
import { hoyISO } from '@/lib/fechas'

/** Vuelta de la vista movil: quien la usa esta en el pasillo con el telefono. */
const DESTINO_MOVIL = '/panel/housekeeping/mi-trabajo'

/**
 * Una Server Action es un endpoint HTTP público: se invoca con un POST sin pasar
 * por la pantalla. Que la página verifique el rol NO protege la acción, así que
 * cada una lo verifica por sí misma contra `lib/domain/permisos.ts`.
 *
 * Hasta la auditoría de la Fase 3, estas dos acciones no tenían ninguna
 * verificación: la única barrera eran las políticas RLS.
 */
export async function cambiarEstadoUnidad(formData: FormData): Promise<void> {
  await requerirAcceso('housekeeping')
  const id = String(formData.get('unidad_id') ?? '')
  const estado = String(formData.get('estado') ?? '') as EstadoHousekeeping
  if (!id || !ESTADOS_HK.includes(estado)) redirect('/panel/housekeeping')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('unidades').update({ estado }).eq('id', id)
  cortarSiFalla(error, '/panel/housekeeping', 'estado')

  /*
    Inspeccionada = lista para entregar, y eso lo espera el mostrador.

    Se avisa en `inspeccionada` y no en `limpia` porque son dos cosas distintas:
    `limpia` la marca quien hizo el trabajo y `inspeccionada` la firma la
    gobernanta. Avisar en la primera haría que recepción entregara habitaciones
    sin control de calidad, que es justamente lo que separa a los dos estados.
  */
  if (estado === 'inspeccionada') {
    await avisarUnidadLista(supabase, id)
  }

  redirect('/panel/housekeeping')
}

/**
 * Le avisa al mostrador que una unidad quedó lista, y para quién.
 *
 * **Nunca corta.** La unidad ya está marcada; un aviso que no se pudo anotar no
 * puede volverse un error en la cara de la gobernanta.
 */
async function avisarUnidadLista(
  client: Awaited<ReturnType<typeof crearClienteServidor>>,
  unidadId: string,
): Promise<void> {
  const { data: unidad } = await client
    .from('unidades')
    .select('nombre')
    .eq('id', unidadId)
    .maybeSingle<{ nombre: string }>()
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
  const { data: llegada } = await client
    .from('estadias')
    .select('reserva:reservas!inner(huesped:huespedes!reservas_huesped_id_fkey(nombre, apellido))')
    .eq('unidad_id', unidadId)
    .eq('check_in', hoy)
    .limit(1)
    .maybeSingle()

  const h = (llegada as unknown as {
    reserva: { huesped: { nombre: string; apellido: string } | null } | null
  } | null)?.reserva?.huesped

  await avisarHabitacionLista(client, {
    unidadId,
    unidad: unidad.nombre,
    dia: hoy,
    paraQuien: h ? `${h.nombre} ${h.apellido}`.trim() : undefined,
  })
}

/** Asigna (o desasigna) una mucama/o a una unidad. */
export async function asignarMucama(formData: FormData): Promise<void> {
  await requerirAcceso('housekeeping')
  const id = String(formData.get('unidad_id') ?? '')
  const mucamaId = String(formData.get('mucama_id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('unidades')
      .update({ asignada_a: mucamaId || null })
      .eq('id', id)
    cortarSiFalla(error, '/panel/housekeeping', 'asignar')
  }
  redirect('/panel/housekeeping')
}

/**
 * La mucama marca su habitación como limpia desde el celular.
 *
 * ── Por qué es una acción aparte de `cambiarEstadoUnidad` ───────────────────
 *
 * Aquélla acepta cualquier estado por parámetro, incluida `inspeccionada`. Esta
 * **sólo** hace sucia → limpia, y el destino lo decide el dominio
 * (`siguienteEstadoMucama`), no el formulario. La diferencia importa: si la mucama
 * pudiera mandar `inspeccionada`, el control de calidad lo firmaría quien hizo el
 * trabajo. La inspección la hace la gobernanta desde el tablero.
 *
 * Vuelve a `/panel/housekeeping/mi-trabajo` y no al tablero: quien la usa está en
 * el pasillo con el teléfono en una mano.
 */
export async function marcarLimpiaDesdeMovil(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('housekeeping')
  const id = String(formData.get('unidad_id') ?? '')
  if (!id) redirect(DESTINO_MOVIL)

  const supabase = await crearClienteServidor()

  // Se lee el estado actual para que el destino salga del dominio y no del cliente.
  const { data: unidad } = await supabase
    .from('unidades')
    .select('estado, asignada_a')
    .eq('id', id)
    .maybeSingle<{ estado: EstadoHousekeeping; asignada_a: string | null }>()

  if (!unidad) redirect(`${DESTINO_MOVIL}?error=no_existe`)

  // Una mucama sólo cierra lo suyo. Admin y gerencia pueden cerrar cualquiera —a
  // veces la gobernanta termina una habitación— pero una mucama no puede marcar
  // como hecha la habitación de otra.
  if (sesion.rol === 'housekeeping' && unidad.asignada_a !== sesion.userId) {
    redirect(`${DESTINO_MOVIL}?error=ajena`)
  }

  const siguiente = siguienteEstadoMucama(unidad.estado)
  if (!siguiente) redirect(`${DESTINO_MOVIL}?error=no_corresponde`)

  const { error } = await supabase.from('unidades').update({ estado: siguiente }).eq('id', id)
  cortarSiFalla(error, DESTINO_MOVIL, 'estado')

  revalidatePath(DESTINO_MOVIL)
  revalidatePath('/panel/housekeeping')
  redirect(`${DESTINO_MOVIL}?ok=limpia`)
}
