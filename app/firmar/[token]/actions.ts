'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { hoyISO } from '@/lib/fechas'
import { motivoNoFirmable, type EstadoContrato } from '@/lib/domain/contratos'
import { obtenerProveedorFirma } from '@/lib/firma'
import { ipDeCabeceras } from '@/lib/limites'
import { cortarSiFalla } from '@/lib/acciones'

/**
 * Acciones de la vista pública de firma.
 *
 * Quien las ejecuta NO tiene cuenta: el token opaco de la URL es la credencial,
 * igual que en la confirmación de reserva. Por eso se resuelve con
 * `service_role` desde el servidor y **nunca** se expone lectura a `anon`.
 */

async function contratoPorToken(token: string) {
  const admin = crearClienteAdmin()
  const { data } = await admin
    .from('firmas')
    .select('id, contrato_id, fecha_firma, contrato:contratos(id, estado, contenido, vigencia_hasta)')
    .eq('token', token)
    .maybeSingle()
  return data as {
    id: string
    contrato_id: string
    fecha_firma: string | null
    contrato: {
      id: string
      estado: EstadoContrato
      contenido: string | null
      vigencia_hasta: string | null
    } | null
  } | null
}

export async function firmarContrato(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const nombre = String(formData.get('firmante_nombre') ?? '').trim()
  if (!token) redirect('/')
  if (!nombre) redirect(`/firmar/${token}?error=nombre`)

  const registro = await contratoPorToken(token)
  if (!registro?.contrato) redirect(`/firmar/${token}?error=invalido`)

  // La regla vive en el dominio puro: la misma que testea Vitest y la misma que
  // usa la vista para decidir si muestra el formulario.
  const motivo = motivoNoFirmable(registro.contrato, hoyISO())
  if (motivo) redirect(`/firmar/${token}?error=${motivo}`)

  const cabeceras = await headers()
  const proveedor = obtenerProveedorFirma()
  const constancia = await proveedor.registrarFirma(registro.contrato.contenido ?? '', {
    ip: ipDeCabeceras(cabeceras),
    userAgent: cabeceras.get('user-agent'),
  })

  const admin = crearClienteAdmin()
  // Las dos escrituras que siguen tienen que fallar cerrado, y en este orden.
  // Si se guardara el estado «firmado» sin haber guardado la constancia, el
  // contrato quedaría firmado sin evidencia; y si se guarda la constancia pero
  // no el estado, el huésped ve «listo» con el contrato sin firmar. `cortarSiFalla`
  // lanza, así que la segunda no corre si la primera falló.
  const { error: eFirma } = await admin
    .from('firmas')
    .update({
      firmante_nombre: nombre,
      hash_documento: constancia.hashDocumento,
      ip: constancia.ip,
      user_agent: constancia.userAgent,
      fecha_firma: constancia.fecha.toISOString(),
    })
    .eq('id', registro.id)
  cortarSiFalla(eFirma, `/firmar/${token}`, 'firma')

  const { error: eEstado } = await admin
    .from('contratos')
    .update({ estado: 'firmado', fecha_firma: constancia.fecha.toISOString() })
    .eq('id', registro.contrato.id)
  cortarSiFalla(eEstado, `/firmar/${token}`, 'firma')

  redirect(`/firmar/${token}?ok=1`)
}

export async function rechazarContrato(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  if (!token) redirect('/')

  const registro = await contratoPorToken(token)
  if (!registro?.contrato) redirect(`/firmar/${token}?error=invalido`)
  if (registro.contrato.estado !== 'enviado') redirect(`/firmar/${token}`)

  const admin = crearClienteAdmin()
  const { error } = await admin
    .from('contratos')
    .update({ estado: 'rechazado' })
    .eq('id', registro.contrato.id)
  cortarSiFalla(error, `/firmar/${token}`, 'rechazo')
  redirect(`/firmar/${token}?rechazado=1`)
}
