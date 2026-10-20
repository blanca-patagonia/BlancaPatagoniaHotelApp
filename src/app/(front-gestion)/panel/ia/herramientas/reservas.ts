import 'server-only'
import { hoyISO, parsearPeriodo, diasEntre, sumarDias, fechaDelHotel } from '@/lib/fechas'
import { ETIQUETAS_ESTADO_RESERVA, ESTADOS_ACTIVOS, type EstadoReserva } from '@/lib/domain/reservas'
import { registrarFalla } from '@/lib/acciones'
import { resumirDia, movimientosPorDia, normalizarCodigoReserva, type EstadiaDelDia } from '@/lib/domain/ia-datos'
import { crearClienteServidor } from '@/lib/supabase/server'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { UMBRAL_PARECIDO } from '@/lib/busqueda/servicio'
import { terminoBusqueda } from '@/lib/listados'
import { comoLista } from '@/lib/domain/listas'
import { cuentaConsolidada } from '@/lib/domain/consumos'
import {
  FECHA,
  SELECTS_IA,
  cuentaDe,
  enlaceDeReserva,
  idsDeHuespedes,
  noSePudoLeer,
  palabrasDeNombre,
  textoArg,
  type Argumentos,
  type ReservaConCuenta,
} from './comun'

/**
 * Herramientas de reservas y ocupación: buscar una reserva (por código o por
 * huésped), su cuenta detallada, saldos, disponibilidad, cotización y los
 * movimientos de los próximos días.
 *
 * ⚠️ Ninguna devuelve datos personales: lo que vuelve de acá viaja al
 * proveedor de IA (ADR 0039). Se contesta con códigos, fechas, unidades y el
 * enlace a la ficha.
 */

/** Llegadas, salidas y ocupación de un día, con la misma regla que el tablero. */
export async function operacionDelDia(argumentos: Argumentos) {
  const crudo = typeof argumentos.fecha === 'string' ? argumentos.fecha : ''
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(crudo) ? crudo : hoyISO()
  const supabase = await crearClienteServidor()
  const [unidades, estadias] = await Promise.all([
    supabase.from('unidades').select('*', { count: 'exact', head: true }).eq('activo', true),
    supabase
      .from('estadias')
      .select(
        // Sin el huésped: lo que devuelve una herramienta sale al proveedor de IA.
        SELECTS_IA.operacionDelDia,
      )
      // Más `checkout`: sin él, en un día pasado faltaban todas las estadías ya
      // cerradas (la ocupación salía baja) y hoy no aparecían las salidas ya
      // registradas. Una estadía en `checkout` nunca ocupa la noche consultada
      // después de su salida, así que no infla la ocupación.
      .in('estado', [...ESTADOS_ACTIVOS, 'checkout'])
      // Sólo las que tocan ese día: llegan, se van o duermen esa noche.
      .lte('check_in', dia)
      .gte('check_out', dia)
      .order('id')
      .limit(1000),
  ])
  if (unidades.error || estadias.error) {
    registrarFalla(unidades.error ?? estadias.error, 'ia:operacion_del_dia')
    return { fecha: dia, error: 'No se pudo leer la ocupación de ese día.' }
  }
  return resumirDia((estadias.data ?? []) as unknown as EstadiaDelDia[], dia, unidades.count ?? 0)
}

