'use server'

/**
 * Emisión de la factura y de la nota de crédito de una reserva (ADR 0012,
 * comprobante para ARCA en `lib/domain/wsfev1.ts`). El correlativo es la clave
 * de idempotencia (migración 0069): ver los comentarios de cada acción.
 */

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { requerirAcceso, requerirRol } from '@/lib/auth/session'
import { hoyISO } from '@/lib/fechas'
import {
  tipoComprobante,
  numeroComprobante,
  numeroDeComprobante,
  cuitValido,
  normalizarCuit,
  exigeCuitReceptor,
  motivoNoFacturable,
  motivoNoAcreditar,
  desglosarIva,
  discriminaIva,
  type CondicionIva,
  type TipoComprobante,
  ALICUOTA_ALOJAMIENTO,
} from '@/lib/domain/facturacion'
import { exentoDeIva, desglosarConExencion } from '@/lib/domain/exencion-iva'
import { obtenerProveedorFacturacion } from '@/lib/facturacion'
import { datosFiscales } from '@/lib/facturacion/emisor'
import { armarComprobante, MENSAJES_NO_ARMABLE } from '@/lib/domain/wsfev1'
import { cortarSiFalla, registrarFalla } from '@/lib/acciones'
import { registrarErrorSync } from '@/lib/registro'

/**
 * Condición del hotel frente al IVA, de RESPALDO, y punto de venta habilitado.
 *
 * La condición real sale de `datos_fiscales` (migración 0082, se carga en
 * Configuración → Datos fiscales); esta constante sólo se usa mientras esa
 * tabla esté vacía. El punto de venta sigue acá: no está en la tabla.
 */
