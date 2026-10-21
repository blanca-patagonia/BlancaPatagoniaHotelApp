'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { responderConversacion } from '@/lib/bandeja/responder'
import {
  actualizarContacto,
  actualizarConversacion,
  marcarConversacionLeida,
  perfilAsignable,
  ponerEtiqueta,
  registrarActividad,
  sacarEtiqueta,
} from '@/lib/bandeja/gestion'
import {
  ETIQUETAS_ESTADO,
  ETIQUETAS_POSPONER,
  ETIQUETAS_PRIORIDAD,
  OPCIONES_POSPONER,
  PRIORIDADES,
  pospuestaHasta,
} from '@/lib/domain/bandeja'
import { deLista } from '@/lib/domain/listas'

/**
 * Acciones de la bandeja de mensajes (ADR 0043).
 *
 * Todas pasan por `requerirAcceso('bandeja')` —admin, gerencia y recepción— y
 * escriben por `lib/bandeja/gestion.ts` con el cliente del usuario: RLS
 * (migración 0125) es la segunda barrera y la que deja cada mensaje a nombre de
 * quien lo escribió.
 *
 * Los cambios de estado, asignación y prioridad dejan un renglón de ACTIVIDAD
 * en el hilo, como Chatwoot: «Laura marcó la conversación como resuelta». Sin
 * eso, una conversación que se reabre no explica quién la había cerrado.
 */

const RUTA = '/panel/bandeja'
const destino = (id: string) => `${RUTA}?c=${encodeURIComponent(id)}`

