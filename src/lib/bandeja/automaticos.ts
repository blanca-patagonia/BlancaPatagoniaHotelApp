import 'server-only'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarFalla } from '@/lib/acciones'
import {
  aplicarVariables,
  mensajeAutomatico,
  primerNombre,
  type CanalBandeja,
  type ConfigAutomatica,
} from '@/lib/domain/bandeja'
import { enviarPorCanal, puedeEnviar } from './canales'

/**
 * Saludo y mensaje fuera de horario (ADR 0044; en Chatwoot, greeting y
 * out-of-office por bandeja).
 *
 * Se llama DESPUÉS de guardar el mensaje del huésped y **nunca hace fallar el
 * webhook**: es accesorio. Un saludo que no sale no justifica que Meta reintente
 * un mensaje que ya está guardado.
 *
 * El mensaje se guarda con `automatico = true`: no cuenta como la respuesta de
 * una persona, así que el huésped sigue figurando como «esperando» y la lista
 * lo marca en rojo (migración 0127).
 */

interface FilaBandeja {
  saludo_activo: boolean
  saludo_mensaje: string
  fuera_horario_activo: boolean
  fuera_horario_mensaje: string
  horario_desde: string
  horario_hasta: string
  dias_atencion: number[]
}

export function configDeFila(f: FilaBandeja): ConfigAutomatica {
  return {
    saludoActivo: f.saludo_activo,
    saludoMensaje: f.saludo_mensaje,
    fueraHorarioActivo: f.fuera_horario_activo,
    fueraHorarioMensaje: f.fuera_horario_mensaje,
    horario: { desde: f.horario_desde, hasta: f.horario_hasta, dias: f.dias_atencion },
  }
}

export interface DatosEntrada {
  canal: CanalBandeja
  externoContacto: string
  email?: string
  asunto?: string
  conversacionId: string
  contactoId: string
  nueva: boolean
  primeraVez: boolean
}

export async function enviarMensajeAutomatico(e: DatosEntrada): Promise<void> {
  try {
    const admin = crearClienteAdmin()
    const { data: bandeja, error } = await admin
      .from('crm_bandejas')
      .select('saludo_activo, saludo_mensaje, fuera_horario_activo, fuera_horario_mensaje, horario_desde, horario_hasta, dias_atencion')
      .eq('canal', e.canal)
      .maybeSingle<FilaBandeja>()
    if (error || !bandeja) {
      registrarFalla(error, 'bandeja:automatico:config')
      return
    }

    const decision = mensajeAutomatico({
      config: configDeFila(bandeja),
      esConversacionNueva: e.nueva,
      esPrimeraVez: e.primeraVez,
      remitenteEmail: e.email ?? (e.canal === 'email' ? e.externoContacto : null),
    })
    if (!decision) return

    // Un canal de Meta sin claves no puede mandar: no se guarda un «enviado» que no salió.
    if (e.canal !== 'web' && !puedeEnviar(e.canal)) return

    const { data: contacto, error: eContacto } = await admin
      .from('crm_contactos')
      .select('nombre')
      .eq('id', e.contactoId)
      .maybeSingle<{ nombre: string }>()
    registrarFalla(eContacto, 'bandeja:automatico:contacto')

    const texto = aplicarVariables(decision.texto, {
      nombre: primerNombre(contacto?.nombre),
      nombre_completo: contacto?.nombre ?? '',
      agente: 'Recepción',
    })
    if (!texto.trim()) return

    const envio =
      e.canal === 'web'
        ? { ok: true as const, externoId: undefined }
        : await enviarPorCanal(e.canal, { externoContacto: e.externoContacto, asunto: e.asunto ?? null }, texto)

    const { error: eIns } = await admin.from('crm_mensajes').insert({
      conversacion_id: e.conversacionId,
      tipo: 'saliente',
      contenido: texto,
      automatico: true,
      estado: envio.ok ? 'enviado' : 'fallido',
      externo_id: envio.ok ? (envio.externoId ?? null) : null,
      error: envio.ok ? null : (envio.detalle ?? 'No se pudo enviar.'),
    })
    registrarFalla(eIns, 'bandeja:automatico:guardar')
  } catch (err) {
    // Accesorio: se registra y se sigue.
    registrarFalla({ message: err instanceof Error ? err.message : String(err) }, 'bandeja:automatico')
  }
}
