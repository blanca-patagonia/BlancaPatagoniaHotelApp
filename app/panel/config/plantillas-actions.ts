'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requerirAcceso, requerirRol } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { enviarPlantilla } from '@/lib/email'
import { EVENTOS_EMAIL, type EventoEmail } from '@/lib/domain/plantillas'

export interface EstadoPlantilla {
  error?: string
  ok?: string
}

/**
 * Envía una plantilla de prueba al email indicado.
 *
 * Sirve para que gerencia vea cómo queda el correo antes de que le llegue a un
 * huésped. Con el proveedor de consola no sale nada: el envío queda registrado
 * en el servidor y la pantalla lo aclara.
 */
export async function enviarPlantillaPrueba(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('config')

  const evento = String(formData.get('evento') ?? '') as EventoEmail
  const para = String(formData.get('para') ?? '').trim()

  if (!EVENTOS_EMAIL.includes(evento)) redirect('/panel/config/plantillas?error=plantilla')

  // Datos de muestra: alcanzan para ver el resultado sin tocar una reserva real.
  const resultado = await enviarPlantilla(evento, para || sesion.email, {
    nombre: sesion.nombre.split(' ')[0],
    codigo: 'BP-DEMO',
    check_in: '10/09/2026',
    check_out: '13/09/2026',
    hora_check_in: '15:00',
    hora_check_out: '10:00',
    total: '642,51',
    enlace: 'https://blancapatagonia.com/ejemplo',
    nivel: 'Oro',
    puntos: 2100,
  })

  redirect(
    `/panel/config/plantillas?${resultado.ok ? 'ok' : 'error'}=envio&detalle=${encodeURIComponent(resultado.detalle)}`,
  )
}

/**
 * Guarda el asunto/cuerpo editado de una plantilla (`plantillas_email`,
 * migración 0097).
 *
 * `variables`/`opcionales` no se tocan acá: siguen viniendo siempre del
 * catálogo de código (`lib/domain/plantillas.ts`), así que un texto que se
 * borre un marcador obligatorio por error lo va a decir la vista previa —
 * `renderizar()` sigue marcando lo que falta igual que con el original.
 */
export async function guardarPlantilla(
  _prev: EstadoPlantilla,
  formData: FormData,
): Promise<EstadoPlantilla> {
  const sesion = await requerirRol('admin', 'gerencia')

  const evento = String(formData.get('evento') ?? '') as EventoEmail
  const asunto = String(formData.get('asunto') ?? '').trim()
  const cuerpo = String(formData.get('cuerpo') ?? '').trim()

  if (!EVENTOS_EMAIL.includes(evento)) return { error: 'Esa plantilla no existe.' }
  if (!asunto || !cuerpo) return { error: 'El asunto y el cuerpo no pueden quedar vacíos.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('plantillas_email')
    .upsert({
      evento,
      asunto,
      cuerpo,
      actualizado_por: sesion.userId,
      actualizado_en: new Date().toISOString(),
    })
  if (error) return { error: `No se pudo guardar: ${error.message}` }

  revalidatePath('/panel/config/plantillas')
  return { ok: 'Plantilla actualizada.' }
}

/** Vuelve al texto original del código, borrando el override guardado. */
export async function restaurarPlantillaOriginal(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const evento = String(formData.get('evento') ?? '')
  if (EVENTOS_EMAIL.includes(evento as EventoEmail)) {
    const supabase = await crearClienteServidor()
    await supabase.from('plantillas_email').delete().eq('evento', evento)
  }
  revalidatePath('/panel/config/plantillas')
  redirect('/panel/config/plantillas')
}
