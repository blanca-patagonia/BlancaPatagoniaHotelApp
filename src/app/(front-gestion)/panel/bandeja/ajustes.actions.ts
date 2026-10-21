'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requerirRol } from '@/lib/auth/session'
import {
  borrarEtiquetaBandeja,
  borrarRespuestaGuardada,
  guardarEtiquetaBandeja,
  guardarRespuestaGuardada,
} from '@/lib/bandeja/gestion'
import { cortarSiFalla, mensajeDeFalla } from '@/lib/acciones'
import { atajoValido, TONOS_ETIQUETA } from '@/lib/domain/bandeja'
import { deLista } from '@/lib/domain/listas'

/**
 * Ajustes de la bandeja: respuestas guardadas y etiquetas.
 *
 * Más estrecho que el área a propósito (`requerirRol`, no `requerirAcceso`):
 * recepción USA las respuestas y las etiquetas, pero las define la dirección,
 * igual que la política RLS de la 0125. Un texto que sale a nombre del hotel
 * a todos los huéspedes es una decisión de la dirección.
 */

export interface EstadoAjuste {
  error?: string
  ok?: boolean
  valores?: Record<string, string>
}

function uuid(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim()
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null
}

// ── Respuestas guardadas ────────────────────────────────────────────────────

export async function guardarRespuesta(_prev: EstadoAjuste, formData: FormData): Promise<EstadoAjuste> {
  await requerirRol('admin', 'gerencia')
  const id = uuid(formData.get('id'))
  const atajo = String(formData.get('atajo') ?? '').trim().toLowerCase().replace(/^\//, '')
  const contenido = String(formData.get('contenido') ?? '').trim()
  const valores = { atajo, contenido }

  if (!atajoValido(atajo)) {
    return { error: 'El atajo va de 2 a 30 letras minúsculas, números, guiones o guiones bajos, sin espacios.', valores }
  }
  if (!contenido) return { error: 'Escribí el texto de la respuesta.', valores }
  if (contenido.length > 2000) return { error: 'La respuesta es demasiado larga (máximo 2000 caracteres).', valores }

  const error = await guardarRespuestaGuardada(id, { atajo, contenido })
  if (error) {
    return {
      error: error.code === '23505' ? `Ya hay una respuesta con el atajo /${atajo}.` : mensajeDeFalla(error, 'bandeja:respuesta', 'guardar la respuesta'),
      valores,
    }
  }
  revalidatePath('/panel/bandeja/respuestas')
  return { ok: true, valores: id ? valores : undefined }
}

export async function borrarRespuesta(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')
  const id = uuid(formData.get('id'))
  if (!id) return
  cortarSiFalla(await borrarRespuestaGuardada(id), '/panel/bandeja/respuestas', 'borrar')
  revalidatePath('/panel/bandeja/respuestas')
  redirect('/panel/bandeja/respuestas?ok=borrada')
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

export async function guardarEtiqueta(_prev: EstadoAjuste, formData: FormData): Promise<EstadoAjuste> {
  await requerirRol('admin', 'gerencia')
  const id = uuid(formData.get('id'))
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 40)
  const color = deLista(TONOS_ETIQUETA, String(formData.get('color'))) ?? 'lago'
  const valores = { nombre, color }

  if (!nombre) return { error: 'Escribí el nombre de la etiqueta.', valores }

  const error = await guardarEtiquetaBandeja(id, { nombre, color })
  if (error) {
    return {
      error: error.code === '23505' ? `Ya hay una etiqueta «${nombre}».` : mensajeDeFalla(error, 'bandeja:etiqueta', 'guardar la etiqueta'),
      valores,
    }
  }
  revalidatePath('/panel/bandeja/etiquetas')
  revalidatePath('/panel/bandeja')
  return { ok: true, valores: id ? valores : undefined }
}

export async function borrarEtiqueta(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')
  const id = uuid(formData.get('id'))
  if (!id) return
  cortarSiFalla(await borrarEtiquetaBandeja(id), '/panel/bandeja/etiquetas', 'borrar')
  revalidatePath('/panel/bandeja/etiquetas')
  revalidatePath('/panel/bandeja')
  redirect('/panel/bandeja/etiquetas?ok=borrada')
}
