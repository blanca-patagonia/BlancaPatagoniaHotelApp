'use server'

/**
 * Cambios sobre una reserva ya creada: editar la ficha (atómico, migración
 * 0112), cambiar las fechas y mudar de unidad (0028). Los dos últimos recotizan
 * con `aplicar_precio_reserva` (0085/0114) y nunca escriben `total` a mano.
 */

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { TarifaTipo } from '@/lib/domain/precios'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre } from '@/lib/fechas'
import { type EstadoReserva } from '@/lib/domain/reservas'
import {
  motivoRechazoMudanza,
  debeRecotizar,
  puedeCambiarUnidad,
  type PoliticaTarifa,
} from '@/lib/domain/mudanzas'
import { condicionesDePrecio, estaFacturada } from '@/lib/reservas/condiciones-de-precio'
import { requerirAcceso } from '@/lib/auth/session'
import { parsearPeriodo } from '@/lib/fechas'
import { avisarReservaReprogramada } from '@/lib/notificaciones/eventos'
import { cortarSiFalla } from '@/lib/acciones'
import { origenDeMudanza, rutaDeRetorno, filtrosDeGrilla } from '@/lib/retorno'
import { validarOcupantes, type Ocupantes } from '@/lib/domain/ocupantes'
import { PLANES, SEGMENTOS, type Plan, type Segmento } from '@/lib/domain/reservas'

/**
 * Edita la ficha de una reserva: plan, segmento, voucher, notas, cunas, «no
 * mover» y la composición (adultos/menores/bebés). Hasta ahora, una vez creada,
 * una reserva solo se podía reprogramar, mudar de unidad o cancelar y volver a
 * cargar — no había forma de corregir un dato comercial o de ocupación sin
 * pasar por uno de esos tres caminos, que tocan cosas que acá no cambian
 * (fechas, unidad, estado).
 *
 * ── Por qué NO recotiza ──────────────────────────────────────────────────────
 *
 * Ninguno de estos campos entra en `cotizar_estadia` ni en `calcularEstadia`
 * (`lib/domain/catalogo.ts`): el precio depende del tipo de unidad, la fecha y
 * `tarifa_tipo`, no de quién se aloja ni de qué plan de comidas eligió. `plan`
 * es descriptivo desde que el desayuno quedó siempre incluido (migración 0098);
 * la composición solo importa para la capacidad, no para la tarifa. Por eso esta
 * acción nunca toca `reservas.total`: si algún día se agrega un campo que sí
 * afecte el precio, va en reprogramar/mudar —que ya recotizan—, no acá.
 *
 * ── Validación de capacidad, reusando el dominio ────────────────────────────
 *
 * `validarOcupantes` (`lib/domain/ocupantes.ts`) es la misma regla que ya usa el
 * alta: los bebés no ocupan plaza, las camas extra amplían el tope. `huespedes`
 * lo recalcula la función SQL (`greatest(adultos + menores, 1)`, misma
 * derivación que `crear_reserva`) para que nunca quede desincronizado del
 * desglose.
 *
 * ── Atomicidad y auditoría ───────────────────────────────────────────────────
 *
 * `editar_ficha_reserva` (migración 0112, issue #85) escribe `reservas` y
 * `estadias` en una sola transacción: antes eran dos `update` sueltos y un
 * fallo en el segundo dejaba la ficha a medio editar sin poder volver atrás.
 * Las dos escrituras quedan auditadas solas: `reservas_ficha_auditoria` y
 * `estadias_ficha_auditoria` (migración 0110) reusan el mismo trigger
 * genérico que ya audita pagos, tarifas y el estado de una reserva.
 */
