import Link from 'next/link'
import { MENSAJES_FICHA_RESERVA as MENSAJES_ERROR } from './mensajes'
import { mensajeDe } from '@/lib/listados'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarAccesoHuesped } from '@/lib/auditoria/accesos'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { registrarFalla } from '@/lib/acciones'
import {
  transicionesPosibles,
  ETIQUETAS_ESTADO_RESERVA,
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  noShowEsCobrable,
  PLANES,
  SEGMENTOS,
  type EstadoReserva,
  type Garantia,
  type Plan,
  type Segmento,
} from '@/lib/domain/reservas'
import {
  desgloseCoincide,
  paxQueOcupa,
  textoOcupantes,
  type Ocupantes,
} from '@/lib/domain/ocupantes'
import { cargoDeCancelacion } from '@/lib/reservas/cancelacion'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { pagoAgenciaVencido, vencimientoPagoAgencia } from '@/lib/domain/cuentas'
import { parsearPeriodo, formatoFechaCorta, diasEntre, hoyISO } from '@/lib/fechas'
import { cambiarEstadoReserva } from '../actions'
import { fijarOrigenDelPago } from '../cobros.actions'
import { reprogramarReserva, cambiarUnidadReserva, editarFichaReserva } from '../cambios.actions'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { motivoNoFacturable, ALICUOTA_ALOJAMIENTO } from '@/lib/domain/facturacion'
import { condicionesDePrecio } from '@/lib/reservas/condiciones-de-precio'
import {
  exentoDeIva,
  motivoSinExencion,
  desglosarConExencion,
  MENSAJES_SIN_EXENCION,
} from '@/lib/domain/exencion-iva'
import {
  garantiaSirveParaCobrar,
  motivoGarantiaNoSirve,
  type EstadoVerificacionTarjeta,
} from '@/lib/domain/garantia-tarjeta'
import { puedeCambiarUnidad } from '@/lib/domain/mudanzas'
import { unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { BotonEnvio } from '../../_components/boton-envio'
import { Icono } from '../../_components/iconos'
import { TONO_ESTADO } from '../../_components/estilos'
import { Encabezado, Etiqueta, Mensaje, Pagina } from '../../_components/ui'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, seniaSugerida, type Pago } from '@/lib/domain/pagos'
import { formatearUSD } from '@/lib/domain/moneda'
import {
  CobroEnLinea,
  SeccionConsumos,
  SeccionGarantia,
  SeccionPagos,
  type ConsumoRow,
  type PagoRow,
  type ProductoRow,
} from './seccion-cuenta'

/**
 * Mensajes de error que puede devolver cualquier acción de esta pantalla.
 *
 * Antes era una cadena de ternarios anidados: cada error nuevo agregaba un
 * nivel de indentación y el último quedaba a diez niveles de profundidad. Como
 * mapa, sumar un caso es una línea.
 */

const ACCION_ESTADO: Record<EstadoReserva, { verbo: string; color: string }> = {
  pendiente: { verbo: 'Marcar pendiente', color: 'bg-stone-600 hover:bg-stone-700' },
  confirmada: { verbo: 'Confirmar', color: 'bg-lago-700 hover:bg-lago-800' },
  pagada: { verbo: 'Marcar pagada', color: 'bg-emerald-600 hover:bg-emerald-700' },
  in_house: { verbo: 'Check-in', color: 'bg-lenga-600 hover:bg-lenga-700' },
  checkout: { verbo: 'Check-out', color: 'bg-stone-700 hover:bg-stone-800' },
  cancelada: { verbo: 'Cancelar', color: 'bg-red-600 hover:bg-red-700' },
  no_show: { verbo: 'No-show', color: 'bg-red-600 hover:bg-red-700' },
}

interface Reserva {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  /* Desglose fiscal (paso 6). `total` sigue siendo el importe CON IVA. */
  subtotal: number | string
  total_neto: number | string
  iva: number | string
  descuento_pct: number | string
  canal: string
  tarifa_tipo: string
  notas: string
  plan: Plan
  garantia: Garantia
  segmento: Segmento
  voucher: string
  agencia_id: string | null
  huesped_id: string | null
  /** Origen del pago para la exención de IVA (RG 3971). `null` = sin definir. */
  pago_desde_exterior: boolean | null
  /* Garantía de tarjeta (ADR 0025). NUNCA hay acá un número de tarjeta. */
  tarjeta_ultimos4: string | null
  tarjeta_marca: string | null
  tarjeta_vencimiento: string | null
  tarjeta_verificacion: EstadoVerificacionTarjeta
  tarjeta_verificada_en: string | null
  huesped: {
    apellido: string
    nombre: string
    email: string | null
    doc_numero: string
    vip: boolean
    residente_exterior: boolean | null
  } | null
  estadias: {
    periodo: string
    precio_noche: number | string
    huespedes: number
    adultos: number
    menores: number
    bebes: number
    camas_extra: number
    cunas: number
    no_mover: boolean
    unidad: {
      nombre: string
      tipo_unidad_id: string
      tipo: { nombre: string; capacidad_max: number } | null
    } | null
  }[]
}

