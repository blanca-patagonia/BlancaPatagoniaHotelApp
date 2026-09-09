import { crearClienteAdmin } from '@/lib/supabase/admin'
import { permitirIntento } from '@/lib/limites'
import { registrarError } from '@/lib/registro'
import { registrarFalla } from '@/lib/acciones'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { validarReservaExterna } from '@/lib/domain/canal-externo'

/**
 * Webhook receptor de reservas de un channel manager externo.
 * `POST /api/canales/externos/<token>`.
 *
 * Fase 7 del análisis de referencia (patrón: el módulo conector de QloApps
 * hacia el Channel Manager de Webkul — un servicio SaaS de terceros que el
 * repo clonado NO trae, solo el adaptador que le habla). Acá no hay ningún
 * proveedor real conectado: es la arquitectura para que conectar uno el día
 * de mañana (Beds24, Hotelrunner, RateGain) sea agregar una fila en
 * `canales_externos` y su mapeo de tipos, no reescribir el sistema (ver el
 * comentario largo de la migración 0094).
 *
 * ── Por qué NO es lo mismo que `lib/canales/*` (Booking/Expedia) ────────────
 *
 * Ese módulo resuelve un problema distinto: el informe CSV y el iCal de
 * Booking, que son de solo lectura y no evitan el overbooking (ADR 0021). Un
 * channel manager de verdad habla por su propia API/webhook y sí puede avisar
 * una venta apenas ocurre, así que esto crea la reserva de una, no la deja en
 * una cola para que recepción la revise.
 *
 * ── Autenticación: un token al portador en la URL ────────────────────────────
 *
 * Mismo patrón que el feed iCal de salida y el portal de socios: el otro lado
 * es un servidor que no puede iniciar sesión. Un token que no existe o está
 * desactivado devuelve 404 y no 401 — un 401 confirmaría que la ruta existe.
 *
 * ── `reservas.canal` es un bucket, no la identidad del proveedor ────────────
 *
 * `reservas_canal_valido` (migración 0062) fija la lista de canales a propósito
 * chica: es la dimensión de `resumen_canal_mes` y de la conciliación de
 * comisiones. La 0095 le sumó `channel_manager` como bucket genérico —CUALQUIER
 * proveedor conectado por acá cae ahí—, así que qué proveedor fue puntualmente
 * viaja en el prefijo de `reservas.voucher` (`<codigo>:<referencia_externa>`),
 * no en `canal`.
 *
 * ── Idempotencia ──────────────────────────────────────────────────────────
 *
 * `referencia_externa` es obligatoria. Un reintento de red con la misma
 * referencia (y el mismo canal) devuelve la reserva ya creada en vez de
 * duplicarla — mismo problema que resuelve `pagos.external_id` (único) para
 * las pasarelas, acá resuelto a mano porque `voucher` no es único a nivel de
 * base (también lo usa una reserva cargada por mostrador).
 *
 * ── Qué pasa si la unidad ya no está libre ──────────────────────────────────
 *
 * Es el overbooking real que las advertencias de `capacidades()` describen: el
 * channel manager cree que vendió algo que acá ya no está disponible. Se
 * responde 409 (conflicto, no error transitorio) y se registra en `errores`
 * para que alguien lo resuelva a mano con el huésped.
 */

/** ¿Tiene forma de uuid? Consultar la base con otra cosa da error de sintaxis. */
function pareceUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)
}

