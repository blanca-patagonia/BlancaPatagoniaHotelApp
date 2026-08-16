'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { requerirAcceso } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { cortarSiFalla } from '@/lib/acciones'
import { siguienteEstadoMucama } from '@/lib/domain/housekeeping'

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
  redirect('/panel/housekeeping')
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