export async function buscarReserva(argumentos: Argumentos) {
  // Guiones Unicode, espacios y minúsculas: ver `normalizarCodigoReserva`.
  const codigo = normalizarCodigoReserva(typeof argumentos.codigo === 'string' ? argumentos.codigo : '')
  if (!/^[A-Z0-9-]{3,30}$/.test(codigo)) {
    return { error: 'Pasame el código de la reserva tal como aparece en el panel (por ejemplo BP-0123).' }
  }
  const supabase = await crearClienteServidor()
  /*
    Por coincidencia parcial y no exacta: alcanza con «9410» o con el código sin
    el prefijo. Si hay una sola, va el detalle completo; si hay varias, la lista
    para que la persona elija.
  */
  const { data, error } = await supabase
    .from('reservas')
    .select(SELECTS_IA.buscarReserva)
    .ilike('codigo', `%${terminoBusqueda(codigo) ?? codigo}%`)
    .order('creada_en', { ascending: false })
    .limit(6)
  if (error) {
    registrarFalla(error, 'ia:buscar_reserva')
    return { error: 'No se pudo leer la reserva.' }
  }
  const filas = (data ?? []) as unknown as (ReservaConCuenta & {
    id: string
    canal: string
    estadias: {
      periodo: string
      adultos: number | null
      menores: number | null
      unidad: { nombre: string; tipo: { nombre: string } | null } | null
    }[]
  })[]
  if (filas.length === 0) return { codigo, encontrada: false }

  const exacta = filas.find((r) => r.codigo.toUpperCase() === codigo)
  if (!exacta && filas.length > 1) {
    return {
      codigo,
      encontrada: false,
      parecidas: filas.map((r) => ({
        codigo: r.codigo,
        estado: ETIQUETAS_ESTADO_RESERVA[r.estado as EstadoReserva] ?? r.estado,
        llegada: r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo).desde : null,
        enlace: enlaceDeReserva(r.id),
      })),
      instruccion: 'Mostrale las parecidas a la persona y preguntale cuál es.',
    }
  }
  const r = exacta ?? filas[0]
  const estadia = r.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  return {
    codigo: r.codigo,
    encontrada: true,
    enlace: enlaceDeReserva(r.id),
    estado: ETIQUETAS_ESTADO_RESERVA[r.estado as EstadoReserva] ?? r.estado,
    canal: r.canal,
    llegada: periodo?.desde ?? null,
    salida: periodo?.hasta ?? null,
    noches: periodo ? diasEntre(periodo.desde, periodo.hasta) : null,
    unidad: estadia?.unidad?.nombre ?? null,
    tipo: estadia?.unidad?.tipo?.nombre ?? null,
    // El desglose de ocupantes vive en la ESTADÍA, no en la reserva.
    adultos: estadia?.adultos ?? null,
    menores: estadia?.menores ?? null,
    ...cuentaDe(r),
  }
}


/**
 * Reservas de un huésped buscado por nombre o apellido.
 *
 * ── Privacidad (ADR 0039, adenda 3) ─────────────────────────────────────────
 *
 * El nombre lo escribe quien pregunta, así que ya viajó al proveedor. Lo que
 * esta herramienta NO hace es devolver datos personales: lee de `huespedes`
 * únicamente el `id` (el nombre se usa como FILTRO en la base, no se lee) y
 * contesta con códigos de reserva, fechas, estado, unidad y el enlace a la
 * ficha, donde la persona ve los datos completos. Ni email, ni documento, ni
 * teléfono, ni siquiera el nombre completo salen hacia el modelo.
 */
