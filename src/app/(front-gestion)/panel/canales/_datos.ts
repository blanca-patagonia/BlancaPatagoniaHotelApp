import 'server-only'
import { deLista } from '@/lib/domain/listas'
import { esDireccion } from '@/lib/domain/permisos'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerProveedorCanal } from '@/lib/canales'
import { urlDelSitio } from '@/lib/env'
import {
  hoyISO,
  inicioFinDeMes,
  mesActual,
  parsearPeriodo,
  sumarDias,
} from '@/lib/fechas'
import { registrarFalla } from '@/lib/acciones'
import { conciliarDevengoContraFactura } from '@/lib/domain/canales-costos'
import {
  clasificarCobro,
  contarCobros,
  type ModalidadCobro,
} from '@/lib/domain/canales-cobro'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import {
  VISTAS,
  type Vista,
  ESTADOS_ENTRANTE,
  type EntranteRow,
  type SincroRow,
  type MensajeRow,
  type ResenaRow,
  type CargoRow,
} from './_compartido'

/** Lo que llega por la URL a la pantalla de canales. */
export type ParametrosCanales = {
  vista?: string
  estado?: string
  error?: string
  ok?: string
  codigo?: string
  nuevas?: string
  actualizadas?: string
  rechazadas?: string
  mes?: string
}

type Sesion = Awaited<ReturnType<typeof requerirAcceso>>

/**
 * Toda la lectura de datos de la pantalla de canales, aparte de cómo se
 * muestran. Devuelve lo que la página y sus vistas necesitan; su tipo
 * (`DatosCanales`) se deduce de lo que devuelve, así no hay que mantenerlo a mano.
 */
