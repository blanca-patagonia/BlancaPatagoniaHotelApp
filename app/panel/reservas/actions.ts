'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { TarifaTipo } from '@/lib/domain/precios'
import { crearReservaEnUnidadLibre } from '@/lib/reservas/crear'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre } from '@/lib/fechas'
import { puedeTransicionar, ESTADOS_ACTIVOS, type EstadoReserva } from '@/lib/domain/reservas'
import {
  motivoRechazoMudanza,
  debeRecotizar,
  type PoliticaTarifa,
} from '@/lib/domain/mudanzas'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { puntosPorEstadia, nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import { obtenerSesion } from '@/lib/auth/session'
import { hoyISO, sumarDias, parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import {
  tipoComprobante,
  desglosarIva,
  numeroComprobante,
  cuitValido,
  normalizarCuit,
  exigeCuitReceptor,
  motivoNoFacturable,
  type CondicionIva,
} from '@/lib/domain/facturacion'
import { obtenerProveedorFacturacion } from '@/lib/facturacion'
import { enviarPlantilla } from '@/lib/email'
import { urlDelSitio } from '@/lib/env'

import { HORA_CHECK_IN } from '@/lib/domain/hotel'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'

export interface EstadoNuevaReserva {
  error?: string
  /**
   * Lo que se había cargado, para reponerlo si hubo error.
   *
   * React limpia el formulario después de una Server Action, así que sin esto
   * un error en un solo campo obligaba a escribir todo de nuevo.
   */
  valores?: {
    apellido?: string
    nombre?: string
    email?: string
    doc_numero?: string
    canal?: string
    agencia_id?: string
  }
}

const CANAL_TARIFA: Record<string, TarifaTipo> = {
  directo: 'rack',
  web: 'rack',
  booking: 'neto',
  expedia: 'neto',
}

export async function crearReservaAction(
  _prev: EstadoNuevaReserva,
  formData: FormData,
): Promise<EstadoNuevaReserva> {
  const tipoUnidadId = String(formData.get('tipo_unidad_id') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const huespedesCant = Math.max(1, Number(formData.get('huespedes') ?? 1) || 1)
  const canal = String(formData.get('canal') ?? 'directo')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const docNumero = String(formData.get('doc_numero') ?? '').trim()

  const agenciaId = String(formData.get('agencia_id') ?? '')
  // Se devuelve tal cual vino para reponer el formulario ante cualquier error.
  const valores = {
    apellido,
    nombre,
    email,
    doc_numero: docNumero,
    canal,
    agencia_id: agenciaId,
  }

  if (!tipoUnidadId || !checkIn || !checkOut) {
    return { error: 'Elegí fechas y un tipo de unidad.', valores }
  }
  if (checkOut <= checkIn) {
    return { error: 'El check-out debe ser posterior al check-in.', valores }
  }
  if (!apellido) return { error: 'Ingresá al menos el apellido del huésped.', valores }

  const supabase = await crearClienteServidor()

  // Con convenio siempre corresponde tarifa NETA, sea cual sea el canal por el
  // que entró la reserva: es lo que define el acuerdo con la agencia.
  const tarifaTipo: TarifaTipo = agenciaId ? 'neto' : (CANAL_TARIFA[canal] ?? 'rack')

  /*
    Se cotiza ANTES de tocar la tabla de huéspedes.

    Antes el huésped se creaba primero y, si la reserva fallaba —por ejemplo por
    no haber tarifa cargada—, quedaba en la base un registro sin ninguna reserva
    asociada. Cotizar primero convierte el caso más común de fallo en un
    rechazo limpio, sin escribir nada.
  */
  const cotizacion = await cotizarEstadia({ tipoUnidadId, checkIn, checkOut, tarifaTipo })
  if (cotizacion.faltanTarifas) {
    return {
      error:
        'No hay tarifa cargada para esas fechas. Cargá la temporada y sus precios en Configuración → Temporadas.',
      valores,
    }
  }

  // Reusar el huésped por email o crearlo.
  let huespedId: string | null = null
  if (email) {
    const { data: existente } = await supabase
      .from('huespedes')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    huespedId = existente?.id ?? null
  }

  // Solo hay que revertir el huésped si lo creó ESTA llamada: si ya existía,
  // borrarlo destruiría la ficha de alguien que se alojó antes.
  let huespedCreadoAca = false
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await supabase
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email: email || null, doc_numero: docNumero })
      .select('id')
      .single()
    if (eHuesped || !nuevo) return { error: 'No se pudo registrar al huésped.', valores }
    huespedId = nuevo.id
    huespedCreadoAca = true
  }

  if (!huespedId) return { error: 'No se pudo registrar al huésped.', valores }

  // Alta atómica: unidad libre + cotización + anti-overbooking (helper compartido).
  const res = await crearReservaEnUnidadLibre(supabase, {
    tipoUnidadId,
    checkIn,
    checkOut,
    huespedes: huespedesCant,
    huespedId,
    canal,
    tarifaTipo,
    estado: 'confirmada',
  })

  if (!res.ok) {
    // La cotización ya se validó arriba, así que llegar acá significa que la
    // unidad se ocupó entre la búsqueda y el alta. Si el huésped se creó en
    // esta misma llamada, se revierte: no debe quedar una ficha sin reserva.
    if (huespedCreadoAca) {
      // Compensación: se loguea y NO se corta. El error que el usuario tiene que
      // ver es `res.error` —por qué no se pudo reservar—, no el del rollback. Si
      // esto redirigiera, taparía la causa real. Si el borrado falla queda una
      // ficha de huésped sin reserva, que es prolijable a mano; perder el motivo
      // del rechazo, no.
      const { error: eRollback } = await supabase.from('huespedes').delete().eq('id', huespedId)
      registrarFalla(eRollback, `rollback del huésped ${huespedId} tras fallar el alta`)
    }
    return { error: res.error, valores }
  }

  // El vínculo con la agencia se guarda aparte: el helper de alta atómica es
  // compartido con el portal público, donde no existe el concepto de convenio.
  if (agenciaId) {
    const { error } = await supabase
      .from('reservas')
      .update({ agencia_id: agenciaId })
      .eq('id', res.reserva.id)
    // La reserva ya está creada: no se devuelve `{ error }` porque diría que no
    // se pudo reservar, y sí se pudo. Va al detalle avisando qué quedó sin
    // guardar, que además decide la tarifa y la cuenta corriente.
    cortarSiFalla(error, `/panel/reservas/${res.reserva.id}`, 'agencia')
  }

  redirect(`/panel/reservas/${res.reserva.id}`)
}

