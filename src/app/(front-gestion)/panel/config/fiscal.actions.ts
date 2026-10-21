'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { cuitValido, normalizarCuit } from '@/lib/domain/facturacion'

/**
 * Guarda los datos del hotel como emisor de comprobantes (migración 0082).
 *
 * ── Por qué es de admin y no de gerencia ────────────────────────────────────
 *
 * Cambiar el CUIT o la razón social afecta **todos los comprobantes que se emitan
 * desde ese momento**, y un CUIT mal cargado los hace rechazar a todos. La
 * política RLS de la tabla ya lo impone; acá se verifica también para poder
 * explicarlo en español en vez de mostrar un error de base.
 */
export async function guardarDatosFiscales(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || sesion.rol !== 'admin') redirect('/panel/config/datos-fiscales?error=fiscales_rol')

  const razonSocial = String(formData.get('razon_social') ?? '').trim().slice(0, 120)
  const cuit = normalizarCuit(String(formData.get('cuit') ?? ''))

  if (!razonSocial) redirect('/panel/config/datos-fiscales?error=fiscales_razon')
  /*
    Se valida el dígito verificador, no sólo la longitud.

    Once dígitos cualesquiera pasan el `check` de la base y hacen rechazar todos
    los comprobantes contra ARCA, con un error que no dice que el CUIT esté mal.
    `cuitValido` ya existe y se usa para el receptor; el emisor merece lo mismo.
  */
  if (!cuitValido(cuit)) redirect('/panel/config/datos-fiscales?error=fiscales_cuit')

  const condicion = String(formData.get('condicion_iva') ?? 'responsable_inscripto')
  const inicio = String(formData.get('inicio_actividades') ?? '').trim()

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('datos_fiscales').upsert(
    {
      // La fila es única y su clave es la constante `true` (ver la 0082): el
      // `upsert` sobre `id` es lo que convierte «crear» y «editar» en la misma
      // operación sin tener que preguntar antes si ya existe.
      id: true,
      razon_social: razonSocial,
      cuit,
      condicion_iva: condicion,
      domicilio: String(formData.get('domicilio') ?? '').trim().slice(0, 200),
      inicio_actividades: /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : null,
      ingresos_brutos: String(formData.get('ingresos_brutos') ?? '').trim().slice(0, 60) || null,
      actualizado_por: sesion.userId,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  cortarSiFalla(error, '/panel/config/datos-fiscales', 'fiscales')
  revalidatePath('/panel/config/datos-fiscales')
  revalidatePath('/panel/proveedores/comprobantes')
  redirect('/panel/config/datos-fiscales?ok=fiscales')
}
