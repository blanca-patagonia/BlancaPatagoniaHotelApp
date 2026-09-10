import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerProveedorCanal } from '@/lib/canales'
import { describirUltimaLectura } from '@/lib/canales/ical-saliente'
import { MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import { urlDelSitio } from '@/lib/env'
import {
  fechaHoraHotel,
  fechaHotel,
  formatoFechaCorta,
  horaHotel,
  hoyISO,
  parsearPeriodo,
  sumarDias,
} from '@/lib/fechas'
import { construirQuery } from '@/lib/listados'
import { registrarFalla } from '@/lib/acciones'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import {
  BarraHerramientas,
  CAMPO,
  Campo,
  Chip,
  COL_SECUNDARIA,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../_components/ui'
import { ImportarCsv } from './importar-csv'
import { ImportarResenas } from './importar-resenas'
import {
  cargarMensaje,
  cargarResena,
  borrarRestriccionCanal,
  conciliarCargo,
  guardarMapeoCanal,
  guardarRestriccionCanal,
  publicarAhora,
  ignorarEntrante,
  importarUna,
  marcarMensajeAtendido,
  fijarModalidadCobro,
  registrarFacturaComision,
  registrarTransferenciaCanal,
  vincularResena,
  reintentarEntrante,
  responderResena,
  sincronizarCanal,
} from './actions'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import {
  conciliarDevengoContraFactura,
  ESTADOS_CONCILIACION,
  MENSAJES_NO_CONCILIAR,
  ETIQUETAS_CONCEPTO,
  ETIQUETAS_CONCILIACION,
  ETIQUETAS_ORIGEN,
  type ConceptoCargo,
  type EstadoConciliacion,
  type OrigenCargo,
} from '@/lib/domain/canales-costos'
import {
  clasificarCobro,
  contarCobros,
  ETIQUETAS_MODALIDAD,
  ETIQUETAS_SITUACION,
  MODALIDADES_COBRO,
  type ModalidadCobro,
  type SituacionCobro,
} from '@/lib/domain/canales-cobro'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'

/**
 * Canales de venta: el panel único de lo que llega de Booking.
 *
 * Tres vistas —reservas entrantes, mensajes y reseñas— más el estado de la
 * sincronización. Es lo que pedía el objetivo: ver en un mismo lugar las
 * llegadas, salidas y estancias del canal, los pedidos del huésped y las reseñas.
 *
 * ⚠️ **La advertencia de arriba no es decorativa.** Los dos proveedores que se
 * pueden usar sin ser partner certificado (CSV e iCal) son de solo lectura: nadie
 * le informa a Booking qué queda libre, así que Booking **puede vender una unidad
 * que el mostrador ya vendió**. Sin decirlo en pantalla, alguien va a creer que
 * está cubierto porque «el sistema sincroniza con Booking».
 */

/** Horas transcurridas desde un timestamp ISO. */
function horasDesde(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 3600000
}

const VISTAS = ['entrantes', 'cobros', 'costos', 'publicacion', 'mensajes', 'resenas', 'calendario'] as const
type Vista = (typeof VISTAS)[number]

const ETIQUETAS_VISTA: Record<Vista, string> = {
  entrantes: 'Reservas entrantes',
  cobros: 'Cobros y conciliación',
  costos: 'Costos y comisión',
  publicacion: 'Publicación al canal',
  mensajes: 'Mensajes y peticiones',
  resenas: 'Reseñas',
  calendario: 'Calendario para el canal',
}

const ESTADOS_ENTRANTE = ['pendiente', 'importada', 'error', 'ignorada'] as const
type EstadoEntrante = (typeof ESTADOS_ENTRANTE)[number]

const ETIQUETAS_ESTADO: Record<EstadoEntrante, string> = {
  pendiente: 'Sin importar',
  importada: 'Importada',
  error: 'Con problema',
  ignorada: 'Descartada',
}

const TONO_ESTADO: Record<EstadoEntrante, 'neutro' | 'lago' | 'exito' | 'alerta' | 'peligro'> = {
  pendiente: 'alerta',
  importada: 'exito',
  error: 'peligro',
  ignorada: 'neutro',
}

const MENSAJES_ERROR: Record<string, string> = {
  sin_sondeo:
    'El proveedor configurado no sabe traer reservas por sí solo. Usá la importación del informe CSV.',
  sondeo: 'No se pudo consultar el canal. Revisá la configuración de los feeds y probá de nuevo.',
  importar: 'No se pudo importar. El motivo quedó anotado en la fila, abajo.',
  falta_id: 'Faltó indicar cuál era la reserva.',
  ignorar: 'No se pudo descartar la reserva. Quedó como estaba.',
  reintentar: 'No se pudo volver a marcar como pendiente. Quedó como estaba.',
  mensaje: 'No se pudo guardar el mensaje.',
  cuerpo: 'Escribí el texto del mensaje.',
  resena: 'No se pudo guardar la reseña.',
  puntaje: 'El puntaje de Booking va de 0 a 10.',
  resena_vacia: 'Escribí al menos lo positivo o lo negativo de la reseña.',
  respuesta: 'No se pudo guardar la respuesta.',
  respuesta_vacia: 'Escribí la respuesta antes de guardar.',
  restriccion_rol:
    'Cerrar fechas en un canal es de administración o gerencia: decide cuánto inventario se le deja a la OTA.',
  restriccion_fechas:
    'Revisá las fechas: el "hasta" queda AFUERA del bloqueo, así que tiene que ser posterior al "desde".',
  restriccion_minimo: 'El mínimo de noches tiene que ser un número entero de 1 o más.',
  restriccion_vacia:
    'Esa restricción no restringe nada. Poné un mínimo de noches, o tildá cerrado, sin llegadas o sin salidas.',
  restriccion: 'No se pudo guardar la restricción. Probá de nuevo.',
  restriccion_borrar: 'No se pudo levantar la restricción. Quedó como estaba.',
  factura_rol: 'Registrar la factura del canal es de administración o gerencia: mueve la cuenta corriente del proveedor.',
  factura_comprobante: 'Poné el número de la factura: es con lo que después se coteja contra el papel.',
  factura_monto: 'El importe de la factura tiene que ser mayor que cero.',
  factura_moneda: 'Esa moneda no está entre las que el sistema sabe convertir.',
  factura_sin_cotizacion:
    'No hay cotización para esa moneda, así que la deuda en dólares sería inventada. Cargá una a mano en Configuración o registrá la factura en USD.',
  factura_periodo: 'Elegí el mes que factura el canal.',
  factura_config:
    'No se pudo leer la configuración del canal. Probá de nuevo; si sigue, avisá a administración.',
  factura_sin_proveedor:
    'Falta decir con qué proveedor se contabiliza Booking. Creá el proveedor en el módulo Proveedores y vinculalo en la configuración del canal.',
  factura_movimiento: 'No se pudo registrar la deuda con el proveedor. No se guardó nada.',
  factura_cargo:
    'La deuda con el proveedor SÍ se registró, pero no se pudo guardar la línea comparable contra lo devengado. Revisá el movimiento en Proveedores.',
  factura_repetida: 'Ya hay una factura cargada con ese número de comprobante.',
  conciliar_rol:
    'Cerrar la conciliación es de administración o gerencia: aceptar una diferencia es aceptar un costo.',
  conciliar_lectura: 'No se pudo leer el cargo. Probá de nuevo.',
  conciliar_inexistente: 'Ese cargo ya no existe. Recargá la pantalla.',
  conciliar_estado: MENSAJES_NO_CONCILIAR.estado,
  conciliar_sin_cambio: MENSAJES_NO_CONCILIAR.sin_cambio,
  conciliar_motivo_corto: MENSAJES_NO_CONCILIAR.motivo_corto,
  conciliar: 'No se pudo guardar el estado de conciliación. El cargo quedó como estaba.',
  mapeo_rol:
    'Configurar la publicación al canal es de administración o gerencia: define cuánto inventario se le entrega a la OTA.',
  mapeo_codigo: 'Escribí con qué código conoce el canal a ese tipo de unidad.',
  mapeo_codigo_repetido:
    'Ese código del canal ya está asignado a otro tipo de unidad. Si estuvieran repetidos, una reserva entrante caería en el tipo equivocado.',
  mapeo_tope: 'El tope de cupo tiene que ser un número entero de cero o más.',
  mapeo_minimo: 'El mínimo de noches tiene que ser un número entero de uno o más.',
  mapeo: 'No se pudo guardar el mapeo. Quedó como estaba.',
  transf_referencia: 'Poné la referencia de la liquidación: es lo que evita registrar dos veces la misma transferencia.',
  transf_monto: 'El importe de la transferencia tiene que ser mayor que cero.',
  transf_lectura: 'No se pudo leer la reserva. Probá de nuevo.',
  transf_no_existe: 'Esa reserva entrante ya no existe.',
  transf_sin_reserva: 'Primero hay que importar la reserva: sin reserva propia no hay a qué imputarle el pago.',
  transf_pago: 'No se pudo registrar la transferencia. No se guardó nada.',
  modalidad: 'No se pudo guardar quién cobra. Quedó como estaba.',
  vincular: 'No se pudo ligar la reseña a la reserva. Quedó como estaba.',
  autor: 'Elegí si el mensaje lo escribió el huésped o el hotel.',
  modalidad_invalida: 'Esa forma de cobro no existe.',
}

interface EntranteRow {
  id: string
  canal: string
  external_id: string
  operacion: string
  estado: EstadoEntrante
  motivo: string
  huesped_apellido: string
  huesped_nombre: string
  huesped_email: string | null
  huesped_pais: string | null
  tipo_unidad_codigo: string
  check_in: string
  check_out: string
  huespedes: number
  importe_canal: number | string | null
  moneda_canal: string | null
  comision: number | string | null
  modalidad_cobro: string | null
  liquidado_en: string | null
  conflicto: boolean
  notas: string
  /** Qué cambió el canal después de importarla, en palabras (migración 0088). */
  divergencia: string
  divergencia_desde: string | null
  reserva_id: string | null
  reserva: { codigo: string } | null
}

interface SincroRow {
  proveedor: string
  origen: string
  leidas: number
  nuevas: number
  actualizadas: number
  rechazadas: number
  corrida_en: string
}

interface MensajeRow {
  id: string
  cuerpo: string
  autor: string
  atendido: boolean
  recibido_en: string
  entrante: { huesped_apellido: string; check_in: string } | null
}

interface ResenaRow {
  id: string
  autor: string
  puntaje: number | string | null
  positivo: string
  negativo: string
  publicada_en: string | null
  respondida: boolean
  respuesta: string
  pais: string | null
  titulo: string
  vinculo: string
  motivo_sin_vinculo: string
  reserva: { id: string; codigo: string } | null
}

interface CargoRow {
  id: string
  concepto: string
  origen: string
  monto: number | string
  moneda: string
  monto_usd: number | string | null
  imputado_el: string | null
  estado_conciliacion: string
  /** Por qué se disputó, o qué se anotó al cerrar la revisión (migración 0079). */
  nota_conciliacion: string | null
  detalle: string
  /** Nulo cuando el cargo no se pudo atribuir a ninguna reserva del canal. */
  entrante: { huesped_apellido: string; external_id: string } | null
  reserva: { codigo: string } | null
}

export default async function CanalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string
    estado?: string
    error?: string
    ok?: string
    codigo?: string
    nuevas?: string
    actualizadas?: string
    rechazadas?: string
  }>
}) {
  const sesion = await requerirAcceso('canales')
  const sp = await searchParams

  /*
    Cerrar la conciliación es de gerencia (P1-4).

    El área `canales` alcanza también a recepción para lo operativo —importar,
    convertir una entrante, atender un mensaje—, pero aceptar una diferencia
    contra el canal es aceptar un costo y disputarla es abrir un reclamo. La
    acción lo verifica igual; acá se decide si mostrar el control.
  */
  const puedeConciliarCargos = sesion.rol === 'admin' || sesion.rol === 'gerencia'

  const vista: Vista = (VISTAS as readonly string[]).includes(sp.vista ?? '')
    ? (sp.vista as Vista)
    : 'entrantes'
  const estado = (ESTADOS_ENTRANTE as readonly string[]).includes(sp.estado ?? '')
    ? (sp.estado as EstadoEntrante)
    : undefined

  const proveedor = obtenerProveedorCanal()
  const capacidades = proveedor.capacidades()

  const supabase = await crearClienteServidor()

  let consultaEntrantes = supabase
    .from('canal_reservas')
    .select(
      'id, canal, external_id, operacion, estado, motivo, huesped_apellido, huesped_nombre, huesped_email, huesped_pais, tipo_unidad_codigo, check_in, check_out, huespedes, importe_canal, moneda_canal, comision, modalidad_cobro, liquidado_en, conflicto, notas, divergencia, divergencia_desde, reserva_id, reserva:reservas(codigo)',
    )
    .order('check_in', { ascending: true })
    .limit(200)
  if (estado) consultaEntrantes = consultaEntrantes.eq('estado', estado)

  const [
    { data: entrantesData, error: eEntrantes },
    { data: sincroData, error: eSincro },
    { data: mensajesData, error: eMensajes },
    { data: resenasData, error: eResenas },
    { data: cargosData, error: eCargos },
    { data: tiposData, error: eTipos },
    { data: unidadesData, error: eUnidades },
    { data: configData, error: eConfig },
    { data: mapeosData, error: eMapeos },
    { data: salidaData, error: eSalida },
    { data: restriccionesData, error: eRestricciones },
  ] = await Promise.all([
      consultaEntrantes,
      supabase
        .from('canal_sincronizaciones')
        .select('proveedor, origen, leidas, nuevas, actualizadas, rechazadas, corrida_en')
        .order('corrida_en', { ascending: false })
        .limit(5),
      supabase
        .from('canal_mensajes')
        .select(
          'id, cuerpo, autor, atendido, recibido_en, entrante:canal_reservas(huesped_apellido, check_in)',
        )
        .order('recibido_en', { ascending: false })
        .limit(100),
      supabase
        .from('canal_resenas')
        .select('id, autor, pais, puntaje, titulo, positivo, negativo, publicada_en, respondida, respuesta, vinculo, motivo_sin_vinculo, reserva:reservas(id, codigo)')
        .order('publicada_en', { ascending: false, nullsFirst: false })
        .limit(100),
      // Los cargos del canal (migración 0049). El embed trae el apellido para poder
      // decir a qué venta pertenece cada costo, que es todo el punto de la tabla.
      supabase
        .from('canal_cargos')
        .select(
          'id, concepto, origen, monto, moneda, monto_usd, imputado_el, estado_conciliacion, nota_conciliacion, detalle, entrante:canal_reservas(huesped_apellido, external_id), reserva:reservas(codigo)',
        )
        .order('imputado_el', { ascending: false, nullsFirst: false })
        .limit(200),
      /*
        El inventario, para armar las URLs del feed iCal de salida.

        Las unidades se traen enteras y se cuentan acá en vez de pedirle el conteo a
        la base: son quince filas. Y hace falta el conteo por tipo porque de él
        depende lo único que hay que explicarle a quien lee la pantalla — un tipo con
        tres unidades recién se cierra cuando se vendieron las tres.
      */
      supabase
        .from('tipos_unidad')
        .select('id, codigo, nombre')
        .eq('activo', true)
        .order('codigo'),
      supabase
        .from('unidades')
        .select('id, nombre, tipo_unidad_id')
        .eq('activo', true)
        .order('nombre'),
      supabase
        .from('canal_config')
        .select('canal, ical_token, ical_leido_en')
        .eq('canal', 'booking')
        .maybeSingle(),
      /*
      El mapeo de tipos por canal y la última corrida de SALIDA (migración 0081).

      Van en el mismo `Promise.all` que el resto: son dos lecturas chicas y
      encadenarlas sumaría un viaje a la base por una pantalla que ya hace ocho.
    */
    supabase
      .from('canal_tipos')
      .select('tipo_unidad_id, codigo_canal, tope_cupo, minimo_noches, cerrado')
      .eq('canal', 'booking')
      .eq('activo', true),
    supabase
      .from('canal_sincronizaciones')
      .select('proveedor, leidas, actualizadas, rechazadas, detalle, corrida_en')
      .eq('sentido', 'salida')
      .order('corrida_en', { ascending: false })
      .limit(1)
      .maybeSingle(),
    /*
      Las restricciones por fecha (0087).

      Se traen sólo las que **todavía rigen o van a regir**: una que terminó no
      cambia nada de lo que se publica, y dejarlas acumular convierte la lista en
      algo ilegible justo cuando hay que revisarla rápido. El corte es por el fin
      del rango, y `hoyISO()` resuelve en la zona del hotel.
    */
    supabase
      .from('canal_restricciones')
      .select('id, tipo_unidad_id, periodo, minimo_noches, cerrado, cerrado_llegada, cerrado_salida, nota')
      .eq('canal', 'booking')
      .overlaps('periodo', `[${hoyISO()},9999-12-31)`)
      .order('periodo'),
  ])
  registrarFalla(eEntrantes, 'canales:entrantes')
  registrarFalla(eSincro, 'canales:sincronizaciones')
  registrarFalla(eMensajes, 'canales:mensajes')
  registrarFalla(eResenas, 'canales:resenas')
  registrarFalla(eCargos, 'canales:cargos')
  registrarFalla(eTipos, 'canales:tipos_unidad')
  registrarFalla(eUnidades, 'canales:unidades')
  registrarFalla(eConfig, 'canales:config')
  registrarFalla(eMapeos, 'canales:mapeo_tipos')
  registrarFalla(eSalida, 'canales:sincronizacion_salida')
  registrarFalla(eRestricciones, 'canales:restricciones')
  // `entrantesData` trae `conflicto`, la base del KPI de posible overbooking de
  // esta misma pantalla (`conConflicto`, más abajo): si esa lectura falla, ese
  // KPI daría cero conflictos con datos vacíos, el fallo silencioso más caro
  // que puede pasar acá.
  const fallaConflictos = Boolean(eEntrantes)
  const fallaLectura = Boolean(
    eEntrantes || eSincro || eMensajes || eResenas || eCargos || eTipos || eUnidades || eConfig ||
      eMapeos || eSalida,
  )

  const entrantes = (entrantesData ?? []) as unknown as EntranteRow[]

  /*
    El saldo de cada reserva importada, para la vista de cobros.

    Tres consultas y no una por fila: con 200 entrantes, un `saldo` calculado dentro
    del map serían 400 viajes a la base. Se traen los pagos y los consumos de todas
    las reservas de una vez —acotados por `in(ids)`, así que el volumen está atado al
    límite de 200 de arriba— y el cálculo se hace en memoria con el mismo dominio que
    usa el mostrador.

    ⚠️ La cuenta es alojamiento MÁS consumos. Compararla contra `reservas.total`
    dejaría «al día» a quien consumió del frigobar y no lo pagó, que es el bug que la
    Fase 20 ya arregló en el mostrador.
  */
  const idsReservas = entrantes.map((e) => e.reserva_id).filter((x): x is string => Boolean(x))

  const [
    { data: pagosData, error: ePagos },
    { data: consumosData, error: eConsumosCobro },
    { data: totalesData, error: eTotales },
  ] = idsReservas.length > 0
    ? await Promise.all([
        supabase.from('pagos').select('reserva_id, tipo, monto, estado').in('reserva_id', idsReservas),
        supabase
          .from('consumos')
          .select('reserva_id, cantidad, precio_unitario')
          .in('reserva_id', idsReservas),
        supabase.from('reservas').select('id, total').in('id', idsReservas),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  registrarFalla(ePagos, 'canales:cobro_pagos')
  registrarFalla(eConsumosCobro, 'canales:cobro_consumos')
  registrarFalla(eTotales, 'canales:cobro_totales')
  const fallaSaldos = Boolean(ePagos || eConsumosCobro || eTotales)

  const totalPorReserva = new Map<string, number>()
  for (const r of (totalesData ?? []) as { id: string; total: number | string }[]) {
    totalPorReserva.set(r.id, Number(r.total))
  }

  const pagosPorReserva = new Map<string, Pago[]>()
  for (const p of (pagosData ?? []) as (Pago & { reserva_id: string })[]) {
    const lista = pagosPorReserva.get(p.reserva_id) ?? []
    lista.push(p)
    pagosPorReserva.set(p.reserva_id, lista)
  }

  const consumosPorReserva = new Map<string, Consumo[]>()
  for (const c of (consumosData ?? []) as {
    reserva_id: string
    cantidad: number
    precio_unitario: number | string
  }[]) {
    const lista = consumosPorReserva.get(c.reserva_id) ?? []
    lista.push({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) })
    consumosPorReserva.set(c.reserva_id, lista)
  }

  /** Filas de cobro: la entrante más su situación y su saldo. */
  const cobros = entrantes.map((e) => {
    const rid = e.reserva_id
    const cuenta = cuentaConsolidada(
      rid ? (totalPorReserva.get(rid) ?? 0) : 0,
      rid ? (consumosPorReserva.get(rid) ?? []) : [],
    )
    const resumen = resumenPagos(cuenta.total, rid ? (pagosPorReserva.get(rid) ?? []) : [])

    const entrada = {
      modalidad: (e.modalidad_cobro ?? 'desconocida') as ModalidadCobro,
      checkOut: e.check_out,
      saldo: resumen.saldo,
      importada: Boolean(rid),
    }

    return { entrante: e, ...entrada, situacion: clasificarCobro(entrada, hoyISO()) }
  })

  const conteoCobros = contarCobros(cobros, hoyISO())
  const sincronizaciones = (sincroData ?? []) as SincroRow[]
  const mensajes = (mensajesData ?? []) as unknown as MensajeRow[]
  const resenas = (resenasData ?? []) as unknown as ResenaRow[]
  const cargos = (cargosData ?? []) as unknown as CargoRow[]

  /*
    La conciliación del mes: lo devengado desde el informe contra lo que facturó el
    canal. Si difieren, el canal cobra distinto de lo que informó, y eso es
    exactamente lo que hay que ver antes de pagar la factura.

    Se agrupa en memoria y no con la vista `conciliacion_comision_canal` porque acá
    ya están las filas cargadas para la tabla: una consulta más sería un viaje de
    ida y vuelta para recalcular lo mismo. La vista existe para los reportes (B9),
    donde el volumen sí lo justifica.
  */
  const comisiones = cargos.filter((c) => c.concepto === 'comision')
  const devengado = comisiones
    .filter((c) => c.origen === 'informe_reservas')
    .reduce((a, c) => a + Number(c.monto), 0)
  const facturado = comisiones
    .filter((c) => c.origen === 'factura_comision')
    .reduce((a, c) => a + Number(c.monto), 0)
  const conciliacion = conciliarDevengoContraFactura(devengado, facturado)

  // Entrantes que informaron comisión, para poder decir cuántas NO lo hicieron. Un
  // neto calculado sobre datos incompletos no se presenta como definitivo.
  const sinComision = entrantes.filter(
    (e) => e.operacion !== 'cancelada' && (e.comision === null || Number(e.comision) <= 0),
  ).length

  // Los contadores se cuentan sobre todo, no sobre lo filtrado: son la razón para
  // aplicar el filtro, así que no pueden depender de él.
  const { data: todosEstados, error: eTodosEstados } = await supabase
    .from('canal_reservas')
    .select('estado')
  registrarFalla(eTodosEstados, 'canales:conteo_estados')
  const conteo = new Map<string, number>()
  for (const r of (todosEstados ?? []) as { estado: string }[]) {
    conteo.set(r.estado, (conteo.get(r.estado) ?? 0) + 1)
  }

  // Cuantas entrantes vigentes chocan con lo ya vendido. Es lo mas caro que le puede
  // pasar al hotel, asi que va como KPI y no escondido en una fila de la tabla.
  const conConflicto = entrantes.filter((e) => e.conflicto && e.estado !== 'ignorada').length

  const ultima = sincronizaciones[0]

  /*
    El feed iCal de SALIDA (ADR 0022): las URLs listas para pegar en el extranet.

    Se arman acá y no en el cliente porque el token sale de `canal_config`, que ni
    recepción puede leer (migración 0049). Y se muestran armadas —no «pedile la URL a
    alguien»— porque copiarlas y pegarlas en Booking es la única acción que el hotel
    tiene que hacer para que esto sirva.
  */
  const configIcal = configData as {
    canal: string
    ical_token: string
    ical_leido_en: string | null
  } | null

  const tiposUnidad = (tiposData ?? []) as { id: string; codigo: string; nombre: string }[]

  /*
    El mapeo, indexado por tipo para que la tabla no busque en un arreglo por cada
    fila. Un tipo sin fila mapeada muestra su propio código como valor por
    omisión: es lo más probable y ahorra escribirlo.
  */
  const mapeoPorTipo = new Map(
    ((mapeosData ?? []) as {
      tipo_unidad_id: string
      codigo_canal: string
      tope_cupo: number | null
      minimo_noches: number | null
      cerrado: boolean
    }[]).map((m) => [m.tipo_unidad_id, m]),
  )

  const restricciones = ((restriccionesData ?? []) as {
    id: string
    tipo_unidad_id: string | null
    periodo: string
    minimo_noches: number | null
    cerrado: boolean
    cerrado_llegada: boolean
    cerrado_salida: boolean
    nota: string
  }[]).map((r) => ({ ...r, rango: parsearPeriodo(r.periodo) }))

  const ultimaSalida = salidaData as {
    proveedor: string
    leidas: number
    actualizadas: number
    rechazadas: number
    detalle: string
    corrida_en: string
  } | null
  const unidadesFeed = (unidadesData ?? []) as {
    id: string
    nombre: string
    tipo_unidad_id: string
  }[]

  const feeds = configIcal
    ? tiposUnidad.map((t) => {
        const propias = unidadesFeed.filter((u) => u.tipo_unidad_id === t.id)
        const base = `${urlDelSitio()}/api/canales/ical/${configIcal.ical_token}`
        return {
          codigo: t.codigo,
          nombre: t.nombre,
          cuantas: propias.length,
          url: `${base}?tipo=${encodeURIComponent(t.codigo)}`,
          unidades: propias.map((u) => ({
            nombre: u.nombre,
            url: `${base}?unidad=${encodeURIComponent(u.nombre)}`,
          })),
        }
      })
    : []

  const hoy = hoyISO()
  const sinAtender = mensajes.filter((m) => !m.atendido).length
  const sinResponder = resenas.filter((r) => !r.respondida).length
  const vigentes = { vista: sp.vista, estado }

  return (
    <Pagina ancho="ancho">
      <Encabezado
        titulo="Canales de venta"
        descripcion="Reservas, mensajes y reseñas que llegan de Booking."
        icono="canales"
        acciones={
          capacidades.traeReservas ? (
            <form action={sincronizarCanal}>
              <BotonEnvio variante="secundario" cargando="Sincronizando…">
                <Icono nombre="siguiente" tam={16} />
                Sincronizar ahora
              </BotonEnvio>
            </form>
          ) : null
        }
      />

      {sp.error && (
        <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>
      )}
      {fallaConflictos && (
        <Mensaje tono="error">
          No se pudo verificar el posible overbooking de canal — el KPI de abajo no es
          confiable. Revisá las reservas entrantes a mano antes de confirmar algo.
        </Mensaje>
      )}
      {!fallaConflictos && (fallaLectura || fallaSaldos) && (
        <Mensaje tono="error">
          No se pudo cargar toda la información de canales (mensajes, reseñas, cargos,
          configuración o el saldo de cobro de las reservas importadas) — algunos datos de
          esta pantalla pueden faltar.
        </Mensaje>
      )}
      {sp.ok === 'sincro' && (
        <Mensaje tono="ok">
          Sincronización lista: {sp.nuevas ?? 0} nueva(s), {sp.actualizadas ?? 0} actualizada(s),{' '}
          {sp.rechazadas ?? 0} rechazada(s).
        </Mensaje>
      )}
      {sp.ok === 'importada' && (
        <Mensaje tono="ok">Reserva {sp.codigo} creada a partir de la del canal.</Mensaje>
      )}
      {sp.ok === 'restriccion' && (
        <Mensaje tono="ok">
          Restricción guardada. Sale en la próxima publicación al canal.
        </Mensaje>
      )}
      {sp.ok === 'restriccion_borrada' && (
        <Mensaje tono="ok">Restricción levantada: esas fechas vuelven a la venta normal.</Mensaje>
      )}
      {sp.ok === 'importada_con_aviso' && (
        <Mensaje tono="ok">
          Reserva {sp.codigo} creada. El importe del canal no coincide con la cuenta del hotel —
          el detalle quedó anotado en la fila.
        </Mensaje>
      )}
      {sp.ok === 'ignorada' && <Mensaje tono="ok">Reserva descartada.</Mensaje>}
      {sp.ok === 'reintentar' && <Mensaje tono="ok">Quedó lista para volver a importar.</Mensaje>}
      {sp.ok === 'mensaje' && <Mensaje tono="ok">Mensaje guardado.</Mensaje>}
      {sp.ok === 'resena' && <Mensaje tono="ok">Reseña guardada.</Mensaje>}
      {sp.ok === 'respuesta' && <Mensaje tono="ok">Respuesta guardada.</Mensaje>}
      {sp.ok === 'mapeo' && (
        <Mensaje tono="ok">Guardado. Se usa para importar y para publicar.</Mensaje>
      )}
      {sp.ok === 'publicado' && (
        <Mensaje tono="ok">Disponibilidad publicada. El detalle está más abajo.</Mensaje>
      )}
      {sp.ok === 'publicado_sin_efecto' && (
        <Mensaje tono="ok">
          Se calculó la disponibilidad y quedó registrada, pero no salió a ningún lado: el
          proveedor configurado no puede publicarle al canal. El motivo está más abajo.
        </Mensaje>
      )}
      {sp.ok === 'conciliar' && (
        <Mensaje tono="ok">Estado de conciliación guardado, con tu nombre y la fecha.</Mensaje>
      )}
      {sp.ok === 'factura' && (
        <Mensaje tono="ok">
          Factura registrada: quedó la deuda con el proveedor y la línea comparable contra lo
          devengado.
        </Mensaje>
      )}

      {/* ── La advertencia que no puede faltar ────────────────────────────────
          Sin esto alguien va a creer que está cubierto porque «el sistema
          sincroniza con Booking». Va con ícono Y texto, arriba de todo. */}
      {!capacidades.publicaDisponibilidad && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-lenga-50 px-4 py-3 ring-1 ring-lenga-200">
          <span className="mt-0.5 shrink-0 text-lenga-700">
            <Icono nombre="alerta" tam={18} />
          </span>
          <div className="text-sm text-lenga-900">
            <p className="font-semibold">
              Esta sincronización es de una sola dirección: no evita el overbooking.
            </p>
            <p className="mt-1 text-lenga-800">
              Traemos las reservas de Booking, pero <strong>no le informamos qué queda libre</strong>.
              Booking puede vender una unidad que el mostrador ya vendió. Para sincronizar en las
              dos direcciones hace falta un <em>channel manager</em> — es una contratación del
              hotel, no algo que se resuelva con código.
            </p>
            {/*
              El matiz que suma el feed iCal de salida (ADR 0022), sin borrar nada de
              lo anterior. Que exista un calendario publicado no cambia el hecho de
              fondo: el canal lo lee cuando quiere y nadie confirma que lo aplicó.
            */}
            <p className="mt-1 text-lenga-800">
              Lo que sí se puede hacer es{' '}
              <Link
                href={`/panel/canales${construirQuery({ vista: 'calendario' })}`}
                className="font-semibold underline"
              >
                publicarle el calendario de ocupación
              </Link>{' '}
              para que cierre fechas solo en vez de cerrarlas a mano.{' '}
              <strong>Angosta la ventana, no la cierra:</strong> el canal lo lee cada varias horas
              y nadie avisa si dejó de leerlo.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          titulo="Sin importar"
          valor={String(conteo.get('pendiente') ?? 0)}
          detalle="esperando revisión"
          icono="reservas"
          tono="alerta"
          href={`/panel/canales${construirQuery({ estado: 'pendiente' })}`}
        />
        <Kpi
          titulo="Con problema"
          valor={String(conteo.get('error') ?? 0)}
          detalle="no se pudieron importar"
          icono="alerta"
          tono="peligro"
          href={`/panel/canales${construirQuery({ estado: 'error' })}`}
        />
        {/*
          El KPI que no existía y es el más caro del módulo.

          NO evita el overbooking —eso exige publicarle disponibilidad a Booking, o sea
          un channel manager (ADR 0021)— pero lo hace visible el mismo día en que el
          informe entra, en vez de cuando alguien aprieta «Importar» o, peor, en el
          check-in con el huésped en la puerta.
        */}
        <Kpi
          titulo="Posible overbooking"
          valor={fallaConflictos ? '—' : String(conConflicto)}
          detalle={
            fallaConflictos
              ? 'no se pudo verificar'
              : conConflicto > 0
                ? 'el canal vendió de más'
                : 'el cupo cierra'
          }
          icono="alerta"
          tono={fallaConflictos || conConflicto > 0 ? 'peligro' : undefined}
        />
        <Kpi
          titulo="Mensajes sin atender"
          valor={String(sinAtender)}
          detalle="peticiones del huésped"
          icono="chat"
          href="/panel/canales?vista=mensajes"
        />
        <Kpi
          titulo="Reseñas sin responder"
          valor={String(sinResponder)}
          detalle="publicadas en el canal"
          icono="firma"
          href="/panel/canales?vista=resenas"
        />
      </div>

      {/* Estado del proveedor: qué está configurado y qué sabe hacer. */}
      <Tarjeta titulo="Estado de la sincronización">
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-stone-600">
              Proveedor: <strong className="text-stone-900">{proveedor.nombre}</strong>
              {!proveedor.esReal() && (
                <span className="ml-2 text-xs text-stone-500">
                  (simulado — no consulta ningún canal)
                </span>
              )}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-stone-600">
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.traeReservas ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.traeReservas
                  ? 'Trae reservas automáticamente'
                  : 'No trae reservas solo: hay que subir el informe CSV'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.publicaDisponibilidad ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.publicaDisponibilidad
                  ? 'Publica disponibilidad al canal'
                  : 'No publica disponibilidad (el canal puede sobrevender)'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.trae.importes ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.trae.importes
                  ? 'Informa importes y comisión'
                  : 'No informa importes: el total lo calcula el hotel'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.trae.contacto ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.trae.contacto
                  ? 'Informa email y teléfono'
                  : 'No informa contacto del huésped'}
              </li>
            </ul>
          </div>

          <div className="text-sm">
            {ultima ? (
              <>
                <p className="text-stone-600">
                  Última sincronización:{' '}
                  <strong className="text-stone-900">
                    {fechaHoraHotel(ultima.corrida_en)}
                  </strong>
                </p>
                <p className="mt-1 text-xs text-stone-600">
                  {ultima.proveedor}
                  {ultima.origen ? ` · ${ultima.origen}` : ''} — {ultima.leidas} leída(s),{' '}
                  {ultima.nuevas} nueva(s), {ultima.actualizadas} actualizada(s),{' '}
                  {ultima.rechazadas} rechazada(s)
                </p>

                {/*
                  Aviso, NO acción.

                  La tentación es sincronizar sola al abrir la pantalla, y está mal por
                  tres razones: sería un GET que muta, se dispararía N veces con tres
                  personas mirando, y sobre todo **no correría de noche** — que es
                  justamente cuando entran las reservas que nadie ve hasta el lunes.
                  Eso lo resuelve el cron; esto solo avisa que hace rato que no corre.
                */}
                {horasDesde(ultima.corrida_en) >= 12 && (
                  <div className="mt-2 flex gap-2 rounded-lg bg-calafate-50 p-2 text-xs text-stone-700">
                    <Icono nombre="alerta" tam={14} />
                    <p>
                      Hace más de {Math.floor(horasDesde(ultima.corrida_en))} horas que no se
                      sincroniza.{' '}
                      {capacidades.traeReservas
                        ? 'Si la sincronización automática está configurada, algo la está impidiendo; si no, conviene correrla a mano.'
                        : 'El proveedor configurado no sondea: hay que subir el informe del extranet.'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-stone-600">
                Todavía no se sincronizó nunca. Subí el informe del extranet abajo para empezar.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      <div className="mt-4">
        <Tarjeta
          titulo="Importar el informe del extranet"
          descripcion="El camino que no necesita aprobación de Booking ni contratar nada."
        >
          <ImportarCsv />
        </Tarjeta>
      </div>

      <div className="mt-6 mb-4 flex flex-wrap gap-1.5">
        {VISTAS.map((v) => (
          <Chip
            key={v}
            href={`/panel/canales${construirQuery({ vista: v === 'entrantes' ? undefined : v })}`}
            activo={vista === v}
          >
            {ETIQUETAS_VISTA[v]}
          </Chip>
        ))}
      </div>

      {vista === 'entrantes' && (
        <>
          <BarraHerramientas>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                href={`/panel/canales${construirQuery(vigentes, { estado: undefined })}`}
                activo={!estado}
              >
                Todas
              </Chip>
              {ESTADOS_ENTRANTE.map((e) => (
                <Chip
                  key={e}
                  href={`/panel/canales${construirQuery(vigentes, { estado: e })}`}
                  activo={estado === e}
                >
                  {ETIQUETAS_ESTADO[e]} ({conteo.get(e) ?? 0})
                </Chip>
              ))}
            </div>
          </BarraHerramientas>

          <Tarjeta className="overflow-hidden">
            {entrantes.length === 0 ? (
              <EstadoVacio
                titulo={estado ? `No hay reservas «${ETIQUETAS_ESTADO[estado]}»` : 'Todavía no llegó ninguna reserva'}
                descripcion={
                  estado
                    ? 'Probá con otro estado o quitá el filtro.'
                    : 'Subí el informe del extranet, o configurá los feeds iCal para que se sincronicen solas.'
                }
                icono="canales"
              />
            ) : (
              <div className="overflow-x-auto">
                <Tabla resumen="Reservas llegadas de canales externos, con su estado de importación">
                  <thead>
                    <tr>
                      <th className={TH}>Huésped</th>
                      <th className={TH}>Estadía</th>
                      <th className={TH}>Tipo pedido</th>
                      <th className={`${TH} text-right`}>Canal informa</th>
                      <th className={TH}>Estado</th>
                      <th className={TH}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entrantes.map((e) => {
                      const llegaHoy = e.check_in === hoy
                      const saleHoy = e.check_out === hoy
                      const enCurso = e.check_in <= hoy && e.check_out > hoy

                      return (
                        <tr key={e.id} className={FILA}>
                          <td className={TD}>
                            <span className="font-medium text-stone-800">
                              {e.huesped_apellido}
                              {e.huesped_nombre ? `, ${e.huesped_nombre}` : ''}
                            </span>
                            <span className="block text-xs text-stone-500">
                              {e.canal} · {e.external_id}
                              {e.huesped_pais ? ` · ${e.huesped_pais}` : ''}
                            </span>
                            {e.huesped_email && (
                              <span className="block text-xs text-stone-500">{e.huesped_email}</span>
                            )}
                          </td>

                          <td className={`${TD} text-stone-600`}>
                            <span className="tabular">
                              {formatoFechaCorta(e.check_in)} → {formatoFechaCorta(e.check_out)}
                            </span>
                            <span className="block text-xs text-stone-500">
                              {e.huespedes} huésped(es)
                            </span>
                            {/* Llegadas, salidas y estancias marcadas con texto,
                                no sólo con color. */}
                            {llegaHoy && (
                              <Etiqueta tono="exito">Llega hoy</Etiqueta>
                            )}
                            {saleHoy && <Etiqueta tono="alerta">Sale hoy</Etiqueta>}
                            {enCurso && !llegaHoy && <Etiqueta tono="lago">En curso</Etiqueta>}
                          </td>

                          <td className={`${TD} text-stone-600`}>
                            <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
                              {e.tipo_unidad_codigo}
                            </code>
                          </td>

                          <td className={`${TD} tabular text-right text-stone-600`}>
                            {Number(e.importe_canal ?? 0) > 0 ? (
                              <>
                                {e.moneda_canal} {importe(Number(e.importe_canal))}
                                {e.comision != null && (
                                  <span className="block text-xs text-stone-500">
                                    comisión {importe(Number(e.comision))}
                                  </span>
                                )}
                              </>
                            ) : (
                              /* No se muestra «0» como si fuera un precio: el iCal
                                 no informa importes y un cero ahí se leería como
                                 «reserva gratis». */
                              <span className="text-xs text-stone-400">no informa</span>
                            )}
                          </td>

                          <td className={TD}>
                            <Etiqueta tono={TONO_ESTADO[e.estado]}>
                              {ETIQUETAS_ESTADO[e.estado]}
                            </Etiqueta>
                            {e.operacion === 'cancelada' && (
                              <span className="mt-1 block text-xs font-medium text-red-700">
                                el canal la canceló
                              </span>
                            )}
                            {e.reserva?.codigo && (
                              <Link
                                href={`/panel/reservas/${e.reserva_id}`}
                                className="mt-1 block text-xs font-medium text-lago-700 hover:underline"
                              >
                                {e.reserva.codigo}
                              </Link>
                            )}
                            {e.motivo && (
                              <span className="mt-1 block max-w-xs text-xs text-stone-600">
                                {e.motivo}
                              </span>
                            )}
                            {/*
                              El canal cambió algo DESPUÉS de importarla (0088).

                              Va en rojo y con el detalle a la vista porque es lo
                              más caro del módulo: la reserva del hotel sigue con
                              los datos viejos y no hay ningún otro síntoma hasta
                              que el huésped se presenta. El sistema no la corrige
                              solo, así que este texto es lo único que dispara la
                              corrección.
                            */}
                            {e.divergencia_desde && e.divergencia && (
                              <span className="mt-1 block max-w-xs rounded-lg bg-red-50 px-2 py-1 text-xs text-red-800 ring-1 ring-red-200">
                                <strong>El canal cambió esta reserva.</strong> {e.divergencia}.
                                Corregila a mano en la ficha: el sistema no la mueve solo.
                              </span>
                            )}
                            {e.notas && (
                              <span className="mt-1 block max-w-xs text-xs text-stone-500 italic">
                                «{e.notas}»
                              </span>
                            )}
                          </td>

                          <td className={TD}>
                            <div className="flex flex-col gap-1.5">
                              {(e.estado === 'pendiente' || e.estado === 'error') &&
                                e.operacion !== 'cancelada' && (
                                  <form action={importarUna}>
                                    <input type="hidden" name="entrante_id" value={e.id} />
                                    <BotonEnvio cargando="Importando…" extra="w-full">
                                      Importar
                                    </BotonEnvio>
                                  </form>
                                )}

                              {e.estado === 'ignorada' && (
                                <form action={reintentarEntrante}>
                                  <input type="hidden" name="entrante_id" value={e.id} />
                                  <BotonEnvio
                                    variante="secundario"
                                    cargando="Reactivando…"
                                    extra="w-full"
                                  >
                                    Reactivar
                                  </BotonEnvio>
                                </form>
                              )}

                              {e.estado !== 'importada' && e.estado !== 'ignorada' && (
                                <form action={ignorarEntrante}>
                                  <input type="hidden" name="entrante_id" value={e.id} />
                                  <BotonEnvio
                                    variante="fantasma"
                                    cargando="Descartando…"
                                    extra="w-full"
                                    confirmar={`¿Descartar la reserva de ${e.huesped_apellido}? No se va a crear en el sistema.`}
                                  >
                                    Descartar
                                  </BotonEnvio>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Tabla>
              </div>
            )}
          </Tarjeta>
        </>
      )}

      {vista === 'cobros' && (
        <div className="grid gap-4">
          {/*
            Lo primero que se dice, porque decide qué es esta pantalla.

            Sin ser Connectivity Partner NO existe un aviso de «Booking te pagó»: no
            hay webhook ni push. Prometer una notificación que nunca llega es peor que
            no prometerla, así que esto se presenta por lo que es: una lista para
            mirar, no una alerta que aparece sola.
          */}
          <div className="flex gap-2 rounded-lg bg-lago-50 p-3 text-sm text-stone-700">
            <Icono nombre="ayuda" className="mt-0.5 size-4 shrink-0 text-lago-700" />
            <p>
              <strong>Esto no avisa solo: es una lista para revisar.</strong> Booking no manda
              notificaciones de pago sin la API de partner, así que el sistema compara lo que el
              canal informó contra lo que hay cobrado y muestra lo que no cierra. Conviene mirarla
              una vez por día.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi
              titulo="Falta la transferencia"
              valor={String(conteoCobros.faltaTransferencia)}
              detalle="cobró el canal y no llegó"
              icono="divisas"
              tono={conteoCobros.faltaTransferencia > 0 ? 'alerta' : undefined}
            />
            <Kpi
              titulo="Salió sin cobrar"
              valor={String(conteoCobros.salioSinCobrar)}
              detalle="ya se fue y quedó saldo"
              icono="alerta"
              tono={conteoCobros.salioSinCobrar > 0 ? 'peligro' : undefined}
            />
            <Kpi
              titulo="No sabemos quién cobra"
              valor={String(conteoCobros.sinDeterminar)}
              detalle="el informe no lo dijo"
              icono="ayuda"
              tono={conteoCobros.sinDeterminar > 0 ? 'alerta' : undefined}
            />
            <Kpi
              titulo="En riesgo"
              valor={formatearUSD(conteoCobros.enRiesgo)}
              detalle="suma de las tres de al lado"
              icono="reportes"
            />
          </div>

          {conteoCobros.sinDeterminar > 0 && (
            <Tarjeta
              titulo="Fijar quién cobra, de una vez"
              descripcion="Cuando el informe del extranet no trae la columna de forma de pago, todo queda sin determinar."
            >
              <p className="mb-3 text-sm text-stone-600">
                Hay <strong>{conteoCobros.sinDeterminar}</strong>{' '}
                {conteoCobros.sinDeterminar === 1 ? 'reserva' : 'reservas'} sin determinar. Si en
                esta temporada el hotel tiene una sola modalidad activa, se puede fijar de una vez y
                después corregir las excepciones una por una.
              </p>
              <form action={fijarModalidadCobro} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="todas" value="1" />
                <Campo etiqueta="En todas las que no sabemos, cobra">
                  <select name="modalidad" defaultValue="hotel" className={CAMPO}>
                    {MODALIDADES_COBRO.filter((m) => m !== 'desconocida').map((m) => (
                      <option key={m} value={m}>
                        {ETIQUETAS_MODALIDAD[m]}
                      </option>
                    ))}
                  </select>
                </Campo>
                <BotonEnvio
                  variante="secundario"
                  cargando="Guardando…"
                  confirmar={`Se va a fijar la forma de cobro en las ${conteoCobros.sinDeterminar} reservas sin determinar. Las que ya tienen una forma asignada no se tocan. ¿Seguir?`}
                  extra="w-full sm:w-auto"
                >
                  Fijar en todas
                </BotonEnvio>
              </form>
            </Tarjeta>
          )}

          <Tarjeta
            titulo="Lo que hay que resolver"
            descripcion="Reservas del canal cuyo cobro no cierra. Las que están al día y las que todavía no llegaron no aparecen."
          >
            {(() => {
              // Solo las tres situaciones que piden acción, ordenadas por urgencia:
              // primero las que ya se fueron, que es plata que se va caminando.
              const orden: Record<SituacionCobro, number> = {
                salio_sin_cobrar: 0,
                falta_transferencia: 1,
                sin_determinar: 2,
                al_dia: 3,
                pendiente_de_estadia: 4,
              }
              const pendientes = cobros
                .filter((c) => orden[c.situacion] <= 2)
                .sort((a, b) => orden[a.situacion] - orden[b.situacion] || a.checkOut.localeCompare(b.checkOut))

              if (pendientes.length === 0) {
                return (
                  <EstadoVacio
                    titulo="Todo el cobro del canal cierra"
                    descripcion="No hay reservas con saldo sin explicación. Cuando entre un informe nuevo, lo que no cierre aparece acá."
                    icono="ok"
                  />
                )
              }

              return (
                <Tabla resumen="Reservas del canal con el cobro sin cerrar: huésped, estadía, quién cobra, situación y saldo.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Huésped</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Estadía</th>
                      <th className={TH}>Quién cobra</th>
                      <th className={TH}>Situación</th>
                      <th className={TH}>Saldo</th>
                      <th className={TH}>Qué hacer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendientes.map((c) => (
                      <tr key={c.entrante.id} className={FILA}>
                        <td className={TD}>
                          <span className="font-medium text-stone-800">
                            {c.entrante.huesped_apellido}
                          </span>
                          <span className="block font-mono text-xs text-stone-500">
                            {c.entrante.reserva?.codigo ?? c.entrante.external_id}
                          </span>
                          {/* En móvil la estadía no tiene columna: se pliega acá. */}
                          <span className="block text-xs text-stone-500 sm:hidden">
                            {formatoFechaCorta(c.entrante.check_in)} →{' '}
                            {formatoFechaCorta(c.entrante.check_out)}
                          </span>
                        </td>
                        <td className={`${TD} ${COL_SECUNDARIA}`}>
                          {formatoFechaCorta(c.entrante.check_in)} →{' '}
                          {formatoFechaCorta(c.entrante.check_out)}
                        </td>
                        <td className={TD}>
                          {/* Cambiar la modalidad de una sola fila, sin salir de acá. */}
                          <form action={fijarModalidadCobro} className="flex items-center gap-1">
                            <input type="hidden" name="entrante_id" value={c.entrante.id} />
                            <select
                              name="modalidad"
                              defaultValue={c.modalidad}
                              aria-label={`Quién cobra la reserva de ${c.entrante.huesped_apellido}`}
                              className="rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                            >
                              {MODALIDADES_COBRO.map((m) => (
                                <option key={m} value={m}>
                                  {ETIQUETAS_MODALIDAD[m]}
                                </option>
                              ))}
                            </select>
                            <BotonEnvio
                              variante="fantasma"
                              cargando="…"
                              extra="px-2 py-1 text-xs"
                            >
                              Guardar
                            </BotonEnvio>
                          </form>
                        </td>
                        <td className={TD}>
                          {/* Color + texto, nunca solo color. */}
                          <Etiqueta
                            tono={c.situacion === 'salio_sin_cobrar' ? 'peligro' : 'alerta'}
                          >
                            {ETIQUETAS_SITUACION[c.situacion]}
                          </Etiqueta>
                        </td>
                        <td className={TD}>{importe(c.saldo)}</td>
                        <td className={TD}>
                          {c.situacion === 'falta_transferencia' ? (
                            <form action={registrarTransferenciaCanal} className="flex flex-wrap items-end gap-1">
                              <input type="hidden" name="entrante_id" value={c.entrante.id} />
                              <input
                                name="referencia"
                                required
                                maxLength={60}
                                placeholder="N.º liquidación"
                                aria-label={`Referencia de la liquidación de ${c.entrante.huesped_apellido}`}
                                className="w-32 rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                              />
                              <input
                                name="monto"
                                type="number"
                                step="0.01"
                                min="0.01"
                                required
                                defaultValue={c.saldo.toFixed(2)}
                                aria-label={`Importe transferido de ${c.entrante.huesped_apellido}`}
                                className="w-24 rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                              />
                              <BotonEnvio cargando="…" extra="px-2 py-1 text-xs">
                                Llegó
                              </BotonEnvio>
                            </form>
                          ) : c.situacion === 'salio_sin_cobrar' ? (
                            <Link
                              href={`/panel/reservas/${c.entrante.reserva_id}`}
                              className="text-sm font-medium text-lago-700 underline"
                            >
                              Cobrar en la ficha
                            </Link>
                          ) : (
                            <span className="text-xs text-stone-500">
                              Decidí quién cobra, a la izquierda
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              )
            })()}
          </Tarjeta>
        </div>
      )}

      {vista === 'costos' && (
        <div className="grid gap-4">
          <Tarjeta
            titulo="Conciliación de la comisión"
            descripcion="Lo que el canal informó por reserva, contra lo que después facturó."
          >
            {/*
              La advertencia que evita el error más caro de esta pantalla. `tarifa_tipo
              = 'neto'` es un TIPO DE TARIFA (la de agencia, contra la rack de
              mostrador) y no «importe al que ya se le descontó la comisión». Sin
              decirlo acá, alguien resta la comisión de un total que creía ya neto y el
              número queda mal sin que nadie lo note.
            */}
            <div className="mb-4 flex gap-2 rounded-lg bg-lago-50 p-3 text-sm text-stone-700">
              <Icono nombre="ayuda" className="mt-0.5 size-4 shrink-0 text-lago-700" />
              <p>
                <strong>Neto de comisión = total − comisión.</strong> El total de la reserva es lo
                que paga el huésped; la comisión es un gasto del hotel. Que la reserva vaya a tarifa{' '}
                <em>neto</em> significa que se cobró a precio de agencia, <strong>no</strong> que ya
                tenga la comisión descontada.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Kpi
                titulo="Devengado"
                valor={formatearUSD(conciliacion.devengado)}
                detalle="según el informe de reservas"
                icono="reportes"
              />
              <Kpi
                titulo="Facturado por el canal"
                valor={
                  facturado > 0 ? formatearUSD(conciliacion.facturado) : '—'
                }
                detalle={
                  facturado > 0
                    ? 'según la factura de comisión'
                    : 'todavía no se cargó ninguna factura'
                }
                icono="divisas"
              />
              <Kpi
                titulo="Diferencia"
                valor={
                  facturado > 0 ? formatearUSD(Math.abs(conciliacion.diferencia)) : '—'
                }
                detalle={
                  facturado === 0
                    ? 'hace falta la factura para comparar'
                    : conciliacion.cierra
                      ? 'cierra'
                      : 'revisar antes de pagar'
                }
                icono={conciliacion.cierra || facturado === 0 ? 'ok' : 'alerta'}
                tono={facturado > 0 && !conciliacion.cierra ? 'peligro' : undefined}
              />
            </div>

            {facturado > 0 && !conciliacion.cierra && (
              <div className="mt-4">
                <Mensaje tono="error">{conciliacion.detalle}</Mensaje>
              </div>
            )}

            {sinComision > 0 && (
              /*
                No se presenta el devengado como definitivo si hay reservas sin
                comisión informada: el feed iCal nunca la trae, así que este caso es
                normal y hay que decirlo. Contarlas aparte es la diferencia entre «el
                devengado es esto» y «es al menos esto».
              */
              <div className="mt-4 flex gap-2 rounded-lg bg-calafate-50 p-3 text-sm text-stone-700">
                <Icono nombre="alerta" className="mt-0.5 size-4 shrink-0 text-calafate-700" />
                <p>
                  Hay <strong>{sinComision}</strong>{' '}
                  {sinComision === 1 ? 'reserva entrante' : 'reservas entrantes'} sin comisión
                  informada, así que el devengado es <strong>al menos</strong> ese importe y no el
                  total. El feed iCal no informa comisión: para tenerla hay que subir el informe de
                  reservas del extranet.
                </p>
              </div>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Cargar la factura de comisión"
            descripcion="La que Booking emite por mes, desde Finanzas → Facturas del extranet."
          >
            <form action={registrarFacturaComision} className="grid gap-3 sm:grid-cols-6">
              <Campo etiqueta="N.º de comprobante">
                <input
                                    name="comprobante"
                  required
                  maxLength={60}
                  className={CAMPO}
                  placeholder="1234567890"
                />
              </Campo>
              <Campo etiqueta="Mes que factura">
                <input id="periodo" name="periodo" type="month" required className={CAMPO} />
              </Campo>
              {/* Booking no factura en dólares: emite en euros o en pesos según el
                  contrato. Sin este campo el importe entraba como USD al libro
                  mayor (auditoría 2026-09, P1-3). */}
              <Campo etiqueta="Moneda" ayuda="La de la factura del canal.">
                <select name="moneda" defaultValue="USD" className={CAMPO}>
                  <option value="USD">USD</option>
                  {MONEDAS_EXTRANJERAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Importe">
                <input
                                    name="monto"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className={CAMPO}
                />
              </Campo>
              <Campo etiqueta="Vence el">
                <input id="vencimiento" name="vencimiento" type="date" className={CAMPO} />
              </Campo>
              <div className="flex items-end">
                <BotonEnvio cargando="Registrando…" extra="w-full sm:w-auto">
                  Registrar
                </BotonEnvio>
              </div>
            </form>
            <p className="mt-3 text-xs text-stone-500">
              Registrar la factura crea la deuda con el proveedor —con su vencimiento y su
              antigüedad de saldos, en el módulo Proveedores— y la línea que se compara contra lo
              devengado. <strong>No marca nada como conciliado</strong>: decidir si una diferencia
              es aceptable es una decisión, no un efecto de cargar un número.
            </p>
          </Tarjeta>

          <Tarjeta
            titulo="Cargos del canal"
            descripcion="Cada costo imputado a la venta que lo generó."
          >
            {cargos.length === 0 ? (
              <EstadoVacio
                titulo="Todavía no hay cargos"
                descripcion="Los cargos se devengan al subir el informe de reservas del extranet: de ahí sale la comisión de cada reserva."
                icono="reportes"
              />
            ) : (
              <Tabla resumen="Cargos del canal: concepto, reserva, origen del dato, fecha de imputación, importe y estado de conciliación.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Concepto</th>
                      <th className={TH}>Reserva</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Origen</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Imputado</th>
                      <th className={TH}>Importe</th>
                      <th className={TH}>Estado</th>
                      {puedeConciliarCargos && <th className={TH}>Cerrar la revisión</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cargos.map((c) => (
                      <tr key={c.id} className={FILA}>
                        <td className={TD}>
                          <span className="font-medium text-stone-800">
                            {ETIQUETAS_CONCEPTO[c.concepto as ConceptoCargo] ?? c.concepto}
                          </span>
                          {/* En móvil el origen no tiene columna: se pliega acá. */}
                          <span className="block text-xs text-stone-500 sm:hidden">
                            {ETIQUETAS_ORIGEN[c.origen as OrigenCargo] ?? c.origen}
                          </span>
                        </td>
                        <td className={TD}>
                          {c.reserva?.codigo ? (
                            <span className="font-mono text-xs">{c.reserva.codigo}</span>
                          ) : c.entrante ? (
                            <span className="text-stone-700">
                              {c.entrante.huesped_apellido}
                              <span className="block font-mono text-xs text-stone-500">
                                {c.entrante.external_id}
                              </span>
                            </span>
                          ) : (
                            /*
                              El caso que justifica que `canal_reserva_id` sea nullable:
                              una línea de factura que no se atribuye a ninguna reserva
                              significa que el canal cobró algo que no reconocemos. Se
                              dice, no se esconde.
                            */
                            <span className="text-calafate-700">
                              Sin reserva atribuida
                              <span className="block text-xs text-stone-500">
                                el canal cobró algo que no reconocemos
                              </span>
                            </span>
                          )}
                        </td>
                        <td className={`${TD} ${COL_SECUNDARIA}`}>
                          {ETIQUETAS_ORIGEN[c.origen as OrigenCargo] ?? c.origen}
                        </td>
                        <td className={`${TD} ${COL_SECUNDARIA}`}>
                          {c.imputado_el ? formatoFechaCorta(c.imputado_el) : '—'}
                        </td>
                        <td className={TD}>
                          {importe(Number(c.monto))}
                          {c.moneda !== 'USD' && (
                            <span className="block text-xs text-stone-500">{c.moneda}</span>
                          )}
                        </td>
                        <td className={TD}>
                          {/* Color + texto: nunca solo color (accesibilidad). */}
                          <Etiqueta
                            tono={
                              c.estado_conciliacion === 'en_disputa'
                                ? 'peligro'
                                : c.estado_conciliacion === 'conciliado'
                                  ? 'exito'
                                  : 'neutro'
                            }
                          >
                            {ETIQUETAS_CONCILIACION[c.estado_conciliacion as EstadoConciliacion] ??
                              c.estado_conciliacion}
                          </Etiqueta>
                          {c.nota_conciliacion && (
                            <span className="mt-1 block text-xs text-stone-500">
                              {c.nota_conciliacion}
                            </span>
                          )}
                        </td>
                        {/*
                          Cerrar la revisión (P1-4).

                          Hasta la migración 0079 la columna de al lado decía
                          «Devengado» en todas las filas para siempre: el estado
                          existía y nada lo escribía, así que cada mes había que
                          revisar de nuevo lo ya revisado.

                          Solo lo ve gerencia: aceptar una diferencia es aceptar un
                          costo y disputarla es abrir un reclamo.
                        */}
                        {puedeConciliarCargos && (
                          <td className={TD}>
                            <form
                              action={conciliarCargo}
                              className="flex flex-wrap items-end gap-1.5"
                            >
                              <input type="hidden" name="cargo_id" value={c.id} />
                              <label className="flex flex-col gap-1 text-xs">
                                <span className="text-stone-500">Estado</span>
                                <select
                                  name="estado"
                                  defaultValue={
                                    c.estado_conciliacion === 'devengado'
                                      ? 'conciliado'
                                      : 'devengado'
                                  }
                                  className={CAMPO}
                                >
                                  {ESTADOS_CONCILIACION.filter(
                                    (e) => e !== c.estado_conciliacion,
                                  ).map((e) => (
                                    <option key={e} value={e}>
                                      {ETIQUETAS_CONCILIACION[e]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-xs">
                                <span className="text-stone-500">Motivo</span>
                                <input
                                  name="nota"
                                  maxLength={500}
                                  placeholder="Motivo (si disputás)"
                                  className={`${CAMPO} w-44`}
                                />
                              </label>
                              <BotonEnvio variante="secundario" cargando="Guardando…">
                                Guardar
                              </BotonEnvio>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
            )}
          </Tarjeta>
        </div>
      )}

      {vista === 'mensajes' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Tarjeta
            titulo="Peticiones del huésped"
            descripcion="Un pedido sin atender termina siendo una queja en la reseña."
            className="lg:col-span-2"
          >
            {mensajes.length === 0 ? (
              <EstadoVacio
                titulo="No hay mensajes cargados"
                descripcion="Ni el informe CSV ni el feed iCal traen los mensajes de Booking: se cargan a mano acá al lado."
                icono="chat"
              />
            ) : (
              <ul className="divide-y divide-stone-100">
                {mensajes.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className={`text-sm ${m.atendido ? 'text-stone-500' : 'text-stone-800'}`}>
                        {m.cuerpo}
                      </p>
                      <p className="mt-1 text-xs text-stone-500">
                        {m.entrante
                          ? `${m.entrante.huesped_apellido} · llega ${formatoFechaCorta(m.entrante.check_in)} · `
                          : ''}
                        {fechaHotel(m.recibido_en)}
                      </p>
                      {m.atendido && (
                        <Etiqueta tono="exito">Atendido</Etiqueta>
                      )}
                    </div>
                    <form action={marcarMensajeAtendido} className="shrink-0">
                      <input type="hidden" name="mensaje_id" value={m.id} />
                      <input type="hidden" name="atendido" value={String(m.atendido)} />
                      <BotonEnvio variante={m.atendido ? 'fantasma' : 'secundario'} cargando="…">
                        {m.atendido ? 'Reabrir' : 'Marcar atendido'}
                      </BotonEnvio>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo="Cargar un mensaje">
            <form action={cargarMensaje} className="flex flex-col gap-3 p-5">
              {/*
                El autor era fijo en «huésped», así que el módulo guardaba media
                conversación: no había forma de registrar qué se le contestó. El `check`
                de la base ya permitía «hotel» desde el principio; solo faltaba
                ofrecerlo.
              */}
              <Campo etiqueta="Quién lo escribió">
                <select name="autor" defaultValue="huesped" className={CAMPO}>
                  <option value="huesped">El huésped (un pedido)</option>
                  <option value="hotel">El hotel (la respuesta)</option>
                </select>
              </Campo>
              <Campo
                etiqueta="Qué dice"
                ayuda="Cuna, llegada tardía, habitación en planta baja… o la respuesta que se le dio."
              >
                <textarea name="cuerpo" rows={4} required className={CAMPO} />
              </Campo>
              <Campo etiqueta="Reserva del canal (opcional)">
                <select name="entrante_id" defaultValue="" className={CAMPO}>
                  <option value="">Sin asociar</option>
                  {entrantes.slice(0, 50).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.huesped_apellido} — {formatoFechaCorta(e.check_in)}
                    </option>
                  ))}
                </select>
              </Campo>
              <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
                Guardar petición
              </BotonEnvio>
            </form>
          </Tarjeta>
        </div>
      )}

      {vista === 'resenas' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Tarjeta
            titulo="Reseñas publicadas"
            descripcion="Las de Booking. El NPS propio se mide aparte, en las encuestas."
            className="lg:col-span-2"
          >
            {resenas.length === 0 ? (
              <EstadoVacio
                titulo="No hay reseñas cargadas"
                descripcion="Subí el export de reseñas del extranet acá al lado, o cargá una a mano. La API de reseñas de Booking es de partner, así que el archivo es el único camino."
                icono="firma"
              />
            ) : (
              <ul className="divide-y divide-stone-100">
                {resenas.map((r) => (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-800">
                          {r.autor}
                          {r.puntaje != null && (
                            <span
                              className={`ml-2 rounded px-1.5 py-0.5 text-xs font-semibold ${
                                Number(r.puntaje) >= 8
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : Number(r.puntaje) >= 6
                                    ? 'bg-lenga-100 text-lenga-900'
                                    : 'bg-red-100 text-red-900'
                              }`}
                            >
                              {Number(r.puntaje).toFixed(1)} / 10
                            </span>
                          )}
                        </p>
                        {r.publicada_en && (
                          <p className="text-xs text-stone-500">
                            {formatoFechaCorta(r.publicada_en)}
                          </p>
                        )}
                      </div>
                      {r.respondida && <Etiqueta tono="exito">Respondida</Etiqueta>}
                    </div>

                    {r.positivo && (
                      <p className="mt-2 text-sm text-stone-700">
                        <span className="font-medium text-emerald-700">Le gustó:</span> {r.positivo}
                      </p>
                    )}
                    {r.negativo && (
                      <p className="mt-1 text-sm text-stone-700">
                        <span className="font-medium text-red-700">No le gustó:</span> {r.negativo}
                      </p>
                    )}

                    {r.respondida ? (
                      <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                        <span className="font-medium">Respuesta del hotel:</span> {r.respuesta}
                      </p>
                    ) : (
                      <form action={responderResena} className="mt-2 flex flex-col gap-2">
                        <input type="hidden" name="resena_id" value={r.id} />
                        <Campo etiqueta="Respuesta del hotel">
                          <textarea name="respuesta" rows={2} required className={CAMPO} />
                        </Campo>
                        <BotonEnvio
                          variante="secundario"
                          cargando="Guardando…"
                          extra="w-full sm:w-auto"
                        >
                          Guardar respuesta
                        </BotonEnvio>
                      </form>
                    )}

                    {/*
                      El vínculo con la reserva.

                      Una reseña ligada sirve para bastante más que leerla: dice qué
                      unidad la produjo, se cruza con el NPS propio y muestra si el
                      huésped que se queja ya se había quejado.

                      Cuando el emparejamiento fue ambiguo NO se adivinó, y acá se dice
                      por qué: una reseña mal ligada ensucia el historial de alguien que
                      no dijo eso, y eso es peor que una sin ligar.
                    */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
                      {r.reserva ? (
                        <>
                          <Etiqueta tono="exito">
                            {r.vinculo === 'manual' ? 'Ligada a mano' : 'Ligada'}
                          </Etiqueta>
                          <Link
                            href={`/panel/reservas/${r.reserva.id}`}
                            className="font-mono text-xs text-lago-700 underline"
                          >
                            {r.reserva.codigo}
                          </Link>
                          <form action={vincularResena}>
                            <input type="hidden" name="resena_id" value={r.id} />
                            <input type="hidden" name="reserva_id" value="" />
                            <BotonEnvio variante="fantasma" cargando="…" extra="px-2 py-1 text-xs">
                              Desligar
                            </BotonEnvio>
                          </form>
                        </>
                      ) : (
                        <>
                          <Etiqueta tono="alerta">Sin ligar</Etiqueta>
                          {r.motivo_sin_vinculo && (
                            <span className="text-xs text-stone-600">{r.motivo_sin_vinculo}</span>
                          )}
                          <form action={vincularResena} className="flex items-center gap-1">
                            <input type="hidden" name="resena_id" value={r.id} />
                            <select
                              name="reserva_id"
                              defaultValue=""
                              aria-label={`Reserva a la que corresponde la reseña de ${r.autor}`}
                              className="rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
                            >
                              <option value="">— Elegí la reserva —</option>
                              {entrantes
                                .filter((e) => e.reserva_id && e.reserva?.codigo)
                                .map((e) => (
                                  <option key={e.id} value={e.reserva_id!}>
                                    {e.huesped_apellido} · {e.reserva!.codigo} ·{' '}
                                    {formatoFechaCorta(e.check_out)}
                                  </option>
                                ))}
                            </select>
                            <BotonEnvio variante="fantasma" cargando="…" extra="px-2 py-1 text-xs">
                              Ligar
                            </BotonEnvio>
                          </form>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <div className="grid gap-4">
            <Tarjeta
              titulo="Importar el export de reseñas"
              descripcion="Desde la sección Reseñas del extranet."
            >
              <ImportarResenas />
            </Tarjeta>

            <Tarjeta titulo="Cargar una reseña a mano">
            <form action={cargarResena} className="flex flex-col gap-3 p-5">
              <Campo etiqueta="Autor">
                <input name="autor" className={CAMPO} placeholder="Nombre o «Anónimo»" />
              </Campo>
              <Campo etiqueta="Puntaje" ayuda="Escala de Booking: 0 a 10, con un decimal.">
                <input
                  name="puntaje"
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  required
                  className={CAMPO}
                />
              </Campo>
              <Campo etiqueta="Le gustó">
                <textarea name="positivo" rows={2} className={CAMPO} />
              </Campo>
              <Campo etiqueta="No le gustó">
                <textarea name="negativo" rows={2} className={CAMPO} />
              </Campo>
              <Campo etiqueta="Fecha de publicación">
                <input name="publicada_en" type="date" className={CAMPO} />
              </Campo>
              <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
                Guardar reseña
              </BotonEnvio>
            </form>
            </Tarjeta>
          </div>
        </div>
      )}

      {vista === 'publicacion' && (
        <div className="space-y-4">
          {/*
            La advertencia va PRIMERO y no al final.

            Alguien que entra a una pantalla titulada «Publicación al canal»
            asume, con toda razón, que el sistema le está informando a Booking qué
            queda libre. Hoy no lo hace: los dos caminos disponibles sin ser
            Connectivity Partner son de solo lectura. Que eso se lea después de la
            tabla sería dejar que se forme la conclusión equivocada primero.
          */}
          {!capacidades.publicaDisponibilidad && (
            <div className="flex items-start gap-3 rounded-xl bg-lenga-50 px-4 py-3 ring-1 ring-lenga-200">
              <span className="mt-0.5 shrink-0 text-lenga-700">
                <Icono nombre="alerta" tam={18} />
              </span>
              <div className="text-sm text-lenga-900">
                <p className="font-semibold">
                  El proveedor configurado NO puede publicarle disponibilidad al canal.
                </p>
                <p className="mt-1 text-stone-700">
                  Lo de acá abajo se calcula y se registra, pero no sale a ningún lado. Sirve para
                  dos cosas concretas: que la importación resuelva bien los tipos aunque Booking
                  les diga de otra forma, y que el día que el hotel contrate un{' '}
                  <strong>channel manager</strong> lo único que falte sea enchufarlo. La
                  sincronización en las dos direcciones es una contratación, no una decisión
                  técnica.
                </p>
              </div>
            </div>
          )}

          <Tarjeta
            titulo="Cómo llama el canal a cada tipo de unidad"
            descripcion="Sirve para los dos sentidos: resolver una reserva entrante y armar lo que se publica."
          >
            <p className="mb-4 text-sm text-stone-600">
              Booking puede llamar «DBL-LAGO» a lo que el sistema llama «DOBLE_VISTA». Hasta ahora
              había que renombrar el tipo del hotel para que la importación funcionara; con esto se
              anota la equivalencia una vez.
            </p>

            {tiposUnidad.length === 0 ? (
              <EstadoVacio
                titulo="No hay tipos de unidad activos"
                descripcion="Cargá los tipos de unidad antes de mapearlos a un canal."
                icono="ocupacion"
              />
            ) : (
              <div className="overflow-x-auto">
                <Tabla resumen="Tipos de unidad y su equivalencia en el canal, con el tope de cupo y las restricciones que se publican.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Tipo del hotel</th>
                      <th className={TH}>Código en el canal</th>
                      <th className={TH}>Tope de cupo</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Mín. noches</th>
                      <th className={TH}>Cerrado</th>
                      <th className={TH}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiposUnidad.map((t) => {
                      const m = mapeoPorTipo.get(t.id)
                      return (
                        <tr key={t.id} className={FILA}>
                          <td className={TD}>
                            <span className="font-medium text-stone-800">{t.nombre}</span>
                            <span className="block font-mono text-xs text-stone-500">
                              {t.codigo}
                            </span>
                          </td>
                          <td className={TD} colSpan={5}>
                            <form
                              action={guardarMapeoCanal}
                              className="flex flex-wrap items-end gap-2"
                            >
                              <input type="hidden" name="tipo_unidad_id" value={t.id} />
                              <Campo etiqueta="Código en el canal">
                                <input
                                  name="codigo_canal"
                                  defaultValue={m?.codigo_canal ?? t.codigo}
                                  maxLength={60}
                                  required
                                  className={`${CAMPO} w-40`}
                                />
                              </Campo>
                              <Campo
                                etiqueta="Tope de cupo"
                                ayuda="Vacío = todas las unidades."
                              >
                                <input
                                  name="tope_cupo"
                                  type="number"
                                  min="0"
                                  defaultValue={m?.tope_cupo ?? ''}
                                  className={`${CAMPO} w-24`}
                                />
                              </Campo>
                              <Campo etiqueta="Mín. noches">
                                <input
                                  name="minimo_noches"
                                  type="number"
                                  min="1"
                                  defaultValue={m?.minimo_noches ?? ''}
                                  className={`${CAMPO} w-24`}
                                />
                              </Campo>
                              <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
                                <input
                                  type="checkbox"
                                  name="cerrado"
                                  defaultChecked={m?.cerrado ?? false}
                                  className="size-4"
                                />
                                Cerrado
                              </label>
                              <BotonEnvio variante="secundario" cargando="Guardando…">
                                Guardar
                              </BotonEnvio>
                            </form>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Tabla>
              </div>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Restricciones por fecha"
            descripcion="Un mínimo de noches o un cierre que vale sólo para unos días, sin tocar el resto del año."
          >
            <div className="mb-4 space-y-2 text-sm text-stone-600">
              <p>
                Las restricciones de la tabla de arriba valen <strong>siempre</strong>. Éstas valen
                para un tramo de fechas: «el fin de semana largo pide 3 noches», «esas dos semanas
                las guardo para el grupo que reservó por teléfono», «no acepto llegadas el 24».
              </p>
              <p>
                <strong>El «hasta» queda afuera.</strong> Del 9 al 13 alcanza al 9, 10, 11 y 12: es
                la misma forma de contar que las temporadas y las estadías.
              </p>
              <p>
                <strong>Sin llegadas</strong> no cierra el día: deja que alguien pase esa noche,
                pero no que empiece ahí. Es lo que evita que un fin de semana largo se parta al
                medio. <strong>Sin salidas</strong> es lo mismo del otro lado.
              </p>
            </div>

            {puedeConciliarCargos ? (
              <form
                action={guardarRestriccionCanal}
                className="mb-5 flex flex-wrap items-end gap-2 rounded-xl bg-stone-50 p-4 ring-1 ring-stone-200"
              >
                <Campo etiqueta="Desde">
                  <input name="desde" type="date" required className={`${CAMPO} w-40`} />
                </Campo>
                <Campo etiqueta="Hasta (excluido)">
                  <input name="hasta" type="date" required className={`${CAMPO} w-40`} />
                </Campo>
                <Campo etiqueta="Tipo de unidad" ayuda="Vacío = todo el hotel.">
                  <select name="tipo_unidad_id" className={`${CAMPO} w-48`}>
                    <option value="">Todos los tipos</option>
                    {tiposUnidad.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo etiqueta="Mín. noches">
                  <input name="minimo_noches" type="number" min="1" className={`${CAMPO} w-24`} />
                </Campo>
                <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
                  <input type="checkbox" name="cerrado" className="size-4" />
                  Cerrado
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
                  <input type="checkbox" name="cerrado_llegada" className="size-4" />
                  Sin llegadas
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm text-stone-700">
                  <input type="checkbox" name="cerrado_salida" className="size-4" />
                  Sin salidas
                </label>
                <Campo etiqueta="Motivo" ayuda="Para acordarse de por qué, dentro de tres meses.">
                  <input
                    name="nota"
                    maxLength={200}
                    placeholder="Fin de semana largo"
                    className={`${CAMPO} w-56`}
                  />
                </Campo>
                <BotonEnvio variante="secundario" cargando="Guardando…">
                  Agregar
                </BotonEnvio>
              </form>
            ) : (
              <p className="mb-5 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600 ring-1 ring-stone-200">
                Cerrar fechas en un canal lo hace administración o gerencia: decide cuánto
                inventario se le deja a la OTA.
              </p>
            )}

            {restricciones.length === 0 ? (
              <EstadoVacio
                titulo="No hay restricciones vigentes"
                descripcion="Se publica lo que digan el cupo y el mapeo de cada tipo."
                icono="ocupacion"
              />
            ) : (
              <div className="overflow-x-auto">
                <Tabla resumen="Restricciones de venta por fecha, con el tramo, el tipo alcanzado y qué impone cada una.">
                  <thead>
                    <tr className={FILA}>
                      <th className={TH}>Fechas</th>
                      <th className={TH}>Alcanza a</th>
                      <th className={TH}>Qué impone</th>
                      <th className={`${TH} ${COL_SECUNDARIA}`}>Motivo</th>
                      <th className={TH}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {restricciones.map((r) => {
                      const tipo = tiposUnidad.find((t) => t.id === r.tipo_unidad_id)
                      const impone = [
                        r.cerrado ? 'Cerrado' : null,
                        r.minimo_noches ? `Mín. ${r.minimo_noches} noches` : null,
                        r.cerrado_llegada ? 'Sin llegadas' : null,
                        r.cerrado_salida ? 'Sin salidas' : null,
                      ].filter(Boolean)

                      return (
                        <tr key={r.id} className={FILA}>
                          <td className={`${TD} whitespace-nowrap`}>
                            {/*
                              Se muestra el último día INCLUIDO, no el fin del
                              rango: quien lee «hasta el 13» y ve que el bloqueo
                              termina el 12 concluye que el sistema le erró por un
                              día. Es lo mismo que hace `textoRango` con las
                              temporadas.
                            */}
                            {formatoFechaCorta(r.rango.desde)} al{' '}
                            {formatoFechaCorta(sumarDias(r.rango.hasta, -1))}
                          </td>
                          <td className={TD}>
                            {tipo ? (
                              tipo.nombre
                            ) : (
                              <span className="text-stone-600">Todo el hotel</span>
                            )}
                          </td>
                          <td className={TD}>
                            <span className="flex flex-wrap gap-1.5">
                              {impone.map((i) => (
                                <Etiqueta key={i} tono={r.cerrado ? 'peligro' : 'alerta'}>
                                  {i}
                                </Etiqueta>
                              ))}
                            </span>
                          </td>
                          <td className={`${TD} ${COL_SECUNDARIA} text-xs text-stone-600`}>
                            {r.nota || '—'}
                          </td>
                          <td className={TD}>
                            {puedeConciliarCargos && (
                              <form action={borrarRestriccionCanal}>
                                <input type="hidden" name="id" value={r.id} />
                                <BotonEnvio
                                  variante="fantasma"
                                  extra="text-stone-600 hover:text-red-600"
                                  cargando="Levantando…"
                                  confirmar="¿Levantar esta restricción? Esas fechas vuelven a la venta normal en la próxima publicación."
                                >
                                  Levantar
                                </BotonEnvio>
                              </form>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Tabla>
              </div>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Última publicación"
            descripcion="Que quede registrada aunque no salga nada es el punto: «no se actualiza» y «nadie lo corrió» son problemas distintos."
          >
            {ultimaSalida ? (
              <div className="space-y-2 text-sm text-stone-700">
                <p>
                  <strong>{formatoFechaCorta(ultimaSalida.corrida_en.slice(0, 10))}</strong> ·{' '}
                  {horaHotel(ultimaSalida.corrida_en)} · proveedor{' '}
                  {ultimaSalida.proveedor}
                </p>
                <p className="tabular">
                  {ultimaSalida.leidas} filas calculadas · {ultimaSalida.actualizadas} aceptadas por
                  el canal · {ultimaSalida.rechazadas} días sin tarifa cargada
                </p>
                {ultimaSalida.rechazadas > 0 && (
                  <p className="rounded-lg bg-lenga-50 px-3 py-2 text-lenga-900 ring-1 ring-lenga-200">
                    Los días sin tarifa <strong>no se publican</strong>, y es a propósito: publicar
                    cero sería publicar una noche gratis. Cargá las temporadas que faltan para que
                    esas fechas salgan a la venta.
                  </p>
                )}
                {ultimaSalida.detalle && (
                  <p className="text-stone-600">{ultimaSalida.detalle}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-stone-600">
                Todavía no se corrió ninguna publicación. Se dispara sola todos los días, o con el
                botón de acá abajo.
              </p>
            )}

            {puedeConciliarCargos && (
              <form action={publicarAhora} className="mt-4">
                <BotonEnvio variante="secundario" cargando="Publicando…">
                  Publicar ahora
                </BotonEnvio>
              </form>
            )}
          </Tarjeta>
        </div>
      )}

      {vista === 'calendario' && (
        <div className="space-y-4">
          <Tarjeta
            titulo="Calendario de ocupación para el canal"
            descripcion="Las direcciones que hay que pegar en el extranet para que cierre fechas solo."
          >
            <div className="space-y-3 text-sm text-stone-700">
              <p>
                Cada dirección de acá abajo es un calendario que Booking, Airbnb o Expedia pueden
                leer. Se pega una vez en el extranet, en la sección de calendarios importados o
                sincronización de calendarios, y a partir de ahí el canal cierra solo las fechas en
                las que no queda lugar.
              </p>
              <p className="rounded-lg bg-lenga-50 px-3 py-2 text-lenga-900 ring-1 ring-lenga-200">
                <strong>Esto angosta la ventana del overbooking, no la cierra.</strong> El canal
                relee el calendario cada varias horas y no promete cada cuánto; entre que se vende
                la última unidad y que se entera, puede vender de nuevo. Y nadie confirma que lo
                aplicó: lo único que se sabe es si pasó a buscarlo.
              </p>
              <p>
                <strong>Son direcciones secretas.</strong> Quien las tenga puede ver qué días está
                lleno el hotel. No traen ningún dato de los huéspedes, pero conviene no publicarlas
                ni mandarlas por fuera del extranet.
              </p>
            </div>
          </Tarjeta>

          {!configIcal ? (
            <EstadoVacio
              titulo="Todavía no hay configuración del canal"
              descripcion="El calendario sale del token que se genera al configurar Booking en Costos y comisión. Sin esa fila no hay ninguna dirección que publicar."
            />
          ) : (
            <>
              <Tarjeta titulo="¿Lo están leyendo?">
                <p className="text-sm text-stone-700">
                  {describirUltimaLectura(configIcal.ical_leido_en, new Date())}.{' '}
                  {configIcal.ical_leido_en ? (
                    <span className="text-stone-500">
                      Es lo más parecido a un acuse de recibo que permite este formato: dice que
                      vinieron a buscar el archivo, no que hayan cerrado las fechas.
                    </span>
                  ) : (
                    <span className="text-stone-500">
                      Si ya se pegó la dirección en el extranet y sigue diciendo esto al día
                      siguiente, lo más probable es que esté copiada de más o de menos.
                    </span>
                  )}
                </p>
              </Tarjeta>

              {feeds.map((f) => (
                <Tarjeta
                  key={f.codigo}
                  titulo={f.nombre}
                  descripcion={`${f.cuantas} unidad(es) activa(s) · código ${f.codigo}`}
                >
                  <div className="space-y-3">
                    <div>
                      <Etiqueta>Calendario del tipo</Etiqueta>
                      <p className="mt-1 break-all rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800 ring-1 ring-stone-200">
                        {f.url}
                      </p>
                    </div>

                    {/*
                      La limitación que hay que decir por tipo, no en general: con más
                      de una unidad el calendario recién cierra cuando se vendieron
                      todas. No es un defecto que se pueda arreglar acá —un calendario
                      dice «ocupado», no «me queda una»— y cerrar antes le costaría
                      ventas reales al hotel.
                    */}
                    {f.cuantas > 1 && (
                      <div className="rounded-lg bg-lenga-50 px-3 py-2 text-sm text-lenga-900 ring-1 ring-lenga-200">
                        <p>
                          Este tipo tiene <strong>{f.cuantas} unidades</strong>, así que este
                          calendario marca ocupado <strong>recién cuando se vendieron las {f.cuantas}</strong>.
                          Antes de eso todavía hay lugar y cerrarlo sería perder ventas.
                        </p>
                        <p className="mt-1">
                          Si en el extranet cada unidad figura como una habitación aparte, conviene
                          usar el calendario de cada una:
                        </p>
                        <ul className="mt-2 space-y-2">
                          {f.unidades.map((u) => (
                            <li key={u.nombre}>
                              <span className="font-semibold">{u.nombre}</span>
                              <p className="mt-0.5 break-all rounded bg-white/70 px-2 py-1 font-mono text-xs text-stone-800">
                                {u.url}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Tarjeta>
              ))}

              {feeds.length === 0 && (
                <EstadoVacio
                  titulo="No hay tipos de unidad activos"
                  descripcion="Sin inventario cargado no hay calendario que publicar."
                />
              )}
            </>
          )}
        </div>
      )}
    </Pagina>
  )
}
