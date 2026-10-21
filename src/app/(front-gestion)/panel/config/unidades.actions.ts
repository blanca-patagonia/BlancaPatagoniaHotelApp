'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla, mensajeDeFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'

/**
 * Guarda la ubicación física de una unidad: bloque, piso y orden de recorrido.
 *
 * Sin una pantalla para cargarlos, las columnas de la migración 0042 quedarían
 * vacías para siempre y los filtros de la grilla no servirían para nada.
 *
 * `orden` es el que define el recorrido de limpieza dentro del piso. Existe porque
 * el alfabético pone «10» antes que «9», así que ordenar por nombre manda a la
 * mucama a caminar el pasillo en zigzag.
 */
export async function guardarUbicacionUnidad(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('unidad_id') ?? '')
  if (!id) redirect('/panel/config/ubicaciones?error=unidad')

  // El nombre viaja en el MISMO envío (criterio «una fila, un guardado», igual
  // que el tarifario): antes esta pantalla dejaba crear una unidad pero nunca
  // renombrarla — «Cabaña 7» quedaba así para siempre aunque el hotel le
  // pusiera un nombre propio después.
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 80)
  if (!nombre) redirect('/panel/config/ubicaciones?error=unidad_nombre')

  const bloque = String(formData.get('bloque') ?? '').trim().slice(0, 60)
  const piso = String(formData.get('piso') ?? '').trim().slice(0, 20)
  const ordenCrudo = Number(formData.get('orden'))
  const orden = Number.isFinite(ordenCrudo) ? Math.max(0, Math.trunc(ordenCrudo)) : 0

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('unidades')
    .update({ nombre, bloque, piso, orden })
    .eq('id', id)

  cortarSiFalla(error, '/panel/config/ubicaciones', 'ubicacion')
  revalidatePath('/panel/config/ubicaciones')
  revalidatePath('/panel/ocupacion')
  redirect('/panel/config/ubicaciones?ok=ubicacion')
}

/**
 * Da de baja o reactiva una unidad física.
 *
 * ── Por qué se bloquea si tiene una estadía ACTIVA ──────────────────────────
 *
 * `activo = false` la saca de la grilla de ocupación y de cualquier alta
 * nueva (mismo criterio que agencias, proveedores y tarifas — ADR/migración
 * 0061). Pero si la unidad tiene una estadía en un estado que **ocupa
 * inventario** (`ESTADOS_ACTIVOS`, el mismo que usa la restricción anti-
 * overbooking de la base), desactivarla dejaría a un huésped alojado o por
 * llegar en una habitación que ya no aparece en ningún listado. Para eso
 * existe «cambiar de unidad» (migración 0028): hay que mudar la estadía
 * primero.
 */
export async function alternarActivoUnidad(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('unidad_id') ?? '')
  const activo = formData.get('activo') === '1'
  if (!id) redirect('/panel/config/ubicaciones?error=unidad')

  const supabase = await crearClienteServidor()

  if (!activo) {
    const { data: ocupada, error: errorOcupada } = await supabase
      .from('estadias')
      .select('id')
      .eq('unidad_id', id)
      .in('estado', ESTADOS_ACTIVOS)
      .limit(1)
      .maybeSingle()
    if (errorOcupada) cortarSiFalla(errorOcupada, '/panel/config/ubicaciones', 'unidad_verificar')
    if (ocupada) redirect('/panel/config/ubicaciones?error=unidad_ocupada')
  }

  const { error } = await supabase.from('unidades').update({ activo }).eq('id', id)
  cortarSiFalla(error, '/panel/config/ubicaciones', 'unidad_estado')

  revalidatePath('/panel/config/ubicaciones')
  revalidatePath('/panel/ocupacion')
  redirect(`/panel/config/ubicaciones?ok=${activo ? 'unidad_activada' : 'unidad_dada_de_baja'}`)
}

/**
 * Da de alta una unidad física (habitación o cabaña) nueva.
 *
 * No existía ningún camino en el panel para esto: el botón «Cargar unidades»
 * del estado vacío de la grilla de ocupación apuntaba a una ruta que no
 * existe, y de fondo no había ninguna Server Action que hiciera un `insert`
 * sobre `unidades`. `tipo_unidad_id` se valida contra los tipos activos reales
 * (no confiar en lo que mande el formulario) para no crear una unidad
 * huérfana de un tipo inexistente o dado de baja.
 */
/** Lo que vuelve al formulario de alta de una unidad cuando algo se rechaza. */
export interface EstadoAltaUnidad {
  error?: string
  valores?: { nombre: string; tipo_unidad_id: string }
}

export async function crearUnidad(
  _prev: EstadoAltaUnidad,
  formData: FormData,
): Promise<EstadoAltaUnidad> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const nombre = String(formData.get('nombre') ?? '').trim()
  const tipoUnidadId = String(formData.get('tipo_unidad_id') ?? '')
  // Lo cargado vuelve con el error: el alta tiene su pantalla y no se vacía.
  const valores = { nombre, tipo_unidad_id: tipoUnidadId }
  if (!nombre) return { error: 'Ingresá un nombre para la unidad.', valores }
  if (!tipoUnidadId) return { error: 'Elegí un tipo de alojamiento válido.', valores }

  const supabase = await crearClienteServidor()
  const { data: tipo, error: errorTipo } = await supabase
    .from('tipos_unidad')
    .select('id')
    .eq('id', tipoUnidadId)
    .eq('activo', true)
    .maybeSingle()
  if (errorTipo) {
    return {
      error: mensajeDeFalla(errorTipo, 'config:crear_unidad_tipo', 'No se pudo verificar el tipo. No se creó nada'),
      valores,
    }
  }
  if (!tipo) return { error: 'Elegí un tipo de alojamiento válido.', valores }

  const { error } = await supabase
    .from('unidades')
    .insert({ nombre, tipo_unidad_id: tipoUnidadId })
  if (error) return { error: mensajeDeFalla(error, 'config:crear_unidad', 'No se pudo crear la unidad'), valores }

  revalidatePath('/panel/config/ubicaciones')
  revalidatePath('/panel/ocupacion')
  redirect('/panel/config/ubicaciones?ok=unidad')
}
