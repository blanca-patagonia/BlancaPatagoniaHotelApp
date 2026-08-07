'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { formatearRango, rangoInvalido } from '@/lib/domain/temporadas'

const RUTA = '/panel/config/temporadas'

async function exigirGestion() {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')
  if (!['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel/config')
}

/**
 * Agrega un rango de fechas a una temporada.
 *
 * La garantía de que dos temporadas no se pisen la da la base: hay una
 * restricción de exclusión GiST sobre `temporada_rangos`. Acá solo se traduce
 * su rechazo (`23P01`) a algo que se entienda, igual que se hace con el
 * anti-overbooking de las estadías.
 */
export async function agregarRango(formData: FormData): Promise<void> {
  await exigirGestion()

  const temporadaId = String(formData.get('temporada_id') ?? '')
  const desde = String(formData.get('desde') ?? '')
  const hasta = String(formData.get('hasta') ?? '')

  if (!temporadaId) redirect(`${RUTA}?error=temporada`)

  const problema = rangoInvalido(desde, hasta)
  if (problema) redirect(`${RUTA}?error=fechas`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('temporada_rangos')
    .insert({ temporada_id: temporadaId, rango: formatearRango(desde, hasta) })

  if (error) {
    redirect(`${RUTA}?error=${error.code === '23P01' ? 'solape' : 'guardar'}`)
  }

  revalidatePath(RUTA)
  redirect(`${RUTA}?ok=agregado`)
}

/** Quita un rango. Las fechas que cubría quedan sin temporada (y sin tarifa). */
export async function quitarRango(formData: FormData): Promise<void> {
  await exigirGestion()

  const id = String(formData.get('rango_id') ?? '')
  if (!id) redirect(RUTA)

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('temporada_rangos').delete().eq('id', id)
  if (error) redirect(`${RUTA}?error=borrar`)

  revalidatePath(RUTA)
  redirect(`${RUTA}?ok=quitado`)
}