/**
 * Cambia el estado de una reserva validando la transición con la máquina de
 * estados. El trigger de la base sincroniza las estadías (libera/ocupa inventario).
 */
export async function cambiarEstadoReserva(formData: FormData): Promise<void> {
  const id = String(formData.get('reserva_id') ?? '')
  const nuevo = String(formData.get('nuevo_estado') ?? '') as EstadoReserva
  if (!id || !nuevo) redirect('/panel/reservas')

  const supabase = await crearClienteServidor()
  const { data: reserva } = await supabase
    .from('reservas')
    .select(
      'estado, total, huesped_id, huesped:huespedes!reservas_huesped_id_fkey(nombre, email)',
    )
    .eq('id', id)
    .single()
  if (!reserva) redirect('/panel/reservas')

  if (!puedeTransicionar(reserva.estado as EstadoReserva, nuevo)) {
    redirect(`/panel/reservas/${id}?error=transicion`)
  }

  const { error: eEstado } = await supabase.from('reservas').update({ estado: nuevo }).eq('id', id)
  cortarSiFalla(eEstado, `/panel/reservas/${id}`, 'estado')

  // Fidelidad: el check-out otorga puntos al huésped (una sola vez; 'checkout' es terminal).
  if (nuevo === 'checkout' && reserva.huesped_id) {
    const puntos = puntosPorEstadia(Number(reserva.total))
    if (puntos > 0) {
      const { data: h } = await supabase
        .from('huespedes')
        .select('puntos')
        .eq('id', reserva.huesped_id)
        .single()

      const previos = h?.puntos ?? 0
      const totales = previos + puntos
      const { error: ePuntos } = await supabase
        .from('huespedes')
        .update({ puntos: totales })
        .eq('id', reserva.huesped_id)
      // El check-out ya quedó hecho arriba. Se corta igual: perder los puntos de
      // un huésped en silencio es un problema real, y avisando se pueden cargar
      // a mano. El aviso de nivel no se manda, que es lo correcto si no se pudo
      // guardar el nivel nuevo.
      cortarSiFalla(ePuntos, `/panel/reservas/${id}`, 'puntos')

      // Solo se avisa si la estadía lo hizo CAMBIAR de nivel; sumar puntos sin
      // cruzar el umbral no amerita un correo.
      const nivelPrevio = nivelFidelidad(previos)
      const nivelNuevo = nivelFidelidad(totales)
      const huespedFid = reserva.huesped as unknown as {
        nombre: string
        email: string | null
      } | null

      if (nivelNuevo !== nivelPrevio && huespedFid?.email) {
        await enviarPlantilla('cambio_nivel_fidelidad', huespedFid.email, {
          nombre: huespedFid.nombre,
          nivel: ETIQUETAS_NIVEL[nivelNuevo],
          puntos: totales,
        })
      }
    }

    // El trigger `reservas_generar_encuesta` ya creó la encuesta con su token:
    // acá solo se le manda el enlace al huésped.
    const huesped = reserva.huesped as unknown as { nombre: string; email: string | null } | null
    const { data: encuesta } = await supabase
      .from('encuestas_satisfaccion')
      .select('token')
      .eq('reserva_id', id)
      .maybeSingle()

    if (encuesta?.token && huesped?.email) {
      await enviarPlantilla('encuesta_postcheckout', huesped.email, {
        nombre: huesped.nombre,
        enlace: `${urlDelSitio()}/encuesta/${encuesta.token}`,
      })
    }
  }

  redirect(`/panel/reservas/${id}`)
}

