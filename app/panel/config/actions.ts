'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'

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
