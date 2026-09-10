'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla } from '@/lib/acciones'
import { PROVEEDORES } from '@/lib/domain/conexiones'

const DESTINO = '/panel/config/conexiones'

/**
 * Desconecta un proveedor: borra los tokens, no la fila entera.
 *
 * Conservar la fila (con `estado = 'desconectado'`) deja el historial de
 * quién conectó y cuándo, en vez de perderlo cada vez que alguien desconecta
 * y vuelve a conectar.
 */
export async function desconectarProveedor(formData: FormData): Promise<void> {
  await requerirAcceso('config')

  const proveedor = String(formData.get('proveedor') ?? '')
  if (!(PROVEEDORES as readonly string[]).includes(proveedor)) redirect(DESTINO)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('conexiones_proveedores')
    .update({
      estado: 'desconectado',
      access_token_cifrado: null,
      refresh_token_cifrado: null,
      expira_en: null,
      actualizado_en: new Date().toISOString(),
    })
    .eq('proveedor', proveedor)
  cortarSiFalla(error, DESTINO, 'desconectar')

  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=desconectado`)
}
