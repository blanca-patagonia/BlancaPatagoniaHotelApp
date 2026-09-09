'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla } from '@/lib/acciones'
import { obtenerProveedorEmail } from '@/lib/email'
import { registrarAviso } from '@/lib/registro'

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

export interface EstadoPrueba {
  ok?: string
  error?: string
}

/**
 * Manda un correo de prueba a una dirección que escribe quien lo pide.
 *
 * ── Por qué hace falta un botón para esto ───────────────────────────────────
 *
 * Porque **todo el camino funciona sin credenciales**: la bandeja encola, el cron
 * despacha y el proveedor de consola devuelve `ok`. Un hotel sin configurar ve
 * exactamente lo mismo que uno configurado —filas en verde que dicen «enviada»—
 * y la diferencia recién se nota cuando un huésped llama para decir que no le
 * llegó nada.
 *
 * Esto lo prueba en diez segundos y, sobre todo, **devuelve el motivo verbatim
 * del proveedor**. Es donde aparece lo que de verdad hay que corregir: «domain is
 * not verified», «API key is invalid». Traducirlo a «no se pudo enviar» sería
 * quedarse justo con la parte inútil.
 *
 * ── Por qué NO pasa por la bandeja ──────────────────────────────────────────
 *
 * Un correo de prueba no es una comunicación al huésped: no tiene entidad a la
 * que imputarse, no debe aparecer en el registro de envíos —que es el rastro de
 * lo que el hotel le dijo a la gente— y no tiene sentido reintentarlo con espera
 * creciente. Lo que se está probando es el proveedor, y se lo llama directo.
 *
 * ⚠️ Es de administración: manda correo hacia afuera con el dominio del hotel.
 */
export async function mandarCorreoDePrueba(
  _prev: EstadoPrueba,
  formData: FormData,
): Promise<EstadoPrueba> {
  const sesion = await requerirAcceso('notificaciones')

  if (sesion.rol !== 'admin' && sesion.rol !== 'gerencia') {
    return { error: 'La prueba de envío es de administración o gerencia.' }
  }

  const para = String(formData.get('para') ?? '').trim()
  if (!para || !para.includes('@')) {
    return { error: 'Escribí una dirección de correo válida.' }
  }

  const proveedor = obtenerProveedorEmail()

  const r = await proveedor.enviar({
    para,
    asunto: 'Prueba de envío — Blanca Patagonia',
    cuerpo: `Este es un correo de prueba del sistema de gestión del Hotel Blanca Patagonia.

Si lo estás leyendo, el envío de correos está funcionando: las confirmaciones de
reserva, los recordatorios y los avisos de pago van a salir por este mismo camino.

No hace falta responderlo.`,
  })

  /*
    Queda registrado, y no es un detalle: una prueba fallida es la mejor pista
    que va a haber de por qué el hotel no está mandando correos. Se guarda el
    motivo del proveedor, nunca la clave ni el cuerpo.
  */
  await registrarAviso('prueba_de_correo', {
    detalle: r.detalle.slice(0, 500),
    proveedor: proveedor.nombre,
    ok: r.ok,
    real: proveedor.esReal(),
  })

  if (!r.ok) return { error: r.detalle }

  if (!proveedor.esReal()) {
    /*
      El proveedor de consola devuelve `ok: true` y no manda nada. Decir «listo,
      se envió» sería la mentira más cara de esta pantalla: alguien concluiría
      que el correo está configurado y se iría tranquilo.
    */
    return {
      error:
        `El proveedor configurado es «${proveedor.nombre}», que NO envía: escribe el correo en el ` +
        'registro del servidor. Para mandar de verdad hay que poner EMAIL_PROVIDER=resend con su clave.',
    }
  }

  return {
    ok: `Se mandó a ${para}. Si no llega en unos minutos, revisá el correo no deseado y el dominio del remitente.`,
  }
}
