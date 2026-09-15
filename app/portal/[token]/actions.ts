'use server'

import { redirect } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { subirAdjunto } from '@/lib/storage'
import { permitirIntento } from '@/lib/limites'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'

/**
 * Sube el comprobante de pago de una reserva desde el portal del socio —sin
 * sesión de staff, el token de la URL es la única credencial—.
 *
 * Es la PRIMERA Server Action de escritura de `/portal/<token>`: hasta acá el
 * portal era 100% de solo lectura (ver el comentario de `page.tsx`). Por eso
 * lleva los mismos cuidados que el resto del borde público con escritura:
 *
 * 1. **Límite de tasa** (`comprobante_agencia`, `lib/domain/limites.ts`): sin
 *    sesión de staff, quien tenga el enlace podría llenar el bucket privado de
 *    archivos o ensuciar la cuenta corriente con filas sin comprobante real.
 * 2. **El token se vuelve a validar acá**, con el mismo doble chequeo que la
 *    lectura de la página (`activo` + `token_revocado_en is null`): dar de baja
 *    la agencia o regenerar el enlace tiene que cerrar también esta puerta, no
 *    solo la de lectura.
 * 3. **La reserva tiene que ser DE ESTA agencia.** Sin ese chequeo, cualquiera
 *    con un token de agencia válido podría adjuntar un comprobante a la
 *    reserva de OTRA agencia con solo adivinar (o enumerar) un id.
 * 4. **Nunca se asume que «subió el comprobante» == «el dinero ya está
 *    confirmado»** (mismo criterio que la conciliación bancaria, ADR 0030).
 *    El importe real lo carga o verifica el staff después: esta acción NUNCA
 *    escribe un monto que haya inventado o que la agencia haya tipeado sin
 *    verificar. Se adjunta a un `pago` existente que todavía no tiene
 *    comprobante, o se crea uno nuevo en CERO si no hay ninguno pendiente —un
 *    `pago` en cero no mueve el saldo, y queda a la vista de recepción en la
 *    ficha de la agencia para que lo complete.
 */
export async function subirComprobantePagoAgencia(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').trim()
  if (!token) redirect('/portal')
  const destino = `/portal/${token}`

  // Se cuenta el intento SIEMPRE, antes de tocar la base: es la protección
  // contra volumen, y tiene que aplicar incluso a un envío con datos mal
  // formados (si no, alcanzaría con mandar el formulario vacío sin gastar
  // cupo para tantear el resto).
  if (!(await permitirIntento('comprobante_agencia'))) {
    redirect(`${destino}?error=limite`)
  }

  const reservaId = String(formData.get('reserva_id') ?? '').trim()
  const nota = String(formData.get('nota') ?? '').trim().slice(0, 500)
  const archivo = formData.get('comprobante')
  if (!reservaId || !(archivo instanceof File) || archivo.size === 0) {
    redirect(`${destino}?error=comprobante_datos`)
  }

  const admin = crearClienteAdmin()

  // Mismo doble chequeo que `page.tsx`: enlace activo y no revocado.
  const { data: agencia, error: eAgencia } = await admin
    .from('agencias')
    .select('id')
    .eq('token', token)
    .eq('activo', true)
    .is('token_revocado_en', null)
    .maybeSingle()
  registrarFalla(eAgencia, 'portal:agencia_por_token')
  if (!agencia) redirect(`${destino}?error=token`)

  const { data: reserva, error: eReserva } = await admin
    .from('reservas')
    .select('id, estado')
    .eq('id', reservaId)
    .eq('agencia_id', agencia.id)
    .maybeSingle()
  registrarFalla(eReserva, 'portal:reserva_de_agencia')
  if (!reserva) redirect(`${destino}?error=reserva`)
  if (reserva.estado === 'cancelada') redirect(`${destino}?error=reserva_cancelada`)

  const subido = await subirAdjunto(`agencias/${agencia.id}`, archivo)
  if ('error' in subido) redirect(`${destino}?error=subida`)

  // El movimiento `pago` más viejo de esta reserva que todavía no tiene
  // comprobante: es al que hay que sumarle este archivo. Del más viejo primero
  // porque, si hay varios, es el que lleva más tiempo esperando.
  const { data: pendiente, error: ePendiente } = await admin
    .from('movimientos_cuenta')
    .select('id')
    .eq('reserva_id', reserva.id)
    .eq('tipo', 'pago')
    .is('comprobante_ruta', null)
    .order('creado_en', { ascending: true })
    .limit(1)
    .maybeSingle()
  registrarFalla(ePendiente, 'portal:pago_pendiente_sin_comprobante')
  // Si la lectura falló, `pendiente` da `null` igual que «no hay ninguno
  // pendiente» — sin cortar acá, ese error de lectura crearía un `pago` en
  // CERO nuevo en vez de completar el que ya existía, duplicando filas.
  if (ePendiente) redirect(`${destino}?error=comprobante_guardar`)

  if (pendiente) {
    const { error } = await admin
      .from('movimientos_cuenta')
      .update({ comprobante_ruta: subido.ruta })
      .eq('id', pendiente.id)
    cortarSiFalla(error, destino, 'comprobante_guardar')
  } else {
    const concepto = nota
      ? `Comprobante subido desde el portal de la agencia. Nota de la agencia: ${nota}`
      : 'Comprobante subido desde el portal de la agencia.'
    const { error } = await admin.from('movimientos_cuenta').insert({
      agencia_id: agencia.id,
      reserva_id: reserva.id,
      tipo: 'pago',
      // En CERO a propósito: es un importe que la agencia no verificó y que el
      // sistema no puede inventar. El staff lo revisa contra el comprobante
      // adjunto y recién ahí carga el monto real con `registrarMovimiento`.
      monto: 0,
      moneda: 'USD',
      concepto,
      comprobante_ruta: subido.ruta,
    })
    cortarSiFalla(error, destino, 'comprobante_guardar')
  }

  redirect(`${destino}?ok=comprobante`)
}
