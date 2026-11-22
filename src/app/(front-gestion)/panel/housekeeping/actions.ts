'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { requerirAcceso } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { cortarSiFalla } from '@/lib/acciones'
import { siguienteEstadoMucama, retornoHousekeeping, unidadesParaAsignar } from '@/lib/domain/housekeeping'
import { subirAdjunto } from '@/lib/storage'
import { esUuid } from '@/lib/domain/reserva-publica'
import { fijarEstadoUnidad } from '@/lib/housekeeping/estado'

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

  // La regla vive en `lib/housekeeping/estado.ts`.
  const resultado = await fijarEstadoUnidad(await crearClienteServidor(), id, estado)
  if (!resultado.ok) redirect('/panel/housekeeping?error=estado')
  redirect('/panel/housekeeping')
}

/**
 * Asigna (o desasigna) una mucama/o a una unidad.
 *
 * Vuelve a la vista desde la que se asignó (`retornoHousekeeping`): antes
 * devolvía siempre a «Por unidad», y quien estaba repartiendo el trabajo en
 * «Por responsable» perdía la pantalla.
 */
export async function asignarMucama(formData: FormData): Promise<void> {
  await requerirAcceso('housekeeping')
  const destino = retornoHousekeeping(String(formData.get('vista') ?? ''))
  const id = String(formData.get('unidad_id') ?? '')
  const mucamaId = String(formData.get('mucama_id') ?? '')
  if (!esUuid(id) || (mucamaId && !esUuid(mucamaId))) redirect(destino)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('unidades')
    .update({ asignada_a: mucamaId || null })
    .eq('id', id)
  cortarSiFalla(error, destino, 'asignar')
  revalidatePath('/panel/housekeeping')
  redirect(destino)
}

/**
 * Reparte varias unidades a una misma responsable de una vez.
 *
 * Con una sola asignación por fila, repartir las 37 unidades del hotel eran 37
 * elecciones y 37 clics en «Asignar». Esta acción toma las marcadas en
 * «Repartir habitaciones» y las asigna (o las deja sin asignar) en una sola
 * escritura.
 *
 * Se pide de vuelta lo que se actualizó (`select`) y se compara con lo marcado:
 * si RLS bloquea la escritura, el `update` afecta cero filas SIN dar error, y la
 * pantalla diría «listo» sin haber hecho nada.
 */
export async function asignarVarias(formData: FormData): Promise<void> {
  await requerirAcceso('housekeeping')
  const destino = retornoHousekeeping('mucama')
  const separador = destino.includes('?') ? '&' : '?'

  const ids = unidadesParaAsignar(formData.getAll('unidad_id'))
  if (!ids) redirect(`${destino}${separador}error=sin_marcar`)

  const mucamaId = String(formData.get('mucama_id') ?? '')
  if (mucamaId && !esUuid(mucamaId)) redirect(`${destino}${separador}error=asignar`)

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('unidades')
    .update({ asignada_a: mucamaId || null })
    .in('id', ids)
    .select('id')
  cortarSiFalla(error, destino, 'asignar')
  if ((data ?? []).length !== ids.length) redirect(`${destino}${separador}error=asignar_parcial`)

  revalidatePath('/panel/housekeeping')
  redirect(`${destino}${separador}ok=asignadas&n=${ids.length}`)
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
  const { data: unidad, error: eUnidad } = await supabase
    .from('unidades')
    .select('estado, asignada_a')
    .eq('id', id)
    .maybeSingle<{ estado: EstadoHousekeeping; asignada_a: string | null }>()

  // Antes una lectura que fallaba se confundía con "esta unidad no existe" —
  // para quien está en el pasillo con el teléfono, son dos mensajes muy
  // distintos: uno dice "revisá el enlace", el otro "probá de nuevo".
  if (eUnidad) redirect(`${DESTINO_MOVIL}?error=lectura`)
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

/**
 * Agrega un registro al historial de limpieza de una unidad: comentario y/o
 * foto de un pase puntual (`housekeeping_registros`, migración 0101).
 *
 * ── Por qué es una pantalla aparte, y no un campo más en la tarjeta ─────────
 *
 * La tarjeta de «Mi trabajo» tiene un solo botón a propósito (ver el
 * encabezado de `mi-trabajo/page.tsx`): la mucama no elige entre estados,
 * marca hecho. Esta acción NO toca `unidades.estado` — es un log aparte,
 * opcional, para dejar un detalle puntual («falta un toallón», «se rompió la
 * persiana») que el botón único no puede expresar. Vive en
 * `/panel/housekeeping/mi-trabajo/[unidadId]`, una pantalla de detalle que se
 * visita por elección, no un paso obligatorio del flujo de limpieza.
 *
 * El comentario y la foto son los dos opcionales: un registro vacío no tiene
 * sentido, pero cuál de los dos falta no importa — a veces alcanza con la
 * foto, a veces alcanza con la palabra.
 */
export async function agregarRegistroLimpieza(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('housekeeping')

  const unidadId = String(formData.get('unidad_id') ?? '')
  const destino = `/panel/housekeeping/mi-trabajo/${unidadId}`
  // Va armando la ruta del archivo y la URL: tiene que ser un UUID, no texto libre.
  if (!esUuid(unidadId)) redirect(DESTINO_MOVIL)

  const comentario = String(formData.get('comentario') ?? '').trim()
  const archivo = formData.get('foto')
  const hayFoto = archivo instanceof File && archivo.size > 0

  if (!comentario && !hayFoto) {
    redirect(`${destino}?error=registro_vacio`)
  }

  const fotos: string[] = []
  if (hayFoto) {
    const subida = await subirAdjunto(`housekeeping/${unidadId}`, archivo as File)
    if ('error' in subida) {
      redirect(`${destino}?error=foto_subida`)
    }
    fotos.push(subida.ruta)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('housekeeping_registros').insert({
    unidad_id: unidadId,
    mucama_id: sesion.userId,
    comentario,
    fotos,
  })
  cortarSiFalla(error, destino, 'registro_guardar')

  revalidatePath(destino)
  redirect(`${destino}?ok=registro`)
}