export async function editarFichaReserva(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const id = String(formData.get('reserva_id') ?? '')
  if (!id) redirect('/panel/reservas')

  const plan = String(formData.get('plan') ?? '')
  const segmento = String(formData.get('segmento') ?? '')
  const voucher = String(formData.get('voucher') ?? '').trim().slice(0, 200)
  const notas = String(formData.get('notas') ?? '').trim().slice(0, 2000)
  const noMover = formData.get('no_mover') === '1'

  /*
    Lo que la persona tecleó, para repoblar el formulario si una validación
    corta más abajo (auditoría QA/UX 2026-10-14: antes, cualquier error
    recargaba la página con los valores VIEJOS de la base, y lo recién
    escrito se perdía sin aviso). Van los crudos de `formData`, no los ya
    recortados/coercidos arriba: así un número mal tipeado se ve en el campo
    tal como se lo escribió, en vez de aparecer vacío.
  */
  const camposPrevios = new URLSearchParams({
    v_plan: plan,
    v_segmento: segmento,
    v_voucher: String(formData.get('voucher') ?? ''),
    v_notas: String(formData.get('notas') ?? ''),
    v_adultos: String(formData.get('adultos') ?? ''),
    v_menores: String(formData.get('menores') ?? ''),
    v_bebes: String(formData.get('bebes') ?? ''),
    v_cunas: String(formData.get('cunas') ?? ''),
    v_no_mover: noMover ? '1' : '0',
  }).toString()

  if (!PLANES.includes(plan as Plan)) {
    redirect(`/panel/reservas/${id}?error=ficha_plan&${camposPrevios}`)
  }
  if (!SEGMENTOS.includes(segmento as Segmento)) {
    redirect(`/panel/reservas/${id}?error=ficha_segmento&${camposPrevios}`)
  }

  const supabase = await crearClienteServidor()
  const { data: estadiaData, error: eEstadia } = await supabase
    .from('estadias')
    .select('id, camas_extra, tipo:tipos_unidad(capacidad_max)')
    .eq('reserva_id', id)
    .limit(1)
    .single()
  // Sin la estadía no hay a qué unidad validar la capacidad, ni dónde
  // guardar: no tiene sentido repoblar un formulario que no se puede volver
  // a enviar.
  if (eEstadia || !estadiaData) redirect(`/panel/reservas/${id}?error=ficha_leer`)

  // PostgREST tipa el embed a-uno como arreglo (ver AGENTS.md).
  const estadia = estadiaData as unknown as {
    id: string
    camas_extra: number
    tipo: { capacidad_max: number }[] | { capacidad_max: number } | null
  }
  const capacidadMax = Array.isArray(estadia.tipo) ? estadia.tipo[0]?.capacidad_max : estadia.tipo?.capacidad_max

  const ocupantes: Ocupantes = {
    adultos: Math.trunc(Number(formData.get('adultos'))),
    menores: Math.trunc(Number(formData.get('menores'))),
    bebes: Math.trunc(Number(formData.get('bebes'))),
    camasExtra: Number(estadia.camas_extra),
    cunas: Math.trunc(Number(formData.get('cunas'))),
  }
  const problemasOcupantes = validarOcupantes(ocupantes, capacidadMax)
  if (problemasOcupantes.length > 0) {
    // El motivo puntual (de qué capacidad se pasó, o qué falta) viaja en
    // `detalle`: es el mismo texto que ya usa `crearReservaAction` al
    // devolver `{ error }`, y acá se perdía por completo detrás de un
    // mensaje genérico que listaba las tres condiciones posibles en vez de
    // decir cuál falló (auditoría QA/UX 2026-10-14).
    redirect(
      `/panel/reservas/${id}?error=ficha_ocupantes&detalle=${encodeURIComponent(problemasOcupantes[0])}&${camposPrevios}`,
    )
  }

  // Las dos escrituras (reservas + estadias), en una transacción
  // (migración 0112, issue #85): antes eran dos `update` sueltos, y un
  // fallo en el segundo dejaba la ficha a medio editar sin poder volver
  // atrás.
  const { data: resultado, error: eEditar } = await supabase.rpc('editar_ficha_reserva', {
    p_reserva_id: id,
    p_estadia_id: estadia.id,
    p_plan: plan,
    p_segmento: segmento,
    p_voucher: voucher,
    p_notas: notas,
    p_adultos: ocupantes.adultos,
    p_menores: ocupantes.menores,
    p_bebes: ocupantes.bebes,
    p_cunas: ocupantes.cunas,
    p_no_mover: noMover,
  })
  cortarSiFalla(eEditar, `/panel/reservas/${id}?${camposPrevios}`, 'ficha_guardar')
  const r = resultado as { ok: boolean; motivo?: string } | null
  if (!r?.ok) redirect(`/panel/reservas/${id}?error=ficha_guardar&${camposPrevios}`)

  redirect(`/panel/reservas/${id}?ok=ficha`)
}

