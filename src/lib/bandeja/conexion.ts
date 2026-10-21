import 'server-only'
import {
  diagnosticar,
  INTEGRACIONES,
  type Diagnostico,
  type Integracion,
} from '@/lib/domain/integraciones'
import type { CanalBandeja } from '@/lib/domain/bandeja'
import { puedeEnviar, puedeRecibir } from './canales'

/**
 * Qué tan conectado está cada canal (ADR 0044). Lee el ENTORNO, no al proveedor:
 * para saber si el proveedor realmente le avisa a este sistema está la
 * verificación en vivo (`lib/integraciones/meta.ts`), que es una acción del staff
 * porque cuesta una llamada de red por canal.
 */

/** Qué ficha del catálogo corresponde a cada canal. El chat de la web no tiene: no usa claves. */
export const INTEGRACION_DEL_CANAL: Record<CanalBandeja, string | null> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  email: 'resend',
  telegram: 'telegram',
  web: null,
}

export type NivelConexion = 'conectado' | 'a_medias' | 'sin_conectar' | 'siempre'

export interface EstadoDelCanal {
  canal: CanalBandeja
  nivel: NivelConexion
  integracion: Integracion | null
  diagnostico: Diagnostico | null
  recibe: boolean
  responde: boolean
}

export function estadoDeCanales(canales: readonly CanalBandeja[]): EstadoDelCanal[] {
  return canales.map((canal) => {
    const id = INTEGRACION_DEL_CANAL[canal]
    const integracion = id ? (INTEGRACIONES.find((i) => i.id === id) ?? null) : null
    if (!integracion) {
      return { canal, nivel: 'siempre', integracion: null, diagnostico: null, recibe: true, responde: true }
    }
    const diagnostico = diagnosticar(integracion, process.env)
    const recibe = puedeRecibir(canal)
    const responde = puedeEnviar(canal)
    const nivel: NivelConexion = recibe && responde ? 'conectado' : diagnostico.estado === 'sin_configurar' ? 'sin_conectar' : 'a_medias'
    return { canal, nivel, integracion, diagnostico, recibe, responde }
  })
}
