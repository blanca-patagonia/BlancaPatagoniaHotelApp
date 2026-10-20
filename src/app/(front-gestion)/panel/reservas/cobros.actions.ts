'use server'

/**
 * Acciones de cobro de una reserva: registrar un pago, generar un link de pago
 * por la pasarela, fijar el origen del pago (exención de IVA, ADR 0024) y
 * verificar la tarjeta de garantía (ADR 0025). Separadas de `actions.ts`
 * (2026-10-20) para que el dinero se lea en un solo lugar.
 */

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { type EstadoReserva } from '@/lib/domain/reservas'
import { saldarSiCorresponde } from '@/lib/reservas/saldar'
import { requerirAcceso } from '@/lib/auth/session'
import { obtenerProveedor } from '@/lib/payments'
import { iniciarCobro, falloElCobro } from '@/lib/payments/servicio'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { imputarEnUSD, motivoNoSeCobra, MONEDA_BASE } from '@/lib/domain/cobro'
import { esMonedaExtranjera } from '@/lib/domain/divisas'
import { cotizacionVigente } from '@/lib/divisas/servicio'
import { avisarCobroAprobado } from '@/lib/notificaciones/cobros'
import { urlDelSitio } from '@/lib/env'
import { cortarSiFalla } from '@/lib/acciones'
import { registrarError } from '@/lib/registro'

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

  /*
    ── Idempotencia del cobro de mostrador ──────────────────────────────────

    Esta acción no tenía ninguna: dos envíos del mismo formulario eran **dos
    pagos**. Lo único que lo frenaba era `BotonEnvio`, que vive en el navegador y
    no sobrevive a un reintento de red, un F5 sobre el POST ni el botón de atrás.
    Para el hotel eso es un huésped que figura pagando dos veces.

    La clave la genera la pantalla al renderizar, así que es la misma para los dos
    envíos del mismo formulario y distinta en cada carga: un segundo pago legítimo
    —el huésped que paga dos veces el mismo importe— entra sin problema porque
    llega con una clave nueva.

    Se apoya en el `unique` que `pagos.external_id` tiene desde la 0009: la
    garantía la da la base, no una comprobación previa que una carrera podría
    esquivar.
  */
  const clave = String(formData.get('idempotencia') ?? '').trim()
  const externalId = clave ? `mostrador:${clave}` : null

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
    external_id: externalId,
  })

  // 23505 = el mismo formulario se envió dos veces. El pago ya está registrado,
  // así que NO es un error para quien lo hizo: se sigue como si hubiera entrado
  // ahora, que es lo que idempotente significa.
  if (error && error.code !== '23505') redirect(`/panel/reservas/${reservaId}?error=pago`)

  // ¿Quedó saldada? → intentar pasar a 'pagada'.
  //
  // La regla vive en `lib/reservas/saldar.ts` y no acá porque el webhook de pagos
  // hace exactamente lo mismo. Estaban duplicadas y divergieron: allá se corrigió
  // para consolidar alojamiento + consumos, y acá quedó comparando contra
  // `reservas.total`, que cubre solo la estadía. Quien había consumido del frigobar
  // y pagaba el alojamiento en efectivo quedaba marcado «pagada» debiendo esa parte.
  const { error: eSaldada, confirmada } = await saldarSiCorresponde(supabase, reservaId)
  // El pago ya está registrado. Si esto se pierde queda cobrado sin marcar, y acá
  // hay alguien mirando la pantalla — pero solo se entera si se le dice.
  cortarSiFalla(eSaldada ? { message: eSaldada } : null, `/panel/reservas/${reservaId}`, 'saldada')

  /*
    El comprobante que el huésped espera.

    Cobrar en el mostrador y no mandar nada deja al huésped sin constancia de lo
    que pagó, que es justamente lo que después trae el reclamo. Va por el mismo
    camino que el cobro por pasarela —`lib/notificaciones/cobros.ts`— para que
    las dos puntas digan lo mismo: cuando estuvieron duplicadas, divergieron.

    No corta el flujo: el cobro ya está hecho, y no poder anotar un correo no
    puede volverse un error en la cara de quien está cobrando.
  */
  await avisarCobroAprobado(supabase, {
    reservaId,
    pagoId: externalId ?? reservaId,
    importe: montoUSD,
    medio,
    confirmada,
  })

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
    // Lo mismo del lado del mostrador: recepción ve el mensaje, pero el motivo
    // técnico tiene que quedar en algún lado que se pueda consultar después.
    await registrarError('cobro_link_mostrador', {
      reserva: reserva.codigo,
      detalle: resultado.error,
    })
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