export async function cargarDatosCanales(sesion: Sesion, sp: ParametrosCanales) {
  // Mes de la conciliación de comisión (Devengado / Facturado / Diferencia).
  // Antes se sumaba TODO `canal_cargos` sin acotar por fecha, mezclando meses
  // distintos como si fueran comparables — y encima truncado a 200 filas.
  const mesConciliacion = /^\d{4}-\d{2}$/.test(sp.mes ?? '') ? sp.mes! : mesActual()
  const { inicio: mesDesde, fin: mesHasta } = inicioFinDeMes(mesConciliacion)

  /*
    Cerrar la conciliación es de gerencia (P1-4).

    El área `canales` alcanza también a recepción para lo operativo —importar,
    convertir una entrante, atender un mensaje—, pero aceptar una diferencia
    contra el canal es aceptar un costo y disputarla es abrir un reclamo. La
    acción lo verifica igual; acá se decide si mostrar el control.
  */
  const puedeConciliarCargos = esDireccion(sesion.rol)

  const vista: Vista = deLista(VISTAS, sp.vista) ?? 'entrantes'
  const estado = deLista(ESTADOS_ENTRANTE, sp.estado)

  const proveedor = obtenerProveedorCanal()
  const capacidades = proveedor.capacidades()

  const supabase = await crearClienteServidor()

  /*
    `canal_reservas` no se purga: acumula todo lo sincronizado desde siempre.
    Con orden ascendente por `check_in` y un `limit(200)`, sin ningún piso de
    fecha, esa combinación traía las 200 filas MÁS VIEJAS de toda la historia
    en cuanto el hotel superaba las 200 sincronizaciones — las entrantes
    NUEVAS, que son las que hay que revisar, quedaban tapadas por historial ya
    resuelto. Y de ahí salían el KPI de "posible overbooking" y la lista de
    cobros, así que el problema no era solo visual.

    El piso de 14 días hacia atrás (no `hoyISO()` a secas) es porque una
    entrante de conciliación puede seguir necesitando revisión unos días
    después del check-in. El conteo de la barra de filtros (`conteo`, más
    abajo) es una consulta aparte SIN este piso ni el límite: sigue contando
    la historia completa.
  */
  let consultaEntrantes = supabase
    .from('canal_reservas')
    .select(
      /*
        `agencia:agencias(nombre)` a secas es AMBIGUO: `reservas` tiene DOS FKs
        hacia `agencias` (`agencia_id` y `folio_b_agencia_id`, para el folio B).
        Sin `!reservas_agencia_id_fkey`, PostgREST no puede elegir sola y
        responde "more than one relationship was found" — el embed entero
        falla, y con él el KPI de posible overbooking de canal que depende de
        esta consulta. Mismo patrón que `huespedes!reservas_huesped_id_fkey`
        en `reservas/consulta.ts` (ahí también hay 2 FKs).
      */
      'id, canal, external_id, operacion, estado, motivo, huesped_apellido, huesped_nombre, huesped_email, huesped_pais, tipo_unidad_codigo, check_in, check_out, huespedes, importe_canal, moneda_canal, comision, modalidad_cobro, liquidado_en, conflicto, notas, divergencia, divergencia_desde, reserva_id, reserva:reservas(codigo, agencia:agencias!reservas_agencia_id_fkey(nombre))',
    )
    .gte('check_in', sumarDias(hoyISO(), -14))
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
      .select(
        'id, autor, pais, puntaje, titulo, positivo, negativo, publicada_en, respondida, respuesta, vinculo, motivo_sin_vinculo, reserva:reservas(id, codigo)',
      )
      .order('publicada_en', { ascending: false, nullsFirst: false })
      .limit(100),
    // Los cargos del canal (migración 0049). El embed trae el apellido para poder
    // decir a qué venta pertenece cada costo, que es todo el punto de la tabla.
    // Acotado al mes de conciliación elegido (`mesConciliacion`): sin este
    // filtro se sumaban cargos de meses distintos como si fueran comparables,
    // y encima se truncaba a 200 filas sin avisar — ver el comentario de más
    // abajo, junto a `devengado`/`facturado`.
    supabase
      .from('canal_cargos')
      .select(
        'id, concepto, origen, monto, moneda, monto_usd, imputado_el, estado_conciliacion, nota_conciliacion, detalle, entrante:canal_reservas(huesped_apellido, external_id), reserva:reservas(codigo)',
      )
      .gte('imputado_el', mesDesde)
      .lt('imputado_el', mesHasta)
      .order('imputado_el', { ascending: false, nullsFirst: false })
      .limit(500),
    /*
        El inventario, para armar las URLs del feed iCal de salida.

        Las unidades se traen enteras y se cuentan acá en vez de pedirle el conteo a
        la base: son quince filas. Y hace falta el conteo por tipo porque de él
        depende lo único que hay que explicarle a quien lee la pantalla — un tipo con
        tres unidades recién se cierra cuando se vendieron las tres.
      */
    supabase.from('tipos_unidad').select('id, codigo, nombre').eq('activo', true).order('codigo'),
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
      .select(
        'id, tipo_unidad_id, periodo, minimo_noches, cerrado, cerrado_llegada, cerrado_salida, nota',
      )
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
    eEntrantes ||
    eSincro ||
    eMensajes ||
    eResenas ||
    eCargos ||
    eTipos ||
    eUnidades ||
    eConfig ||
    eMapeos ||
    eSalida,
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
  ] =
    idsReservas.length > 0
      ? await Promise.all([
          supabase
            .from('pagos')
            .select('reserva_id, tipo, monto, estado')
            .in('reserva_id', idsReservas),
          supabase
            .from('consumos')
            .select('reserva_id, cantidad, precio_unitario')
            .in('reserva_id', idsReservas),
          supabase.from('reservas').select('id, total').in('id', idsReservas),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ]
  registrarFalla(ePagos, 'canales:cobro_pagos')
  registrarFalla(eConsumosCobro, 'canales:cobro_consumos')
  registrarFalla(eTotales, 'canales:cobro_totales')
  const fallaSaldos = Boolean(ePagos || eConsumosCobro || eTotales)

  const totalPorReserva = new Map<string, number>()
  for (const r of (totalesData ?? []) as {
    id: string
    total: number | string
  }[]) {
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
    lista.push({
      cantidad: c.cantidad,
      precioUnitario: Number(c.precio_unitario),
    })
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

    return {
      entrante: e,
      ...entrada,
      situacion: clasificarCobro(entrada, hoyISO()),
    }
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
  /*
    Se suma `monto_usd`, NO `monto`: `monto` está en la moneda del comprobante
    (una factura de Booking en EUR o en ARS) y sumarlo para mostrarlo como USD
    daba diferencias falsas —con una factura en pesos, de millones—. Las filas
    sin cotización se cuentan aparte en vez de sumarse como cero, igual que la
    vista de la 0049 (ADR 0020: la falta de cotización no bloquea nada, pero
    tampoco se esconde).
  */
  const comisiones = cargos.filter((c) => c.concepto === 'comision')
  const sinConvertir = comisiones.filter((c) => c.monto_usd === null).length
  const sumarUsd = (filas: CargoRow[]) =>
    filas.reduce((a, c) => a + (c.monto_usd === null ? 0 : Number(c.monto_usd)), 0)
  const devengado = sumarUsd(comisiones.filter((c) => c.origen === 'informe_reservas'))
  const facturado = sumarUsd(comisiones.filter((c) => c.origen === 'factura_comision'))
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

  const tiposUnidad = (tiposData ?? []) as {
    id: string
    codigo: string
    nombre: string
  }[]

  /*
    El mapeo, indexado por tipo para que la tabla no busque en un arreglo por cada
    fila. Un tipo sin fila mapeada muestra su propio código como valor por
    omisión: es lo más probable y ahorra escribirlo.
  */
  const mapeoPorTipo = new Map(
    (
      (mapeosData ?? []) as {
        tipo_unidad_id: string
        codigo_canal: string
        tope_cupo: number | null
        minimo_noches: number | null
        cerrado: boolean
      }[]
    ).map((m) => [m.tipo_unidad_id, m]),
  )

  const restricciones = (
    (restriccionesData ?? []) as {
      id: string
      tipo_unidad_id: string | null
      periodo: string
      minimo_noches: number | null
      cerrado: boolean
      cerrado_llegada: boolean
      cerrado_salida: boolean
      nota: string
    }[]
  ).map((r) => ({ ...r, rango: parsearPeriodo(r.periodo) }))

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

  return {
    capacidades,
    cargos,
    cobros,
    conConflicto,
    conciliacion,
    configIcal,
    conteo,
    conteoCobros,
    entrantes,
    estado,
    facturado,
    fallaConflictos,
    fallaLectura,
    fallaSaldos,
    feeds,
    hoy,
    mapeoPorTipo,
    mensajes,
    mesConciliacion,
    proveedor,
    puedeConciliarCargos,
    resenas,
    restricciones,
    sinAtender,
    sinComision,
    sinConvertir,
    sinResponder,
    tiposUnidad,
    ultima,
    ultimaSalida,
    vigentes,
    vista,
  }
}

export type DatosCanales = Awaited<ReturnType<typeof cargarDatosCanales>>
