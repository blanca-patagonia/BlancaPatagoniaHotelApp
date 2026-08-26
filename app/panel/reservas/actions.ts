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
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { motivoNoCargable } from '@/lib/domain/servicio'
import { saldarSiCorresponde } from '@/lib/reservas/saldar'
import { puntosPorEstadia, nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import { requerirAcceso } from '@/lib/auth/session'
import { hoyISO, sumarDias, parsearPeriodo, formatoFechaCorta } from '@/lib/fechas'
import {
  tipoComprobante,
  numeroComprobante,
  cuitValido,
  normalizarCuit,
  exigeCuitReceptor,
  motivoNoFacturable,
  type CondicionIva,
} from '@/lib/domain/facturacion'
import { exentoDeIva, desglosarConExencion } from '@/lib/domain/exencion-iva'
import { obtenerProveedorFacturacion } from '@/lib/facturacion'
import { obtenerProveedor } from '@/lib/payments'
import { iniciarCobro, falloElCobro } from '@/lib/payments/servicio'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { imputarEnUSD, motivoNoSeCobra, MONEDA_BASE } from '@/lib/domain/cobro'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { enviarPlantilla } from '@/lib/email'
import { urlDelSitio } from '@/lib/env'

import { HORA_CHECK_IN } from '@/lib/domain/hotel'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import {
  paxQueOcupa,
  validarOcupantes,
  type Ocupantes,
} from '@/lib/domain/ocupantes'
import {
  GARANTIAS,
  PLANES,
  SEGMENTOS,
  type Garantia,
  type Plan,
  type Segmento,
} from '@/lib/domain/reservas'

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
    /* Desglose de ocupantes y condiciones comerciales (paso 6). */
    adultos?: string
    menores?: string
    bebes?: string
    camas_extra?: string
    cunas?: string
    no_mover?: string
    plan?: string
    garantia?: string
    segmento?: string
    voucher?: string
    descuento_pct?: string
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
  await requerirAcceso('reservas')
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

  // ── Desglose de ocupantes y condiciones comerciales (paso 6) ───────────────
  const entero = (clave: string, porDefecto = 0) => {
    const n = Number(formData.get(clave))
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : porDefecto
  }

  const ocupantes: Ocupantes = {
    // Sin desglose cargado se asume que todos los huéspedes de la búsqueda son
    // adultos, que es lo que el sistema suponía antes del paso 6.
    adultos: entero('adultos', huespedesCant) || huespedesCant,
    menores: entero('menores'),
    bebes: entero('bebes'),
    camasExtra: entero('camas_extra'),
    cunas: entero('cunas'),
  }
  const noMover = formData.get('no_mover') === '1'

  const planCrudo = String(formData.get('plan') ?? 'desayuno')
  const garantiaCrudo = String(formData.get('garantia') ?? 'sin_garantia')
  const segmentoCrudo = String(formData.get('segmento') ?? '')
  const voucher = String(formData.get('voucher') ?? '').trim()
  const descuentoPct = Math.min(100, Math.max(0, Number(formData.get('descuento_pct')) || 0))

  // Se devuelve tal cual vino para reponer el formulario ante cualquier error.
  const valores = {
    apellido,
    nombre,
    email,
    doc_numero: docNumero,
    canal,
    agencia_id: agenciaId,
    adultos: String(ocupantes.adultos),
    menores: String(ocupantes.menores),
    bebes: String(ocupantes.bebes),
    camas_extra: String(ocupantes.camasExtra),
    cunas: String(ocupantes.cunas),
    no_mover: noMover ? '1' : '',
    plan: planCrudo,
    garantia: garantiaCrudo,
    segmento: segmentoCrudo,
    voucher,
    descuento_pct: String(descuentoPct),
  }

  if (!tipoUnidadId || !checkIn || !checkOut) {
    return { error: 'Elegí fechas y un tipo de unidad.', valores }
  }
  if (checkOut <= checkIn) {
    return { error: 'El check-out debe ser posterior al check-in.', valores }
  }
  if (!apellido) return { error: 'Ingresá al menos el apellido del huésped.', valores }

  // El desglose se valida contra la capacidad de la unidad elegida. Se hace acá y
  // no en la base porque el mensaje tiene que decir cuántos entran y por qué, no
  // «viola una restricción».
  const { data: tipoElegido } = await (await crearClienteServidor())
    .from('tipos_unidad')
    .select('capacidad_max')
    .eq('id', tipoUnidadId)
    .maybeSingle<{ capacidad_max: number }>()

  const problemas = validarOcupantes(ocupantes, tipoElegido?.capacidad_max)
  if (problemas.length > 0) return { error: problemas[0], valores }

  const plan = (PLANES as readonly string[]).includes(planCrudo) ? (planCrudo as Plan) : 'desayuno'
  const garantia = (GARANTIAS as readonly string[]).includes(garantiaCrudo)
    ? (garantiaCrudo as Garantia)
    : 'sin_garantia'
  const segmento = (SEGMENTOS as readonly string[]).includes(segmentoCrudo)
    ? (segmentoCrudo as Segmento)
    : undefined

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
    // `crear_reserva` deriva el pax del desglose, así que este valor queda como
    // respaldo para el caso sin desglose.
    huespedes: paxQueOcupa(ocupantes),
    huespedId,
    canal,
    tarifaTipo,
    estado: 'confirmada',
    ocupantes,
    noMover,
    comercial: {
      plan,
      garantia,
      segmento,
      voucher,
      // El descuento del convenio de la agencia ya está aplicado en la cotización
      // neta; éste es el adicional que carga recepción.
      descuentoPct,
    },
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
  await requerirAcceso('reservas')
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
      /*
        La suma la hace la base (`sumar_puntos_huesped`, migración 0053), no la app.

        Antes esto era read-then-write y **descartaba el error de la lectura**: con la
        lectura fallada, `previos` quedaba en 0 y el `update` escribía solo los puntos
        de esta estadía, **borrando todo lo acumulado** del huésped. El check-out se
        completaba igual y nadie se enteraba.

        Arreglar solo el error de lectura habría dejado abierta una segunda carrera:
        dos check-outs simultáneos del mismo huésped —dos reservas, dos personas en el
        mostrador— leen el mismo valor previo y el segundo update pisa al primero.
        `update ... set puntos = puntos + n` no tiene lectura que falle ni valor previo
        que quede viejo.
      */
      const { data: totalesData, error: ePuntos } = await supabase.rpc('sumar_puntos_huesped', {
        p_huesped: reserva.huesped_id,
        p_puntos: puntos,
      })

      // El check-out ya quedó hecho arriba. Se corta igual: perder los puntos de
      // un huésped en silencio es un problema real, y avisando se pueden cargar
      // a mano. El aviso de nivel no se manda, que es lo correcto si no se pudo
      // guardar el nivel nuevo.
      cortarSiFalla(ePuntos, `/panel/reservas/${id}`, 'puntos')

      const totales = Number(totalesData ?? 0)
      const previos = totales - puntos

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
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  const medio = String(formData.get('medio') ?? 'efectivo')
  const tipo = String(formData.get('tipo') ?? 'saldo')
  const montoIngresado = Number(formData.get('monto') ?? 0)
  const moneda = String(formData.get('moneda') ?? MONEDA_BASE)
  if (!reservaId) redirect('/panel/reservas')
  if (!(montoIngresado > 0)) redirect(`/panel/reservas/${reservaId}?error=monto`)

  /*
    El importe se ingresa en la moneda en la que se cobró, y se guarda en las
    dos: `monto` en USD —que es lo único que salda la reserva— y `monto_cobrado`
    con lo que de verdad entró a la caja.

    Es la parte que faltaba para el mostrador. Un huésped que paga en efectivo en
    pesos es el caso más común del hotel, y antes había que hacer la cuenta a
    mano y anotar el resultado en dólares: sin registro de cuántos pesos entraron
    ni a qué cambio, la caja no cierra contra el sistema.
  */
  let montoUSD = montoIngresado
  let montoCobrado: number | null = null
  let cotizacion: number | null = null

  if (moneda !== MONEDA_BASE) {
    if (!esMonedaExtranjera(moneda)) {
      redirect(`/panel/reservas/${reservaId}?error=moneda`)
    }
    const vigente = await cotizacionVigente(moneda)
    // `venta` es la que se cobra: cuántas unidades cuesta comprar un dólar.
    const valor = vigente?.venta ?? null
    if (!valor) redirect(`/panel/reservas/${reservaId}?error=sin_cotizacion`)

    const enUSD = imputarEnUSD(montoIngresado, valor)
    if (enUSD === null) redirect(`/panel/reservas/${reservaId}?error=monto`)

    montoUSD = enUSD
    montoCobrado = montoIngresado
    cotizacion = valor
  }

  /*
    Rastro del cobro con tarjeta.

    Sin el cupón, un cobro con posnet se registra igual que uno en efectivo, y
    cuando la liquidación de la terminal no cierra contra el sistema no hay por
    dónde empezar a buscar. Los últimos cuatro dígitos PCI-DSS los permite; el
    número entero no se pide, no se guarda y la migración 0067 lo rechaza.
  */
  const esTarjeta = medio === 'tarjeta'
  const cupon = esTarjeta ? String(formData.get('cupon') ?? '').trim() : ''
  const ultimos4 = esTarjeta ? String(formData.get('ultimos4') ?? '').trim() : ''
  const marca = esTarjeta ? String(formData.get('tarjeta_marca') ?? '').trim() : ''

  if (ultimos4 && !/^[0-9]{4}$/.test(ultimos4)) {
    redirect(`/panel/reservas/${reservaId}?error=ultimos4`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('pagos').insert({
    reserva_id: reservaId,
    medio,
    tipo,
    monto: montoUSD,
    moneda,
    monto_cobrado: montoCobrado,
    cotizacion,
    estado: 'aprobado',
    cupon: cupon || null,
    ultimos4: ultimos4 || null,
    tarjeta_marca: marca || null,
  })
  if (error) redirect(`/panel/reservas/${reservaId}?error=pago`)

  // ¿Quedó saldada? → intentar pasar a 'pagada'.
  //
  // La regla vive en `lib/reservas/saldar.ts` y no acá porque el webhook de pagos
  // hace exactamente lo mismo. Estaban duplicadas y divergieron: allá se corrigió
  // para consolidar alojamiento + consumos, y acá quedó comparando contra
  // `reservas.total`, que cubre solo la estadía. Quien había consumido del frigobar
  // y pagaba el alojamiento en efectivo quedaba marcado «pagada» debiendo esa parte.
  const { error: eSaldada } = await saldarSiCorresponde(supabase, reservaId)
  // El pago ya está registrado. Si esto se pierde queda cobrado sin marcar, y acá
  // hay alguien mirando la pantalla — pero solo se entera si se le dice.
  cortarSiFalla(eSaldada ? { message: eSaldada } : null, `/panel/reservas/${reservaId}`, 'saldada')

  redirect(`/panel/reservas/${reservaId}`)
}

/**
 * Genera un link de pago y se lo deja a recepción para mandárselo al huésped.
 *
 * Para qué sirve en el mostrador. Es el caso del huésped que reserva por
 * teléfono o por WhatsApp: no está para dar la tarjeta, no quiere dictarla por
 * teléfono —y el hotel no debería anotarla— y todavía hay que asegurarle la
 * reserva. Se le manda el link, paga desde su celular y el webhook salda solo.
 *
 * Toda la parte delicada —congelar la cotización, escribir el pago pendiente, no
 * dejar dos links vivos— vive en `iniciarCobro`, que es el mismo camino que usa
 * el portal público. Acá sólo se decide qué se cobra y a dónde vuelve.
 */
export async function generarLinkDePago(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  const medio = String(formData.get('medio') ?? '')
  const tipoPedido = String(formData.get('tipo') ?? 'saldo')
  if (!reservaId) redirect('/panel/reservas')

  const supabase = await crearClienteServidor()

  const { data: reserva, error: eReserva } = await supabase
    .from('reservas')
    .select('id, codigo, estado, token, huesped:huespedes!reservas_huesped_id_fkey(email)')
    .eq('id', reservaId)
    .maybeSingle()

  cortarSiFalla(eReserva, `/panel/reservas/${reservaId}`, 'link_pago')
  if (!reserva) redirect('/panel/reservas')

  const cobro = await estadoDeCobro(supabase, reservaId)
  if (!cobro) redirect(`/panel/reservas/${reservaId}?error=link_sin_datos`)

  // Mismo criterio que en el portal: la seña sólo mientras no se haya pagado.
  const tipo = tipoPedido === 'senia' && !cobro.tieneSenia ? 'senia' : 'saldo'
  const monto = tipo === 'senia' ? Math.min(cobro.senia, cobro.saldo) : cobro.saldo

  const impedimento = motivoNoSeCobra(reserva.estado as EstadoReserva, cobro.saldo)
  if (impedimento) redirect(`/panel/reservas/${reservaId}?error=link_no_cobrable`)

  const base = urlDelSitio().replace(/\/$/, '')
  // El huésped vuelve a SU pantalla, no al panel: el link se abre desde su
  // teléfono y ahí no tiene —ni debe tener— sesión de staff.
  const volver = `${base}/reservar/confirmacion/${reserva.token}`

  const resultado = await iniciarCobro(supabase, {
    reservaId,
    tipo,
    montoUSD: monto,
    proveedor: medio,
    descripcion: `Hotel Blanca Patagonia · reserva ${reserva.codigo} · ${tipo === 'senia' ? 'seña' : 'saldo'}`,
    emailComprador: emailDelHuesped(reserva.huesped),
    urls: { exito: volver, error: volver, pendiente: volver },
  })

  if (falloElCobro(resultado)) {
    console.error(`[link de pago] ${reserva.codigo}: ${resultado.error}`)
    redirect(`/panel/reservas/${reservaId}?error=link_pasarela`)
  }

  redirect(`/panel/reservas/${reservaId}`)
}

/**
 * El email del huésped, venga como objeto o como array.
 *
 * PostgREST devuelve un embed to-one como objeto, pero el tipo generado lo
 * declara como array cuando no puede probar la cardinalidad.
 */
function emailDelHuesped(huesped: unknown): string | undefined {
  const h = Array.isArray(huesped) ? huesped[0] : huesped
  return (h as { email?: string } | null)?.email ?? undefined
}

/** Carga un consumo (producto × cantidad) a la cuenta de la reserva. */
export async function agregarConsumo(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  const productoId = String(formData.get('producto_id') ?? '')
  const cantidad = Math.max(1, Number(formData.get('cantidad') ?? 1) || 1)
  if (!reservaId || !productoId) redirect(`/panel/reservas/${reservaId}`)

  const supabase = await crearClienteServidor()

  /*
    ¿Se le puede cargar algo a esta reserva? (P3 del relevamiento del 15/08/2026)

    La cuenta NO se cierra en el check-out sino en la **factura**. Es lo que
    permite los dos casos reales de todos los días: el huésped que llega a las 9
    y desayuna antes del check-in de las 15, y el que hace el check-out a las 10
    habiendo desayunado esa mañana. En los dos consumió de verdad.

    Lo que sí corta es el comprobante emitido: un cargo posterior no entraría en
    él, y `facturas` es inmutable (migración 0034).
  */
  const [{ data: reservaEstado }, { data: facturaExistente }] = await Promise.all([
    supabase.from('reservas').select('estado').eq('id', reservaId).maybeSingle(),
    supabase.from('facturas').select('id').eq('reserva_id', reservaId).maybeSingle(),
  ])

  const motivo = motivoNoCargable(
    String(reservaEstado?.estado ?? ''),
    Boolean(facturaExistente),
  )
  if (motivo) redirect(`/panel/reservas/${reservaId}?error=${motivo}`)

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
  await requerirAcceso('reservas')
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
 * Registra de dónde sale el pago de la reserva (RG 3971, ADR 0024).
 *
 * Es la segunda de las dos condiciones de la exención de IVA al turista del
 * exterior; la primera —la residencia— vive en la ficha del huésped.
 *
 * ── Por qué son tres estados y no una casilla ───────────────────────────────
 *
 * Una casilla «exento» daría dos valores y obligaría a elegir uno al crear la
 * reserva, cuando todavía no se sabe cómo va a pagar. Acá:
 *
 *   sin_definir → todavía no se sabe. **No exime.**
 *   exterior    → tarjeta emitida afuera o transferencia del exterior. Exime.
 *   local       → efectivo, tarjeta o transferencia del país. No exime.
 *
 * El estado inicial es «no se sabe» y no «local», porque son cosas distintas:
 * una es falta de dato y la otra es un hecho comprobado. Las dos terminan
 * cobrando IVA, pero solo la segunda es una respuesta.
 */
export async function fijarOrigenDelPago(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!reservaId) redirect('/panel/reservas')

  const elegido = String(formData.get('origen_pago') ?? '')
  // Se traduce a los tres estados posibles de la columna. Cualquier otro valor
  // —incluido uno inventado en un POST directo— cae en «no se sabe», que es el
  // que NO exime: ante una entrada inesperada, se cobra el impuesto.
  const valor = elegido === 'exterior' ? true : elegido === 'local' ? false : null

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('reservas')
    .update({ pago_desde_exterior: valor })
    .eq('id', reservaId)

  cortarSiFalla(error, `/panel/reservas/${reservaId}`, 'origen_pago')

  // Sin `revalidatePath`: el resto del archivo resuelve con el `redirect` a la
  // misma ficha, que vuelve a renderizar el Server Component. Mezclar las dos
  // convenciones en un mismo archivo confunde más de lo que aporta.
  redirect(`/panel/reservas/${reservaId}`)
}

/**
 * Registra y verifica la tarjeta de garantía (ADR 0025).
 *
 * ⚠️ LO MÁS IMPORTANTE DE ESTA FUNCIÓN ES LO QUE **NO** HACE.
 *
 * Recibe el número de tarjeta y el CVV porque hay que pasárselos a la pasarela,
 * y los **descarta**. No se guardan, no se loguean, no se devuelven y no se
 * escriben en la URL. Lo único que persiste es lo que la pasarela devuelve:
 * token, últimos cuatro dígitos, marca, vencimiento y resultado.
 *
 * WinPAX guardaba número, vencimiento, autorización y PIN. Guardar un PAN
 * sacaría al hotel del alcance SAQ-A de PCI-DSS. La migración 0059 tiene
 * restricciones que rechazan un PAN en estas columnas, y `tests/garantia-
 * tarjeta.test.ts` falla si alguien agrega una columna que pueda contener uno.
 *
 * Si no hay pasarela contratada, el resultado es `no_soportado` y **así queda
 * registrado**: no se simula una verificación exitosa. Recepción tiene que poder
 * distinguir «el emisor la rechazó» de «no hay con qué probarla».
 */
export async function verificarTarjetaGarantia(formData: FormData): Promise<void> {
  await requerirAcceso('reservas')
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!reservaId) redirect('/panel/reservas')

  const numero = String(formData.get('tarjeta_numero') ?? '').trim()
  const vencimiento = String(formData.get('tarjeta_vencimiento') ?? '').trim()
  const titular = String(formData.get('tarjeta_titular') ?? '').trim()
  const cvv = String(formData.get('tarjeta_cvv') ?? '').trim()

  if (!numero || !vencimiento) {
    redirect(`/panel/reservas/${reservaId}?error=tarjeta_incompleta`)
  }

  const resultado = await obtenerProveedor(PROVEEDOR_GARANTIA)?.verificarTarjeta({
    numero,
    vencimiento,
    titular,
    cvv,
  })

  if (!resultado) redirect(`/panel/reservas/${reservaId}?error=tarjeta_sin_proveedor`)

  // El estado sale del resultado y NUNCA de lo que eligió quien carga: no hay
  // forma de marcar una tarjeta como verificada a mano.
  const estado = resultado.ok
    ? 'verificada'
    : resultado.noSoportado
      ? 'no_soportado'
      : 'rechazada'

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('reservas')
    .update({
      // `token` solo existe si la pasarela lo emitió. Con el simulador es nulo,
      // y eso es correcto: no hay nada con qué cobrar.
      tarjeta_token: resultado.token ?? null,
      tarjeta_ultimos4: resultado.ultimos4 ?? null,
      tarjeta_marca: resultado.marca ?? null,
      tarjeta_vencimiento: resultado.vencimiento ?? null,
      tarjeta_verificacion: estado,
      tarjeta_verificada_en: new Date().toISOString(),
      tarjeta_detalle: resultado.detalle ?? null,
    })
    .eq('id', reservaId)

  cortarSiFalla(error, `/panel/reservas/${reservaId}`, 'tarjeta')

  redirect(`/panel/reservas/${reservaId}`)
}

/**
 * Proveedor con el que se verifican las tarjetas de garantía.
 *
 * Hoy los dos son el mismo simulador y ninguno verifica. Se declara como
 * constante y no se elige en la pantalla porque la tarjeta se verifica contra la
 * pasarela que el hotel tenga contratada, que es una sola.
 */
const PROVEEDOR_GARANTIA = 'mercadopago'

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

  const sesion = await requerirAcceso('reservas')
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
      'estado, total, agencia_id, pago_desde_exterior, huesped:huespedes!reservas_huesped_id_fkey(condicion_iva, doc_tipo, doc_numero, residente_exterior)',
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

  /*
    Exención de IVA al turista del exterior (RG 3971, ADR 0024).

    Se decide ACÁ y no al cotizar, y es deliberado: la forma de pago recién se
    conoce al cobrar. Cotizar exento y después recibir efectivo dejaría un total
    que no cierra, y el error caro es el inverso —facturar exento sin que
    corresponda es IVA que el hotel no ingresó—.

    La exención se DERIVA de dos hechos (residencia del huésped + origen del
    pago). No hay ninguna casilla «exento» que alguien pueda tildar de más:
    `exentoDeIva` es la única puerta.

    Si la reserva entró por una agencia, el receptor del comprobante es la
    agencia y no el huésped, así que la exención del turista no aplica.
  */
  const huespedFiscal = reserva.huesped as unknown as {
    residente_exterior?: boolean | null
  } | null

  const exento =
    !reserva.agencia_id &&
    exentoDeIva({
      residenteExterior: Boolean(huespedFiscal?.residente_exterior),
      pagoDesdeExterior: (reserva.pago_desde_exterior as boolean | null) ?? null,
    })

  const desglose = desglosarConExencion({
    alojamientoConIva: cuenta.alojamiento,
    consumosConIva: cuenta.consumos,
    alicuota: ALICUOTA,
    exento,
  })

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
    // La alícuota efectiva sale del desglose, no de la constante: con todo el
    // comprobante exento es 0, y declarar 21 % sobre una base de cero confunde
    // a quien lee la factura y a quien la audita.
    alicuota_iva: desglose.alicuota,
    exento: desglose.exento,
    motivo_exencion: desglose.motivoExencion,
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
  // ── Si el insert chocó con la restricción única, la reserva YA está facturada ──
  //
  // Esta acción es check-then-act: entre el `select` del principio y este `insert`
  // no hay nada. Dos emisiones simultáneas —dos clics, o dos personas cerrando la
  // misma reserva desde dos puestos— pasan las dos por el `select`, las dos ven que
  // no hay factura, y las dos llegan hasta acá. La que pierde recibe 23505 de
  // `facturas_una_por_reserva` (migración 0045), que es la garantía funcionando: en
  // la base quedó un solo comprobante.
  //
  // Mandarla al error genérico sería mentirle a quien la usa: la reserva **está**
  // facturada, solo que la emitió el otro pedido. Lo correcto es mostrarle el
  // comprobante, igual que si hubiera llegado segunda en secuencia.
  // ⚠️ Lo que este arreglo NO resuelve, y hay que decirlo:
  //
  // El pedido que pierde la carrera llegó hasta acá, o sea que **ya consumió un
  // número correlativo** (`siguiente_numero_comprobante`, más arriba) y **ya le
  // pidió un CAE al proveedor**. Con el proveedor simulado no pasa nada. Con AFIP de
  // verdad quedaría un CAE emitido para un número que no tiene fila en `facturas`:
  // un salto en la numeración, que es una obligación formal (ADR 0015).
  //
  // No se arregla acá. Pedir el CAE después de insertar no alcanza —el CAE va en la
  // fila— y reservar la fila primero y completarla después choca con la
  // inmutabilidad de `facturas` (migración 0034). La salida es una función SQL
  // transaccional que numere, inserte y devuelva, con el CAE pedido dentro de la
  // misma transacción. Queda anotado como pendiente.
  //
  // La ventana es chica (dos pedidos en vuelo sobre la misma reserva) y el daño de
  // no tener la restricción era mucho peor: dos comprobantes fiscales de la misma
  // estadía y una nota de crédito para arreglarlo.
  if (eFactura?.code === '23505') {
    // Al log igual: hubo una carrera y probablemente un número gastado.
    console.error(
      `Emisión simultánea sobre la reserva ${reservaId}: la restricción única rechazó el segundo comprobante. ` +
        `Revisar si quedó un salto en la numeración del punto de venta ${PUNTO_VENTA}.`,
      eFactura.message,
    )
    redirect(`/panel/reservas/${reservaId}/factura`)
  }

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
  /**
   * Éxito **parcial**: el grupo se creó, pero con menos unidades de las pedidas.
   *
   * ── Por qué no se aborta el lote entero ─────────────────────────────────────
   *
   * El pendiente original decía «`crearReservaGrupal` no es atómica». La
   * no-atomicidad no es el problema: para un hotel, un grupo de 5 que sólo consigue
   * 4 unidades **suele valer la pena igual** —se toman las 4 y se llama al cliente—,
   * y abortar el lote perdería cuatro ventas reales por una que no entró.
   *
   * El problema es el **silencio**: `primerError` se calculaba y se descartaba
   * cuando `creadas > 0`, así que quien pedía 5 y recibía 2 veía la misma pantalla
   * de éxito que quien recibía las 5. Lo descubría el día de la llegada.
   *
   * Por eso el resultado parcial se devuelve como estado y **no** se redirige: el
   * listado de reservas no renderiza mensajes de query, así que un
   * `?parcial=…` se habría perdido en el camino.
   */
  parcial?: {
    creadas: number
    pedidas: number
    /** Por qué no entraron las demás, en las palabras del motor de disponibilidad. */
    motivo: string
    grupoId: string
  }
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
  await requerirAcceso('reservas')
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

  // Cuántas unidades se habían pedido, para poder comparar contra lo que entró.
  const pedidas = selecciones.reduce((a, s) => a + s.cantidad, 0)

  if (creadas < pedidas) {
    return {
      parcial: {
        creadas,
        pedidas,
        motivo: primerError ?? 'No había más unidades libres para esas fechas.',
        grupoId,
      },
    }
  }

  redirect(`/panel/reservas?grupo=${grupoId}`)
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
  await requerirAcceso('reservas')
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
  const sesion = await requerirAcceso('reservas')
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
