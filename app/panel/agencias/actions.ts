'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirRol } from '@/lib/auth/session'
import { puedeAvanzar, type EtapaComercial } from '@/lib/domain/comercial'
import { TIPOS_CUENTA, movimientoEnMoneda } from '@/lib/domain/cuentas'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
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
  await requerirRol('admin', 'gerencia')

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

/**
 * Registra un cargo o un pago en la cuenta corriente de una agencia.
 *
 * No tenía ninguna verificación (auditoría · Fase 3): era la única de este
 * archivo sin guarda, y la que mueve plata. Se le aplica la MISMA regla que a
 * sus hermanas —admin/gerencia— y no la del área `agencias`, que en
 * `lib/domain/permisos.ts` también alcanza a recepción: esa matriz gobierna
 * quién *ve* la sección, mientras que escribir sobre una cuenta corriente es
 * competencia de gerencia.
 *
 * ── La moneda (auditoría 2026-09, P1-3) ─────────────────────────────────────
 *
 * El importe se ingresa **en la moneda del comprobante** y se guarda en las dos:
 * `monto` en USD, que es lo único que suma `saldoCuenta`, y `monto_origen` con
 * el número que la agencia tiene en el papel.
 *
 * Antes esta acción no mandaba `moneda`, así que la columna caía en su default
 * `'USD'` para todas las filas. Una agencia argentina a la que se le carga un
 * cargo de ARS 185.000 quedaba debiendo USD 185.000.
 */
export async function registrarMovimiento(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const agenciaId = String(formData.get('agencia_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const montoIngresado = Number(formData.get('monto') ?? 0)
  const moneda = String(formData.get('moneda') ?? 'USD')
  const concepto = String(formData.get('concepto') ?? '').trim()
  if (!agenciaId || !['cargo', 'pago'].includes(tipo) || !(montoIngresado > 0)) {
    redirect(`/panel/agencias/${agenciaId}?error=movimiento_datos`)
  }
  if (moneda !== 'USD' && !esMonedaExtranjera(moneda)) {
    redirect(`/panel/agencias/${agenciaId}?error=moneda`)
  }

  // `venta` es la que se aplica: cuántas unidades de la moneda cuesta comprar un
  // dólar (ADR 0020). Usar la de compra le regalaría el spread a la agencia.
  const vigente = moneda === 'USD' ? null : await cotizacionVigente(moneda)
  const mov = movimientoEnMoneda(montoIngresado, moneda, vigente?.venta ?? null)
  // Sin cotización no se inventa una: el saldo de un socio real se movería con un
  // tipo de cambio que nadie puede justificar después.
  if (!mov) redirect(`/panel/agencias/${agenciaId}?error=sin_cotizacion`)

  const supabase = await crearClienteServidor()
  // Un movimiento de cuenta corriente que no se registra y no avisa descuadra el
  // saldo de la agencia sin que nadie lo note.
  const { error } = await supabase.from('movimientos_cuenta').insert({
    agencia_id: agenciaId,
    tipo,
    monto: mov.monto,
    moneda: mov.moneda,
    monto_origen: mov.montoOrigen,
    cotizacion: mov.cotizacion,
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
  await requerirRol('admin', 'gerencia')

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
  await requerirRol('admin', 'gerencia')

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
  await requerirRol('admin', 'gerencia')

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

/**
 * Regenera el enlace del portal de una agencia.
 *
 * Es la salida cuando un enlace se filtró: un reenvío de correo, el historial de
 * un navegador compartido, alguien que dejó la empresa. Antes no había ninguna
 * —el token se generaba al crear la agencia y servía para siempre—.
 *
 * El token viejo se marca revocado **en la misma sentencia** en que nace el
 * nuevo. Si fueran dos pasos, entre uno y otro habría un instante con los dos
 * enlaces vivos, que es justo lo contrario de lo que se quiere.
 */
export async function regenerarEnlacePortal(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const id = String(formData.get('agencia_id') ?? '')
  if (!id) redirect('/panel/agencias')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('agencias')
    .update({
      token: crypto.randomUUID(),
      // Se deja constancia de cuándo se rotó. La columna se llama «revocado» por
      // el enlace anterior, que es lo que deja de servir en este instante.
      token_revocado_en: null,
    })
    .eq('id', id)

  cortarSiFalla(error, `/panel/agencias/${id}`, 'enlace')

  revalidatePath(`/panel/agencias/${id}`)
  redirect(`/panel/agencias/${id}?ok=enlace`)
}

/**
 * Da de baja el enlace del portal sin generar otro.
 *
 * Distinto de regenerar: acá el socio queda **sin acceso** hasta que alguien le
 * genere uno nuevo. Es lo que corresponde cuando se corta la relación pero la
 * cuenta sigue abierta por saldos pendientes.
 */
export async function revocarEnlacePortal(formData: FormData): Promise<void> {
  await requerirRol('admin', 'gerencia')

  const id = String(formData.get('agencia_id') ?? '')
  if (!id) redirect('/panel/agencias')

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('agencias')
    .update({ token_revocado_en: new Date().toISOString() })
    .eq('id', id)

  cortarSiFalla(error, `/panel/agencias/${id}`, 'enlace')

  revalidatePath(`/panel/agencias/${id}`)
  redirect(`/panel/agencias/${id}?ok=enlace_revocado`)
}