export async function buscarPorHuesped(argumentos: Argumentos) {
  const crudo = textoArg(argumentos, 'nombre')
  const palabras = palabrasDeNombre(crudo)
  if (palabras.length === 0) return { error: 'Decime el nombre o el apellido del huésped.' }

  const supabase = await crearClienteServidor()
  const encontrados = await idsDeHuespedes(palabras, 20)
  if (encontrados.error) {
    registrarFalla(encontrados.error, 'ia:buscar_por_huesped')
    return { error: 'No se pudo buscar al huésped.' }
  }
  let ids = encontrados.ids
  /*
    Sin coincidencia exacta, una aproximada (0118, pg_trgm): «amiron» encuentra
    a «almiron». La base compara los nombres y devuelve sólo ids y un puntaje,
    así que nada personal sale hacia el modelo. Se marca como aproximada para
    que el asistente pregunte «¿es esta?» en vez de darla por buena.
  */
  let aproximada = false
  if (ids.length === 0) {
    const { data: parecidos, error: eParecidos } = await supabase.rpc('buscar_huespedes_parecidos', {
      p_termino: crudo,
      p_limite: 5,
    })
    registrarFalla(eParecidos, 'ia:buscar_huespedes_parecidos')
    ids = ((parecidos ?? []) as { id: string; parecido: number }[])
      .filter((p) => p.parecido >= UMBRAL_PARECIDO)
      .map((p) => p.id)
    aproximada = ids.length > 0
  }
  if (ids.length === 0) return { buscado: crudo, encontrado: false }

  const { data, error } = await supabase
    .from('reservas')
    .select(SELECTS_IA.reservasDeHuesped)
    .in('huesped_id', ids)
    .order('creada_en', { ascending: false })
    .limit(10)
  if (error) {
    registrarFalla(error, 'ia:buscar_por_huesped_reservas')
    return { error: 'No se pudieron leer las reservas.' }
  }
  const reservas = (data ?? []) as unknown as {
    id: string
    codigo: string
    estado: string
    estadias: { periodo: string; unidad: { nombre: string } | null }[]
  }[]
  return {
    buscado: crudo,
    encontrado: true,
    ...(aproximada
      ? {
          coincidenciaAproximada: true,
          aviso: `No hay nadie exactamente «${crudo}»: estas son de huéspedes con un nombre PARECIDO. Preguntale a la persona si es alguna de estas.`,
        }
      : {}),
    huespedesQueCoinciden: ids.length,
    reservas: reservas.map((r) => {
      const p = r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo) : null
      return {
        codigo: r.codigo,
        estado: ETIQUETAS_ESTADO_RESERVA[r.estado as EstadoReserva] ?? r.estado,
        llegada: p?.desde ?? null,
        salida: p?.hasta ?? null,
        unidad: r.estadias?.[0]?.unidad?.nombre ?? null,
        enlace: enlaceDeReserva(r.id),
      }
    }),
    instruccion:
      ids.length > 1
        ? 'Hay más de un huésped con ese nombre: mostrá las reservas con su enlace y que la persona confirme cuál es.'
        : 'Mostrá las reservas con su enlace a la ficha. No tenés el nombre completo ni otros datos del huésped.',
  }
}

/** La misma regla que «Requiere atención» del tablero (`contarSaldosPendientes`). */
export async function saldosPendientes() {
  const hoy = hoyISO()
  const supabase = await crearClienteServidor()
  const SELECT = SELECTS_IA.saldosPendientes
  const [confirmadas, alojadas] = await Promise.all([
    supabase.from('reservas').select(SELECT).eq('estado', 'confirmada').lte('estadias.check_in', hoy),
    supabase.from('reservas').select(SELECT).eq('estado', 'in_house').lte('estadias.check_out', hoy),
  ])
  const error = confirmadas.error ?? alojadas.error
  if (error) {
    registrarFalla(error, 'ia:saldos_pendientes')
    return { error: 'No se pudieron leer los saldos.' }
  }
  const filas = [...(confirmadas.data ?? []), ...(alojadas.data ?? [])] as unknown as (ReservaConCuenta & {
    estadias: { check_in: string; check_out: string }[]
  })[]
  const conSaldo = filas
    .map((r) => ({
      codigo: r.codigo,
      estado: ETIQUETAS_ESTADO_RESERVA[r.estado as EstadoReserva] ?? r.estado,
      fecha: r.estado === 'in_house' ? r.estadias[0]?.check_out : r.estadias[0]?.check_in,
      ...cuentaDe(r),
    }))
    .filter((r) => r.saldoUsd > 0)
    .sort((a, b) => b.saldoUsd - a.saldoUsd)
  return {
    cantidad: conSaldo.length,
    saldoTotalUsd: Math.round(conSaldo.reduce((t, r) => t + r.saldoUsd, 0) * 100) / 100,
    reservas: conSaldo.slice(0, 20),
  }
}

