import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  transicionesPosibles,
  ETIQUETAS_ESTADO_RESERVA,
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  noShowEsCobrable,
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
import {
  cargoPorCancelacion,
  montoCancelacion,
  nochePromedioConIva,
  primeraNocheRealConIva,
  type ReglaCancelacion,
} from '@/lib/domain/cancelacion'
import { parsearPeriodo, formatoFechaCorta, diasEntre, hoyISO } from '@/lib/fechas'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import {
  cambiarEstadoReserva,
  registrarPago,
  agregarConsumo,
  quitarConsumo,
  emitirFactura,
  reprogramarReserva,
  cambiarUnidadReserva,
  fijarOrigenDelPago,
  verificarTarjetaGarantia,
  generarLinkDePago,
} from '../actions'
import { proveedoresHabilitados, nombreClave } from '@/lib/payments'
import { MEDIOS_DE_COBRO, MONEDA_BASE, motivoNoSeCobra } from '@/lib/domain/cobro'
import { estadoDeCobro } from '@/lib/reservas/cobro'
import { MONEDAS_EXTRANJERAS, ETIQUETAS_MONEDA, formatearLocal } from '@/lib/domain/divisas'
import { motivoNoFacturable, MENSAJES_NO_FACTURABLE } from '@/lib/domain/facturacion'
import { MENSAJES_NO_CARGABLE } from '@/lib/domain/servicio'
import {
  exentoDeIva,
  motivoSinExencion,
  desglosarConExencion,
  MENSAJES_SIN_EXENCION,
} from '@/lib/domain/exencion-iva'
import {
  ETIQUETAS_VERIFICACION,
  MENSAJES_GARANTIA,
  garantiaSirveParaCobrar,
  motivoGarantiaNoSirve,
  tarjetaEnmascarada,
  type EstadoVerificacionTarjeta,
} from '@/lib/domain/garantia-tarjeta'
import { puedeCambiarUnidad, MENSAJES_RECHAZO_MUDANZA } from '@/lib/domain/mudanzas'
import { unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { BotonEnvio } from '../../_components/boton-envio'
import { Icono } from '../../_components/iconos'
import { TONO_ESTADO } from '../../_components/estilos'
import { Encabezado, Etiqueta, Mensaje, Pagina } from '../../_components/ui'
import {
  cuentaConsolidada,
  ETIQUETAS_CATEGORIA_PRODUCTO,
  type CategoriaProducto,
  type Consumo,
} from '@/lib/domain/consumos'
import {
  resumenPagos,
  seniaSugerida,
  ETIQUETAS_MEDIO,
  ETIQUETAS_TIPO_PAGO,
  TIPOS_PAGO,
  type MedioPago,
  type TipoPago,
  type EstadoPago,
  type Pago,
} from '@/lib/domain/pagos'
import { formatearUSD } from '@/lib/domain/moneda'

const MEDIOS_MANUALES: MedioPago[] = ['efectivo', 'transferencia', 'tarjeta']

interface PagoRow {
  id: string
  medio: MedioPago
  tipo: TipoPago
  /** SIEMPRE en USD: es lo único que salda la reserva (migración 0067). */
  monto: number | string
  estado: EstadoPago
  creado_en: string
  /** Moneda que de verdad pasó por la caja o la pasarela. */
  moneda: string | null
  /** Importe en `moneda`. Nulo cuando se cobró en dólares. */
  monto_cobrado: number | string | null
  cupon: string | null
  ultimos4: string | null
  tarjeta_marca: string | null
}

interface ConsumoRow {
  id: string
  cantidad: number
  precio_unitario: number | string
  producto: { nombre: string; categoria: CategoriaProducto } | null
}

interface ProductoRow {
  id: string
  nombre: string
  categoria: CategoriaProducto
  precio: number | string
}

/**
 * Mensajes de error que puede devolver cualquier acción de esta pantalla.
 *
 * Antes era una cadena de ternarios anidados: cada error nuevo agregaba un
 * nivel de indentación y el último quedaba a diez niveles de profundidad. Como
 * mapa, sumar un caso es una línea.
 */
const MENSAJES_ERROR: Record<string, string> = {
  transicion: 'Esa transición de estado no es válida.',
  overlap: 'No se pudo reprogramar: la unidad ya está ocupada en esas fechas.',
  tarifa: 'No hay tarifa cargada para esas fechas.',
  fechas: 'Revisá las fechas de reprogramación.',
  sin_consumir: MENSAJES_NO_FACTURABLE.sin_consumir,
  anulada: MENSAJES_NO_FACTURABLE.anulada,
  ya_facturada: MENSAJES_NO_FACTURABLE.ya_facturada,
  cuit: 'Para emitir una factura A hace falta un CUIT válido del receptor. Cargalo en la ficha del huésped o de la agencia.',
  cae: 'El proveedor de facturación rechazó el comprobante. Revisá los importes.',
  // Escrituras que la base puede rechazar. Antes fallaban en silencio: la
  // pantalla recargaba igual y no había forma de saber que no se había guardado.
  estado: 'No se pudo guardar el estado nuevo. La reserva quedó como estaba.',
  agencia: 'La reserva se creó, pero no se pudo vincular con la agencia. Asignala desde la ficha: de eso dependen la tarifa y la cuenta corriente.',
  puntos: 'Se registró el check-out, pero no se pudieron acreditar los puntos de fidelidad. Cargalos a mano desde la ficha del huésped.',
  saldada: 'Se registró el pago, pero la reserva no quedó marcada como pagada. Revisá el estado antes de seguir.',
  consumo: 'No se pudo cargar el consumo. No se cobró ni se descontó del stock.',
  quitar_consumo: 'No se pudo quitar el consumo. Sigue cargado a la cuenta.',
  factura:
    'Se pidió el CAE y se consumió el número de comprobante, pero la factura NO quedó guardada. Avisá antes de volver a emitir: el número ya se usó.',
  total: 'El cambio se hizo, pero no se pudo recalcular el precio. La reserva quedó con el total anterior.',
  repro: 'No se pudo reprogramar la estadía.',
  // Cobro (Fase 23).
  monto: 'El importe tiene que ser mayor que cero.',
  pago: 'No se pudo registrar el pago. No quedó nada cobrado.',
  moneda: 'Esa moneda no está entre las que el sistema sabe convertir.',
  sin_cotizacion:
    'No hay cotización vigente para esa moneda, así que no se puede pasar el importe a dólares. Cargá una en Configuración o registrá el pago en dólares.',
  ultimos4: 'Los últimos cuatro dígitos tienen que ser exactamente cuatro números.',
  link_sin_datos: 'No se pudo calcular el saldo para generar el link. Probá de nuevo.',
  link_no_cobrable: 'Esta reserva no tiene un saldo que se pueda cobrar en línea.',
  link_pago: 'No se pudo leer la reserva para generar el link de pago.',
  link_pasarela:
    'La pasarela no pudo crear el link. Probá con otro medio o cobrá desde el mostrador.',
  // Cambio de unidad.
  ...MENSAJES_RECHAZO_MUDANZA,
  ocupada: 'Esa unidad ya está ocupada en las fechas de la reserva.',
  sin_destino: 'Elegí la unidad de destino.',
  sin_estadia: 'La reserva no tiene una estadía asociada.',
  destino_inexistente: 'La unidad de destino no existe.',
  destino_inactivo: 'La unidad de destino está dada de baja.',
  tarifa_destino:
    'La mudanza se hizo, pero no hay tarifa cargada para el tipo de destino: el total quedó sin recotizar.',
  mudanza: 'No se pudo cambiar la unidad.',
  origen_pago:
    'No se pudo guardar el origen del pago. La exención de IVA quedó como estaba: revisala antes de facturar.',
  // Cargos que la cuenta ya no admite (P3).
  ...MENSAJES_NO_CARGABLE,
  // Garantía de tarjeta (P2, ADR 0025).
  tarjeta_incompleta: 'Faltan el número y el vencimiento de la tarjeta.',
  tarjeta_sin_proveedor:
    'No hay una pasarela configurada para verificar tarjetas. Avisá antes de confiar en esta garantía.',
  tarjeta:
    'No se pudo guardar el resultado de la verificación. La garantía quedó como estaba: revisala antes del check-in.',
}

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
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirAcceso('reservas')
  const { id } = await params
  const { error: errorParam, ok: okParam } = await searchParams
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('reservas')
    .select(
      'id, codigo, estado, total, subtotal, total_neto, iva, descuento_pct, canal, tarifa_tipo, notas, plan, garantia, segmento, voucher, agencia_id, pago_desde_exterior, tarjeta_ultimos4, tarjeta_marca, tarjeta_vencimiento, tarjeta_verificacion, tarjeta_verificada_en, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email, doc_numero, vip, residente_exterior), estadias(periodo, precio_noche, huespedes, adultos, menores, bebes, camas_extra, cunas, no_mover, unidad:unidades(nombre, tipo_unidad_id, tipo:tipos_unidad(nombre, capacidad_max)))',
    )
    .eq('id', id)
    .single()

  if (!data) notFound()
  const reserva = data as unknown as Reserva
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
  const ALICUOTA_PREVIA = 21
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

  // Preview del cargo por cancelación (política estándar).
  let cargo: { dias: number; monto: number } | null = null
  if (periodo && transiciones.includes('cancelada')) {
    const { data: pol } = await supabase
      .from('politicas_cancelacion')
      .select('reglas')
      .eq('codigo', 'estandar')
      .single()
    const reglas = (pol?.reglas ?? []) as ReglaCancelacion[]
    const dias = diasEntre(hoyISO(), periodo.desde)
    const tipoCargo = cargoPorCancelacion(reglas, dias)
    /*
      La primera noche REAL, no el promedio.

      `estadia.precio_noche` guarda `totalNeto / noches`: ya viene promediado, así que
      no sirve para esto. Se piden las tarifas por noche del tramo y se reparte el
      total **guardado** según esa proporción — el precio se fijó al reservar (ADR
      0004), así que recotizar cobraría un número que el huésped nunca aceptó.

      Si la estadía cruza un cambio de temporada, el promedio cobraba de más o de
      menos según cuál de las dos fuera la primera noche. En los dos sentidos es plata
      mal cobrada, y el huésped tiene el tarifario publicado para discutirlo.

      Si no se pudieron leer las tarifas —temporada sin cargar, por ejemplo— se cae al
      promedio, que es lo que había antes: peor que lo exacto, mejor que nada.
    */
    const cotizacion = await cotizarEstadia({
      tipoUnidadId: estadia?.unidad?.tipo_unidad_id ?? '',
      checkIn: periodo.desde,
      checkOut: periodo.hasta,
      tarifaTipo: reserva.tarifa_tipo as 'neto' | 'rack',
    }).catch(() => null)

    const preciosPorNoche = (cotizacion?.noches ?? []).map((n: { precio: number }) => n.precio)

    const monto = montoCancelacion({
      cargo: tipoCargo,
      totalEstadia: Number(reserva.total),
      primeraNocheConIva:
        preciosPorNoche.length > 0
          ? primeraNocheRealConIva(Number(reserva.total), preciosPorNoche)
          : nochePromedioConIva(Number(reserva.total), noches),
    })
    cargo = { dias, monto }
  }

  const { data: pagosData } = await supabase
    .from('pagos')
    .select('id, medio, tipo, monto, estado, creado_en, moneda, monto_cobrado, cupon, ultimos4, tarjeta_marca')
    .eq('reserva_id', id)
    .order('creado_en')
  const pagos = (pagosData ?? []) as PagoRow[]

  // Estado de cobro consolidado (alojamiento + consumos) y links de pago vivos.
  // Es la misma lectura que usa el portal público, para que el huésped y
  // recepción no vean saldos distintos.
  const cobroEnLinea = await estadoDeCobro(supabase, id)
  const resumen = resumenPagos(
    Number(reserva.total),
    pagos.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado }) as Pago),
  )
  const senia = seniaSugerida(Number(reserva.total), noches)

  const [{ data: consumosData }, { data: productosData }, { data: facturaData }] =
    await Promise.all([
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
        descripcion={
          reserva.huesped
            ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}`
            : 'Sin huésped asociado'
        }
        icono="reservas"
        acciones={
          <Etiqueta tono={TONO_ESTADO[reserva.estado]}>
            {ETIQUETAS_ESTADO_RESERVA[reserva.estado]}
          </Etiqueta>
        }
      />

      {errorParam && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[errorParam] ?? 'No se pudo completar la operación.'}
        </Mensaje>
      )}

      {okParam === 'mudanza' && (
        <Mensaje tono="ok">
          Unidad cambiada. La habitación liberada quedó marcada para limpieza si el huésped ya
          estaba alojado.
        </Mensaje>
      )}

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
              valor={reserva.huesped ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}` : '—'}
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

      {periodo && !['cancelada', 'no_show', 'checkout'].includes(reserva.estado) && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Reprogramar</h2>
          <form action={reprogramarReserva} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="reserva_id" value={reserva.id} />
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Nuevo check-in</span>
              <input type="date" name="check_in" defaultValue={periodo.desde} className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Nuevo check-out</span>
              <input type="date" name="check_out" defaultValue={periodo.hasta} className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
            </label>
            <BotonEnvio extra="w-full sm:w-auto" cargando="Reprogramando…">
              Reprogramar
            </BotonEnvio>
          </form>
          <p className="mt-2 text-xs text-stone-600">
            Recotiza el total; se rechaza si la unidad ya está ocupada en esas fechas.
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
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
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
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
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
        </div>

        {/* Columna de la cuenta: lo que se cobró y lo que se consumió. */}
        <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Pagos</h2>
        {/* Total / pagado / saldo son importes en USD: en tres columnas de
            110px se cortaban. En móvil van de a uno. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-stone-50 px-4 py-3">
            <p className="text-xs text-stone-600">Total</p>
            <p className="text-lg font-semibold text-stone-900">
              {formatearUSD(Number(reserva.total))}
            </p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-4 py-3">
            <p className="text-xs text-emerald-600">Pagado</p>
            <p className="text-lg font-semibold text-emerald-700">
              {formatearUSD(resumen.pagado)}
            </p>
          </div>
          <div className="rounded-lg bg-lenga-50 px-4 py-3">
            <p className="text-xs text-lenga-600">Saldo</p>
            <p className="text-lg font-semibold text-lenga-700">
              {formatearUSD(resumen.saldo)}
            </p>
          </div>
        </div>

        {pagos.length > 0 && (
          <ul className="mt-4 divide-y divide-stone-100 text-sm">
            {pagos.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0 text-stone-600">
                  {ETIQUETAS_TIPO_PAGO[p.tipo]} · {ETIQUETAS_MEDIO[p.medio]}
                  {p.estado !== 'aprobado' && (
                    <>
                      {' '}
                      <Etiqueta tono={p.estado === 'pendiente' ? 'alerta' : 'peligro'}>
                        {p.estado === 'pendiente' ? 'Pendiente' : 'Rechazado'}
                      </Etiqueta>
                    </>
                  )}
                  {/* El rastro del posnet y el importe en moneda local. Es lo que
                      permite conciliar contra la liquidación de la terminal
                      cuando los números no cierran. */}
                  {detalleDelCobro(p) && (
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {detalleDelCobro(p)}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 font-medium ${p.tipo === 'reembolso' ? 'text-red-600' : 'text-stone-800'} ${p.estado !== 'aprobado' ? 'text-stone-400 line-through' : ''}`}
                >
                  {p.tipo === 'reembolso' ? '−' : ''}{formatearUSD(Number(p.monto))}
                </span>
              </li>
            ))}
          </ul>
        )}

        {resumen.saldada ? (
          <p className="mt-4 text-sm font-medium text-emerald-700">✓ Reserva saldada.</p>
        ) : (
          <form action={registrarPago} className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="reserva_id" value={reserva.id} />
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Medio</span>
              <select name="medio" className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm">
                {MEDIOS_MANUALES.map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETAS_MEDIO[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Tipo</span>
              <select
                name="tipo"
                defaultValue={resumen.tieneSenia ? 'saldo' : 'senia'}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              >
                {TIPOS_PAGO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_PAGO[t]}
                  </option>
                ))}
              </select>
            </label>
            {/* La moneda del cobro. Un huésped que paga en efectivo en pesos es
                el caso más común del hotel; antes había que hacer la conversión
                a mano y anotar el resultado, así que no quedaba registro de
                cuántos pesos entraron ni a qué cambio y la caja no cerraba
                contra el sistema. `monto` se sigue guardando en USD —es lo único
                que salda la reserva— y el importe real va aparte. */}
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Moneda</span>
              <select
                name="moneda"
                defaultValue={MONEDA_BASE}
                className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-auto"
              >
                <option value={MONEDA_BASE}>Dólares (USD)</option>
                {MONEDAS_EXTRANJERAS.map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETAS_MONEDA[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Monto</span>
              <input
                name="monto"
                type="number"
                step="0.01"
                min="0"
                defaultValue={resumen.tieneSenia ? resumen.saldo : senia}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-32"
              />
            </label>

            {/* Rastro del posnet. Se piden SIEMPRE, no sólo al elegir tarjeta:
                esconderlos detrás de la selección del medio exigiría JavaScript
                de cliente en una pantalla que hoy es un formulario de servidor, y
                el proyecto prohíbe esconder campos. Son opcionales y la acción
                los ignora si el medio no es tarjeta.
                ⚠️ NO hay campo para el número de tarjeta y no debe haberlo: la
                migración 0067 rechaza un PAN en estas columnas (ADR 0025). */}
            <fieldset className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-stone-200 p-3">
              <legend className="px-1 text-xs text-stone-500">
                Si cobrás con el posnet (opcional)
              </legend>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Cupón / autorización</span>
                <input
                  name="cupon"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-36"
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Últimos 4 dígitos</span>
                <input
                  name="ultimos4"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  autoComplete="off"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-28"
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Marca</span>
                <input
                  name="tarjeta_marca"
                  autoComplete="off"
                  placeholder="Visa"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-28"
                />
              </label>
            </fieldset>

            {/* El caso que más importa: sin bloqueo, un segundo clic
                registraba el pago dos veces. */}
            <BotonEnvio
              extra="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 sm:w-auto"
              cargando="Registrando…"
            >
              Registrar pago
            </BotonEnvio>
          </form>
        )}
        <p className="mt-3 text-xs text-stone-600">
          Seña sugerida (primera noche): {formatearUSD(senia)}.
        </p>
      </div>

      {/* ── Cobro en línea ────────────────────────────────────────────────
          El caso del huésped que reservó por teléfono o WhatsApp: no está para
          dar la tarjeta y no conviene que la dicte. Se le manda el link, paga
          desde su celular y el webhook salda la reserva solo. */}
      <CobroEnLinea reserva={reserva} cobro={cobroEnLinea} />

      {/* ── Tarjeta de garantía (ADR 0025) ─────────────────────────────────
          Vive en la columna de la plata y no en «Estadía», que es donde estaba.

          Dos razones. La de fondo: una tarjeta de garantía no describe la
          estadía, es lo que permite COBRAR un no-show, así que su lugar está
          junto a los pagos y la cuenta. La práctica: el formulario ocupa unos
          450 px y siempre está abierto —no se puede plegar, el proyecto lo
          prohíbe—, así que dejaba la tarjeta «Estadía» en 1.100 px, más del
          triple que cualquier otra, y toda la columna derecha en blanco.

          El sistema NO guarda el número de tarjeta: guarda el token que
          devuelve la pasarela, los últimos cuatro dígitos y el resultado de la
          verificación. Ver el ADR antes de agregar campos acá. */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Tarjeta de garantía</h2>
        <dl>
              <div>
                <dd className="space-y-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="tabular font-medium text-stone-800">
                      {tarjetaEnmascarada(reserva.tarjeta_ultimos4, reserva.tarjeta_marca)}
                    </span>
                    <Etiqueta
                      tono={
                        garantiaOk
                          ? 'exito'
                          : reserva.tarjeta_verificacion === 'rechazada'
                            ? 'peligro'
                            : 'alerta'
                      }
                    >
                      {ETIQUETAS_VERIFICACION[reserva.tarjeta_verificacion]}
                    </Etiqueta>
                  </p>

                  {motivoGarantia && (
                    <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-700">
                      {MENSAJES_GARANTIA[motivoGarantia]}
                    </p>
                  )}

                  {/* Formulario SIEMPRE visible: `CLAUDE.md` prohíbe esconder una
                      acción detrás de un `<details>`, y acá pesa doble — si la
                      garantía no sirve, cargar otra tarjeta es justo lo que hay
                      que hacer y no puede estar a un clic de distancia.
                      `autoComplete="off"` en el número y el código: no tienen por
                      qué quedar en el historial de un puesto compartido. */}
                  <div className="rounded-lg border border-stone-200 p-3 text-xs">
                    <p className="mb-2 font-medium text-stone-700">
                      {reserva.tarjeta_ultimos4 ? 'Cambiar la tarjeta' : 'Cargar una tarjeta'}
                    </p>
                    <form
                      action={verificarTarjetaGarantia}
                      autoComplete="off"
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      <input type="hidden" name="reserva_id" value={reserva.id} />
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-stone-600">Número de tarjeta</span>
                        <input
                          name="tarjeta_numero"
                          inputMode="numeric"
                          autoComplete="off"
                          required
                          className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-stone-600">Vencimiento (MM/AA)</span>
                        <input
                          name="tarjeta_vencimiento"
                          placeholder="12/28"
                          pattern="(0[1-9]|1[0-2])/[0-9]{2}"
                          required
                          className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-stone-600">Código de seguridad</span>
                        <input
                          name="tarjeta_cvv"
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                        />
                      </label>
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-stone-600">Titular</span>
                        <input
                          name="tarjeta_titular"
                          autoComplete="off"
                          className="w-full rounded-lg border border-stone-300 px-2 py-1.5"
                        />
                      </label>
                      <p className="text-[11px] leading-snug text-stone-500 sm:col-span-2">
                        El sistema <strong>no guarda</strong> el número ni el código de seguridad:
                        se los manda a la pasarela y conserva solo los últimos cuatro dígitos y el
                        resultado.
                      </p>
                      <div className="sm:col-span-2">
                        <BotonEnvio variante="secundario" cargando="Verificando…">
                          Verificar tarjeta
                        </BotonEnvio>
                      </div>
                    </form>
                  </div>
                </dd>
              </div>
        </dl>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-stone-700">Consumos y cuenta</h2>
          <div className="flex flex-wrap items-center gap-3">
          {/* La cuenta detallada vive aparte: acá está la consolidada, que alcanza
              para el día a día. El detalle por departamento y el split entre folios
              son de administración y ocuparían la pantalla entera. */}
          <Link
            href={`/panel/reservas/${reserva.id}/cuenta`}
            className="text-sm font-medium text-lago-700 hover:underline"
          >
            Ver cuenta detallada
          </Link>
          {factura ? (
            <Link
              href={`/panel/reservas/${reserva.id}/factura`}
              className="text-sm font-medium text-lago-700 hover:underline"
            >
              Ver factura {factura.numero}
            </Link>
          ) : motivoFactura ? (
            /* El botón no se ofrece si no corresponde: es más claro explicar por
               qué que dejar apretar y devolver un error. */
            <span className="max-w-sm text-right text-xs text-stone-600">
              {MENSAJES_NO_FACTURABLE[motivoFactura]}
            </span>
          ) : (
            <form action={emitirFactura}>
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <BotonEnvio
                cargando="Emitiendo…"
                confirmar={`¿Emitir la factura de ${reserva.codigo}? Una vez emitida no se puede anular desde el sistema.`}
              >
                Emitir factura
              </BotonEnvio>
            </form>
          )}
          </div>
        </div>

        {consumos.length > 0 && (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {consumos.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="text-stone-600">
                  {c.cantidad}× {c.producto?.nombre}
                  <span className="ml-2 text-xs text-stone-600">
                    {c.producto ? ETIQUETAS_CATEGORIA_PRODUCTO[c.producto.categoria] : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-stone-800">
                    {formatearUSD((c.cantidad * Number(c.precio_unitario)))}
                  </span>
                  {/* Quitar un cargo es un borrado irreversible de dinero de la
                      cuenta del huésped. Antes era un `<button>` crudo con `✕`:
                      sin confirmación, sin estado de envío y sin nombre
                      accesible —un lector de pantalla anunciaba «botón»—.
                      `anularComanda` ya hacía lo correcto para el lote; esto
                      quedó afuera. */}
                  <form action={quitarConsumo}>
                    <input type="hidden" name="reserva_id" value={reserva.id} />
                    <input type="hidden" name="consumo_id" value={c.id} />
                    <BotonEnvio
                      variante="fantasma"
                      cargando="Quitando…"
                      aria-label={`Quitar ${c.producto?.nombre ?? 'el consumo'} de la cuenta`}
                      confirmar={`¿Quitar ${c.cantidad}× ${c.producto?.nombre ?? 'este consumo'} por ${formatearUSD(c.cantidad * Number(c.precio_unitario))} de la cuenta? No se puede deshacer.`}
                    >
                      ✕
                    </BotonEnvio>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form action={agregarConsumo} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Producto / servicio</span>
            <select
              name="producto_id"
              required
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — {formatearUSD(Number(p.precio))}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Cant.</span>
            <input
              name="cantidad"
              type="number"
              min="1"
              defaultValue={1}
              className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <BotonEnvio extra="w-full sm:w-auto" cargando="Cargando…">
            Cargar
          </BotonEnvio>
        </form>

        <dl className="mt-4 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Alojamiento</dt>
            <dd className="text-stone-700">{formatearUSD(cuenta.alojamiento)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Consumos</dt>
            <dd className="text-stone-700">{formatearUSD(cuenta.consumos)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-100 pt-1 font-semibold text-stone-900">
            <dt>Total cuenta</dt>
            <dd>{formatearUSD(cuenta.total)}</dd>
          </div>
        </dl>
      </div>
        </div>
      </div>
    </Pagina>
  )
}

/* ─────────────────────────────────────────────────── cobro en línea ────── */

/**
 * Generar y reenviar el link de pago del huésped.
 *
 * Resuelve el caso del huésped que reservó por teléfono o WhatsApp: no está en
 * el mostrador para dar la tarjeta y dictarla por teléfono es justo lo que no
 * hay que hacer. Se le manda el link, paga desde su celular y el webhook salda
 * la reserva sin que recepción toque nada.
 *
 * Cuando ya hay un link vivo **se muestra ése y no se ofrece crear otro**: dos
 * links por el mismo saldo son dos cobros posibles, y devolver uno es un trámite
 * manual con la pasarela más una discusión con el huésped.
 */
function CobroEnLinea({
  reserva,
  cobro,
}: {
  reserva: { id: string; estado: EstadoReserva }
  cobro: Awaited<ReturnType<typeof estadoDeCobro>>
}) {
  if (!cobro) return null

  const impedimento = motivoNoSeCobra(reserva.estado, cobro.saldo)
  const habilitados = new Set(proveedoresHabilitados().map(nombreClave))

  // El catálogo más el simulador, que no está en el catálogo porque no es un
  // medio que se le ofrezca a nadie: es la herramienta de demostración.
  const medios = [
    ...MEDIOS_DE_COBRO.filter((m) => habilitados.has(m.id)).map((m) => ({
      valor: m.id as string,
      titulo: m.titulo,
    })),
    ...(habilitados.has('simulado')
      ? [{ valor: 'simulado', titulo: 'Pago simulado (no mueve dinero)' }]
      : []),
  ]

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-medium text-stone-700">Link de pago</h2>
      <p className="mb-3 text-xs leading-snug text-stone-500">
        Para mandarle al huésped por correo o WhatsApp. Paga desde su teléfono y la reserva se
        salda sola.
      </p>

      {cobro.linksVivos.length > 0 ? (
        <div className="space-y-3">
          {cobro.linksVivos.map((l) => (
            <div key={l.externalId} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-stone-800">
                  {l.tipo === 'senia' ? 'Seña' : 'Saldo'} · {formatearUSD(l.monto)}
                </span>
                {l.moneda !== MONEDA_BASE && l.montoCobrado !== null && (
                  <span className="text-xs text-stone-500">
                    se cobra{' '}
                    {MONEDAS_EXTRANJERAS.includes(l.moneda as (typeof MONEDAS_EXTRANJERAS)[number])
                      ? formatearLocal(
                          l.montoCobrado,
                          l.moneda as (typeof MONEDAS_EXTRANJERAS)[number],
                        )
                      : `${l.moneda} ${l.montoCobrado}`}
                  </span>
                )}
              </p>

              {/* El enlace completo y seleccionable, no un botón de «copiar»:
                  copiar al portapapeles necesita JavaScript de cliente y falla
                  en silencio si el navegador lo bloquea. Un texto que se puede
                  leer y seleccionar funciona siempre. */}
              <p className="mt-1 break-all rounded border border-stone-200 bg-white px-2 py-1.5 font-mono text-xs text-stone-600 select-all">
                {l.url}
              </p>

              <p className="mt-1 text-xs text-stone-500">
                {l.venceEn
                  ? `Vence el ${formatoFechaCorta(l.venceEn.slice(0, 10))}.`
                  : 'Sin vencimiento.'}
              </p>
            </div>
          ))}
          <p className="text-xs text-stone-500">
            Ya hay un link activo por este saldo. No se genera otro para que el huésped no
            pueda pagar dos veces.
          </p>
        </div>
      ) : impedimento ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-600">
          {impedimento}
        </p>
      ) : medios.length === 0 ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-snug text-stone-600">
          No hay ninguna pasarela habilitada. Se configura con la variable{' '}
          <code className="font-mono">PAGO_PROVIDER</code>.
        </p>
      ) : (
        <form action={generarLinkDePago} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Medio</span>
            <select
              name="medio"
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-auto"
            >
              {medios.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Cobrar</span>
            <select
              name="tipo"
              defaultValue={cobro.tieneSenia ? 'saldo' : 'senia'}
              className="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-auto"
            >
              <option value="senia">Seña ({formatearUSD(Math.min(cobro.senia, cobro.saldo))})</option>
              <option value="saldo">Saldo completo ({formatearUSD(cobro.saldo)})</option>
            </select>
          </label>
          <BotonEnvio extra="w-full sm:w-auto" cargando="Generando…">
            Generar link
          </BotonEnvio>
        </form>
      )}
    </div>
  )
}

/**
 * La línea chica bajo un pago: cuánto entró en moneda local y con qué cupón.
 *
 * Devuelve cadena vacía cuando no hay nada que agregar —un pago en dólares sin
 * tarjeta— para no ensuciar la lista con una línea en blanco.
 */
function detalleDelCobro(p: PagoRow): string {
  const partes: string[] = []

  if (p.moneda && p.moneda !== MONEDA_BASE && p.monto_cobrado !== null) {
    const monto = Number(p.monto_cobrado)
    partes.push(
      MONEDAS_EXTRANJERAS.includes(p.moneda as (typeof MONEDAS_EXTRANJERAS)[number])
        ? formatearLocal(monto, p.moneda as (typeof MONEDAS_EXTRANJERAS)[number])
        : `${p.moneda} ${monto}`,
    )
  }

  if (p.tarjeta_marca) partes.push(p.tarjeta_marca)
  if (p.ultimos4) partes.push(`•••• ${p.ultimos4}`)
  if (p.cupon) partes.push(`cupón ${p.cupon}`)

  return partes.join(' · ')
}
