'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { CAMPOS_BOOKING, esColumnaProhibida, normalizarEncabezado } from '@/lib/canales/csv'
import { validarAsignaciones, type Asignaciones } from '@/lib/domain/mapeo-columnas'

/**
 * Guardar el mapeo de columnas de un formato de informe.
 *
 * ── Por qué la validación es del lado del servidor y no del formulario ──────
 *
 * Lo que llega es un `jsonb` armado con lo que el usuario eligió en unos `<select>`.
 * Un `<select>` no es una garantía: la acción es un endpoint HTTP y se puede invocar
 * con cualquier cuerpo.
 *
 * La comprobación que más importa es la de **columnas prohibidas**. Este formulario le
 * da al usuario exactamente la capacidad que el lector le niega —elegir qué columna se
 * lee— así que sin validar acá, «Tarjeta virtual» asignada al campo de observaciones
 * metería un PAN en la base desde una pantalla de configuración.
 */

const DESTINO = '/panel/canales/mapeo'

export async function guardarMapeo(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'canales')) redirect('/panel')

  const id = String(formData.get('mapeo_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()

  const { data: mapeo, error: eLectura } = await supabase
    .from('canal_mapeos_columnas')
    .select('id, muestra')
    .eq('id', id)
    .maybeSingle<{ id: string; muestra: { encabezados: string[] } | null }>()

  cortarSiFalla(eLectura, DESTINO, 'lectura')
  if (!mapeo) redirect(`${DESTINO}?error=no_existe`)

  const encabezados = mapeo.muestra?.encabezados ?? []
  if (encabezados.length === 0) redirect(`${DESTINO}?error=sin_encabezados`)

  // Se arma desde los campos del lector y no desde lo que vino en el formulario: así
  // una clave inventada nunca llega a la validación.
  const asignaciones: Asignaciones = {}
  for (const campo of CAMPOS_BOOKING) {
    const valor = String(formData.get(`campo_${campo}`) ?? '').trim()
    if (valor) asignaciones[campo] = valor
  }

  const r = validarAsignaciones(
    asignaciones,
    CAMPOS_BOOKING,
    encabezados,
    esColumnaProhibida,
    normalizarEncabezado,
  )

  if (!r.ok) {
    // Los motivos se guardan en la fila y no van por la URL: son varios, largos, y
    // nombran columnas del archivo del hotel. La pantalla los lee de ahí.
    const { error } = await supabase
      .from('canal_mapeos_columnas')
      .update({ actualizado_en: new Date().toISOString() })
      .eq('id', id)
    cortarSiFalla(error, DESTINO, 'guardar')
    redirect(`${DESTINO}?error=invalido&detalle=${encodeURIComponent(r.motivos.join(' · ').slice(0, 300))}`)
  }

  const { error } = await supabase
    .from('canal_mapeos_columnas')
    .update({
      asignaciones: r.limpias,
      // Recién ahora se activa: hasta que alguien lo completa, el borrador no se usa
      // para importar.
      activo: true,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', id)

  cortarSiFalla(error, DESTINO, 'guardar')

  revalidatePath(DESTINO)
  revalidatePath('/panel/canales')
  redirect('/panel/canales?ok=mapeo_guardado')
}

/** Descarta un mapeo (un borrador que quedó de un archivo equivocado, por ejemplo). */
export async function borrarMapeo(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'canales')) redirect('/panel')

  const id = String(formData.get('mapeo_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_mapeos_columnas').delete().eq('id', id)

  cortarSiFalla(error, DESTINO, 'borrar')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=borrado`)
}
