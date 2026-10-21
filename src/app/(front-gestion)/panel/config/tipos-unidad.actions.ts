'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { ETIQUETA_CATALOGO } from '@/lib/catalogo/publico'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla, mensajeDeFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'

/**
 * Da de alta un tipo de alojamiento (categoría comercial, no una unidad física).
 *
 * `codigo` es la clave que ya usan `lib/domain/catalogo.ts` (el mapa `FOTOS`) y
 * los mapeos de canal (`canal_tipos`, `canal_mapeos_columnas`): una vez creado
 * no se ofrece editarlo desde acá — ver `editarTipoUnidad`, que a propósito no
 * lo toca —, así que tiene que quedar bien desde el alta.
 */
/** Lo que vuelve al formulario de alta de un tipo cuando algo se rechaza. */
export interface EstadoAltaTipo {
  error?: string
  valores?: { codigo: string; nombre: string; categoria: string; capacidad: string; descripcion: string }
}

export async function crearTipoUnidad(
  _prev: EstadoAltaTipo,
  formData: FormData,
): Promise<EstadoAltaTipo> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const codigo = String(formData.get('codigo') ?? '').trim().toUpperCase().slice(0, 40)
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 80)
  const categoria = String(formData.get('categoria') ?? '')
  const capacidadCruda = Number(formData.get('capacidad_max'))
  const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 500)

  /*
    Lo que se tecleó vuelve en el ESTADO de la acción, no en la URL: el alta
    está en su propia pantalla (`tipos-alojamiento/nuevo`) y un error no vacía
    el formulario. Antes viajaba como `?alta_codigo=…&alta_nombre=…`, que es
    justo lo que la regla «nada manejado por URL» del panel evita.
  */
  const valores = {
    codigo: String(formData.get('codigo') ?? ''),
    nombre,
    categoria,
    capacidad: String(formData.get('capacidad_max') ?? ''),
    descripcion,
  }

  if (!codigo || !/^[A-Z0-9-]+$/.test(codigo)) {
    return {
      error: 'El código solo puede tener mayúsculas, números y guiones (por ejemplo HOST-STD).',
      valores,
    }
  }
  if (!nombre) return { error: 'Ingresá un nombre.', valores }
  if (categoria !== 'hosteria' && categoria !== 'cabana') {
    return { error: 'Elegí Hostería o Cabaña.', valores }
  }
  if (!Number.isFinite(capacidadCruda) || capacidadCruda < 1) {
    return { error: 'La capacidad tiene que ser 1 o más.', valores }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('tipos_unidad').insert({
    codigo,
    nombre,
    categoria,
    capacidad_max: Math.trunc(capacidadCruda),
    descripcion,
  })
  // El código es `unique`: lo más probable es que ya exista uno igual.
  if (error) {
    return {
      error:
        error.code === '23505'
          ? 'Ya existe un tipo con ese código.'
          : mensajeDeFalla(error, 'config:crear_tipo', 'No se pudo guardar el tipo'),
      valores,
    }
  }

  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tipos-alojamiento')
  revalidatePath('/panel/config/ubicaciones')
  redirect('/panel/config/tipos-alojamiento?ok=tipo_creado')
}

/**
 * Edita nombre, descripción y capacidad de un tipo YA existente.
 *
 * No recibe `codigo`: cambiarlo rompería en silencio el mapa `FOTOS` de
 * `lib/domain/catalogo.ts` (que indexa por código) y los mapeos de canal, que
 * también lo usan como clave estable. Si el hotel necesita cambiar un código,
 * es una migración — igual que hizo la 0106 al renombrar el inventario —, no
 * un campo de este formulario.
 */
export async function editarTipoUnidad(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('tipo_id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 80)
  const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 500)
  const capacidadCruda = Number(formData.get('capacidad_max'))

  // Con `edita_id` la pantalla sabe CUÁL fila repoblar con lo tecleado: las
  // demás siguen mostrando lo que ya tenían guardado (auditoría QA/UX
  // 2026-10-14).
  const edicionPrevia = new URLSearchParams({
    edita_id: id,
    edita_nombre: nombre,
    edita_capacidad: String(formData.get('capacidad_max') ?? ''),
    edita_descripcion: descripcion,
  }).toString()

  if (!id) redirect(`/panel/config/tipos-alojamiento?error=tipo_guardar&${edicionPrevia}`)
  if (!nombre) redirect(`/panel/config/tipos-alojamiento?error=tipo_nombre&${edicionPrevia}`)
  if (!Number.isFinite(capacidadCruda) || capacidadCruda < 1) {
    redirect(`/panel/config/tipos-alojamiento?error=tipo_capacidad&${edicionPrevia}`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('tipos_unidad')
    .update({ nombre, descripcion, capacidad_max: Math.trunc(capacidadCruda) })
    .eq('id', id)
  cortarSiFalla(error, `/panel/config/tipos-alojamiento?${edicionPrevia}`, 'tipo_guardar')

  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tipos-alojamiento')
  revalidatePath('/panel/config/ubicaciones')
  redirect('/panel/config/tipos-alojamiento?ok=tipo_editado')
}

/**
 * Da de baja o reactiva un tipo de alojamiento.
 *
 * No hace falta verificar unidades ni tarifas antes: `activo = false` sólo
 * saca al tipo del catálogo público (migración 0002, política de `select`) y
 * de la lista para crear una unidad nueva — exactamente lo que ya les pasa a
 * `HOST-SINGLE`/`CAB-UPSALA`/`CAB-MORENO` sin que nadie lo tilde a mano (ver
 * CLAUDE.md, migración 0106). Las unidades y tarifas que ya tenga no se tocan.
 */
export async function alternarActivoTipoUnidad(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('tipo_id') ?? '')
  const activo = formData.get('activo') === '1'
  if (!id) redirect('/panel/config/tipos-alojamiento?error=tipo_guardar')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('tipos_unidad').update({ activo }).eq('id', id)
  cortarSiFalla(error, '/panel/config/tipos-alojamiento', 'tipo_guardar')

  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tipos-alojamiento')
  revalidatePath('/panel/config/ubicaciones')
  redirect(`/panel/config/tipos-alojamiento?ok=${activo ? 'tipo_activado' : 'tipo_dado_de_baja'}`)
}
