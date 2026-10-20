'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla, mensajeDeFalla, registrarFalla } from '@/lib/acciones'

/** Repone stock de un producto (suma unidades). Solo admin/gerencia. */
export async function reponerStock(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('producto_id') ?? '')
  const cantidad = Number(formData.get('cantidad') ?? 0)
  if (id && Number.isInteger(cantidad) && cantidad > 0) {
    const supabase = await crearClienteServidor()
    /*
      En un solo paso en la base (migración 0116). Antes se leía el stock y se
      escribía «leído + cantidad»: un consumo que entrara en el medio quedaba
      pisado y el stock terminaba inflado.
    */
    const { data: nuevo, error } = await supabase.rpc('reponer_stock', {
      p_producto_id: id,
      p_cantidad: cantidad,
    })
    // Una reposición que no se guarda deja el stock mostrando menos de lo que
    // hay, y el próximo consumo lo descuenta de un número equivocado.
    cortarSiFalla(error, '/panel/config/inventario', 'stock')
    if (nuevo === null) redirect('/panel/config/inventario?error=stock_sin_inventario')
  }
  redirect('/panel/config/inventario')
}

/**
 * Da de alta un producto o servicio del catálogo de consumos.
 *
 * Sin esto el catálogo quedaba congelado en lo que trajo el seed: el hotel no
 * podía sumar una bebida nueva al frigobar.
 */
export async function crearProducto(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const nombre = String(formData.get('nombre') ?? '').trim()
  const categoria = String(formData.get('categoria') ?? 'otro')
  const precio = Number(formData.get('precio'))
  const stock = Number(formData.get('stock'))
  const stockMinimo = Number(formData.get('stock_minimo'))
  const controlaStock = String(formData.get('controla_stock') ?? '') === '1'

  if (!nombre || !Number.isFinite(precio) || precio < 0) {
    redirect('/panel/config/inventario?error=producto')
  }

  // El código es único: se deriva del nombre y se completa si ya existe.
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)

  const supabase = await crearClienteServidor()
  const { data: existentes, error: eExistentes } = await supabase
    .from('productos_servicios')
    .select('codigo')
    .like('codigo', `${base}%`)
  // Si falla, el código sale sin sufijo y el `unique` de la base lo frena en el insert.
  registrarFalla(eExistentes, 'config:productos_codigos_existentes')
  const codigo = existentes?.length ? `${base}-${existentes.length + 1}` : base

  const { error } = await supabase.from('productos_servicios').insert({
    codigo,
    nombre,
    categoria,
    precio,
    // Solo lleva stock lo que es físico: un servicio (late check-out) no.
    stock: controlaStock && Number.isFinite(stock) ? stock : null,
    stock_minimo: controlaStock && Number.isFinite(stockMinimo) ? stockMinimo : null,
  })

  revalidatePath('/panel/config/inventario')
  redirect(error ? '/panel/config/inventario?error=producto' : '/panel/config/inventario?ok=producto')
}

export interface EstadoProducto {
  error?: string
  ok?: string
}

/**
 * Edita nombre, categoría y precio de un producto ya cargado.
 *
 * Antes solo se podía dar de alta uno nuevo: un precio mal cargado o un typo
 * en el nombre («Cocacola» en vez de «Coca-Cola») quedaba así para siempre, o
 * había que desactivarlo y crear otro —perdiendo el historial de consumos
 * que ya lo referencian, porque `consumos.producto_id` sigue apuntando al
 * viejo—. El `codigo` no se toca: es la clave estable que usan los consumos
 * ya cargados y el punto de venta.
 */
export async function editarProducto(
  _prev: EstadoProducto,
  formData: FormData,
): Promise<EstadoProducto> {
  await requerirAcceso('config')

  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const categoria = String(formData.get('categoria') ?? '')
  const precio = Number(formData.get('precio'))

  if (!id) return { error: 'Falta el producto a editar.' }
  if (!nombre) return { error: 'Ingresá un nombre.' }
  if (!Number.isFinite(precio) || precio < 0) return { error: 'El precio tiene que ser un número positivo.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('productos_servicios')
    .update({ nombre, categoria, precio })
    .eq('id', id)
  if (error) return { error: mensajeDeFalla(error, 'config:guardar', 'No se pudo guardar') }

  revalidatePath('/panel/config/inventario')
  return { ok: 'Producto actualizado.' }
}

/** Activa o desactiva un producto sin borrarlo (conserva el historial de consumos). */
export async function alternarProducto(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('producto_id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase
      .from('productos_servicios')
      .update({ activo: !activo })
      .eq('id', id)
    cortarSiFalla(error, '/panel/config/inventario', 'producto_estado')
  }
  revalidatePath('/panel/config/inventario')
  redirect('/panel/config/inventario')
}

/**
 * Borra un producto o servicio del catálogo, de verdad.
 *
 * Es seguro por diseño de la base, no por una comprobación de acá:
 * `consumos.producto_id` tiene `on delete restrict` (migración 0010), así que
 * si alguna vez se vendió, Postgres rechaza el borrado antes de tocar nada —
 * el consumo ya cargado no puede quedar apuntando a un producto que no
 * existe. Ese rechazo (código `23503`) no es un fallo real: es la base
 * protegiendo el historial, y se traduce a un mensaje que manda a
 * "Desactivar" en vez del genérico de escritura fallida.
 */
export async function eliminarProducto(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const id = String(formData.get('producto_id') ?? '')
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('productos_servicios').delete().eq('id', id)
    cortarSiFalla(
      error,
      '/panel/config/inventario',
      error?.code === '23503' ? 'producto_con_historial' : 'producto_eliminar',
    )
  }
  revalidatePath('/panel/config/inventario')
  redirect('/panel/config/inventario?ok=producto_eliminado')
}