/**
 * Reprograma una reserva: cambia las fechas de su estadía, recotiza el total y
 * respeta el anti-overbooking (si el nuevo período pisa otra estadía activa de la
 * misma unidad, la restricción de exclusión lo rechaza).
 */
export async function reprogramarReserva(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const id = String(formData.get('reserva_id') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  if (!id) redirect('/panel/reservas')
  if (!checkIn || !checkOut || checkOut <= checkIn) redirect(`/panel/reservas/${id}?error=fechas`)

  const supabase = await crearClienteServidor()
  const { data: estadia, error: eEstadia } = await supabase
    .from('estadias')
    .select('id, tipo_unidad_id')
    .eq('reserva_id', id)
    .limit(1)
    .single()
  const { data: reserva, error: eReserva } = await supabase
    .from('reservas')
    .select(
      'estado, tarifa_tipo, codigo, huesped_id, huesped:huespedes!reservas_huesped_id_fkey(nombre, email, telefono)',
    )
    .eq('id', id)
    .single()
  // Antes esto redirigía SIN `?error=` — la pantalla recargaba en silencio y
  // no había forma de saber que la reprogramación no había pasado nada.
  if (eEstadia || eReserva) redirect(`/panel/reservas/${id}?error=repro_lectura`)
  if (!estadia || !reserva) redirect(`/panel/reservas/${id}`)

  /*
    Las mismas reglas que la ficha, ahora también en el servidor: la ficha
    sólo ocultaba el bloque, y un envío directo re-preciaba una reserva
    cancelada o terminada.
  */
  if (!puedeCambiarUnidad(reserva.estado as EstadoReserva)) {
    redirect(`/panel/reservas/${id}?error=repro_estado`)
  }
  // Con la factura emitida (inmutable) el total ya no puede cambiar.
  const facturada = await estaFacturada(supabase, id)
  if (!facturada.ok) redirect(`/panel/reservas/${id}?error=repro_lectura`)
  if (facturada.facturada) redirect(`/panel/reservas/${id}?error=repro_facturada`)

  // La promoción y el descuento adicional de la reserva se conservan.
  const condiciones = await condicionesDePrecio(supabase, id)
  if (!condiciones.ok) redirect(`/panel/reservas/${id}?error=repro_lectura`)

  const tarifaTipo: TarifaTipo = reserva.tarifa_tipo === 'neto' ? 'neto' : 'rack'
  const cot = await cotizarEstadia({
    tipoUnidadId: estadia.tipo_unidad_id as string,
    checkIn,
    checkOut,
    tarifaTipo,
    promocion: condiciones.condiciones.promocion,
    descuentoAdicionalPct: condiciones.condiciones.descuentoAdicionalPct,
    anticipacionDias: condiciones.condiciones.anticipacionDias(checkIn),
    cliente: supabase,
  })
  if (cot.faltanTarifas) redirect(`/panel/reservas/${id}?error=tarifa`)
  const noches = diasEntre(checkIn, checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  /*
    Las fechas, el precio por noche y el total, en UNA transacción (0085).

    Antes eran dos `update` sueltos, y el comentario que estaba acá lo admitía:
    «las fechas ya se movieron; si el total no se actualiza, la reserva queda con
    el precio de las fechas viejas». Eso no se ve —la reserva figura normal en la
    grilla— y se descubre al facturar, cuando ya hay comprobante emitido.
  */
  const { data: aplicado, error } = await supabase.rpc('aplicar_precio_reserva', {
    p_reserva_id: id,
    p_precio_noche: precioNoche,
    p_total: cot.resumen.total,
    p_check_in: checkIn,
    p_check_out: checkOut,
    // El desglose también (0114): si no, `total_neto + iva` dejaba de ser el total.
    p_subtotal: cot.resumen.subtotalNeto,
    p_total_neto: cot.resumen.totalNeto,
    p_iva: cot.resumen.iva,
  })
  if (error) redirect(`/panel/reservas/${id}?error=repro`)

  const r = aplicado as { ok: boolean; motivo?: string } | null
  if (!r?.ok) {
    // `ocupada` es la restricción de exclusión rechazando el período nuevo: no es
    // una falla del sistema, es el anti-overbooking funcionando (ADR 0002).
    redirect(`/panel/reservas/${id}?error=${r?.motivo === 'ocupada' ? 'overlap' : 'repro'}`)
  }

  /*
    Las fechas nuevas se le avisan al huésped.

    Reprogramar sin avisar deja al huésped con las fechas viejas anotadas, y eso
    se descubre el día que se presenta. El aviso lleva el total actualizado
    porque **puede haber cambiado**: las tarifas dependen de la temporada y las
    fechas nuevas pueden caer en otra.

    El aviso va después del RPC y no antes: si el período pisaba otra estadía, la
    reprogramación no ocurrió y el correo habría anunciado un cambio inexistente.
  */
  const h = reserva.huesped as unknown as {
    nombre: string
    email: string | null
    telefono: string | null
  } | null
  await avisarReservaReprogramada(
    crearClienteAdmin(),
    {
      reservaId: id,
      huespedId: reserva.huesped_id as string | null,
      email: h?.email ?? null,
      telefono: h?.telefono ?? null,
      nombre: h?.nombre ?? '',
      codigo: reserva.codigo as string,
    },
    { checkIn, checkOut, total: cot.resumen.total },
  )

  redirect(`/panel/reservas/${id}`)
}

/**
 * A dónde vuelve la mudanza cuando termina.
 *
 * La decisión —y la lista blanca que evita el redirect abierto— vive en
 * `lib/retorno.ts`, que es una función pura y tiene sus propios tests. Acá queda
 * sólo la lectura del formulario.
 */
function retornoDeMudanza(
  formData: FormData,
  reservaId: string,
): (extra?: Record<string, string>) => string {
  const origen = origenDeMudanza(formData.get('volver'))
  const filtros = filtrosDeGrilla((clave) => formData.get(clave))
  return (extra = {}) => rutaDeRetorno(origen, reservaId, filtros, extra)
}

/**
 * Muda una reserva a otra unidad.
 *
 * Recepción lo necesita cuando se rompe algo, cuando el huésped pide cambio o
 * cuando hay que liberar una habitación para un grupo. El trabajo pesado lo hace
 * la función `cambiar_unidad_reserva`, que mueve la estadía y ensucia la unidad
 * liberada en una sola transacción; si el destino está ocupado, la restricción
 * de exclusión lo rechaza con 23P01.
 */
export async function cambiarUnidadReserva(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const id = String(formData.get('reserva_id') ?? '')
  const unidadDestino = String(formData.get('unidad_destino') ?? '')
  const motivo = String(formData.get('motivo') ?? '')
  const politica: PoliticaTarifa =
    formData.get('politica_tarifa') === 'recotizar' ? 'recotizar' : 'mantener'

  if (!id) redirect('/panel/reservas')
  const volverA = retornoDeMudanza(formData, id)
  if (!unidadDestino) redirect(volverA({ error: 'sin_destino' }))

  const supabase = await crearClienteServidor()
  const { data: estadia, error: eEstadia } = await supabase
    .from('estadias')
    .select('unidad_id, estado, periodo')
    .eq('reserva_id', id)
    .maybeSingle()
  // Distinto de "sin_estadia": para quien está arrastrando una reserva en la
  // grilla, "no se pudo leer, probá de nuevo" no es lo mismo que "esta
  // reserva no tiene estadía", que suena a un problema de datos mucho peor.
  if (eEstadia) redirect(volverA({ error: 'lectura_estadia' }))
  if (!estadia) redirect(volverA({ error: 'sin_estadia' }))

  // Se valida en el dominio ANTES de ir a la base: da un mensaje claro y evita
  // una llamada inútil. La función SQL vuelve a comprobarlo porque la
  // aplicación no es la única puerta a los datos.
  const rechazo = motivoRechazoMudanza(
    estadia.estado as EstadoReserva,
    estadia.unidad_id as string,
    unidadDestino,
  )
  if (rechazo) redirect(volverA({ error: rechazo }))

  const { data, error } = await supabase.rpc('cambiar_unidad_reserva', {
    p_reserva_id: id,
    p_unidad_destino: unidadDestino,
    p_motivo: motivo,
  })
  if (error) {
    redirect(volverA({ error: error.code === '23P01' ? 'ocupada' : 'mudanza' }))
  }

  const resultado = data as {
    ok: boolean
    motivo?: string
    tipo_destino?: string
    cambio_de_tipo?: boolean
  }
  if (!resultado.ok) redirect(volverA({ error: resultado.motivo ?? 'mudanza' }))

  // La recotización va aparte y DESPUÉS de la mudanza, no dentro de la
  // transacción: si fallara, el huésped ya está mudado —que es lo urgente— y el
  // precio se corrige a mano. Al revés (revertir la mudanza por un problema de
  // tarifa) sería peor.
  if (debeRecotizar(politica, Boolean(resultado.cambio_de_tipo)) && resultado.tipo_destino) {
    const { data: reserva, error: eReserva } = await supabase
      .from('reservas')
      .select('tarifa_tipo')
      .eq('id', id)
      .single()

    // Fail-closed, no fail-`rack`: si no se pudo leer `tarifa_tipo`, NO hay que
    // asumir "rack" — una reserva de agencia (`tarifa_tipo: 'neto'`, ADR 0004)
    // se recotizaría a precio de mostrador en vez de precio de agencia, sin que
    // nadie se entere. El huésped ya está mudado (lo urgente); la recotización
    // se corrige a mano, igual que cuando falta la tarifa del tipo destino.
    if (eReserva) redirect(volverA({ error: 'tarifa_tipo_verificar' }))

    // Con la factura emitida el precio no cambia: el huésped ya quedó mudado
    // (lo urgente) y se avisa que el precio no se tocó.
    const facturada = await estaFacturada(supabase, id)
    if (!facturada.ok) redirect(volverA({ error: 'tarifa_tipo_verificar' }))
    if (facturada.facturada) redirect(volverA({ error: 'recotizar_facturada' }))

    // La promoción y el descuento adicional de la reserva se conservan.
    const condiciones = await condicionesDePrecio(supabase, id)
    if (!condiciones.ok) redirect(volverA({ error: 'tarifa_tipo_verificar' }))

    const { desde, hasta } = parsearPeriodo(estadia.periodo as string)
    const cot = await cotizarEstadia({
      tipoUnidadId: resultado.tipo_destino,
      checkIn: desde,
      checkOut: hasta,
      tarifaTipo: reserva?.tarifa_tipo === 'neto' ? 'neto' : 'rack',
      promocion: condiciones.condiciones.promocion,
      descuentoAdicionalPct: condiciones.condiciones.descuentoAdicionalPct,
      anticipacionDias: condiciones.condiciones.anticipacionDias(desde),
      cliente: supabase,
    })

    if (!cot.faltanTarifas) {
      const noches = diasEntre(desde, hasta)
      const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

      /*
        El precio y el total, en una sola transacción (0085).

        Eran dos `update` sueltos y el comentario lo admitía: «si el precio no se
        recotiza, la reserva queda facturando la unidad anterior». Ahora o se
        aplican los dos o no se aplica ninguno.

        ⚠️ Esto NO mete la recotización dentro de la mudanza, y es a propósito: esa
        decisión está tomada más arriba —el huésped ya está mudado, que es lo
        urgente, y revertir una mudanza por un problema de tarifa sería peor—.
        Lo que cambia es que la recotización dejó de poder quedar a medias.
      */
      const { data: recotizado, error: eRecotizar } = await supabase.rpc(
        'aplicar_precio_reserva',
        {
          p_reserva_id: id,
          p_precio_noche: precioNoche,
          p_total: cot.resumen.total,
          // El desglose también (0114).
          p_subtotal: cot.resumen.subtotalNeto,
          p_total_neto: cot.resumen.totalNeto,
          p_iva: cot.resumen.iva,
        },
      )
      cortarSiFalla(eRecotizar, volverA(), 'total')
      if (!(recotizado as { ok: boolean } | null)?.ok) {
        cortarSiFalla({ message: 'no se pudo recotizar' }, volverA(), 'total')
      }
    } else {
      redirect(volverA({ error: 'tarifa_destino' }))
    }
  }

  redirect(volverA({ ok: 'mudanza' }))
}