/** Unidades libres por tipo entre dos fechas (la misma función SQL que el alta de reservas). */
export async function disponibilidad(argumentos: Argumentos) {
  const desde = typeof argumentos.desde === 'string' ? argumentos.desde : ''
  const hasta = typeof argumentos.hasta === 'string' ? argumentos.hasta : ''
  const fecha = /^\d{4}-\d{2}-\d{2}$/
  if (!fecha.test(desde) || !fecha.test(hasta) || hasta <= desde) {
    return { error: 'Necesito dos fechas AAAA-MM-DD, con la salida después de la llegada.' }
  }
  if (diasEntre(desde, hasta) > 60) return { error: 'Consultá de a 60 noches como máximo.' }
  const tipos = await disponibilidadPorTipo(desde, hasta)
  return {
    desde,
    hasta,
    noches: diasEntre(desde, hasta),
    tipos: tipos.map((t) => ({
      tipo: t.nombre,
      categoria: t.categoria,
      capacidadMaxima: t.capacidad_max,
      unidadesLibres: t.disponibles,
    })),
  }
}

/** Un tipo de unidad por nombre o código, o la lista de candidatos si es ambiguo. */
export async function resolverTipo(nombre: string) {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('tipos_unidad')
    .select(SELECTS_IA.tiposUnidad)
    .eq('activo', true)
    .order('nombre')
  if (error) {
    registrarFalla(error, 'ia:resolver_tipo')
    return { error: 'No se pudieron leer los tipos de unidad.' as const }
  }
  const tipos = (data ?? []) as { id: string; codigo: string; nombre: string; capacidad_max: number }[]
  const buscado = nombre.trim().toLowerCase()
  const exacto = tipos.find((t) => t.codigo.toLowerCase() === buscado || t.nombre.toLowerCase() === buscado)
  if (exacto) return { tipo: exacto }
  const parecidos = tipos.filter((t) => t.nombre.toLowerCase().includes(buscado) || t.codigo.toLowerCase().includes(buscado))
  if (parecidos.length === 1) return { tipo: parecidos[0] }
  return { candidatos: (parecidos.length ? parecidos : tipos).map((t) => t.nombre) }
}

/** Precio de mostrador (rack) de una estadía, con IVA, y cuántas unidades quedan. */
export async function cotizar(argumentos: Argumentos) {
  const desde = textoArg(argumentos, 'desde')
  const hasta = textoArg(argumentos, 'hasta')
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta <= desde) {
    return { error: 'Necesito dos fechas AAAA-MM-DD, con la salida después de la llegada.' }
  }
  if (diasEntre(desde, hasta) > 30) return { error: 'Cotizá de a 30 noches como máximo.' }
  const r = await resolverTipo(textoArg(argumentos, 'tipo'))
  if ('error' in r) return { error: r.error }
  if (!('tipo' in r) || !r.tipo) {
    return { error: 'No encontré un único tipo con ese nombre.', tipos: r.candidatos, instruccion: 'Preguntá cuál.' }
  }
  const tipo = r.tipo
  const [cotizacion, disponibles] = await Promise.all([
    // Rack: es el precio de mostrador. El neto es tarifa de agencia (ADR 0004)
    // y no se le da a quien cotiza por el chat.
    cotizarEstadia({ tipoUnidadId: tipo.id, checkIn: desde, checkOut: hasta, tarifaTipo: 'rack' }),
    disponibilidadPorTipo(desde, hasta),
  ])
  const libres = disponibles.find((d) => d.tipo_unidad_id === tipo.id)?.disponibles ?? 0
  const { resumen } = cotizacion
  return {
    tipo: tipo.nombre,
    capacidadMaxima: tipo.capacidad_max,
    desde,
    hasta,
    noches: resumen.noches,
    // Un día sin tarifa NO se cotiza en cero (el «USD 0» de la Fase 18).
    faltanTarifas: cotizacion.faltanTarifas,
    ...(cotizacion.faltanTarifas
      ? { aviso: 'Hay noches sin tarifa cargada: el total está incompleto. Que lo cotice el mostrador.' }
      : {}),
    netoSinIvaUsd: resumen.totalNeto,
    ivaUsd: resumen.iva,
    totalConIvaUsd: resumen.total,
    unidadesLibres: libres,
  }
}