/**
 * Registra un pago (seña / saldo / reembolso) sobre la reserva. Si con este pago
 * la reserva queda saldada, intenta la transición a `pagada`.
 */
export async function registrarPago(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  const medio = String(formData.get('medio') ?? 'efectivo')
  const tipo = String(formData.get('tipo') ?? 'saldo')
  const monto = Number(formData.get('monto') ?? 0)
  if (!reservaId) redirect('/panel/reservas')
  if (!(monto > 0)) redirect(`/panel/reservas/${reservaId}?error=monto`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('pagos')
    .insert({ reserva_id: reservaId, medio, tipo, monto, estado: 'aprobado' })
  if (error) redirect(`/panel/reservas/${reservaId}?error=pago`)

  // ¿Quedó saldada? → intentar pasar a 'pagada'.
  const { data: reserva } = await supabase
    .from('reservas')
    .select('estado, total')
    .eq('id', reservaId)
    .single()
  if (reserva && reserva.estado !== 'pagada') {
    const { data: pagos } = await supabase
      .from('pagos')
      .select('tipo, monto, estado')
      .eq('reserva_id', reservaId)
    const resumen = resumenPagos(Number(reserva.total), (pagos ?? []) as Pago[])
    if (resumen.saldada && puedeTransicionar(reserva.estado as EstadoReserva, 'pagada')) {
      const { error: eSaldada } = await supabase
        .from('reservas')
        .update({ estado: 'pagada' })
        .eq('id', reservaId)
      // Mismo fallo que tenía el webhook: el pago ya está registrado, y si esto
      // se pierde queda cobrado sin marcar. Acá al menos hay alguien mirando la
      // pantalla, pero solo si se le dice.
      cortarSiFalla(eSaldada, `/panel/reservas/${reservaId}`, 'saldada')
    }
  }

  redirect(`/panel/reservas/${reservaId}`)
}

/** Carga un consumo (producto × cantidad) a la cuenta de la reserva. */
export async function agregarConsumo(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  const productoId = String(formData.get('producto_id') ?? '')
  const cantidad = Math.max(1, Number(formData.get('cantidad') ?? 1) || 1)
  if (!reservaId || !productoId) redirect(`/panel/reservas/${reservaId}`)

  const supabase = await crearClienteServidor()
  const { data: producto } = await supabase
    .from('productos_servicios')
    .select('precio')
    .eq('id', productoId)
    .single()
  if (producto) {
    const { error } = await supabase.from('consumos').insert({
      reserva_id: reservaId,
      producto_id: productoId,
      cantidad,
      precio_unitario: Number(producto.precio),
    })
    // El trigger de la base descuenta stock al insertar: si esto falla y no se
    // avisa, el consumo no se cobra y el stock queda mostrando otra cosa.
    cortarSiFalla(error, `/panel/reservas/${reservaId}`, 'consumo')
  }
  redirect(`/panel/reservas/${reservaId}`)
}

/** Quita un consumo de la cuenta. */
export async function quitarConsumo(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  const consumoId = String(formData.get('consumo_id') ?? '')
  if (consumoId) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.from('consumos').delete().eq('id', consumoId)
    cortarSiFalla(error, `/panel/reservas/${reservaId}`, 'quitar_consumo')
  }
  redirect(`/panel/reservas/${reservaId}`)
}

