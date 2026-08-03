'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'

/**
 * Actualiza el precio neto y rack de una tarifa (tipo de unidad × temporada).
 *
 * Solo admin/gerencia. El tarifario es la base de toda cotización, así que se
 * validan los importes antes de tocar la base: nada de precios negativos ni de
 * un neto por encima del rack (el neto es siempre el precio de agencia).
 */
export async function actualizarTarifa(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const id = String(formData.get('tarifa_id') ?? '')
  const neto = Number(formData.get('precio_neto'))
  const rack = Number(formData.get('precio_rack'))

  if (!id || !Number.isFinite(neto) || !Number.isFinite(rack) || neto < 0 || rack < 0) {
    redirect('/panel/config?error=importes')
  }
  if (neto > rack) redirect('/panel/config?error=neto_mayor')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('tarifas')
    .update({ precio_neto: neto, precio_rack: rack })
    .eq('id', id)

  redirect(error ? '/panel/config?error=guardar' : '/panel/config?ok=tarifa')
}

/** Repone stock de un producto (suma unidades). Solo admin/gerencia. */
export async function reponerStock(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const id = String(formData.get('producto_id') ?? '')
  const cantidad = Number(formData.get('cantidad') ?? 0)
  if (id && Number.isFinite(cantidad) && cantidad > 0) {
    const supabase = await crearClienteServidor()
    const { data: p } = await supabase
      .from('productos_servicios')
      .select('stock')
      .eq('id', id)
      .single()
    if (p && p.stock != null) {
      await supabase
        .from('productos_servicios')
        .update({ stock: (p.stock as number) + cantidad })
        .eq('id', id)
    }
  }
  redirect('/panel/config')
}

/**
 * Da de alta un producto o servicio del catálogo de consumos.
 *
 * Sin esto el catálogo quedaba congelado en lo que trajo el seed: el hotel no
 * podía sumar una bebida nueva al frigobar.
 */
export async function crearProducto(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const nombre = String(formData.get('nombre') ?? '').trim()
  const categoria = String(formData.get('categoria') ?? 'otro')
  const precio = Number(formData.get('precio'))
  const stock = Number(formData.get('stock'))
  const stockMinimo = Number(formData.get('stock_minimo'))
  const controlaStock = String(formData.get('controla_stock') ?? '') === '1'

  if (!nombre || !Number.isFinite(precio) || precio < 0) {
    redirect('/panel/config?error=producto')
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
  const { data: existentes } = await supabase
    .from('productos_servicios')
    .select('codigo')
    .like('codigo', `${base}%`)
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

  revalidatePath('/panel/config')
  redirect(error ? '/panel/config?error=producto' : '/panel/config?ok=producto')
}

/** Activa o desactiva un producto sin borrarlo (conserva el historial de consumos). */
export async function alternarProducto(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const id = String(formData.get('producto_id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const supabase = await crearClienteServidor()
    await supabase.from('productos_servicios').update({ activo: !activo }).eq('id', id)
  }
  revalidatePath('/panel/config')
  redirect('/panel/config')
}
