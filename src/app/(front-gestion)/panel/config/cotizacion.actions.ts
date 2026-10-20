'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { puedeAcceder } from '@/lib/domain/permisos'
import { esMonedaExtranjera, validarCotizacionManual } from '@/lib/domain/divisas'
import { registrarCotizacionManual } from '@/lib/divisas/servicio'

/**
 * Carga a mano la cotización de una divisa.
 *
 * Es el respaldo del que habla el ADR 0020: cuando la fuente externa no responde
 * o viene dando cualquier cosa, alguien mira el pizarrón del banco y lo escribe
 * acá. Por eso el valor cargado **le gana** a uno automático más viejo
 * (`resolverVigente` elige por frescura, no por fuente): es una corrección
 * deliberada de una persona, no un dato de segunda.
 *
 * Solo admin/gerencia, y no por prolijidad: fijar la cotización es fijar a qué
 * precio cobra el hotel ese día. Un valor mal tipeado en el mostrador se traduce
 * en cobrarle de menos a todo el que pague en pesos hasta que alguien lo note.
 *
 * A diferencia del resto de este archivo, la comprobación de rol usa
 * `puedeAcceder(rol, 'config')` en lugar del literal `['admin','gerencia']`.
 * `AGENTS.md` pide migrar esos literales al tocarlos; el área `config` ya está
 * restringida a esos dos roles en `lib/domain/permisos.ts`, así que el resultado
 * es el mismo y deja de haber dos fuentes de verdad.
 */
export async function cargarCotizacion(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const moneda = String(formData.get('moneda') ?? '')
  if (!esMonedaExtranjera(moneda)) redirect('/panel/config/divisas?error=moneda')

  const compra = formData.get('compra')
  const venta = formData.get('venta')

  // El dominio decide si el par sirve: un cero, un negativo o una venta por
  // debajo de la compra (que significaría regalar el spread) no llegan a la base.
  const problema = validarCotizacionManual(compra, venta)
  if (problema) {
    redirect(`/panel/config/divisas?error=cotizacion&detalle=${encodeURIComponent(problema)}`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await registrarCotizacionManual(supabase, {
    moneda,
    compra: Number(compra),
    venta: Number(venta),
    perfilId: sesion.userId,
  })

  if (error) redirect(`/panel/config/divisas?error=cotizacion&detalle=${encodeURIComponent(error)}`)

  revalidatePath('/panel/config/divisas')
  revalidatePath('/panel')
  redirect('/panel/config/divisas?ok=cotizacion')
}
