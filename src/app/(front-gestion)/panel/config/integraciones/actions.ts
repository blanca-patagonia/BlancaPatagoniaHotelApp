'use server'

import { requerirRol } from '@/lib/auth/session'
import { registrarAviso } from '@/lib/registro'
import { INTEGRACIONES } from '@/lib/domain/integraciones'
import { probarIntegracion, type ResultadoSonda } from '@/lib/integraciones/sondas'

/**
 * Acciones de la pantalla de integraciones (ADR 0043).
 *
 * Sólo la dirección: probar una clave no la expone, pero sí revela a qué cuenta
 * pertenece (el usuario de Mercado Pago, el dominio de correo).
 */

export interface EstadoPrueba {
  resultado?: ResultadoSonda
  /** Cuándo se probó, para mostrarlo y para que dos pruebas seguidas se distingan. */
  en?: number
}

export async function probar(_prev: EstadoPrueba, formData: FormData): Promise<EstadoPrueba> {
  await requerirRol('admin', 'gerencia')
  const id = String(formData.get('id') ?? '')
  if (!INTEGRACIONES.some((i) => i.id === id)) return { resultado: { ok: false, detalle: 'Integración desconocida.' } }
  const resultado = await probarIntegracion(id, process.env)
  // Un fallo de una clave que ANTES andaba es lo que hay que poder rastrear.
  if (!resultado.ok) await registrarAviso('integracion_prueba_fallida', { integracion: id, detalle: resultado.detalle })
  return { resultado, en: Date.now() }
}