/** Uuid o nada: lo que llega del formulario no se usa sin validar. */
function uuid(valor: FormDataEntryValue | null): string | null {
  const v = String(valor ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null
}

// ── Responder y notas ───────────────────────────────────────────────────────

export interface EstadoRespuesta {
  error?: string
  ok?: boolean
  aviso?: string
  /** Cambia con cada envío exitoso: el formulario lo usa para vaciarse. */
  envio?: number
}

export async function responder(_prev: EstadoRespuesta, formData: FormData): Promise<EstadoRespuesta> {
  const sesion = await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  if (!id) return { error: 'Falta la conversación.' }
  const modo = formData.get('modo') === 'nota' ? 'nota' : 'respuesta'

  const r = await responderConversacion(sesion.userId, id, String(formData.get('texto') ?? ''), modo)
  revalidatePath(RUTA)
  if ('error' in r) return { error: r.error }
  return { ok: true, aviso: r.aviso, envio: Date.now() }
}

// ── Estado, posponer, asignación, prioridad ─────────────────────────────────

export async function cambiarEstado(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  const estado = deLista(['abierta', 'pendiente', 'resuelta'] as const, String(formData.get('estado')))
  if (!id || !estado) return

  const error = await actualizarConversacion(id, {
    estado,
    pospuesta_hasta: null,
    ...(estado === 'resuelta' ? { esperando_desde: null } : {}),
  })
  cortarSiFalla(error, destino(id), 'estado')

  await registrarActividad(id, sesion.userId, `${sesion.nombre} la marcó como ${ETIQUETAS_ESTADO[estado].toLowerCase()}.`)
  revalidatePath(RUTA)
}

export async function posponer(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  const opcion = deLista(OPCIONES_POSPONER, String(formData.get('opcion')))
  if (!id || !opcion) return

  const error = await actualizarConversacion(id, { estado: 'pospuesta', pospuesta_hasta: pospuestaHasta(opcion).toISOString() })
  cortarSiFalla(error, destino(id), 'posponer')

  await registrarActividad(id, sesion.userId, `${sesion.nombre} la pospuso: ${ETIQUETAS_POSPONER[opcion].toLowerCase()}.`)
  revalidatePath(RUTA)
}

export async function asignar(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  if (!id) return
  const crudo = String(formData.get('perfil_id') ?? '')
  const perfilId = crudo === 'yo' ? sesion.userId : uuid(crudo)

  let nombre = 'nadie'
  if (perfilId) {
    // Sólo a quien atiende la bandeja: asignarle una conversación a alguien de
    // housekeeping sería mandarla a una persona que no la puede ver.
    const { perfil, error } = await perfilAsignable(perfilId)
    cortarSiFalla(error, destino(id), 'asignar')
    if (!perfil) redirect(`${destino(id)}&error=asignar_perfil`)
    nombre = perfil.nombre
  }

  const error = await actualizarConversacion(id, { asignada_a: perfilId })
  cortarSiFalla(error, destino(id), 'asignar')

  await registrarActividad(
    id,
    sesion.userId,
    perfilId
      ? `${sesion.nombre} la asignó a ${perfilId === sesion.userId ? 'sí mismo/a' : nombre}.`
      : `${sesion.nombre} la dejó sin asignar.`,
  )
  revalidatePath(RUTA)
}

export async function cambiarPrioridad(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  if (!id) return
  const prioridad = deLista(PRIORIDADES, String(formData.get('prioridad'))) ?? null

  const error = await actualizarConversacion(id, { prioridad })
  cortarSiFalla(error, destino(id), 'prioridad')

  await registrarActividad(
    id,
    sesion.userId,
    prioridad
      ? `${sesion.nombre} puso la prioridad en ${ETIQUETAS_PRIORIDAD[prioridad].toLowerCase()}.`
      : `${sesion.nombre} le quitó la prioridad.`,
  )
  revalidatePath(RUTA)
}

/**
 * Pone en cero los no leídos al abrir la conversación. La llama la pantalla, no
 * un formulario: abrir es leer.
 */
export async function marcarLeida(conversacionId: string): Promise<void> {
  await requerirAcceso('bandeja')
  const id = uuid(conversacionId)
  if (!id) return
  await marcarConversacionLeida(id)
  revalidatePath(RUTA)
}

// ── Etiquetas de la conversación ────────────────────────────────────────────

export async function etiquetar(formData: FormData): Promise<void> {
  await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  const etiqueta = uuid(formData.get('etiqueta_id'))
  if (!id || !etiqueta) return
  cortarSiFalla(await ponerEtiqueta(id, etiqueta), destino(id), 'etiqueta')
  revalidatePath(RUTA)
}

export async function quitarEtiqueta(formData: FormData): Promise<void> {
  await requerirAcceso('bandeja')
  const id = uuid(formData.get('conversacion_id'))
  const etiqueta = uuid(formData.get('etiqueta_id'))
  if (!id || !etiqueta) return
  cortarSiFalla(await sacarEtiqueta(id, etiqueta), destino(id), 'etiqueta')
  revalidatePath(RUTA)
}

// ── Contacto ────────────────────────────────────────────────────────────────

export interface EstadoContacto {
  error?: string
  ok?: boolean
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function guardarContacto(_prev: EstadoContacto, formData: FormData): Promise<EstadoContacto> {
  await requerirAcceso('bandeja')
  const id = uuid(formData.get('contacto_id'))
  if (!id) return { error: 'Falta el contacto.' }

  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
  const email = String(formData.get('email') ?? '').trim().toLowerCase() || null
  const telefono = String(formData.get('telefono') ?? '').trim().slice(0, 40) || null
  const notas = String(formData.get('notas') ?? '').trim().slice(0, 2000) || null
  if (email && !RE_EMAIL.test(email)) return { error: 'El email no tiene un formato válido.' }

  const error = await actualizarContacto(id, { nombre, email, telefono, notas })
  if (error) {
    registrarFalla(error, 'bandeja:contacto')
    return { error: 'No se pudo guardar el contacto. Probá de nuevo.' }
  }
  revalidatePath(RUTA)
  return { ok: true }
}

export async function vincularHuesped(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('bandeja')
  const contacto = uuid(formData.get('contacto_id'))
  const conversacion = uuid(formData.get('conversacion_id'))
  const huesped = formData.get('huesped_id') === '' ? null : uuid(formData.get('huesped_id'))
  if (!contacto || !conversacion) return

  cortarSiFalla(await actualizarContacto(contacto, { huesped_id: huesped }), destino(conversacion), 'vincular')

  await registrarActividad(
    conversacion,
    sesion.userId,
    huesped
      ? `${sesion.nombre} vinculó el contacto a una ficha de huésped.`
      : `${sesion.nombre} desvinculó el contacto de la ficha de huésped.`,
  )
  revalidatePath(RUTA)
}

export async function vincularReserva(formData: FormData): Promise<void> {
  await requerirAcceso('bandeja')
  const conversacion = uuid(formData.get('conversacion_id'))
  if (!conversacion) return
  const reserva = formData.get('reserva_id') === '' ? null : uuid(formData.get('reserva_id'))

  cortarSiFalla(await actualizarConversacion(conversacion, { reserva_id: reserva }), destino(conversacion), 'reserva')
  revalidatePath(RUTA)
}

export async function bloquearContacto(formData: FormData): Promise<void> {
  const sesion = await requerirAcceso('bandeja')
  const contacto = uuid(formData.get('contacto_id'))
  const conversacion = uuid(formData.get('conversacion_id'))
  if (!contacto || !conversacion) return
  const bloquear = formData.get('bloquear') === '1'

  cortarSiFalla(await actualizarContacto(contacto, { bloqueado: bloquear }), destino(conversacion), 'bloquear')

  if (bloquear) {
    // Bloquear también cierra: no tiene sentido que quede esperando respuesta.
    registrarFalla(
      await actualizarConversacion(conversacion, { estado: 'resuelta', esperando_desde: null }),
      'bandeja:bloquear:resolver',
    )
  }
  await registrarActividad(
    conversacion,
    sesion.userId,
    bloquear
      ? `${sesion.nombre} bloqueó al contacto: sus mensajes nuevos no van a entrar.`
      : `${sesion.nombre} desbloqueó al contacto.`,
  )
  revalidatePath(RUTA)
}
