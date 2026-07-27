import 'server-only'

/**
 * Email de confirmación de reserva.
 *
 * STUB: por ahora solo registra el envío. Queda preparado para enchufar un
 * proveedor real (Resend / SMTP / Supabase) sin cambiar el flujo de reserva.
 * No se envían correos reales en esta etapa.
 */

export interface DatosConfirmacion {
  email: string | null
  nombre: string
  codigo: string
  checkIn: string
  checkOut: string
  total: number
}

export async function enviarEmailConfirmacion(datos: DatosConfirmacion): Promise<void> {
  if (!datos.email) return
  console.info(
    `[email] Confirmación ${datos.codigo} → ${datos.email} ` +
      `(${datos.checkIn} a ${datos.checkOut}, USD ${datos.total}). Stub: no se envía realmente.`,
  )
  // TODO (Fase 7): integrar proveedor de email real.
}
