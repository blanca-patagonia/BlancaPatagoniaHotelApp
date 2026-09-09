/**
 * Validación del payload que un channel manager externo manda al webhook de
 * reservas entrantes (Fase 7 del análisis de referencia: preparación, sin
 * proveedor real conectado todavía — ver migración 0094).
 *
 * Lógica pura y sin `fetch`/Supabase a propósito: así se puede probar cada
 * caso borde del formato sin levantar el endpoint ni la base.
 */

export interface ReservaExternaEntrante {
  codigoHabitacion: string
  checkIn: string
  checkOut: string
  huesped: { apellido: string; nombre: string; email: string }
  adultos: number
  menores: number
  bebes: number
  /**
   * El id de la reserva del lado del channel manager. Es la clave de
   * idempotencia: sin ella, un reintento de red duplicaría la venta (mismo
   * problema que resuelve `pagos.external_id`, único, para las pasarelas).
   */
  referenciaExterna: string
}

export type ResultadoValidacion =
  | { ok: true; datos: ReservaExternaEntrante }
  | { ok: false; error: string }

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : ''
}

function entero(valor: unknown, porDefecto: number): number {
  const n = Number(valor)
  return Number.isInteger(n) ? n : porDefecto
}

export function validarReservaExterna(body: unknown): ResultadoValidacion {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'El cuerpo debe ser un objeto JSON.' }
  }
  const b = body as Record<string, unknown>

  const codigoHabitacion = texto(b.codigo_habitacion)
  if (!codigoHabitacion) return { ok: false, error: 'Falta codigo_habitacion.' }

  const checkIn = texto(b.check_in)
  const checkOut = texto(b.check_out)
  if (!RE_FECHA.test(checkIn) || !RE_FECHA.test(checkOut)) {
    return { ok: false, error: 'check_in y check_out deben tener formato AAAA-MM-DD.' }
  }
  if (checkOut <= checkIn) {
    return { ok: false, error: 'check_out debe ser posterior a check_in.' }
  }

  const huespedRaw = b.huesped
  if (typeof huespedRaw !== 'object' || huespedRaw === null || Array.isArray(huespedRaw)) {
    return { ok: false, error: 'Falta el objeto huesped.' }
  }
  const h = huespedRaw as Record<string, unknown>
  const apellido = texto(h.apellido)
  if (!apellido) return { ok: false, error: 'Falta huesped.apellido.' }

  const adultos = entero(b.adultos, 0)
  if (adultos < 1) return { ok: false, error: 'adultos debe ser un entero mayor o igual a 1.' }

  const referenciaExterna = texto(b.referencia_externa)
  if (!referenciaExterna) {
    return {
      ok: false,
      error:
        'Falta referencia_externa: es la que evita duplicar la reserva si el canal reintenta el envío.',
    }
  }

  return {
    ok: true,
    datos: {
      codigoHabitacion,
      checkIn,
      checkOut,
      huesped: { apellido, nombre: texto(h.nombre), email: texto(h.email) },
      adultos,
      menores: Math.max(0, entero(b.menores, 0)),
      bebes: Math.max(0, entero(b.bebes, 0)),
      referenciaExterna,
    },
  }
}
