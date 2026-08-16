'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'
import { obtenerProveedorCanal } from '@/lib/canales'
import { interpretarCsvBooking } from '@/lib/canales/csv'
import { guardarEntrantes, importarEntrante } from '@/lib/canales/servicio'

/**
 * Acciones del área de canales de venta.
 *
 * Las cuatro operaciones que hay: sincronizar (sondeo automático), importar un
 * archivo CSV del extranet, convertir una entrante en reserva, y descartarla.
 *
 * Todas verifican `puedeAcceder(rol, 'canales')` en vez del literal
 * `['admin','gerencia','recepcion']`, que es lo que pide `AGENTS.md` para el
 * código nuevo. El área ya está declarada para esos tres roles en
 * `lib/domain/permisos.ts`, así que no hay dos fuentes de verdad.
 */

const DESTINO = '/panel/canales'

/** Sesión con permiso sobre el área, o afuera. */
async function exigirAcceso() {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'canales')) redirect('/panel')
  return sesion
}

/* ──────────────────────────────────────────────────── sondeo automático ──── */

/**
 * Corre el proveedor configurado y aterriza lo que traiga.
 *
 * Con `CANAL_PROVIDER=booking-ical` lee los feeds del extranet. Con el simulado no
 * trae nada, y eso es correcto: la corrida queda registrada igual, así que la
 * pantalla puede decir «se sincronizó y no había nada» en vez de dejar la duda.
 */
export async function sincronizarCanal(): Promise<void> {
  const sesion = await exigirAcceso()

  const proveedor = obtenerProveedorCanal()
  if (!proveedor.capacidades().traeReservas) {
    redirect(`${DESTINO}?error=sin_sondeo`)
  }

  let entrantes
  try {
    entrantes = await proveedor.traerReservas(new Date().toISOString())
  } catch (e) {
    // El proveedor promete no lanzar, pero si una implementación futura rompe ese
    // contrato la pantalla tiene que decirlo, no quedarse colgada.
    registrarFalla(
      { message: e instanceof Error ? e.message : String(e) },
      'sondear el canal de venta',
    )
    redirect(`${DESTINO}?error=sondeo`)
  }

  const supabase = await crearClienteServidor()
  const resumen = await guardarEntrantes(supabase, entrantes, {
    canal: 'booking',
    proveedor: proveedor.nombre,
    origen: 'sondeo',
    perfilId: sesion.userId,
  })

  revalidatePath(DESTINO)
  redirect(
    `${DESTINO}?ok=sincro&nuevas=${resumen.nuevas}&actualizadas=${resumen.actualizadas}&rechazadas=${resumen.rechazadas}`,
  )
}

/* ─────────────────────────────────────────────────────── importar CSV ──── */

export interface EstadoImportacionCsv {
  error?: string
  ok?: string
  /** Detalle de las filas que quedaron afuera, para mostrarlas una por una. */
  rechazadas?: { fila: number; motivos: string[] }[]
  advertencia?: string
}

/**
 * Importa el «Informe de reservas» descargado del extranet.
 *
 * Devuelve estado en vez de redirigir porque el resultado es **detallado**: si el
 * archivo trae 40 reservas y entraron 38, hay que poder ver las dos que faltan y
 * por qué. Eso no cabe en un `?error=` de la URL.
 *
 * Tope de tamaño: el informe de un hotel de 15 unidades no pasa de unos cientos de
 * kilobytes. El límite existe para que un archivo equivocado —un PDF, un ZIP— no
 * se lea entero en memoria antes de descubrir que no era un CSV.
 */
const MAX_BYTES = 5 * 1024 * 1024

export async function importarCsvCanal(
  _prev: EstadoImportacionCsv,
  formData: FormData,
): Promise<EstadoImportacionCsv> {
  const sesion = await exigirAcceso()

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el archivo CSV que bajaste del extranet.' }
  }
  if (archivo.size > MAX_BYTES) {
    return { error: 'El archivo es demasiado grande. ¿Seguro que es el informe de reservas?' }
  }

  const texto = await archivo.text()
  const resultado = interpretarCsvBooking(texto)

  if (resultado.faltantes.length > 0) {
    return {
      error:
        `No se reconocieron las columnas del archivo. Faltan: ${resultado.faltantes.join(', ')}. ` +
        `Bajá el informe desde Administración → Informe de reservas, sin modificarlo.`,
    }
  }

  if (resultado.reservas.length === 0 && resultado.rechazadas.length === 0) {
    return { error: 'El archivo no tiene ninguna reserva.' }
  }

  const supabase = await crearClienteServidor()
  const resumen = await guardarEntrantes(supabase, resultado.reservas, {
    canal: 'booking',
    proveedor: 'csv',
    origen: archivo.name,
    perfilId: sesion.userId,
  })

  revalidatePath(DESTINO)

  return {
    ok:
      `Se leyeron ${resultado.leidas} fila(s): ${resumen.nuevas} nueva(s), ` +
      `${resumen.actualizadas} actualizada(s), ${resumen.rechazadas + resultado.rechazadas.length} sin importar.`,
    rechazadas: resultado.rechazadas.length > 0 ? resultado.rechazadas : undefined,
    // La ambigüedad día/mes no se puede resolver mirando el archivo, así que se
    // avisa: una reserva en la fecha equivocada no la detecta nadie hasta que el
    // huésped aparece.
    advertencia:
      resultado.fechasAmbiguas > 0
        ? `${resultado.fechasAmbiguas} fecha(s) se pudieron leer de dos formas (día/mes o mes/día) ` +
          `y se interpretaron como día/mes. Revisá esas reservas antes de importarlas.`
        : undefined,
  }
}