/**
 * Un par etiqueta/valor de la ficha.
 *
 * El `wrap-anywhere` del valor no es decorativo. Acá se muestran Email y Voucher,
 * que son cadenas largas y **sin espacios**: sin permitir el corte, un email como
 * `maria.fernanda.gonzalez.iturriaga@corporativoempresarial.com.ar` se sale de la
 * tarjeta blanca y se superpone con la columna de al lado.
 *
 * Es `wrap-anywhere` y no `break-words` a propósito, y la diferencia es la que
 * arregla el problema: las dos permiten partir la palabra al pintar, pero solo
 * `overflow-wrap: anywhere` cuenta ese corte al calcular el ancho **mínimo** del
 * contenido. Con `break-words`, la tarjeta —que es un ítem de grilla, o sea
 * `min-width: auto`— igual se ensancha hasta que el email entre de una pieza, y el
 * desborde se muda del texto a la grilla entera. Los ítems llevan además `min-w-0`.
 */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-stone-600">{etiqueta}</dt>
      <dd className="mt-0.5 wrap-anywhere text-stone-800">{valor}</dd>
    </div>
  )
}

export default async function DetalleReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    error?: string
    detalle?: string
    ok?: string
    nuevo_check_in?: string
    nuevo_check_out?: string
    v_plan?: string
    v_segmento?: string
    v_voucher?: string
    v_notas?: string
    v_adultos?: string
    v_menores?: string
    v_bebes?: string
    v_cunas?: string
    v_no_mover?: string
  }>
}) {
  await requerirAcceso('reservas')
  const { id } = await params
  const {
    error: errorParam,
    detalle: detalleParam,
    ok: okParam,
    nuevo_check_in: nuevoCheckIn,
    nuevo_check_out: nuevoCheckOut,
    v_plan: vPlan,
    v_segmento: vSegmento,
    v_voucher: vVoucher,
    v_notas: vNotas,
    v_adultos: vAdultos,
    v_menores: vMenores,
    v_bebes: vBebes,
    v_cunas: vCunas,
    v_no_mover: vNoMover,
  } = await searchParams
  // Lo que se tecleó la última vez que «Editar ficha» rechazó el envío
  // (auditoría QA/UX 2026-10-14): si vino en la URL, gana sobre el valor
  // guardado en la base. Solo aparece cuando `editarFichaReserva` redirigió
  // con un error — un envío exitoso no deja estos parámetros.
  const huboIntentoDeFicha = vPlan !== undefined
  const supabase = await crearClienteServidor()

  const { data, error: eReserva } = await supabase
    .from('reservas')
    .select(
      'id, codigo, estado, total, subtotal, total_neto, iva, descuento_pct, canal, tarifa_tipo, notas, plan, garantia, segmento, voucher, agencia_id, huesped_id, pago_desde_exterior, tarjeta_ultimos4, tarjeta_marca, tarjeta_vencimiento, tarjeta_verificacion, tarjeta_verificada_en, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email, doc_numero, vip, residente_exterior), estadias(periodo, precio_noche, huespedes, adultos, menores, bebes, camas_extra, cunas, no_mover, unidad:unidades(nombre, tipo_unidad_id, tipo:tipos_unidad(nombre, capacidad_max)))',
    )
    .eq('id', id)
    .maybeSingle()

  // `data` también queda en null si la lectura falló por otro motivo
  // que «no existe» (permisos, red): sin loguear, esos casos se ven idénticos a
  // una reserva borrada y nadie se entera de que hubo un problema de verdad.
  if (eReserva) registrarFalla(eReserva, 'reservas:ficha')
  if (!data) notFound()
  const reserva = data as unknown as Reserva
  if (reserva.huesped_id) await registrarAccesoHuesped(supabase, reserva.huesped_id, 'ficha_reserva')
  const estadia = reserva.estadias?.[0]

  // Desglose de ocupantes en la forma del dominio. Se arma una vez y se reusa,
  // en vez de leer seis campos sueltos en cada lugar de la pantalla.
  const ocupantes: Ocupantes = {
    adultos: estadia?.adultos ?? 0,
    menores: estadia?.menores ?? 0,
    bebes: estadia?.bebes ?? 0,
    camasExtra: estadia?.camas_extra ?? 0,
    cunas: estadia?.cunas ?? 0,
  }
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const transiciones = transicionesPosibles(reserva.estado)

  /*
    Re-precio inline de la reprogramación (patrón de referencia: Hotel PMS,
    "Reservation 360"). Antes había que apretar «Reprogramar» a ciegas para
    enterarse del total nuevo — el propio botón ya avisaba «recotiza el
    total», pero recién después de confirmar.

    Es un paso de GET, mismo patrón que «Buscar disponibilidad» en el alta de
    reservas (`nueva/page.tsx`): la fecha vive en la URL porque es un paso de
    consulta, no una acción con efecto. Reusa `cotizarEstadia`, la misma
    función que ya usa el alta y el cálculo de cancelación de acá arriba —
    ninguna regla de precio se repite a mano.
  */
  const RE_FECHA_PREVIEW = /^\d{4}-\d{2}-\d{2}$/
  const previewValido =
    periodo &&
    estadia?.unidad?.tipo_unidad_id &&
    RE_FECHA_PREVIEW.test(nuevoCheckIn ?? '') &&
    RE_FECHA_PREVIEW.test(nuevoCheckOut ?? '') &&
    nuevoCheckOut! > nuevoCheckIn! &&
    (nuevoCheckIn !== periodo.desde || nuevoCheckOut !== periodo.hasta)
  // Con las mismas condiciones que va a usar la acción (promoción y descuento
  // adicional incluidos): la vista previa y lo que se aplica son el mismo número.
  const condicionesPreview = previewValido ? await condicionesDePrecio(supabase, reserva.id) : null
  const previewCotizacion =
    previewValido && condicionesPreview?.ok
      ? await cotizarEstadia({
          tipoUnidadId: estadia!.unidad!.tipo_unidad_id,
          checkIn: nuevoCheckIn!,
          checkOut: nuevoCheckOut!,
          tarifaTipo: reserva.tarifa_tipo as 'neto' | 'rack',
          promocion: condicionesPreview.condiciones.promocion,
          descuentoAdicionalPct: condicionesPreview.condiciones.descuentoAdicionalPct,
          anticipacionDias: condicionesPreview.condiciones.anticipacionDias(nuevoCheckIn!),
          cliente: supabase,
        }).catch(() => null)
      : null

  /*
    Exención de IVA al turista del exterior (RG 3971, ADR 0024).

    Se calcula con la MISMA función que usa `emitirFactura`, para que lo que la
    pantalla anuncia y lo que el comprobante hace no puedan separarse. Si acá se
    reimplantara la regla, un cambio en una sola de las dos copias haría que la
    ficha prometiera una exención que la factura después no aplica.
  */
  const condicionExencion = {
    residenteExterior: Boolean(reserva.huesped?.residente_exterior),
    pagoDesdeExterior: reserva.pago_desde_exterior,
  }
  const exento = !reserva.agencia_id && exentoDeIva(condicionExencion)
  const motivoExencion = motivoSinExencion(condicionExencion)

  /*
    El importe que la ficha anuncia sale de `desglosarConExencion`, la MISMA
    función que usa `emitirFactura`. No de `reserva.total_neto`.

    Se hacía así y estaba mal: `total_neto` es una columna que puebla el alta
    (migración 0039) y **puede venir en cero** —una reserva creada por un camino
    que no la completa, o anterior a esa migración—. Con `total_neto = 0` la
    pantalla anunciaba «sale sin IVA: USD 0,00 en vez de USD 363,00», un número
    absurdo dicho con total confianza. Y peor: la factura sí calculaba bien los
    USD 300, así que **la ficha prometía una cosa y el comprobante hacía otra**.

    Detectado abriendo la pantalla en el navegador; ningún test lo veía porque el
    número venía de la base y no del dominio.

    Acá se pasa `consumosConIva: 0` a propósito: es una **vista previa del
    alojamiento**, que es lo que cambia con la exención. Los consumos se suman en
    la cuenta y siguen gravados, y el texto lo aclara.
  */
  const ALICUOTA_PREVIA = ALICUOTA_ALOJAMIENTO
  const previaExencion = desglosarConExencion({
    alojamientoConIva: Number(reserva.total),
    consumosConIva: 0,
    alicuota: ALICUOTA_PREVIA,
    exento: true,
  })

  /*
    Garantía de tarjeta (ADR 0025).

    La pregunta que responde no es «¿la tarjeta es válida hoy?» sino «¿va a
    servir el día que haya que cobrar un no-show?». Por eso la fecha de
    referencia es la del check-in y no la de hoy: una tarjeta que vence el mes
    que viene no sirve para una estadía de dentro de dos meses.
  */
  const garantiaTarjeta = {
    estado: reserva.tarjeta_verificacion,
    verificadaEn: reserva.tarjeta_verificada_en,
    vencimiento: reserva.tarjeta_vencimiento,
  }
  const fechaGarantia = periodo?.desde ?? hoyISO()
  const garantiaOk = garantiaSirveParaCobrar(garantiaTarjeta, fechaGarantia)
  const motivoGarantia = motivoGarantiaNoSirve(garantiaTarjeta, fechaGarantia)

  /*
    Preview del cargo por cancelación (política estándar).

    La cuenta vive en `lib/reservas/cancelacion.ts` y no acá porque el correo que
    se le manda al huésped **al** cancelar tiene que anunciar el mismo número que
    esta pantalla mostró **antes** de cancelar. Cuando estuvo duplicada con
    `saldarSiCorresponde` pasó lo previsible: divergió, y se notó en la plata.
  */
  const cargo =
    periodo && transiciones.includes('cancelada')
      ? await cargoDeCancelacion(supabase, {
          checkIn: periodo.desde,
          checkOut: periodo.hasta,
          total: Number(reserva.total),
          tipoUnidadId: estadia?.unidad?.tipo_unidad_id ?? '',
          tarifaTipo: reserva.tarifa_tipo as 'neto' | 'rack',
          noches,
        })
      : null

  const { data: pagosData, error: ePagos } = await supabase
    .from('pagos')
    .select('id, medio, tipo, monto, estado, creado_en, moneda, monto_cobrado, cupon, ultimos4, tarjeta_marca')
    .eq('reserva_id', id)
    .order('creado_en')
  if (ePagos) registrarFalla(ePagos, 'reservas:pagos')
  const pagos = (pagosData ?? []) as PagoRow[]
  // Si esta lectura falla, la ficha mostraría "sin pagos" en una reserva que sí
  // cobró: es el mismo riesgo que la alerta de overbooking del dashboard.
  const fallaPagos = Boolean(ePagos)

  /*
    Pago vencido de la agencia (pedido del dueño del hotel, 2026-09): abona un
    mes antes del check-in. Sólo aplica a una reserva DE agencia y sólo
    mientras siga vigente —una cancelada no genera reclamo—, así que la
    consulta extra se hace nada más que para esa minoría de fichas.
  */
  let avisoPagoAgenciaVencido: { vencimiento: string; totalPagado: number } | null = null
  if (reserva.agencia_id && periodo && reserva.estado !== 'cancelada') {
    const { data: movsAgenciaData, error: eMovsAgencia } = await supabase
      .from('movimientos_cuenta')
      .select('tipo, monto')
      .eq('reserva_id', id)
    if (eMovsAgencia) registrarFalla(eMovsAgencia, 'reservas:pago_agencia')
    const totalPagadoAgencia = (movsAgenciaData ?? [])
      .filter((m) => m.tipo === 'pago')
      .reduce((acc, m) => acc + Number(m.monto), 0)
    if (
      pagoAgenciaVencido(
        { checkIn: periodo.desde, totalReserva: Number(reserva.total), totalPagado: totalPagadoAgencia },
        hoyISO(),
      )
    ) {
      avisoPagoAgenciaVencido = {
        vencimiento: vencimientoPagoAgencia(periodo.desde),
        totalPagado: totalPagadoAgencia,
      }
    }
  }

  // Estado de cobro consolidado (alojamiento + consumos) y links de pago vivos.
  // Es la misma lectura que usa el portal público, para que el huésped y
  // recepción no vean saldos distintos.
  const cobroEnLinea = await estadoDeCobro(supabase, id)
  const resumen = resumenPagos(
    Number(reserva.total),
    pagos.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado }) as Pago),
  )
  const senia = seniaSugerida(Number(reserva.total), noches)

  const [
    { data: consumosData, error: eConsumos },
    { data: productosData, error: eProductos },
    { data: facturaData, error: eFactura },
  ] = await Promise.all([
    supabase
      .from('consumos')
      .select('id, cantidad, precio_unitario, producto:productos_servicios(nombre, categoria)')
      .eq('reserva_id', id)
      .order('creado_en'),
    supabase
      .from('productos_servicios')
      .select('id, nombre, categoria, precio')
      .eq('activo', true)
      .order('categoria'),
    supabase.from('facturas').select('numero').eq('reserva_id', id).maybeSingle(),
  ])
  registrarFalla(eConsumos, 'reservas:consumos')
  registrarFalla(eProductos, 'reservas:catalogo_productos')
  // Mismo riesgo que `fallaPagos` arriba: si esto falla, `factura` da `null`
  // igual que "todavía no facturada", y la pantalla podría ofrecer "Facturar"
  // sobre una reserva que YA tiene factura (bloqueado después por
  // `emitirFactura`, que sí revisa esto bien, pero no debería llegar a
  // ofrecerse el botón en primer lugar).
  const fallaFactura = Boolean(eFactura)
  registrarFalla(eFactura, 'reservas:factura_existente')
  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]
  const productos = (productosData ?? []) as unknown as ProductoRow[]
  const factura = facturaData as { numero: string } | null
  // Misma regla que usa la acción: la pantalla no puede ofrecer algo que
  // el servidor va a rechazar.
  const motivoFactura = motivoNoFacturable(reserva.estado, Boolean(factura))
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )

  // Unidades a las que se puede mudar la reserva. Solo se consulta si el estado
  // lo permite: para un check-out o una cancelación la lista no tendría sentido.
  // La unidad actual no aparece —está ocupada por esta misma reserva—, que es
  // justo lo que se quiere.
  const puedeMudarse = Boolean(periodo) && puedeCambiarUnidad(reserva.estado)
  const [libres, tiposData] = puedeMudarse && periodo
    ? await Promise.all([
        unidadesDisponibles(periodo.desde, periodo.hasta),
        supabase.from('tipos_unidad').select('id, nombre'),
      ])
    : [[], { data: [] }]
  const nombreTipo = new Map(
    ((tiposData.data ?? []) as { id: string; nombre: string }[]).map((t) => [t.id, t.nombre]),
  )

  return (
    <Pagina>
      <Link
        href="/panel/reservas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reservas
      </Link>

      <Encabezado
        titulo={reserva.codigo}
        descripcion={reserva.huesped ? nombreCompleto(reserva.huesped) : 'Sin huésped asociado'}
        icono="reservas"
        acciones={
          <Etiqueta tono={TONO_ESTADO[reserva.estado]}>
            {ETIQUETAS_ESTADO_RESERVA[reserva.estado]}
          </Etiqueta>
        }
      />

      {errorParam && (
        <Mensaje tono="error">
          {/*
            `ficha_ocupantes` es la única clave con un `detalle` propio: lo
            manda `editarFichaReserva` con el motivo puntual que calculó
            `validarOcupantes` (de qué capacidad se pasó, o qué falta),
            porque el texto fijo de MENSAJES_ERROR lista las tres
            condiciones posibles en vez de decir cuál falló.
          */}
          {errorParam === 'ficha_ocupantes' && detalleParam
            ? detalleParam
            : mensajeDe(MENSAJES_ERROR, errorParam, 'No se pudo completar la operación.')}
        </Mensaje>
      )}

      {fallaPagos && (
        <Mensaje tono="error">
          No se pudieron leer los pagos de esta reserva — el saldo que se ve abajo puede no ser el
          real. Revisá directamente en Pagos antes de dar algo por cobrado.
        </Mensaje>
      )}

      {/*
        «Pagada» con saldo: pasa cuando una reserva ya saldada se reprograma a
        fechas más caras o se registra un reembolso. La máquina de estados no
        tiene vuelta de `pagada` a `confirmada` (es una decisión de negocio
        pendiente), así que por lo menos no se esconde: quien mira el estado
        vería «Pagada» y no le cobraría la diferencia.
      */}
      {!fallaPagos && reserva.estado === 'pagada' && resumen.saldo > 0 && (
        <Mensaje tono="error">
          Figura como pagada, pero quedan {formatearUSD(resumen.saldo)} sin cobrar (la estadía se
          recotizó o hubo un reembolso después del pago). Cobrá la diferencia antes de la salida.
        </Mensaje>
      )}

      {avisoPagoAgenciaVencido && (
        <Mensaje tono="error">
          El pago de la agencia está vencido: tenía que estar cubierto el{' '}
          {formatoFechaCorta(avisoPagoAgenciaVencido.vencimiento)} (un mes antes del check-in) y
          lleva pagado {formatearUSD(avisoPagoAgenciaVencido.totalPagado)} de{' '}
          {formatearUSD(Number(reserva.total))}. Reclamale a la agencia o evaluá liberar la
          unidad.
        </Mensaje>
      )}

      {okParam === 'mudanza' && (
        <Mensaje tono="ok">
          Unidad cambiada. La habitación liberada quedó marcada para limpieza si el huésped ya
          estaba alojado.
        </Mensaje>
      )}

      {okParam === 'ficha' && <Mensaje tono="ok">Ficha actualizada.</Mensaje>}

      {/*
        Dos columnas en escritorio, con TODO a la vista al mismo tiempo: nada de
        pestañas ni bloques plegados. A la izquierda la reserva y qué hacer con
        ella; a la derecha la plata. En el teléfono se apila en ese mismo orden.
      */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
      {/*
        `items-start`: cada tarjeta mide lo suyo.

        Sin esto la grilla las estira a la altura de la más alta —es el
        comportamiento por omisión— y «Huésped», que tiene cuatro datos, quedaba
        con mil píxeles de blanco al lado de «Estadía», que trae además el
        formulario de tarjeta y el desglose de importes. La pantalla se veía rota
        aunque no lo estuviera.
      */}
      <div className="grid gap-4 sm:grid-cols-2 sm:items-start lg:grid-cols-1 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Huésped</h2>
          <dl className="flex flex-col gap-3">
            <Dato
              etiqueta="Nombre"
              valor={reserva.huesped ? nombreCompleto(reserva.huesped) : '—'}
            />
            <Dato etiqueta="Email" valor={reserva.huesped?.email || '—'} />
            <Dato etiqueta="Documento" valor={reserva.huesped?.doc_numero || '—'} />
            {/* VIP con etiqueta de texto, no sólo una estrellita de color: si el
                dato importa tiene que leerse sin depender del color. */}
            {reserva.huesped?.vip && (
              <div>
                <dt className="text-xs tracking-wide text-stone-600 uppercase">Categoría</dt>
                <dd className="mt-0.5">
                  <Etiqueta tono="calafate">★ Huésped VIP</Etiqueta>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Estadía</h2>
          <dl className="flex flex-col gap-3">
            <Dato
              etiqueta="Unidad"
              valor={
                estadia?.unidad
                  ? `${estadia.unidad.nombre} · ${estadia.unidad.tipo?.nombre ?? ''}`
                  : '—'
              }
            />
            <Dato
              etiqueta="Fechas"
              valor={
                periodo
                  ? `${formatoFechaCorta(periodo.desde)} → ${formatoFechaCorta(periodo.hasta)} (${noches} noches)`
                  : '—'
              }
            />
            {/* Desglose de ocupantes: es lo que recepción necesita para preparar
                la habitación. «2 huéspedes» no dice si van dos camas o una cama
                y una cuna. */}
            <Dato etiqueta="Ocupantes" valor={estadia ? textoOcupantes(ocupantes) : '—'} />

            {/* Si el desglose y el pax guardado no cierran, se dice. Puede pasar
                con filas viejas o escritas por fuera de `crear_reserva`; mostrar
                dos números contradictorios sin avisar es peor que avisar. */}
            {estadia && !desgloseCoincide(ocupantes, estadia.huespedes) && (
              <div>
                <dt className="text-xs tracking-wide text-stone-600 uppercase">Atención</dt>
                <dd className="mt-0.5 text-sm text-lenga-800">
                  El desglose suma {paxQueOcupa(ocupantes)} pero la estadía tiene{' '}
                  {estadia.huespedes} huésped(es) registrado(s). Revisá el detalle.
                </dd>
              </div>
            )}

            {estadia?.no_mover && (
              <div>
                <dt className="text-xs tracking-wide text-stone-600 uppercase">Asignación</dt>
                <dd className="mt-0.5">
                  <Etiqueta tono="alerta">No mover de habitación</Etiqueta>
                </dd>
              </div>
            )}

            {/* Las notas a la vista y no sólo dentro de «Editar ficha»: ahí
                llega el pedido especial que el huésped escribe al reservar
                desde la web —una cuna, la hora de llegada—, y recepción tiene
                que leerlo sin abrir ningún formulario. */}
            {reserva.notas && (
              <div>
                <dt className="text-xs tracking-wide text-stone-600 uppercase">Notas</dt>
                <dd className="mt-0.5 whitespace-pre-line text-stone-800">{reserva.notas}</dd>
              </div>
            )}

            <Dato etiqueta="Plan" valor={ETIQUETAS_PLAN[reserva.plan] ?? reserva.plan} />
            <Dato
              etiqueta="Canal / tarifa / segmento"
              valor={`${reserva.canal} · ${reserva.tarifa_tipo} · ${ETIQUETAS_SEGMENTO[reserva.segmento] ?? reserva.segmento}`}
            />
            <Dato
              etiqueta="Garantía"
              valor={
                (ETIQUETAS_GARANTIA[reserva.garantia] ?? reserva.garantia) +
                (noShowEsCobrable(reserva.garantia) ? '' : ' — un no-show no sería cobrable')
              }
            />

            {reserva.voucher && <Dato etiqueta="Voucher" valor={reserva.voucher} />}

            {/* ── Desglose fiscal ──────────────────────────────────────────
                El listado de WinPAX mostraba la tarifa con y sin impuestos. Antes
                del paso 6 esto no se podía: `total` guarda el importe con IVA y
                `tarifas.iva_pct` puede variar por tarifa, así que dividir por 1,21
                daba un número aproximado y silenciosamente equivocado. */}
            <div className="border-t border-stone-100 pt-3">
              <dt className="text-xs tracking-wide text-stone-600 uppercase">Importes</dt>
              {/*
                Si el desglose no cierra contra el total, se dice en vez de
                publicarlo.

                `neto + iva` tiene que dar `total`. Cuando no da —una reserva
                importada de un canal, una migrada de WinPAX, una cargada por un
                script— la pantalla mostraba «Subtotal USD 0,00 / Neto USD 0,00 /
                IVA USD 0,00 / Total USD 363,00» con toda naturalidad. Eso es peor
                que no mostrar nada: se lee como un comprobante y no cierra, y
                alguien lo puede copiar a una factura.

                Se comparan con un centavo de tolerancia, porque los importes se
                redondean a dos decimales en varios puntos del camino.
              */}
              {Math.abs(Number(reserva.total_neto) + Number(reserva.iva) - Number(reserva.total)) >
              0.01 ? (
                <dd className="mt-1 space-y-1 text-sm">
                  <div className="flex justify-between font-semibold text-stone-900">
                    <span>Total con IVA</span>
                    <span className="tabular">{formatearUSD(Number(reserva.total))}</span>
                  </div>
                  <p className="rounded-lg bg-lenga-50 px-3 py-2 text-xs text-lenga-800 ring-1 ring-lenga-100">
                    Esta reserva no tiene cargado el desglose entre neto e IVA, así que no se
                    muestra: los números no cerrarían con el total. El importe que se cobra es el
                    de arriba. Si hace falta facturarla, cargá el desglose antes de emitir.
                  </p>
                </dd>
              ) : (
              <dd className="mt-1 space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500">Subtotal sin IVA</span>
                  <span className="tabular text-stone-700">
                    {formatearUSD(Number(reserva.subtotal))}
                  </span>
                </div>
                {Number(reserva.descuento_pct) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">
                      Descuento {Number(reserva.descuento_pct)}%
                    </span>
                    <span className="tabular text-stone-700">
                      −{formatearUSD(Number(reserva.subtotal) - Number(reserva.total_neto))}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-stone-500">Neto gravado</span>
                  <span className="tabular text-stone-700">
                    {formatearUSD(Number(reserva.total_neto))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">IVA</span>
                  <span className="tabular text-stone-700">
                    {formatearUSD(Number(reserva.iva))}
                  </span>
                </div>
                <div className="flex justify-between border-t border-stone-100 pt-1 font-semibold text-stone-900">
                  <span>Total con IVA</span>
                  <span className="tabular">
                    {formatearUSD(Number(reserva.total))}
                  </span>
                </div>
              </dd>
              )}
            </div>

            {/* ── Exención de IVA al turista del exterior (RG 3971, ADR 0024) ──
                Se muestra solo cuando puede aplicar: si el huésped no reside en
                el exterior, este bloque sería ruido en la pantalla de todos los
                días. Una reserva por agencia tampoco lo muestra: ahí el receptor
                del comprobante es la agencia, no el turista. */}
            {reserva.huesped?.residente_exterior && !reserva.agencia_id && (
              <div className="border-t border-stone-100 pt-3">
                <dt className="text-xs tracking-wide text-stone-600 uppercase">
                  Exención de IVA · turista del exterior
                </dt>
                <dd className="mt-2 space-y-2 text-sm">
                  {exento ? (
                    <p className="rounded-lg bg-lenga-50 px-3 py-2 text-lenga-900">
                      <strong>Corresponde la exención.</strong> Al facturar, el
                      alojamiento sale sin IVA:{' '}
                      <span className="tabular font-semibold">
                        {formatearUSD(previaExencion.exento)}
                      </span>{' '}
                      en vez de {formatearUSD(Number(reserva.total))}. Los
                      consumos (frigobar, excursiones) siguen gravados.
                    </p>
                  ) : (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 text-stone-700">
                      {motivoExencion && MENSAJES_SIN_EXENCION[motivoExencion]}
                    </p>
                  )}

                  <form action={fijarOrigenDelPago} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="reserva_id" value={reserva.id} />
                    <label className="flex-1 text-xs text-stone-600">
                      <span className="mb-1 block">¿De dónde sale el pago?</span>
                      <select
                        name="origen_pago"
                        defaultValue={
                          reserva.pago_desde_exterior === true
                            ? 'exterior'
                            : reserva.pago_desde_exterior === false
                              ? 'local'
                              : 'sin_definir'
                        }
                        className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      >
                        <option value="sin_definir">Todavía no se sabe</option>
                        <option value="exterior">
                          Del exterior — tarjeta emitida afuera o transferencia
                        </option>
                        <option value="local">
                          Local — efectivo, tarjeta o transferencia del país
                        </option>
                      </select>
                    </label>
                    <BotonEnvio variante="secundario" cargando="Guardando…">
                      Guardar
                    </BotonEnvio>
                  </form>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Acciones</h2>
        {transiciones.length === 0 ? (
          <p className="text-sm text-stone-600">La reserva está en un estado final.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {transiciones.map((t) => (
              <form key={t} action={cambiarEstadoReserva}>
                <input type="hidden" name="reserva_id" value={reserva.id} />
                <input type="hidden" name="nuevo_estado" value={t} />
                {/* `BotonEnvio` bloquea el botón mientras la acción viaja al
                    servidor: sin eso, un segundo clic impaciente repetía la
                    operación. Cancelar y no-show piden confirmación porque no
                    tienen vuelta atrás: son estados terminales. */}
                <BotonEnvio
                  variante="primario"
                  extra={`text-white ${ACCION_ESTADO[t].color}`}
                  cargando="Aplicando…"
                  confirmar={
                    t === 'cancelada'
                      ? `¿Cancelar la reserva ${reserva.codigo}?${cargo && cargo.monto > 0 ? ` Corresponde un cargo de ${formatearUSD(cargo.monto)}.` : ''} No se puede deshacer.`
                      : t === 'no_show'
                        ? `¿Marcar ${reserva.codigo} como no-show? Se cobra la estadía completa y no se puede deshacer.`
                        : undefined
                  }
                >
                  {ACCION_ESTADO[t].verbo}
                </BotonEnvio>
              </form>
            ))}
          </div>
        )}
        {cargo && (
          <p className="mt-3 text-xs text-stone-500">
            Cancelación hoy (
            {cargo.dias >= 0
              ? `${cargo.dias} días antes del check-in`
              : 'check-in ya transcurrido'}
            ): cargo estimado{' '}
            <span className="font-medium text-stone-700">
              {formatearUSD(cargo.monto)}
            </span>{' '}
            según la política estándar.
          </p>
        )}
      </div>

      {/* Con factura emitida el total no puede cambiar: el servidor lo rechaza. */}
      {periodo && !factura && !['cancelada', 'no_show', 'checkout'].includes(reserva.estado) && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Reprogramar</h2>

          {/*
            Paso de consulta, no de acción: por eso es GET y las fechas viajan
            en la URL, mismo criterio que «Buscar disponibilidad» en el alta
            de reservas. Antes había que reprogramar a ciegas para enterarse
            del total nuevo — el aviso de abajo ya decía «recotiza el total»,
            pero recién después de confirmar (patrón de referencia: Hotel
            PMS, re-precio inline en la ficha de reserva).
          */}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Nuevo check-in</span>
              <input
                type="date"
                name="nuevo_check_in"
                defaultValue={nuevoCheckIn || periodo.desde}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Nuevo check-out</span>
              <input
                type="date"
                name="nuevo_check_out"
                defaultValue={nuevoCheckOut || periodo.hasta}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 sm:w-auto"
            >
              Ver nuevo precio
            </button>
          </form>

          {previewValido && (
            <div className="mt-3 rounded-lg bg-lago-50 p-3 text-sm ring-1 ring-lago-200">
              {!previewCotizacion || previewCotizacion.faltanTarifas ? (
                <p className="text-lago-900">
                  No hay tarifa cargada para esas fechas: no se puede calcular el nuevo total.
                </p>
              ) : (
                <p className="text-lago-900">
                  Nuevo total: <span className="font-semibold">{formatearUSD(previewCotizacion.resumen.total)}</span>{' '}
                  <span className="text-lago-700">(antes {formatearUSD(Number(reserva.total))})</span>
                </p>
              )}
            </div>
          )}

          {previewValido && previewCotizacion && !previewCotizacion.faltanTarifas && (
            <form action={reprogramarReserva} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <input type="hidden" name="check_in" value={nuevoCheckIn!} />
              <input type="hidden" name="check_out" value={nuevoCheckOut!} />
              <BotonEnvio extra="w-full sm:w-auto" cargando="Reprogramando…">
                Confirmar reprogramación
              </BotonEnvio>
            </form>
          )}
          <p className="mt-2 text-xs text-stone-600">
            {previewValido
              ? 'Se rechaza si la unidad ya está ocupada en esas fechas.'
              : 'Elegí las fechas nuevas y mirá el precio antes de confirmar.'}
          </p>
        </div>
      )}

      {puedeMudarse && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-stone-700">Cambiar de unidad</h2>
          <p className="mb-3 text-xs text-stone-600">
            Para averías, pedidos del huésped o para liberar la habitación. Solo se listan las
            unidades libres en {formatoFechaCorta(periodo!.desde)} – {formatoFechaCorta(periodo!.hasta)}.
          </p>

          {/* Acá es donde «no mover» sirve. Sin este aviso, el motivo por el que
              se le asignó esa habitación —vista al lago, planta baja, la de
              siempre— se pierde en el momento exacto en que importa. */}
          {estadia?.no_mover && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-lenga-50 px-3 py-2 text-xs ring-1 ring-lenga-200">
              <span className="shrink-0 text-lenga-700">
                <Icono nombre="alerta" tam={14} />
              </span>
              <span className="text-lenga-900">
                <strong className="font-semibold">Marcada «no mover»:</strong> el huésped pidió esta
                unidad en particular. Confirmá con él antes de cambiarla.
              </span>
            </div>
          )}

          {libres.length === 0 ? (
            <p className="text-sm text-stone-600">
              No hay otra unidad libre en esas fechas. Se puede liberar una reprogramando o
              cancelando otra reserva.
            </p>
          ) : (
            <form action={cambiarUnidadReserva} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Nueva unidad</span>
                <select
                  name="unidad_destino"
                  required
                  className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Elegir…</option>
                  {libres.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} · {nombreTipo.get(u.tipo_unidad_id) ?? 'sin tipo'}
                      {u.estado === 'sucia' ? ' (sucia)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Motivo</span>
                <input
                  name="motivo"
                  placeholder="Calefactor roto"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Si cambia el tipo</span>
                <select
                  name="politica_tarifa"
                  className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                >
                  <option value="mantener">Mantener la tarifa pactada</option>
                  <option value="recotizar">Recotizar según el nuevo tipo</option>
                </select>
              </label>
              <BotonEnvio extra="w-full sm:w-auto" cargando="Mudando…">
                Mudar
              </BotonEnvio>
            </form>
          )}
          <p className="mt-2 text-xs text-stone-600">
            Dentro del mismo tipo el precio no cambia. La unidad que se libera queda sucia solo si
            el huésped ya había hecho el check-in.
          </p>
        </div>
      )}

      {/*
        Editar ficha: plan, segmento, voucher, notas, cunas, «no mover» y la
        composición. Hasta ahora, una vez creada, una reserva solo se podía
        reprogramar, mudar de unidad o cancelar y volver a cargar — no había
        forma de corregir uno de estos datos sin pasar por uno de esos tres
        caminos, que tocan cosas que acá no cambian (fechas, unidad, estado).

        Mismo criterio que «Cambiar de unidad»: si la reserva ya no admite
        mudanza (cancelada, no-show, con el huésped afuera), tampoco tiene
        sentido seguir editando cunas o composición.

        Nunca recotiza: ninguno de estos campos entra en el cálculo del precio
        (ver el comentario de `editarFichaReserva`), así que `reserva.total` no
        se toca.
      */}
      {puedeMudarse && estadia && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-stone-700">Editar ficha</h2>
          <p className="mb-3 text-xs text-stone-600">
            Plan, segmento, voucher, notas y la composición de la habitación. No cambia el precio
            ni el estado de la reserva — eso es «Reprogramar» y los botones de estado, arriba.
          </p>
          <form action={editarFichaReserva} className="flex flex-col gap-3">
            <input type="hidden" name="reserva_id" value={reserva.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-stone-500">Plan</span>
                <select
                  name="plan"
                  defaultValue={huboIntentoDeFicha ? vPlan : reserva.plan}
                  className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                >
                  {PLANES.map((p) => (
                    <option key={p} value={p}>
                      {ETIQUETAS_PLAN[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-stone-500">Segmento</span>
                <select
                  name="segmento"
                  defaultValue={huboIntentoDeFicha ? vSegmento : reserva.segmento}
                  className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                >
                  {SEGMENTOS.map((s) => (
                    <option key={s} value={s}>
                      {ETIQUETAS_SEGMENTO[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs sm:col-span-1">
                <span className="text-stone-500">Voucher</span>
                <input
                  name="voucher"
                  defaultValue={huboIntentoDeFicha ? vVoucher : reserva.voucher}
                  placeholder="Nº del canal o agencia"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-stone-500">Adultos</span>
                <input
                  name="adultos"
                  type="number"
                  min={1}
                  defaultValue={huboIntentoDeFicha ? vAdultos : ocupantes.adultos}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-stone-500">Menores</span>
                <input
                  name="menores"
                  type="number"
                  min={0}
                  defaultValue={huboIntentoDeFicha ? vMenores : ocupantes.menores}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-stone-500">Bebés</span>
                <input
                  name="bebes"
                  type="number"
                  min={0}
                  defaultValue={huboIntentoDeFicha ? vBebes : ocupantes.bebes}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-stone-500">Cunas</span>
                <input
                  name="cunas"
                  type="number"
                  min={0}
                  defaultValue={huboIntentoDeFicha ? vCunas : ocupantes.cunas}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="col-span-2 flex items-center gap-2 self-end pb-1.5 text-xs sm:col-span-1">
                <input
                  type="checkbox"
                  name="no_mover"
                  value="1"
                  defaultChecked={huboIntentoDeFicha ? vNoMover === '1' : estadia.no_mover}
                  className="size-4 rounded border-stone-300"
                />
                <span className="text-stone-700">No mover de habitación</span>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-stone-500">Notas</span>
              <textarea
                name="notas"
                defaultValue={huboIntentoDeFicha ? vNotas : reserva.notas}
                rows={2}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <div>
              <BotonEnvio extra="w-full sm:w-auto" cargando="Guardando…">
                Guardar ficha
              </BotonEnvio>
            </div>
          </form>
          <p className="mt-2 text-xs text-stone-600">
            Entran {estadia.unidad?.tipo?.capacidad_max ?? '—'} persona(s) en esta unidad (los
            bebés en cuna no cuentan).
          </p>
        </div>
      )}
        </div>

        {/* Columna de la cuenta: lo que se cobró y lo que se consumió. */}
        <div className="flex min-w-0 flex-col gap-4">
      <SeccionPagos reserva={reserva} resumen={resumen} pagos={pagos} senia={senia} />


      {/* ── Cobro en línea ────────────────────────────────────────────────
          El caso del huésped que reservó por teléfono o WhatsApp: no está para
          dar la tarjeta y no conviene que la dicte. Se le manda el link, paga
          desde su celular y el webhook salda la reserva solo. */}
      <CobroEnLinea reserva={reserva} cobro={cobroEnLinea} />

      {/* Tarjeta de garantía (ADR 0025): ver el porqué en `seccion-cuenta.tsx`. */}
      <SeccionGarantia reserva={reserva} garantiaOk={garantiaOk} motivoGarantia={motivoGarantia} />

      <SeccionConsumos
        reserva={reserva}
        factura={factura}
        fallaFactura={fallaFactura}
        motivoFactura={motivoFactura}
        consumos={consumos}
        productos={productos}
        cuenta={cuenta}
      />
        </div>
      </div>
    </Pagina>
  )
}