/**
 * Condición del hotel frente al IVA y punto de venta habilitado.
 *
 * Son datos de configuración fiscal; viven acá hasta que exista una tabla de
 * parámetros generales del establecimiento.
 */
const CONDICION_EMISOR: CondicionIva = 'responsable_inscripto'
const PUNTO_VENTA = 1
/** Alojamiento y servicios tributan al 21 % en Argentina. */
const ALICUOTA = 21

interface ReceptorFactura {
  condicion: CondicionIva
  cuit: string | null
}

/**
 * Emite la factura de la reserva.
 *
 * Resuelve la letra del comprobante según la condición frente al IVA del
 * receptor (la agencia si la reserva vino por convenio, si no el huésped),
 * discrimina el impuesto y solicita el CAE al proveedor de facturación
 * electrónica.
 *
 * ⚠️ El CAE lo emite un proveedor **simulado**: los comprobantes no tienen
 * validez fiscal (ver ADR 0012).
 */
export async function emitirFactura(formData: FormData): Promise<void> {
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!reservaId) redirect('/panel/reservas')

  const sesion = await obtenerSesion()
  const supabase = await crearClienteServidor()

  const { data: existente } = await supabase
    .from('facturas')
    .select('id')
    .eq('reserva_id', reservaId)
    .maybeSingle()

  // Una reserva se factura una sola vez: si ya existe, se muestra la emitida.
  if (existente) redirect(`/panel/reservas/${reservaId}/factura`)

  const { data: reserva } = await supabase
    .from('reservas')
    .select(
      'estado, total, agencia_id, huesped:huespedes!reservas_huesped_id_fkey(condicion_iva, doc_tipo, doc_numero)',
    )
    .eq('id', reservaId)
    .single()

  if (!reserva) redirect('/panel/reservas')

  // Solo se factura una estadía consumida: emitir el comprobante de una reserva
  // pendiente o cancelada dejaría, con CAE real, un documento fiscal que después
  // hay que anular con nota de crédito.
  const motivo = motivoNoFacturable(String(reserva.estado), false)
  if (motivo) redirect(`/panel/reservas/${reservaId}?error=${motivo}`)

  const { data: consumosData } = await supabase
    .from('consumos')
    .select('cantidad, precio_unitario')
    .eq('reserva_id', reservaId)

  const consumos: Consumo[] = (consumosData ?? []).map((c) => ({
    cantidad: c.cantidad as number,
    precioUnitario: Number(c.precio_unitario),
  }))
  const cuenta = cuentaConsolidada(Number(reserva.total ?? 0), consumos)

  // El receptor es la agencia cuando la reserva entró por convenio; si no, el
  // huésped. De ahí sale la letra del comprobante.
  let receptor: ReceptorFactura
  if (reserva.agencia_id) {
    const { data: agencia } = await supabase
      .from('agencias')
      .select('condicion_iva, cuit')
      .eq('id', reserva.agencia_id)
      .single()
    receptor = {
      condicion: (agencia?.condicion_iva ?? 'responsable_inscripto') as CondicionIva,
      cuit: (agencia?.cuit as string) ?? null,
    }
  } else {
    const h = reserva.huesped as unknown as {
      condicion_iva: CondicionIva
      doc_tipo: string | null
      doc_numero: string | null
    } | null
    // Solo se toma el documento como CUIT si efectivamente lo es.
    const posibleCuit = h?.doc_tipo?.toUpperCase() === 'CUIT' ? h.doc_numero : null
    receptor = {
      condicion: h?.condicion_iva ?? 'consumidor_final',
      cuit: posibleCuit,
    }
  }

  const tipo = tipoComprobante(CONDICION_EMISOR, receptor.condicion)
  const cuitLimpio = receptor.cuit ? normalizarCuit(receptor.cuit) : null

  // Un comprobante A sin CUIT válido lo rechazaría AFIP: se corta antes.
  if (exigeCuitReceptor(tipo) && (!cuitLimpio || !cuitValido(cuitLimpio))) {
    redirect(`/panel/reservas/${reservaId}?error=cuit`)
  }

  const desglose = desglosarIva(cuenta.total, ALICUOTA)

  // Numeración correlativa: la reserva el contador de la base con bloqueo de
  // fila (migración 0025). Antes se hacía con `count(*) + 1`, que ante dos
  // emisiones simultáneas generaba el mismo número.
  const { data: siguiente, error: eNumero } = await supabase.rpc(
    'siguiente_numero_comprobante',
    { p_punto_venta: PUNTO_VENTA },
  )
  if (eNumero || typeof siguiente !== 'number') {
    redirect(`/panel/reservas/${reservaId}?error=numeracion`)
  }

  const proveedor = obtenerProveedorFacturacion()
  const resultado = await proveedor.solicitarCae({
    tipo,
    puntoVenta: PUNTO_VENTA,
    total: desglose.total,
    neto: desglose.neto,
    iva: desglose.iva,
    condicionReceptor: receptor.condicion,
    cuitReceptor: cuitLimpio,
    fecha: hoyISO(),
  })

  if (!resultado.ok) redirect(`/panel/reservas/${reservaId}?error=cae`)

  const { error: eFactura } = await supabase.from('facturas').insert({
    reserva_id: reservaId,
    total: desglose.total,
    neto: desglose.neto,
    iva: desglose.iva,
    alicuota_iva: ALICUOTA,
    tipo_comprobante: tipo,
    condicion_iva_receptor: receptor.condicion,
    cuit_receptor: cuitLimpio,
    punto_venta: PUNTO_VENTA,
    numero_fiscal: numeroComprobante(PUNTO_VENTA, siguiente),
    cae: resultado.cae,
    cae_vto: resultado.caeVto,
    cae_solicitado_en: new Date().toISOString(),
    emitida_por: sesion?.userId ?? null,
  })
  // El punto más caro del archivo: acá ya se pidió el CAE al proveedor y ya se
  // consumió el número correlativo del punto de venta. Si el insert se pierde en
  // silencio queda un CAE emitido y un número gastado SIN factura, y el usuario
  // ve la pantalla como si no hubiera pasado nada. La correlatividad es una
  // obligación formal (ADR 0015): el hueco tiene que ser visible.
  cortarSiFalla(eFactura, `/panel/reservas/${reservaId}`, 'factura')

  redirect(`/panel/reservas/${reservaId}/factura`)
}