function json(status: number, cuerpo: Record<string, unknown>): Response {
  return Response.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  if (!pareceUuid(token)) return json(404, { error: 'No encontrado.' })

  const admin = crearClienteAdmin()

  const { data: canalExterno, error: eCanal } = await admin
    .from('canales_externos')
    .select('id, codigo, nombre, activo')
    .eq('token', token)
    .maybeSingle<{ id: string; codigo: string; nombre: string; activo: boolean }>()

  if (eCanal) {
    await registrarError('webhook_canal_externo_token', { detalle: eCanal.message })
    return json(503, { error: 'No se pudo procesar en este momento.' })
  }

  // El límite de tasa se cuenta DESPUÉS de rechazar el token, nunca antes
  // (mismo criterio que el webhook de pagos): así una racha de reservas
  // legítimas de un canal real no se frena por su propio volumen.
  if (!canalExterno || !canalExterno.activo) {
    if (!(await permitirIntento('webhook_canal_externo'))) {
      return json(429, { error: 'Demasiados intentos.' })
    }
    return json(404, { error: 'No encontrado.' })
  }

  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return json(400, { error: 'El cuerpo debe ser JSON válido.' })
  }

  const validado = validarReservaExterna(cuerpo)
  if (!validado.ok) return json(400, { error: validado.error })
  const d = validado.datos

  // `reservas.canal` es un bucket genérico ('channel_manager', ver migración
  // 0095): CUÁL proveedor fue no vive ahí, vive en el prefijo del voucher. Sin
  // el prefijo, dos proveedores distintos que numeren sus reservas igual
  // («12345») se pisarían en la comprobación de idempotencia de más abajo.
  const voucher = `${canalExterno.codigo}:${d.referenciaExterna}`

  const { data: yaExiste, error: eExiste } = await admin
    .from('reservas')
    .select('id, codigo')
    .eq('canal', 'channel_manager')
    .eq('voucher', voucher)
    .maybeSingle<{ id: string; codigo: string }>()
  if (eExiste) {
    await registrarError('webhook_canal_externo_idempotencia', { detalle: eExiste.message })
    return json(503, { error: 'No se pudo procesar en este momento.' })
  }
  if (yaExiste) {
    return json(200, { reserva_id: yaExiste.id, codigo: yaExiste.codigo, duplicado: true })
  }

  const { data: mapeo, error: eMapeo } = await admin
    .from('canal_externo_tipos')
    .select('tipo_unidad_id')
    .eq('canal_externo_id', canalExterno.id)
    .eq('codigo_externo', d.codigoHabitacion)
    .eq('activo', true)
    .maybeSingle<{ tipo_unidad_id: string }>()
  if (eMapeo) {
    await registrarError('webhook_canal_externo_mapeo', { detalle: eMapeo.message })
    return json(503, { error: 'No se pudo procesar en este momento.' })
  }
  if (!mapeo) {
    return json(400, {
      error: `El código de habitación «${d.codigoHabitacion}» no está mapeado a ningún tipo de unidad para ${canalExterno.nombre}.`,
    })
  }

  // Huésped: se reutiliza por email, igual que el alta de mostrador
  // (`app/panel/reservas/actions.ts`) y el portal público
  // (`app/reservar/actions.ts`) — ninguno de los dos comparte un helper, así
  // que esto no rompe ningún patrón existente al no compartirlo tampoco.
  let huespedId: string | null = null
  if (d.huesped.email) {
    const { data: existente } = await admin
      .from('huespedes')
      .select('id')
      .eq('email', d.huesped.email)
      .maybeSingle<{ id: string }>()
    huespedId = existente?.id ?? null
  }

  let huespedCreadoAca = false
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await admin
      .from('huespedes')
      .insert({
        nombre: d.huesped.nombre || d.huesped.apellido,
        apellido: d.huesped.apellido,
        email: d.huesped.email || null,
      })
      .select('id')
      .single<{ id: string }>()
    if (eHuesped || !nuevo) {
      await registrarError('webhook_canal_externo_huesped', {
        detalle: eHuesped?.message ?? 'no se devolvió la fila creada',
      })
      return json(503, { error: 'No se pudo registrar al huésped.' })
    }
    huespedId = nuevo.id
    huespedCreadoAca = true
  }

  // Tarifa neta: una venta por channel manager es una venta por canal externo,
  // igual que Booking/Expedia (`CANAL_TARIFA` en `app/panel/reservas/actions.ts`
  // asigna lo mismo a esos dos). No se reusa ese mapa porque está indexado por
  // los cuatro canales fijos del portal/mostrador, y acá el valor es siempre
  // el mismo — no hace falta un lookup para una sola rama.
  const res = await crearReservaEnUnidadLibre(admin, {
    tipoUnidadId: mapeo.tipo_unidad_id,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    huespedes: d.adultos + d.menores,
    huespedId,
    canal: 'channel_manager',
    tarifaTipo: 'neto',
    estado: 'confirmada',
    ocupantes: { adultos: d.adultos, menores: d.menores, bebes: d.bebes, camasExtra: 0, cunas: 0 },
    comercial: { voucher },
  })

  if (!res.ok) {
    if (huespedCreadoAca) {
      const { error: eRollback } = await admin.from('huespedes').delete().eq('id', huespedId)
      registrarFalla(eRollback, `rollback del huésped ${huespedId} tras fallar el alta por canal externo`)
    }
    await registrarError('webhook_canal_externo_overbooking', {
      detalle: res.error,
      canal: canalExterno.codigo,
      referenciaExterna: d.referenciaExterna,
    })
    return json(409, { error: res.error })
  }

  return json(201, { reserva_id: res.reserva.id, codigo: res.reserva.codigo })
}
