'use server'

import { redirect } from 'next/navigation'
import { obtenerSesion } from '@/lib/auth/session'
import { enviarPlantilla } from '@/lib/email'
import { EVENTOS_EMAIL, type EventoEmail } from '@/lib/domain/plantillas'

/**
 * Envía una plantilla de prueba al email indicado.
 *
 * Sirve para que gerencia vea cómo queda el correo antes de que le llegue a un
 * huésped. Con el proveedor de consola no sale nada: el envío queda registrado
 * en el servidor y la pantalla lo aclara.
 */
export async function enviarPlantillaPrueba(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const evento = String(formData.get('evento') ?? '') as EventoEmail
  const para = String(formData.get('para') ?? '').trim()

  if (!EVENTOS_EMAIL.includes(evento)) redirect('/panel/config?error=plantilla')

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
    `/panel/config?${resultado.ok ? 'ok' : 'error'}=envio&detalle=${encodeURIComponent(resultado.detalle)}`,
  )
}