export interface EstadoReservaGrupal {
  error?: string
}

/**
 * Alta de una reserva GRUPAL: crea varias reservas (una por unidad) que comparten
 * un `grupo_id`. Reutiliza el alta atómica por unidad (anti-overbooking) y permite
 * check-out escalonado y facturación consolidada por grupo.
 */
export async function crearReservaGrupal(
  _prev: EstadoReservaGrupal,
  formData: FormData,
): Promise<EstadoReservaGrupal> {
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  const canal = String(formData.get('canal') ?? 'directo')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const apellido = String(formData.get('apellido') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()

  if (!checkIn || !checkOut || checkOut <= checkIn) return { error: 'Revisá las fechas.' }
  if (!apellido) return { error: 'Ingresá el apellido del titular del grupo.' }

  const selecciones: { tipoUnidadId: string; cantidad: number }[] = []
  for (const [k, v] of formData.entries()) {
    if (k.startsWith('qty_')) {
      const cantidad = Math.max(0, Number(v) || 0)
      if (cantidad > 0) selecciones.push({ tipoUnidadId: k.slice(4), cantidad })
    }
  }
  if (selecciones.length === 0) return { error: 'Elegí al menos una unidad.' }

  const supabase = await crearClienteServidor()
  const tarifaTipo = CANAL_TARIFA[canal] ?? 'rack'

  let huespedId: string | null = null
  if (email) {
    const { data: existente } = await supabase.from('huespedes').select('id').eq('email', email).maybeSingle()
    huespedId = existente?.id ?? null
  }
  if (!huespedId) {
    const { data: nuevo, error: eHuesped } = await supabase
      .from('huespedes')
      .insert({ nombre: nombre || apellido, apellido, email: email || null })
      .select('id')
      .single()
    if (eHuesped || !nuevo) return { error: 'No se pudo registrar al titular.' }
    huespedId = nuevo.id
  }

  if (!huespedId) return { error: 'No se pudo registrar al titular.' }

  const grupoId = crypto.randomUUID()
  let creadas = 0
  let primerError: string | undefined
  for (const s of selecciones) {
    for (let i = 0; i < s.cantidad; i++) {
      const res = await crearReservaEnUnidadLibre(supabase, {
        tipoUnidadId: s.tipoUnidadId,
        checkIn,
        checkOut,
        huespedes: 2,
        huespedId,
        canal,
        tarifaTipo,
        estado: 'confirmada',
      })
      if (!res.ok) {
        primerError ??= res.error
        break // no quedan más unidades de este tipo
      }
      const { error: eGrupo } = await supabase
        .from('reservas')
        .update({ grupo_id: grupoId })
        .eq('id', res.reserva.id)
      // No se corta: la reserva quedó creada y las demás del grupo también deben
      // intentarse. Sin el `grupo_id` aparece como individual, que se arregla
      // desde el panel; abortar el lote a medias sería peor.
      registrarFalla(eGrupo, `vínculo de la reserva ${res.reserva.id} con el grupo ${grupoId}`)
      creadas++
    }
  }

  if (creadas === 0) return { error: primerError ?? 'No se pudo crear el grupo.' }
  redirect(`/panel/reservas?grupo=${grupoId}`)
}

/**
 * Reprograma una reserva: cambia las fechas de su estadía, recotiza el total y
 * respeta el anti-overbooking (si el nuevo período pisa otra estadía activa de la
 * misma unidad, la restricción de exclusión lo rechaza).
 */
export async function reprogramarReserva(formData: FormData): Promise<void> {
  const id = String(formData.get('reserva_id') ?? '')
  const checkIn = String(formData.get('check_in') ?? '')
  const checkOut = String(formData.get('check_out') ?? '')
  if (!id) redirect('/panel/reservas')
  if (!checkIn || !checkOut || checkOut <= checkIn) redirect(`/panel/reservas/${id}?error=fechas`)

  const supabase = await crearClienteServidor()
  const { data: estadia } = await supabase
    .from('estadias')
    .select('id, tipo_unidad_id')
    .eq('reserva_id', id)
    .limit(1)
    .single()
  const { data: reserva } = await supabase.from('reservas').select('tarifa_tipo').eq('id', id).single()
  if (!estadia || !reserva) redirect(`/panel/reservas/${id}`)

  const tarifaTipo: TarifaTipo = reserva.tarifa_tipo === 'neto' ? 'neto' : 'rack'
  const cot = await cotizarEstadia({
    tipoUnidadId: estadia.tipo_unidad_id as string,
    checkIn,
    checkOut,
    tarifaTipo,
  })
  if (cot.faltanTarifas) redirect(`/panel/reservas/${id}?error=tarifa`)
  const noches = diasEntre(checkIn, checkOut)
  const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0

  const { error } = await supabase
    .from('estadias')
    .update({ periodo: `[${checkIn},${checkOut})`, precio_noche: precioNoche })
    .eq('id', estadia.id)
  if (error) {
    redirect(`/panel/reservas/${id}?error=${error.code === '23P01' ? 'overlap' : 'repro'}`)
  }
  const { error: eTotal } = await supabase
    .from('reservas')
    .update({ total: cot.resumen.total })
    .eq('id', id)
  // Las fechas ya se movieron. Si el total no se actualiza, la reserva queda con
  // el precio de las fechas viejas: hay que decirlo, no es un detalle.
  cortarSiFalla(eTotal, `/panel/reservas/${id}`, 'total')
  redirect(`/panel/reservas/${id}`)
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
  const id = String(formData.get('reserva_id') ?? '')
  const unidadDestino = String(formData.get('unidad_destino') ?? '')
  const motivo = String(formData.get('motivo') ?? '')
  const politica: PoliticaTarifa =
    formData.get('politica_tarifa') === 'recotizar' ? 'recotizar' : 'mantener'

  if (!id) redirect('/panel/reservas')
  if (!unidadDestino) redirect(`/panel/reservas/${id}?error=sin_destino`)

  const supabase = await crearClienteServidor()
  const { data: estadia } = await supabase
    .from('estadias')
    .select('unidad_id, estado, periodo')
    .eq('reserva_id', id)
    .maybeSingle()
  if (!estadia) redirect(`/panel/reservas/${id}?error=sin_estadia`)

  // Se valida en el dominio ANTES de ir a la base: da un mensaje claro y evita
  // una llamada inútil. La función SQL vuelve a comprobarlo porque la
  // aplicación no es la única puerta a los datos.
  const rechazo = motivoRechazoMudanza(
    estadia.estado as EstadoReserva,
    estadia.unidad_id as string,
    unidadDestino,
  )
  if (rechazo) redirect(`/panel/reservas/${id}?error=${rechazo}`)

  const { data, error } = await supabase.rpc('cambiar_unidad_reserva', {
    p_reserva_id: id,
    p_unidad_destino: unidadDestino,
    p_motivo: motivo,
  })
  if (error) {
    redirect(`/panel/reservas/${id}?error=${error.code === '23P01' ? 'ocupada' : 'mudanza'}`)
  }

  const resultado = data as {
    ok: boolean
    motivo?: string
    tipo_destino?: string
    cambio_de_tipo?: boolean
  }
  if (!resultado.ok) redirect(`/panel/reservas/${id}?error=${resultado.motivo ?? 'mudanza'}`)

  // La recotización va aparte y DESPUÉS de la mudanza, no dentro de la
  // transacción: si fallara, el huésped ya está mudado —que es lo urgente— y el
  // precio se corrige a mano. Al revés (revertir la mudanza por un problema de
  // tarifa) sería peor.
  if (debeRecotizar(politica, Boolean(resultado.cambio_de_tipo)) && resultado.tipo_destino) {
    const { data: reserva } = await supabase
      .from('reservas')
      .select('tarifa_tipo')
      .eq('id', id)
      .single()

    const { desde, hasta } = parsearPeriodo(estadia.periodo as string)
    const cot = await cotizarEstadia({
      tipoUnidadId: resultado.tipo_destino,
      checkIn: desde,
      checkOut: hasta,
      tarifaTipo: reserva?.tarifa_tipo === 'neto' ? 'neto' : 'rack',
    })

    if (!cot.faltanTarifas) {
      const noches = diasEntre(desde, hasta)
      const precioNoche = noches > 0 ? Number((cot.resumen.totalNeto / noches).toFixed(2)) : 0
      const { error: ePrecio } = await supabase
        .from('estadias')
        .update({ precio_noche: precioNoche })
        .eq('reserva_id', id)
      cortarSiFalla(ePrecio, `/panel/reservas/${id}`, 'total')
      const { error: eTotalMudanza } = await supabase
        .from('reservas')
        .update({ total: cot.resumen.total })
        .eq('id', id)
      // La mudanza ya se hizo. Si el precio no se recotiza, la reserva queda
      // facturando la unidad anterior.
      cortarSiFalla(eTotalMudanza, `/panel/reservas/${id}`, 'total')
    } else {
      redirect(`/panel/reservas/${id}?error=tarifa_destino`)
    }
  }

  redirect(`/panel/reservas/${id}?ok=mudanza`)
}

/**
 * Envía el recordatorio a los huéspedes que llegan mañana.
 *
 * Es una tarea programada, como `expirar_reservas_pendientes` o
 * `generar_mantenimiento_preventivo`: hoy se dispara a mano desde el panel y en
 * producción iría por cron. Se limita a las reservas activas con email cargado.
 */
export async function enviarRecordatoriosLlegada(): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/login')

  const manana = sumarDias(hoyISO(), 1)
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('estadias')
    .select(
      'periodo, reserva:reservas(codigo, estado, huesped:huespedes!reservas_huesped_id_fkey(nombre, email))',
    )
    .in('estado', [...ESTADOS_ACTIVOS])

  const filas = (data ?? []) as unknown as {
    periodo: string
    reserva: {
      codigo: string
      estado: EstadoReserva
      huesped: { nombre: string; email: string | null } | null
    } | null
  }[]

  let enviados = 0
  for (const fila of filas) {
    // El check-in es el inicio del período de la estadía.
    if (parsearPeriodo(fila.periodo).desde !== manana) continue
    const h = fila.reserva?.huesped
    if (!h?.email) continue

    const r = await enviarPlantilla('recordatorio_checkin', h.email, {
      nombre: h.nombre,
      codigo: fila.reserva!.codigo,
      check_in: formatoFechaCorta(manana),
      hora_check_in: HORA_CHECK_IN,
    })
    if (r.ok) enviados++
  }

  redirect(`/panel/reservas?recordatorios=${enviados}`)
}
