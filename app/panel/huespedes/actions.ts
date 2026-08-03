'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { CONDICIONES_IVA, cuitValido, type CondicionIva } from '@/lib/domain/facturacion'

export interface EstadoHuesped {
  error?: string
  ok?: string
}

const DOCS = ['DNI', 'Pasaporte', 'CUIT', 'CUIL', 'LC', 'LE']

async function exigirAcceso() {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')
  return sesion
}

/** Campos comunes al alta y a la edición. */
function leerCampos(formData: FormData) {
  const docTipo = String(formData.get('doc_tipo') ?? 'DNI')
  return {
    apellido: String(formData.get('apellido') ?? '').trim(),
    nombre: String(formData.get('nombre') ?? '').trim(),
    doc_tipo: DOCS.includes(docTipo) ? docTipo : 'DNI',
    doc_numero: String(formData.get('doc_numero') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim() || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    nacionalidad: String(formData.get('nacionalidad') ?? '').trim() || null,
    condicion_iva: String(formData.get('condicion_iva') ?? 'consumidor_final') as CondicionIva,
    notas: String(formData.get('notas') ?? '').trim(),
  }
}

/**
 * Valida lo que comparten alta y edición.
 *
 * El CUIT se verifica de verdad porque de la condición frente al IVA depende la
 * letra del comprobante: una factura A con CUIT inválido la rechaza AFIP.
 */
function validar(c: ReturnType<typeof leerCampos>): string | null {
  if (!c.apellido) return 'Ingresá el apellido.'
  if (!c.nombre) return 'Ingresá el nombre.'
  if (!CONDICIONES_IVA.includes(c.condicion_iva)) return 'Elegí una condición frente al IVA.'
  if (c.condicion_iva === 'responsable_inscripto') {
    if (c.doc_tipo !== 'CUIT') {
      return 'Un responsable inscripto se identifica con CUIT: cambiá el tipo de documento.'
    }
    if (!cuitValido(c.doc_numero)) return 'El CUIT no es válido (revisá el dígito verificador).'
  }
  return null
}

export async function crearHuesped(
  _prev: EstadoHuesped,
  formData: FormData,
): Promise<EstadoHuesped> {
  await exigirAcceso()
  const campos = leerCampos(formData)
  const error = validar(campos)
  if (error) return { error }

  const supabase = await crearClienteServidor()

  // Evita duplicar por email, que es como el alta desde el portal identifica al
  // huésped que vuelve.
  if (campos.email) {
    const { data: existente } = await supabase
      .from('huespedes')
      .select('id')
      .eq('email', campos.email)
      .maybeSingle()
    if (existente) return { error: 'Ya hay un huésped con ese email.' }
  }

  const { error: e } = await supabase.from('huespedes').insert(campos)
  if (e) return { error: `No se pudo crear: ${e.message}` }

  revalidatePath('/panel/huespedes')
  return { ok: `Huésped ${campos.apellido}, ${campos.nombre} creado.` }
}

export async function actualizarHuesped(
  _prev: EstadoHuesped,
  formData: FormData,
): Promise<EstadoHuesped> {
  await exigirAcceso()
  const id = String(formData.get('huesped_id') ?? '')
  if (!id) return { error: 'Falta el huésped.' }

  const campos = leerCampos(formData)
  const error = validar(campos)
  if (error) return { error }

  const supabase = await crearClienteServidor()
  const { error: e } = await supabase.from('huespedes').update(campos).eq('id', id)
  if (e) return { error: `No se pudo guardar: ${e.message}` }

  revalidatePath(`/panel/huespedes/${id}`)
  return { ok: 'Datos actualizados.' }
}