/* ──────────────────────────────────────────────────── importar una ──── */

/** Convierte una entrante en reserva propia. */
export async function importarUna(formData: FormData): Promise<void> {
  const sesion = await exigirAcceso()

  const id = String(formData.get('entrante_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const r = await importarEntrante(supabase, id, sesion.userId)

  revalidatePath(DESTINO)
  revalidatePath('/panel/reservas')

  if (!r.ok) {
    // El motivo ya quedó escrito en la fila (`canal_reservas.motivo`), así que la
    // pantalla lo muestra en su lugar sin necesidad de pasarlo por la URL.
    redirect(`${DESTINO}?error=importar`)
  }

  redirect(
    r.aviso
      ? `${DESTINO}?ok=importada_con_aviso&codigo=${encodeURIComponent(r.codigo)}`
      : `${DESTINO}?ok=importada&codigo=${encodeURIComponent(r.codigo)}`,
  )
}

/** Descarta una entrante sin importarla (duplicada, de prueba, ya cargada a mano). */
export async function ignorarEntrante(formData: FormData): Promise<void> {
  await exigirAcceso()

  const id = String(formData.get('entrante_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_reservas')
    .update({ estado: 'ignorada', motivo: 'Descartada a mano desde el panel.' })
    .eq('id', id)

  cortarSiFalla(error, DESTINO, 'ignorar')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=ignorada`)
}

/** Vuelve una entrante a pendiente, para reintentar después de arreglar la causa. */
export async function reintentarEntrante(formData: FormData): Promise<void> {
  await exigirAcceso()

  const id = String(formData.get('entrante_id') ?? '')
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_reservas')
    .update({ estado: 'pendiente', motivo: '' })
    .eq('id', id)

  cortarSiFalla(error, DESTINO, 'reintentar')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?ok=reintentar`)
}

/* ─────────────────────────────────────────────── mensajes y reseñas ──── */

/** Marca un mensaje del huésped como atendido. */
export async function marcarMensajeAtendido(formData: FormData): Promise<void> {
  const sesion = await exigirAcceso()

  const id = String(formData.get('mensaje_id') ?? '')
  const atendido = String(formData.get('atendido') ?? '') === 'true'
  if (!id) redirect(`${DESTINO}?error=falta_id`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_mensajes')
    .update({
      atendido: !atendido,
      atendido_por: !atendido ? sesion.userId : null,
    })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=mensajes`, 'mensaje')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=mensajes`)
}

/**
 * Carga a mano un mensaje o petición que llegó por el canal.
 *
 * Es manual porque **ni el CSV ni el iCal traen los mensajes**: eso requiere la
 * API de mensajería de Booking, que va con la Connectivity API. Cargarlos a mano
 * igual sirve — un pedido de cuna sin atender termina siendo una queja en la
 * reseña, y tenerlo en el sistema es mejor que en la memoria de quien lo leyó.
 */
export async function cargarMensaje(formData: FormData): Promise<void> {
  await exigirAcceso()

  const cuerpo = String(formData.get('cuerpo') ?? '').trim()
  if (!cuerpo) redirect(`${DESTINO}?vista=mensajes&error=cuerpo`)

  const entranteId = String(formData.get('entrante_id') ?? '')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_mensajes').insert({
    canal: 'booking',
    cuerpo,
    autor: 'huesped',
    canal_reserva_id: entranteId || null,
  })

  cortarSiFalla(error, `${DESTINO}?vista=mensajes`, 'mensaje')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=mensajes&ok=mensaje`)
}

/** Carga a mano una reseña publicada en el canal. */
export async function cargarResena(formData: FormData): Promise<void> {
  await exigirAcceso()

  const autor = String(formData.get('autor') ?? '').trim()
  const puntajeCrudo = Number(formData.get('puntaje'))
  const positivo = String(formData.get('positivo') ?? '').trim()
  const negativo = String(formData.get('negativo') ?? '').trim()

  // Booking puntúa de 1 a 10. Un valor fuera de rango lo rechaza el `check` de la
  // base, pero se corta antes para poder explicarlo en español.
  if (!Number.isFinite(puntajeCrudo) || puntajeCrudo < 0 || puntajeCrudo > 10) {
    redirect(`${DESTINO}?vista=resenas&error=puntaje`)
  }
  if (!positivo && !negativo) {
    redirect(`${DESTINO}?vista=resenas&error=resena_vacia`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_resenas').insert({
    canal: 'booking',
    autor: autor || 'Anónimo',
    puntaje: puntajeCrudo,
    positivo,
    negativo,
    publicada_en: String(formData.get('publicada_en') ?? '') || null,
  })

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'resena')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=resena`)
}

/** Guarda la respuesta del hotel a una reseña. */
export async function responderResena(formData: FormData): Promise<void> {
  await exigirAcceso()

  const id = String(formData.get('resena_id') ?? '')
  const respuesta = String(formData.get('respuesta') ?? '').trim()
  if (!id) redirect(`${DESTINO}?error=falta_id`)
  if (!respuesta) redirect(`${DESTINO}?vista=resenas&error=respuesta_vacia`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_resenas')
    .update({ respuesta, respondida: true })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'respuesta')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=respuesta`)
}
