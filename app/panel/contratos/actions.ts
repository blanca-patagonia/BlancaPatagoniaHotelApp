'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerSesion } from '@/lib/auth/session'
import { hoyISO } from '@/lib/fechas'
import {
  puedeEnviar,
  puedeTransicionar,
  TIPOS_CONTRATO,
  type EstadoContrato,
  type TipoContrato,
} from '@/lib/domain/contratos'
import { obtenerProveedorFirma } from '@/lib/firma'
import { cortarSiFalla } from '@/lib/acciones'

export interface EstadoContratoForm {
  error?: string
  ok?: string
  /** Id del borrador recién creado, para ofrecer el enlace directo. */
  id?: string
}

/** Los contratos los gestionan solo admin y gerencia (RLS lo repite en la base). */
async function exigirGestion() {
  const sesion = await obtenerSesion()
  if (!sesion || !['admin', 'gerencia'].includes(sesion.rol)) redirect('/panel')
  return sesion
}

export async function crearContrato(
  _prev: EstadoContratoForm,
  formData: FormData,
): Promise<EstadoContratoForm> {
  const sesion = await exigirGestion()

  const titulo = String(formData.get('titulo') ?? '').trim()
  const contenido = String(formData.get('contenido') ?? '').trim()
  const vigenciaDesde = String(formData.get('vigencia_desde') ?? '')
  const vigenciaHasta = String(formData.get('vigencia_hasta') ?? '')

  // El selector combina tipo y entidad en un solo valor (`agencia:<uuid>`) para
  // que el formulario funcione sin JavaScript en el cliente.
  const [tipoCrudo, entidadId] = String(formData.get('entidad') ?? '').split(':')
  const tipo = tipoCrudo as TipoContrato

  if (!titulo) return { error: 'Ingresá un título para el contrato.' }
  if (!TIPOS_CONTRATO.includes(tipo) || !entidadId) {
    return { error: 'Elegí con quién se firma el contrato.' }
  }
  if (!contenido) return { error: 'Escribí el texto del contrato.' }
  if (vigenciaDesde && vigenciaHasta && vigenciaHasta < vigenciaDesde) {
    return { error: 'La vigencia no puede terminar antes de empezar.' }
  }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('contratos')
    .insert({
      tipo,
      entidad_id: entidadId,
      titulo,
      contenido,
      vigencia_desde: vigenciaDesde || null,
      vigencia_hasta: vigenciaHasta || null,
      creado_por: sesion.userId,
    })
    .select('id')
    .single()
  if (error) return { error: `No se pudo crear: ${error.message}` }

  revalidatePath('/panel/contratos')
  return {
    ok: `Se guardó «${titulo}» como borrador.`,
    id: (data as { id: string } | null)?.id,
  }
}

/**
 * Envía el contrato a firmar: crea la invitación con su token y pasa el estado
 * a `enviado`.
 *
 * La regla «no se puede reenviar uno ya firmado» se evalúa con el dominio puro,
 * no acá, para que sea la misma que testea Vitest.
 */
export async function enviarAFirmar(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('contrato_id') ?? '')
  if (!id) redirect('/panel/contratos')

  const supabase = await crearClienteServidor()
  const { data: contrato } = await supabase
    .from('contratos')
    .select('id, titulo, estado')
    .eq('id', id)
    .single()

  if (!contrato) redirect('/panel/contratos')
  if (!puedeEnviar(contrato.estado as EstadoContrato)) {
    redirect(`/panel/contratos/${id}?error=no_enviable`)
  }

  /*
    La base genera el token (`gen_random_uuid()`); el proveedor arma la URL.

    Va por `crearClienteAdmin` porque desde la migración 0060 `firmas.token` no
    es legible con el cliente del usuario: es la credencial que permite firmar el
    contrato. El `insert` lo hace el mismo cliente para poder devolverlo en el
    `select` de la misma sentencia; la autorización ya la impuso el
    `requerirAcceso` de arriba.
  */
  const { data: firma, error: errorFirma } = await crearClienteAdmin()
    .from('firmas')
    .insert({
      contrato_id: id,
      firmante_nombre: String(formData.get('firmante_nombre') ?? '').trim() || null,
      firmante_email: String(formData.get('firmante_email') ?? '').trim() || null,
    })
    .select('token')
    .single()

  if (errorFirma || !firma) redirect(`/panel/contratos/${id}?error=envio`)

  const { error } = await supabase
    .from('contratos')
    .update({ estado: 'enviado', fecha_envio: new Date().toISOString() })
    .eq('id', id)

  if (error) redirect(`/panel/contratos/${id}?error=envio`)

  revalidatePath(`/panel/contratos/${id}`)
  redirect(`/panel/contratos/${id}?ok=enviado`)
}

/** Cambia el estado del contrato validando la transición contra el dominio. */
export async function cambiarEstadoContrato(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('contrato_id') ?? '')
  const nuevo = String(formData.get('estado') ?? '') as EstadoContrato
  if (!id) redirect('/panel/contratos')

  const supabase = await crearClienteServidor()
  const { data: contrato } = await supabase
    .from('contratos')
    .select('estado')
    .eq('id', id)
    .single()

  if (!contrato) redirect('/panel/contratos')
  if (!puedeTransicionar(contrato.estado as EstadoContrato, nuevo)) {
    redirect(`/panel/contratos/${id}?error=transicion`)
  }

  const { error: eEstado } = await supabase.from('contratos').update({ estado: nuevo }).eq('id', id)
  cortarSiFalla(eEstado, `/panel/contratos/${id}`, 'estado')
  revalidatePath(`/panel/contratos/${id}`)
  redirect(`/panel/contratos/${id}`)
}

/**
 * Marca como vencidos los contratos enviados cuya vigencia ya terminó.
 *
 * Es el equivalente de `expirar_reservas_pendientes` para contratos: por ahora
 * se dispara a mano desde el panel; en producción iría por cron.
 */
export async function vencerContratos(): Promise<void> {
  await exigirGestion()
  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('contratos')
    .update({ estado: 'vencido' })
    .eq('estado', 'enviado')
    .not('vigencia_hasta', 'is', null)
    .lt('vigencia_hasta', hoyISO())
  // Sin esto, «se marcaron los vencidos» se mostraba igual sin haber marcado
  // ninguno, y el listado seguía ofreciendo contratos como vigentes.
  cortarSiFalla(error, '/panel/contratos', 'vencer')

  revalidatePath('/panel/contratos')
  redirect('/panel/contratos?ok=vencidos')
}

/** Verifica que el texto actual del contrato siga coincidiendo con lo firmado. */
export async function verificarIntegridad(formData: FormData): Promise<void> {
  await exigirGestion()
  const id = String(formData.get('contrato_id') ?? '')
  if (!id) redirect('/panel/contratos')

  const supabase = await crearClienteServidor()
  const [{ data: contrato }, { data: firma }] = await Promise.all([
    supabase.from('contratos').select('contenido').eq('id', id).single(),
    supabase
      .from('firmas')
      .select('hash_documento')
      .eq('contrato_id', id)
      .not('hash_documento', 'is', null)
      .maybeSingle(),
  ])

  if (!contrato || !firma?.hash_documento) {
    redirect(`/panel/contratos/${id}?error=sin_firma`)
  }

  const proveedor = obtenerProveedorFirma()
  const intacto = await proveedor.verificarIntegridad(
    contrato.contenido ?? '',
    firma.hash_documento,
  )
  redirect(`/panel/contratos/${id}?ok=${intacto ? 'integro' : 'alterado'}`)
}
