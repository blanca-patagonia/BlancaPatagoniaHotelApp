'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'

/**
 * Vuelve a poner un aviso en la cola.
 *
 * ── Por qué hace falta `service_role` acá ───────────────────────────────────
 *
 * `notificaciones` no tiene políticas de escritura y la 0075 le revoca a
 * `authenticated` el `insert/update/delete` **a propósito**: que nadie pueda
 * marcar como enviado algo que no salió es el punto de tener un registro. Así
 * que esta acción escribe con el cliente administrativo, y el permiso lo pone
 * `requerirAcceso` un renglón antes.
 *
 * ── Por qué el filtro de estado va en la consulta ───────────────────────────
 *
 * `service_role` saltea RLS: si el `update` no acotara el estado, un POST
 * armado a mano —una Server Action es un endpoint HTTP público— podría
 * reencolar algo **ya entregado** y el huésped recibiría el mismo aviso dos
 * veces. El `.in(...)` es lo que lo impide, y el `select` posterior distingue
 * «no se pudo» de «ese aviso no correspondía».
 */
export async function reencolarNotificacion(formData: FormData): Promise<void> {
  await requerirAcceso('notificaciones')
  const id = String(formData.get('id') ?? '')

  if (id) {
    const admin = crearClienteAdmin()
    const { data, error } = await admin
      .from('notificaciones')
      .update({
        estado: 'pendiente',
        // Los intentos vuelven a cero: si el motivo del fallo se arregló, arrancar
        // con cuatro intentos gastados le daría uno solo antes de rendirse otra vez.
        intentos: 0,
        // `'now'` es el reloj de la base, el mismo con el que el cron compara el
        // corte. Con el del proceso, una fila recién encolada puede quedar por
        // encima del corte y no despacharse nunca (ver `despachar`).
        proximo_en: 'now',
        error: null,
      })
      .in('estado', ['fallida', 'cancelada'])
      .eq('id', id)
      .select('id')

    cortarSiFalla(error, '/panel/notificaciones', 'reencolar')

    if (!data || data.length === 0) {
      redirect('/panel/notificaciones?error=estado')
    }

    revalidatePath('/panel/notificaciones')
    redirect('/panel/notificaciones?ok=reencolada')
  }

  redirect('/panel/notificaciones')
}

/**
 * Frena un aviso antes de que salga.
 *
 * ── Para qué existe ─────────────────────────────────────────────────────────
 *
 * Para el caso feo: un despliegue que encoló avisos equivocados. Sin esto, la
 * única forma de que no salgan sería sacarle el secreto al cron —que frena
 * TODOS, incluidos los que sí correspondían— o entrar a la base a mano.
 *
 * El procedimiento completo está en `docs/despliegue.md` §3.5, y el orden
 * importa: primero se frena el cron, después se cancela. Al revés, una corrida
 * se lleva justo lo que se está por cancelar.
 *
 * ⚠️ Sólo cancela lo `pendiente`, y el filtro va EN LA CONSULTA. Cancelar algo
 * ya enviado no lo trae de vuelta —el correo está en la casilla del huésped— y
 * marcarlo como cancelado falsearía el registro de lo que pasó. Como
 * `service_role` saltea RLS, sin ese `.eq(...)` un POST armado a mano podría
 * reescribir la historia de un envío.
 *
 * Lo cancelado se puede volver a encolar (`sePuedeReintentar`): la decisión es
 * reversible mientras el aviso siga teniendo sentido.
 */
export async function cancelarNotificacion(formData: FormData): Promise<void> {
  await requerirAcceso('notificaciones')
  const id = String(formData.get('id') ?? '')

  if (id) {
    const admin = crearClienteAdmin()
    const { data, error } = await admin
      .from('notificaciones')
      .update({ estado: 'cancelada' })
      .eq('estado', 'pendiente')
      .eq('id', id)
      .select('id')

    cortarSiFalla(error, '/panel/notificaciones', 'cancelar')

    if (!data || data.length === 0) {
      redirect('/panel/notificaciones?error=ya_salio')
    }

    revalidatePath('/panel/notificaciones')
    redirect('/panel/notificaciones?ok=cancelada')
  }

  redirect('/panel/notificaciones')
}
