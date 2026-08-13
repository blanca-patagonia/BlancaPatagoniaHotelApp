'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { puedeAvanzar, type EtapaComercial } from '@/lib/domain/comercial'
import { TIPOS_CUENTA } from '@/lib/domain/cuentas'
import { cortarSiFalla } from '@/lib/acciones'

export interface EstadoAgencia {
  error?: string
  ok?: string
  /** Id de la cuenta recién creada, para ofrecer el enlace a su ficha. */
  id?: string
}

export async function crearAgencia(
  _prev: EstadoAgencia,
  formData: FormData,
): Promise<EstadoAgencia> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const nombre = String(formData.get('nombre') ?? '').trim()
  const tipo = String(formData.get('tipo') ?? 'agencia')
  const cuit = String(formData.get('cuit') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const descuento = Math.min(100, Math.max(0, Number(formData.get('descuento_pct') ?? 0) || 0))

  if (!nombre) return { error: 'Ingresá el nombre.' }
  if (!(TIPOS_CUENTA as readonly string[]).includes(tipo)) return { error: 'Tipo inválido.' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('agencias')
    .insert({ nombre, tipo, cuit: cuit || null, email: email || null, descuento_pct: descuento })
    .select('id')
    .single()
  if (error) return { error: `No se pudo crear: ${error.message}` }
  revalidatePath('/panel/agencias')
  return { ok: `Se registró ${nombre}.`, id: (data as { id: string } | null)?.id }
}

export async function registrarMovimiento(formData: FormData): Promise<void> {
  const agenciaId = String(formData.get('agencia_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const monto = Number(formData.get('monto') ?? 0)
  const concepto = String(formData.get('concepto') ?? '').trim()
  if (!agenciaId || !['cargo', 'pago'].includes(tipo) || !(monto > 0)) {
    redirect(`/panel/agencias/${agenciaId}`)
  }
  const supabase = await crearClienteServidor()
  // Un movimiento de cuenta corriente que no se registra y no avisa descuadra el
  // saldo de la agencia sin que nadie lo note.
  const { error } = await supabase.from('movimientos_cuenta').insert({
    agencia_id: agenciaId,
    tipo,
    monto,
    concepto,
  })
  cortarSiFalla(error, `/panel/agencias/${agenciaId}`, 'movimiento')
  redirect(`/panel/agencias/${agenciaId}`)
}

/**
 * Mueve una agencia de etapa en el embudo comercial.
 *
 * La transición se valida contra el dominio puro (`puedeAvanzar`), que es el
 * mismo que testea Vitest: no se puede saltear de «contacto» a «activa».
 */
export async function cambiarEtapaAgencia(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const id = String(formData.get('agencia_id') ?? '')
  const nueva = String(formData.get('etapa') ?? '') as EtapaComercial
  if (!id) redirect('/panel/agencias')

  const supabase = await crearClienteServidor()
  const { data: agencia } = await supabase
    .from('agencias')
    .select('etapa')
    .eq('id', id)
    .single()

  if (!agencia) redirect('/panel/agencias')
  if (!puedeAvanzar(agencia.etapa as EtapaComercial, nueva)) {
    redirect('/panel/agencias?error=etapa')
  }

  const { error } = await supabase.from('agencias').update({ etapa: nueva }).eq('id', id)
  cortarSiFalla(error, '/panel/agencias', 'etapa_guardar')
  revalidatePath('/panel/agencias')
  redirect('/panel/agencias?ok=etapa')
}

/** Actualiza los datos de la agencia (incluida su condición frente al IVA). */
export async function actualizarAgencia(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const id = String(formData.get('agencia_id') ?? '')
  const descuento = Number(formData.get('descuento_pct'))
  if (!id) redirect('/panel/agencias')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('agencias')
    .update({
      nombre: String(formData.get('nombre') ?? '').trim(),
      cuit: String(formData.get('cuit') ?? '').trim() || null,
      email: String(formData.get('email') ?? '').trim() || null,
      telefono: String(formData.get('telefono') ?? '').trim() || null,
      condicion_iva: String(formData.get('condicion_iva') ?? 'responsable_inscripto'),
      descuento_pct: Number.isFinite(descuento) ? Math.min(100, Math.max(0, descuento)) : 0,
    })
    .eq('id', id)
  cortarSiFalla(error, `/panel/agencias/${id}`, 'datos')

  revalidatePath(`/panel/agencias/${id}`)
  redirect(`/panel/agencias/${id}?ok=datos`)
}

/**
 * Activa o desactiva la cuenta. No se borra: los movimientos y las reservas
 * históricas siguen apuntando a ella.
 */
export async function alternarActivoAgencia(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')

  const id = String(formData.get('agencia_id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  if (id) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('agencias').update({ activo: !activo }).eq('id', id)
    cortarSiFalla(error, `/panel/agencias/${id}`, 'activo')
  }
  revalidatePath('/panel/agencias')
  redirect(`/panel/agencias/${id}`)
}