const CONDICION_EMISOR: CondicionIva = 'responsable_inscripto'
const PUNTO_VENTA = 1
/** Alojamiento y servicios tributan al 21 % en Argentina (ver `ALICUOTA_ALOJAMIENTO`). */
const ALICUOTA = ALICUOTA_ALOJAMIENTO

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

  /*
    ── Las tres lecturas de acá abajo CORTAN si fallan ───────────────────────

    No es celo de estilo: una factura sale con CAE y es **inmutable** (la 0034 le
    revocó `update` y `delete`), así que un dato leído de menos no se corrige
    después. Y como no hay notas de crédito, tampoco se anula.

    Lo que pasaba descartando el `{ error }`:

    · `facturas` → `existente` quedaba nulo y se intentaba emitir una segunda
      factura sobre la misma reserva. La restricción de la 0045 la frena, pero
      recién en el `insert`, después de haber quemado el número y pedido el CAE.
    · `reservas` → `reserva` nulo y redirect al listado, sin decir por qué.
    · `consumos` → **el caro**: `consumosData` nulo se degrada a `[]`, y
      `cuentaConsolidada` factura solo el alojamiento. Comprobante fiscal por
      menos de lo consumido, firmado y sin vuelta atrás.
  */
  const { data: existente, error: eExistente } = await supabase
    .from('facturas')
    .select('id')
    .eq('reserva_id', reservaId)
    .maybeSingle()

  cortarSiFalla(eExistente, `/panel/reservas/${reservaId}`, 'lectura_factura')

  // Una reserva se factura una sola vez: si ya existe, se muestra la emitida.
  if (existente) redirect(`/panel/reservas/${reservaId}/factura`)

  const { data: reserva, error: eReserva } = await supabase
    .from('reservas')
    .select(
      // `estadias(check_in, check_out)`: WSFEv1 exige el período facturado en un
      // comprobante de servicios, y una estadía lo es. Son columnas GENERADAS
      // desde `periodo` (migración 0037), así que no pueden desincronizarse.
      'estado, total, agencia_id, pago_desde_exterior, huesped:huespedes!reservas_huesped_id_fkey(condicion_iva, doc_tipo, doc_numero, residente_exterior), estadias(check_in, check_out)',
    )
    .eq('id', reservaId)
    .single()

  cortarSiFalla(eReserva, `/panel/reservas/${reservaId}`, 'lectura_reserva')
  if (!reserva) redirect('/panel/reservas')

  // Solo se factura una estadía consumida: emitir el comprobante de una reserva
  // pendiente o cancelada dejaría, con CAE real, un documento fiscal que después
  // hay que anular con nota de crédito.
  const motivo = motivoNoFacturable(String(reserva.estado), false)
  if (motivo) redirect(`/panel/reservas/${reservaId}?error=${motivo}`)

  const { data: consumosData, error: eConsumos } = await supabase
    .from('consumos')
    .select('cantidad, precio_unitario')
    .eq('reserva_id', reservaId)

  // Ver el bloque de arriba: sin esto, una lectura fallida factura de menos.
  cortarSiFalla(eConsumos, `/panel/reservas/${reservaId}`, 'lectura_consumos')

  const consumos: Consumo[] = (consumosData ?? []).map((c) => ({
    cantidad: c.cantidad as number,
    precioUnitario: Number(c.precio_unitario),
  }))
  const cuenta = cuentaConsolidada(Number(reserva.total ?? 0), consumos)

  // El receptor es la agencia cuando la reserva entró por convenio; si no, el
  // huésped. De ahí sale la letra del comprobante.
  let receptor: ReceptorFactura
  if (reserva.agencia_id) {
    const { data: agencia, error: eAgencia } = await supabase
      .from('agencias')
      .select('condicion_iva, cuit')
      .eq('id', reserva.agencia_id)
      .single()
    /*
      Sin esto, una lectura fallida no se distingue de una agencia sin CUIT
      cargado: `receptor` caía a `responsable_inscripto` con `cuit: null` — la
      condición fiscal MÁS exigente (exige CUIT válido) con el dato que
      justamente hace falta para cumplirla en `null`. Emitir así, o exigirle
      el CUIT al usuario por un dato que en realidad SÍ está cargado y solo no
      se pudo leer, son las dos caras del mismo error.
    */
    cortarSiFalla(eAgencia, `/panel/reservas/${reservaId}`, 'lectura_agencia_fiscal')
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

  /*
    La letra sale de la condición REAL del emisor (tabla `datos_fiscales`, 0082).
    Estaba fija en `responsable_inscripto` aunque la tabla ya existía: si el
    hotel es monotributista, todas las facturas salían con la letra equivocada.
    Sin la tabla cargada, se mantiene el valor de antes.
  */
  const emisor = await datosFiscales(supabase)
  const tipo = tipoComprobante(emisor?.condicionIva ?? CONDICION_EMISOR, receptor.condicion)
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

  // Numeración correlativa, idempotente por reserva (migración 0069).
  //
  // No se llama a `siguiente_numero_comprobante` directo, y ésa es la corrección:
  // hacerlo consumía un número **cada vez**, así que la emisión que perdía una
  // carrera —o cualquier reintento tras un corte— gastaba uno de más y dejaba un
  // salto de correlatividad, que es obligación formal (ADR 0015).
  // `reservar_numero_factura` entrega siempre el mismo número para la misma
  // reserva, y por eso el reintento vuelve a pedirle a AFIP el CAE del mismo
  // comprobante en vez de uno nuevo.
  const { data: reserva_numero, error: eNumero } = await supabase.rpc(
    'reservar_numero_factura',
    { p_reserva_id: reservaId, p_punto_venta: PUNTO_VENTA },
  )
  if (eNumero) redirect(`/panel/reservas/${reservaId}?error=numeracion`)

  const numeracion = reserva_numero as {
    ok: boolean
    motivo?: string
    numero?: number
    reusado?: boolean
  } | null

  // `ya_facturada`: otra emisión llegó primero. Igual que en el 23505 de más
  // abajo, lo correcto es mostrar el comprobante y no un error: la reserva
  // **está** facturada.
  if (numeracion?.motivo === 'ya_facturada') {
    redirect(`/panel/reservas/${reservaId}/factura`)
  }
  if (!numeracion?.ok || typeof numeracion.numero !== 'number') {
    redirect(`/panel/reservas/${reservaId}?error=${numeracion?.motivo ?? 'numeracion'}`)
  }

  const siguiente = numeracion.numero

  /*
    El comprobante en formato ARCA.

    Se arma **acá y no en el adapter** para que cada implementación tenga que
    serializar y no decidir: las reglas de WSFEv1 son condicionales —una estadía
    es un servicio y entonces las fechas del período son obligatorias, la nota de
    crédito lleva otro código y el comprobante asociado, la base imponible es el
    neto menos lo exento— y repetirlas en cada adapter es repetir el error.

    `motivo` no corta la emisión. Hoy el CAE es simulado y el circuito interno
    tiene que poder seguir aunque falte, por ejemplo, el CUIT del hotel: cortar
    ahí dejaría al sistema sin poder facturar por un dato que sólo hace falta para
    una integración que todavía no existe. Se registra y se sigue.
  */
  const periodo = (reserva.estadias ?? []) as { check_in: string; check_out: string }[]
  const { comprobante, motivo: motivoComprobante } = armarComprobante({
    cuitEmisor: emisor?.cuit ?? null,
    tipo,
    esNotaCredito: false,
    puntoVenta: PUNTO_VENTA,
    numero: siguiente,
    fecha: hoyISO(),
    total: desglose.total,
    neto: desglose.neto,
    exento: desglose.exento,
    iva: desglose.iva,
    alicuota: desglose.alicuota,
    discriminaIva: discriminaIva(tipo),
    cuitReceptor: cuitLimpio,
    condicionReceptor: receptor.condicion,
    // `facturas.total` está en USD, igual que `reservas.total`. La conversión a
    // pesos para ARCA es parte del adapter real y de una decisión del contador;
    // hoy se declara la moneda que efectivamente tiene el importe.
    moneda: 'USD',
    cotizacion: null,
    tieneProductos: consumos.length > 0,
    servicioDesde: periodo[0]?.check_in ?? null,
    servicioHasta: periodo[0]?.check_out ?? null,
  })

  if (motivoComprobante) {
    registrarFalla(
      { message: `${motivoComprobante}: ${MENSAJES_NO_ARMABLE[motivoComprobante]}` },
      `armar el comprobante ARCA de la reserva ${reservaId}`,
    )
  }

  const proveedor = obtenerProveedorFacturacion()
  const resultado = await proveedor.solicitarCae({
    tipo,
    puntoVenta: PUNTO_VENTA,
    // El número va en la solicitud porque WSFEv1 lo exige (`CbteDesde`), y
    // porque es lo que hace que un reintento reciba el CAE ya autorizado en vez
    // de uno nuevo: para AFIP, el número ES la clave de idempotencia.
    numero: siguiente,
    total: desglose.total,
    neto: desglose.neto,
    iva: desglose.iva,
    condicionReceptor: receptor.condicion,
    cuitReceptor: cuitLimpio,
    fecha: hoyISO(),
    comprobante,
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
  // ⚠️ El número correlativo YA NO se gasta acá (migración 0069).
  //
  // Esto decía que el pedido perdedor se llevaba puesto un número y un CAE, y era
  // cierto mientras la numeración salía de `siguiente_numero_comprobante` directo:
  // esa función entrega uno nuevo **en cada llamada**. Ahora la numeración pasa por
  // `reservar_numero_factura`, que le da a cada reserva un número y siempre el
  // mismo, así que las dos emisiones de la carrera piden el CAE del **mismo**
  // comprobante. AFIP, re-consultado sobre el mismo `CbteDesde`, devuelve el CAE
  // que ya autorizó: no hay un segundo CAE ni un número perdido.
  //
  // Lo que sigue sin resolverse, y hay que decirlo: si una emisión se abandona de
  // verdad —el CAE se rechaza y nadie reintenta— el número queda reservado y nunca
  // llega a `facturas`. Ahí sí hay hueco. La diferencia es que ahora **se puede
  // ver**: queda la fila en `facturas_numeracion` diciendo qué reserva se quedó con
  // ese número (la consulta está al pie de la migración 0069). Antes el número
  // desaparecía sin rastro y el salto aparecía recién en una fiscalización.
  if (eFactura?.code === '23505') {
    // Sigue yendo al registro, pero ya no como sospecha de número gastado: es
    // una carrera resuelta como corresponde, y sirve saber que ocurrió.
    registrarErrorSync('factura_emision_simultanea', {
      detalle:
        `Emisión simultánea sobre la reserva ${reservaId}: la restricción única rechazó el segundo comprobante. ` +
        `La numeración no se duplicó (migración 0069); se muestra el comprobante emitido.`,
      punto_venta: PUNTO_VENTA,
      motivo_base: eFactura.message,
    })
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

/**
 * Emite una nota de crédito sobre la factura de una reserva (migración 0076).
 *
 * ── Por qué hacía falta ─────────────────────────────────────────────────────
 *
 * `facturas` es inmutable (0034) y hay una sola por reserva (0045): sin notas de
 * crédito, **una factura mal emitida no tenía ningún camino de corrección**. Con
 * el simulador es un inconveniente; con CAE real el comprobante ya está informado
 * a ARCA y la única forma de revertirlo es ésta.
 *
 * ── Qué garantiza la base y qué se comprueba acá ────────────────────────────
 *
 * Las dos reglas duras —la letra la hereda de la factura, y la suma de las notas
 * no puede superar el total— viven en triggers (0076), porque dos emisiones
 * simultáneas leerían el mismo acumulado y las dos pasarían una comprobación
 * hecha en la aplicación. Acá se comprueba lo mismo **antes** para poder decirlo
 * en pantalla en vez de mostrar un error de Postgres.
 */
export async function emitirNotaCredito(formData: FormData): Promise<void> {
  /*
    Más estrecha que el área `reservas`, a propósito: la nota de crédito la
    emiten admin y gerencia (RLS de `notas_credito`, 0076, y la guarda de
    `siguiente_numero_nota_credito`, 0120). Con `requerirAcceso('reservas')`
    recepción llegaba hasta pedir el CAE y recién ahí la base rechazaba el
    insert: con ARCA real quedaba una nota autorizada que no existe en el sistema.
  */
  const sesion = await requerirRol('admin', 'gerencia')
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!reservaId) redirect('/panel/reservas')

  const monto = Number(formData.get('monto') ?? 0)
  const motivo = String(formData.get('motivo') ?? '').trim()
  const destino = `/panel/reservas/${reservaId}/factura`

  const supabase = await crearClienteServidor()

  const { data: factura, error: eFactura } = await supabase
    .from('facturas')
    .select(
      'id, total, cae, tipo_comprobante, punto_venta, numero_fiscal, alicuota_iva, condicion_iva_receptor, cuit_receptor',
    )
    .eq('reserva_id', reservaId)
    .maybeSingle<{
      id: string
      total: number
      cae: string | null
      tipo_comprobante: TipoComprobante | null
      punto_venta: number | null
      numero_fiscal: string | null
      alicuota_iva: number | string | null
      condicion_iva_receptor: CondicionIva | null
      cuit_receptor: string | null
    }>()

  cortarSiFalla(eFactura, destino, 'lectura_factura')

  const { data: previas, error: ePrevias } = await supabase
    .from('notas_credito')
    .select('total')
    .eq('factura_id', factura?.id ?? '00000000-0000-0000-0000-000000000000')

  cortarSiFalla(ePrevias, destino, 'lectura_notas')

  const yaAcreditado = ((previas ?? []) as { total: number }[]).reduce(
    (a, n) => a + Number(n.total),
    0,
  )

  const impedimento = motivoNoAcreditar({
    factura: factura ? { total: Number(factura.total), cae: factura.cae } : null,
    yaAcreditado,
    monto,
    motivo,
  })
  if (impedimento) redirect(`${destino}?error=${impedimento}`)

  const puntoVenta = factura!.punto_venta ?? PUNTO_VENTA
  // La letra la hereda: no se elige. Si la factura es vieja y no la tiene, se cae
  // a `B`, que es el comprobante al consumidor final.
  const tipo: TipoComprobante = factura!.tipo_comprobante ?? 'B'

  const { data: numero, error: eNumero } = await supabase.rpc(
    'siguiente_numero_nota_credito',
    { p_punto_venta: puntoVenta },
  )
  if (eNumero || numero == null) {
    registrarFalla(eNumero, `pedir el número de nota de crédito de la reserva ${reservaId}`)
    redirect(`${destino}?error=numeracion_nc`)
  }
  const siguiente = Number(numero)

  /*
    La nota corrige UNA factura y hereda sus datos fiscales:
    · la alícuota del comprobante original —antes era siempre 21 %, y una nota
      sobre una factura exenta (turista del exterior, ADR 0024) declaraba un
      IVA que nunca se cobró—;
    · la condición y el CUIT del receptor —antes siempre «consumidor final»,
      aunque la factura fuera A—;
    · el número de la factura que corrige —antes se mandaba el de la propia
      nota, que quedaba asociada a sí misma—.
  */
  const alicuota = factura!.alicuota_iva == null ? ALICUOTA : Number(factura!.alicuota_iva)
  const desglose = desglosarIva(monto, alicuota)

  const proveedor = obtenerProveedorFacturacion()
  const resultado = await proveedor.solicitarCae({
    tipo,
    puntoVenta,
    numero: siguiente,
    total: monto,
    neto: desglose.neto,
    iva: desglose.iva,
    condicionReceptor: factura!.condicion_iva_receptor ?? 'consumidor_final',
    cuitReceptor: factura!.cuit_receptor,
    fecha: hoyISO(),
    // ⚠️ Sin esto, un adapter real de WSFEv1 emitiría una FACTURA por el importe
    // que se quería devolver: en ARCA las notas de crédito son otros códigos de
    // comprobante (3, 8 y 13) y tienen que informar el comprobante asociado.
    esNotaCredito: true,
    numeroAsociado: numeroDeComprobante(factura!.numero_fiscal),
  })

  if (!resultado.ok) redirect(`${destino}?error=cae`)

  const { error: eNota } = await supabase.from('notas_credito').insert({
    factura_id: factura!.id,
    tipo_comprobante: tipo,
    punto_venta: puntoVenta,
    total: monto,
    neto: desglose.neto,
    iva: desglose.iva,
    alicuota_iva: desglose.alicuota,
    motivo,
    numero_fiscal: numeroComprobante(puntoVenta, siguiente),
    cae: resultado.cae,
    cae_vto: resultado.caeVto,
    cae_solicitado_en: new Date().toISOString(),
    emitida_por: sesion?.userId ?? null,
  })

  // Mismo punto caro que en `emitirFactura`: acá ya se pidió el CAE y ya se
  // consumió el correlativo. Si el insert se pierde en silencio queda un CAE
  // emitido sin nota, y el hueco de correlatividad es una obligación formal.
  cortarSiFalla(eNota, destino, 'nota_credito')

  redirect(`${destino}?ok=nota_credito`)
}