/** Llegadas y salidas de hasta 14 días. */
export async function movimientosProximos(argumentos: Argumentos) {
  const crudo = textoArg(argumentos, 'desde')
  const desde = FECHA.test(crudo) ? crudo : hoyISO()
  const dias = Math.min(14, Math.max(1, Math.trunc(Number(argumentos.dias ?? 7)) || 7))
  const hasta = sumarDias(desde, dias)
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('estadias')
    .select(SELECTS_IA.operacionDelDia)
    .in('estado', [...ESTADOS_ACTIVOS, 'checkout'])
    // Las que llegan o se van dentro de la ventana.
    .lte('check_in', hasta)
    .gte('check_out', desde)
    .order('id')
    .limit(1000)
  if (error) {
    registrarFalla(error, 'ia:movimientos_proximos')
    return { error: 'No se pudieron leer los movimientos.' }
  }
  return { desde, dias, porDia: movimientosPorDia((data ?? []) as unknown as EstadiaDelDia[], desde, dias) }
}

/**
 * La cuenta detallada de una reserva: cada consumo y cada pago, con la MISMA
 * cuenta consolidada que la ficha (`cuentaDe`). Sin datos del huésped.
 */
export async function cuentaDeReserva(argumentos: Argumentos) {
  const codigo = normalizarCodigoReserva(textoArg(argumentos, 'codigo_reserva'))
  if (!/^[A-Z0-9-]{3,30}$/.test(codigo)) return { error: 'Necesito el código de la reserva.' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('reservas')
    .select(SELECTS_IA.cuentaDeReserva)
    .eq('codigo', codigo)
    .maybeSingle()
  if (error) return noSePudoLeer(error, 'cuenta_de_reserva', 'la cuenta de la reserva')
  if (!data) {
    return { error: `No existe la reserva ${codigo}. Si el código es parcial, buscala primero con buscar_reserva.` }
  }
  const r = data as unknown as {
    id: string
    codigo: string
    estado: string
    total: number | string
    pagos: { tipo: string; monto: number | string; estado: string; medio: string | null; creado_en: string }[]
    consumos: {
      cantidad: number
      precio_unitario: number | string
      fecha: string | null
      producto: { nombre: string } | null
    }[]
    facturas: { numero: string } | { numero: string }[] | null
  }
  const consumos = r.consumos ?? []
  const totalConsumos = cuentaConsolidada(
    0,
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) })),
  ).total
  const redondear = (n: number) => Math.round(n * 100) / 100
  return {
    codigo: r.codigo,
    enlace: enlaceDeReserva(r.id),
    estado: ETIQUETAS_ESTADO_RESERVA[r.estado as EstadoReserva] ?? r.estado,
    alojamientoUsd: redondear(Number(r.total)),
    consumos: consumos.slice(0, 40).map((c) => ({
      producto: c.producto?.nombre ?? 'producto',
      cantidad: c.cantidad,
      importeUsd: redondear(c.cantidad * Number(c.precio_unitario)),
      fecha: c.fecha,
    })),
    totalConsumosUsd: redondear(totalConsumos),
    pagos: (r.pagos ?? []).map((p) => ({
      tipo: p.tipo,
      medio: p.medio,
      montoUsd: redondear(Number(p.monto)),
      estado: p.estado,
      fecha: fechaDelHotel(p.creado_en),
    })),
    ...cuentaDe(data as unknown as ReservaConCuenta),
    facturada: comoLista(r.facturas).length > 0,
  }
}
