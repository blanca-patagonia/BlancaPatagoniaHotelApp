'use server'

import { revalidatePath } from 'next/cache'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla } from '@/lib/acciones'

const DESTINO = '/panel/servicio/lista-compras'

/** Convierte lo que llega del formulario a un número o `null`. Nunca `NaN` en la base. */
function precioDelFormulario(valor: FormDataEntryValue | null): number | null {
  const texto = String(valor ?? '').trim().replace(',', '.')
  if (!texto) return null
  const n = Number(texto)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Agrega un ítem a la lista. Precio y nota son opcionales: se puede anotar algo sin saber cuánto sale. */
export async function agregarItemCompra(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('servicio')

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) cortarSiFalla({ message: 'nombre vacío' }, DESTINO, 'lista_compras_nombre')

  const cantidad = String(formData.get('cantidad') ?? '').trim()
  const nota = String(formData.get('nota') ?? '').trim()
  const precioEstimado = precioDelFormulario(formData.get('precio_estimado'))

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('lista_compras_cocina').insert({
    nombre,
    cantidad,
    nota,
    precio_estimado: precioEstimado,
    creado_por: sesion.userId,
  })
  cortarSiFalla(error, DESTINO, 'lista_compras_guardar')

  revalidatePath(DESTINO)
}

/**
 * Edita nombre, cantidad, precio y nota de un ítem existente, en un solo
 * guardado por fila (mismo patrón que el tarifario: siempre editable, sin
 * modo de edición aparte).
 */
export async function editarItemCompra(formData: FormData): Promise<void> {
  await requerirAcceso('servicio')

  const id = String(formData.get('id') ?? '')
  if (!id) cortarSiFalla({ message: 'sin id' }, DESTINO, 'lista_compras_guardar')

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) cortarSiFalla({ message: 'nombre vacío' }, DESTINO, 'lista_compras_nombre')

  const cantidad = String(formData.get('cantidad') ?? '').trim()
  const nota = String(formData.get('nota') ?? '').trim()
  const precioEstimado = precioDelFormulario(formData.get('precio_estimado'))

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('lista_compras_cocina')
    .update({
      nombre,
      cantidad,
      nota,
      precio_estimado: precioEstimado,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', id)
  cortarSiFalla(error, DESTINO, 'lista_compras_guardar')

  revalidatePath(DESTINO)
}

/** Tilda o destilda un ítem, sin tocar el resto de sus datos. La acción que más se usa. */
export async function alternarCompradoItem(formData: FormData): Promise<void> {
  await requerirAcceso('servicio')

  const id = String(formData.get('id') ?? '')
  const comprado = formData.get('comprado') === '1'
  if (!id) cortarSiFalla({ message: 'sin id' }, DESTINO, 'lista_compras_guardar')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('lista_compras_cocina')
    .update({ comprado, actualizado_en: new Date().toISOString() })
    .eq('id', id)
  cortarSiFalla(error, DESTINO, 'lista_compras_guardar')

  revalidatePath(DESTINO)
}

export async function eliminarItemCompra(formData: FormData): Promise<void> {
  await requerirAcceso('servicio')

  const id = String(formData.get('id') ?? '')
  if (!id) cortarSiFalla({ message: 'sin id' }, DESTINO, 'lista_compras_eliminar')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('lista_compras_cocina').delete().eq('id', id)
  cortarSiFalla(error, DESTINO, 'lista_compras_eliminar')

  revalidatePath(DESTINO)
}
