import 'server-only'
import { parsearPeriodo, diasEntre } from '@/lib/fechas'
import { comoLista } from '@/lib/domain/listas'
import { ETIQUETAS_ESTADO_RESERVA, puedeTransicionar, type EstadoReserva } from '@/lib/domain/reservas'
import { registrarFalla } from '@/lib/acciones'
import { crearClienteServidor } from '@/lib/supabase/server'
import { disponibilidadPorTipo, unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { cargoDeCancelacion } from '@/lib/reservas/cancelacion'
import { formatearUSD } from '@/lib/domain/moneda'
import { enmascararDatosPersonales } from '@/lib/domain/ia-datos'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { motivoNoCargable } from '@/lib/domain/servicio'
import { terminoBusqueda } from '@/lib/listados'
import {
  FECHA,
  SELECTS_IA,
  idsDeHuespedes,
  noSePudoLeer,
  palabrasDeNombre,
  preparada,
  reservaPorCodigo,
  textoArg,
  unidadPorNombre,
  type Argumentos,
} from './comun'
import { resolverTipo } from './reservas'

/**
 * Las herramientas `proponer_*` (ADR 0041): arman una propuesta validada que
 * la persona revisa en una tarjeta y confirma. NINGUNA escribe en la base: la
 * escritura la hace `../acciones.ts` al confirmar, con la Server Action del
 * módulo.
 *
 * Antes de proponer se verifica lo que se puede saber ya (la reserva existe, el
 * cambio de estado corresponde, la unidad está libre, la cuenta no está
 * cerrada): un error se dice ahora y no recién al apretar «Confirmar».
 */

export async function proponerOrden(argumentos: Argumentos) {
  const nombreUnidad = textoArg(argumentos, 'unidad')
  let unidad: { id: string; nombre: string } | null = null
  if (nombreUnidad) {
    const u = await unidadPorNombre(nombreUnidad, 'proponer_orden')
    if ('error' in u) return u
    unidad = u.unidad
  }
  return preparada({
    tipo: 'orden_mantenimiento',
    titulo: textoArg(argumentos, 'titulo'),
    descripcion: textoArg(argumentos, 'descripcion'),
    prioridad: textoArg(argumentos, 'prioridad').toLowerCase(),
    unidadId: unidad?.id ?? null,
    unidadNombre: unidad?.nombre ?? null,
  })
}

/** Cargo en la cuenta: con la misma regla de «cuenta cerrada» que la ficha de la reserva. */
export async function proponerConsumo(argumentos: Argumentos) {
  const codigo = textoArg(argumentos, 'codigo_reserva').toUpperCase()
  const nombreProducto = textoArg(argumentos, 'producto')
  const cantidad = argumentos.cantidad === undefined ? 1 : Number(argumentos.cantidad)
  if (!codigo || !nombreProducto) return { error: 'Necesito el código de la reserva y el producto.' }

  const supabase = await crearClienteServidor()
  const { data: reserva, error: eReserva } = await supabase
    .from('reservas')
    .select(SELECTS_IA.reservaParaConsumo)
    .eq('codigo', codigo)
    .maybeSingle()
  if (eReserva) {
    registrarFalla(eReserva, 'ia:proponer_consumo')
    return { error: 'No se pudo leer la reserva.' }
  }
  if (!reserva) return { error: `No existe la reserva ${codigo}.` }
  const r = reserva as unknown as {
    id: string
    codigo: string
    estado: string
    facturas: { id: string } | { id: string }[] | null
  }
  // A-uno (una factura por reserva): objeto o `null`. Con `.length` sobre el
  // objeto nunca se detectaba la cuenta cerrada.
  const motivo = motivoNoCargable(r.estado, comoLista(r.facturas).length > 0)
  if (motivo) {
    return {
      error:
        motivo === 'cargo_ya_facturada'
          ? `La reserva ${codigo} ya está facturada: la cuenta está cerrada y no admite cargos.`
          : `La reserva ${codigo} está cancelada o fue no-show: no admite cargos.`,
    }
  }

  const termino = terminoBusqueda(nombreProducto) ?? ''
  const { data: productos, error: eProductos } = await supabase
    .from('productos_servicios')
    .select('id, nombre, precio')
    .eq('activo', true)
    .ilike('nombre', `%${termino}%`)
    .order('nombre')
    .limit(6)
  if (eProductos) {
    registrarFalla(eProductos, 'ia:proponer_consumo_producto')
    return { error: 'No se pudo leer el catálogo de productos.' }
  }
  const lista = (productos ?? []) as { id: string; nombre: string; precio: number | string }[]
  const producto =
    lista.find((p) => p.nombre.toLowerCase() === nombreProducto.toLowerCase()) ??
    (lista.length === 1 ? lista[0] : null)
  if (!producto) {
    return {
      error: `No encontré un único producto «${nombreProducto}» en el catálogo.`,
      parecidos: lista.map((p) => p.nombre),
      instruccion: 'Preguntale a la persona cuál es.',
    }
  }
  return preparada({
    tipo: 'consumo',
    reservaId: r.id,
    codigoReserva: r.codigo,
    productoId: producto.id,
    producto: producto.nombre,
    cantidad,
    precioUnitario: Number(producto.precio),
  })
}

export async function proponerEstadoLimpieza(argumentos: Argumentos) {
  const nombre = textoArg(argumentos, 'unidad')
  const estado = textoArg(argumentos, 'estado').toLowerCase()
  if (!nombre) return { error: 'Decime qué habitación o cabaña.' }
  const u = await unidadPorNombre(nombre, 'proponer_estado_limpieza')
  if ('error' in u) return u
  return preparada({ tipo: 'estado_unidad', unidadId: u.unidad.id, unidadNombre: u.unidad.nombre, estado })
}

/* ─────────────────────── propuestas sobre reservas y huéspedes ─────────── */

const ACCIONES_ESTADO: Record<string, EstadoReserva> = {
  confirmar: 'confirmada',
  check_in: 'in_house',
  checkin: 'in_house',
  check_out: 'checkout',
  checkout: 'checkout',
  no_show: 'no_show',
  cancelar: 'cancelada',
}

export async function proponerCambioEstado(argumentos: Argumentos) {
  const destino = ACCIONES_ESTADO[textoArg(argumentos, 'accion').toLowerCase().replace(/[\s-]/g, '_')]
  if (!destino) return { error: 'Acción no reconocida: confirmar, check_in, check_out, no_show o cancelar.' }
  const r = await reservaPorCodigo(argumentos.codigo_reserva)
  if ('error' in r) return r
  const reserva = r.reserva
  // La misma máquina de estados que la ficha: un salto que no corresponde se
  // dice ahora, no recién al confirmar.
  if (!puedeTransicionar(reserva.estado, destino)) {
    return {
      error: `La reserva está «${ETIQUETAS_ESTADO_RESERVA[reserva.estado] ?? reserva.estado}» y desde ahí no se puede pasar a «${ETIQUETAS_ESTADO_RESERVA[destino]}».`,
    }
  }
  let cargo = ''
  const estadia = reserva.estadias?.[0]
  if ((destino === 'cancelada' || destino === 'no_show') && estadia) {
    const p = parsearPeriodo(estadia.periodo)
    // El cargo sale del MISMO módulo que la ficha muestra antes de cancelar.
    const c = await cargoDeCancelacion(await crearClienteServidor(), {
      checkIn: p.desde,
      checkOut: p.hasta,
      total: Number(reserva.total),
      tipoUnidadId: estadia.tipo_unidad_id,
      tarifaTipo: reserva.tarifa_tipo,
      noches: diasEntre(p.desde, p.hasta),
      noShow: destino === 'no_show',
    })
    // Con la llegada ya pasada, «cancela con -2 días de anticipación» no se entiende.
    const cuando =
      c && c.dias < 0
        ? `la llegada ya pasó (hace ${-c.dias} día${c.dias === -1 ? '' : 's'})`
        : c
          ? `cancela con ${c.dias} día${c.dias === 1 ? '' : 's'} de anticipación`
          : ''
    cargo = !c
      ? 'No se pudo calcular el cargo: revisalo en la ficha antes de confirmar.'
      : c.monto <= 0
        ? `Sin cargo: ${cuando}.`
        : `Cargo según la política: ${formatearUSD(c.monto)} (${destino === 'no_show' ? 'no-show: 100 %' : cuando}).`
  }
  return preparada({ tipo: 'estado_reserva', reservaId: reserva.id, codigoReserva: reserva.codigo, estado: destino, cargo })
}

export async function proponerMudanza(argumentos: Argumentos) {
  const r = await reservaPorCodigo(argumentos.codigo_reserva)
  if ('error' in r) return r
  const estadia = r.reserva.estadias?.[0]
  if (!estadia) return { error: 'La reserva no tiene estadía.' }
  const p = parsearPeriodo(estadia.periodo)
  const nombre = textoArg(argumentos, 'unidad')
  // Las libres esas noches, con la misma función SQL que el alta de reservas.
  const libres = await unidadesDisponibles(p.desde, p.hasta)
  const buscado = nombre.toLowerCase()
  const destino =
    libres.find((u) => u.nombre.toLowerCase() === buscado) ??
    (libres.filter((u) => u.nombre.toLowerCase().includes(buscado)).length === 1
      ? libres.find((u) => u.nombre.toLowerCase().includes(buscado))
      : undefined)
  if (!destino) {
    return {
      error: `«${nombre}» no está libre del ${p.desde} al ${p.hasta}, o no la encontré.`,
      libres: libres.map((u) => u.nombre).slice(0, 20),
      instruccion: 'Ofrecele a la persona alguna de las libres.',
    }
  }
  const politica = textoArg(argumentos, 'politica').toLowerCase() === 'recotizar' ? 'recotizar' : 'mantener'
  return preparada({
    tipo: 'mudanza',
    reservaId: r.reserva.id,
    codigoReserva: r.reserva.codigo,
    unidadDestinoId: destino.id,
    unidadDestinoNombre: destino.nombre,
    politica,
  })
}

export async function proponerReprogramacion(argumentos: Argumentos) {
  const r = await reservaPorCodigo(argumentos.codigo_reserva)
  if ('error' in r) return r
  const politica = textoArg(argumentos, 'politica').toLowerCase() === 'mantener' ? 'mantener' : 'recotizar'
  return preparada({
    tipo: 'reprogramar',
    reservaId: r.reserva.id,
    codigoReserva: r.reserva.codigo,
    checkIn: textoArg(argumentos, 'desde'),
    checkOut: textoArg(argumentos, 'hasta'),
    politica,
  })
}

export async function proponerFactura(argumentos: Argumentos) {
  const r = await reservaPorCodigo(argumentos.codigo_reserva)
  if ('error' in r) return r
  if (comoLista(r.reserva.facturas).length > 0) return { error: `La reserva ${r.reserva.codigo} ya tiene factura.` }
  return preparada({ tipo: 'factura', reservaId: r.reserva.id, codigoReserva: r.reserva.codigo })
}

export async function proponerNotaCredito(argumentos: Argumentos) {
  const r = await reservaPorCodigo(argumentos.codigo_reserva)
  if ('error' in r) return r
  if (comoLista(r.reserva.facturas).length === 0) {
    return { error: `La reserva ${r.reserva.codigo} no tiene factura: no hay nada que acreditar.` }
  }
  return preparada({
    tipo: 'nota_credito',
    reservaId: r.reserva.id,
    codigoReserva: r.reserva.codigo,
    monto: Number(argumentos.monto),
    motivo: textoArg(argumentos, 'motivo'),
  })
}

export async function proponerReserva(argumentos: Argumentos) {
  const desde = textoArg(argumentos, 'desde')
  const hasta = textoArg(argumentos, 'hasta')
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta <= desde) {
    return { error: 'Necesito dos fechas AAAA-MM-DD, con la salida después de la llegada.' }
  }
  const t = await resolverTipo(textoArg(argumentos, 'tipo'))
  if ('error' in t) return { error: t.error }
  if (!('tipo' in t) || !t.tipo) {
    return { error: 'No encontré un único tipo con ese nombre.', tipos: t.candidatos, instruccion: 'Preguntá cuál.' }
  }
  const tipo = t.tipo
  const adultos = argumentos.adultos === undefined ? 2 : Math.trunc(Number(argumentos.adultos))
  const menores = argumentos.menores === undefined ? 0 : Math.trunc(Number(argumentos.menores))
  if (adultos + menores > tipo.capacidad_max) {
    return { error: `${tipo.nombre} admite hasta ${tipo.capacidad_max} personas.` }
  }
  const [disponibles, cotizacion] = await Promise.all([
    disponibilidadPorTipo(desde, hasta),
    cotizarEstadia({ tipoUnidadId: tipo.id, checkIn: desde, checkOut: hasta, tarifaTipo: 'rack' }),
  ])
  const libres = disponibles.find((d) => d.tipo_unidad_id === tipo.id)?.disponibles ?? 0
  if (libres <= 0) return { error: `No hay ${tipo.nombre} libre del ${desde} al ${hasta}.` }
  if (cotizacion.faltanTarifas) {
    return { error: 'Hay noches sin tarifa cargada para esas fechas: la reserva no se puede crear todavía.' }
  }
  return preparada({
    tipo: 'nueva_reserva',
    tipoUnidadId: tipo.id,
    tipoNombre: tipo.nombre,
    checkIn: desde,
    checkOut: hasta,
    adultos,
    menores,
    apellido: textoArg(argumentos, 'apellido'),
    nombre: textoArg(argumentos, 'nombre'),
    totalEstimado: cotizacion.resumen.total,
    email: '',
    docNumero: '',
  })
}

/** El id del huésped por nombre (debe ser uno solo) o por el código de una reserva suya. */
async function huespedParaEditar(argumentos: Argumentos) {
  if (argumentos.codigo_reserva) {
    const r = await reservaPorCodigo(argumentos.codigo_reserva)
    if ('error' in r) return r
    if (!r.reserva.huesped_id) return { error: 'Esa reserva no tiene huésped asignado.' }
    return { id: r.reserva.huesped_id, visible: `el huésped de ${r.reserva.codigo}` }
  }
  const crudo = textoArg(argumentos, 'nombre')
  const palabras = palabrasDeNombre(crudo)
  if (palabras.length === 0) return { error: 'Decime el nombre del huésped o el código de una reserva suya.' }
  const { ids, error } = await idsDeHuespedes(palabras, 3)
  if (error) {
    registrarFalla(error, 'ia:huesped_para_editar')
    return { error: 'No se pudo buscar al huésped.' }
  }
  if (ids.length === 0) return { error: `No encontré ningún huésped «${crudo}».` }
  if (ids.length > 1) {
    return { error: `Hay más de un huésped «${crudo}». Pedile a la persona el código de una reserva suya.` }
  }
  // El nombre visible es el que escribió la persona: no se lee de la ficha.
  return { id: ids[0], visible: crudo }
}

export async function proponerEditarHuesped(argumentos: Argumentos) {
  const h = await huespedParaEditar(argumentos)
  if ('error' in h) return h
  return preparada({
    tipo: 'huesped_editar',
    huespedId: h.id,
    nombreVisible: h.visible,
    email: '',
    telefono: '',
    docNumero: '',
    nacionalidad: '',
  })
}

export function proponerHuesped(argumentos: Argumentos) {
  return preparada({
    tipo: 'huesped_nuevo',
    apellido: textoArg(argumentos, 'apellido'),
    nombre: textoArg(argumentos, 'nombre'),
    email: '',
    telefono: '',
    docNumero: '',
    nacionalidad: '',
  })
}

export async function proponerMensajeHuesped(argumentos: Argumentos) {
  const r = await reservaPorCodigo(argumentos.codigo_reserva)
  if ('error' in r) return r
  return preparada({
    tipo: 'mensaje_huesped',
    reservaId: r.reserva.id,
    codigoReserva: r.reserva.codigo,
    mensaje: textoArg(argumentos, 'mensaje'),
  })
}

export function proponerAviso(argumentos: Argumentos) {
  return preparada({ tipo: 'aviso', mensaje: textoArg(argumentos, 'mensaje') })
}

export function proponerObjetoPerdido(argumentos: Argumentos) {
  return preparada({
    tipo: 'objeto_perdido',
    descripcion: textoArg(argumentos, 'descripcion'),
    ubicacion: textoArg(argumentos, 'ubicacion'),
  })
}

/* ─────────────────────────── mantenimiento y objetos: cerrar lo abierto ── */

/**
 * Una orden por su título (o parte de él), la única que coincide. Si hay
 * varias, la unidad desempata; si siguen siendo varias, el asistente pregunta.
 */
export async function proponerEstadoOrden(argumentos: Argumentos) {
  const estado = textoArg(argumentos, 'estado').toLowerCase().replace(/[\s-]/g, '_')
  const titulo = terminoBusqueda(textoArg(argumentos, 'orden'))
  if (!titulo) return { error: 'Decime qué orden (el título o una palabra de él).' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ordenes_mantenimiento')
    .select(SELECTS_IA.ordenesMantenimiento)
    .ilike('titulo', `%${titulo}%`)
    .order('creada_en', { ascending: false })
    .limit(10)
  if (error) return noSePudoLeer(error, 'proponer_estado_orden', 'las órdenes de mantenimiento')
  let filas = (data ?? []) as unknown as {
    id: string
    titulo: string
    estado: string
    unidad: { nombre: string } | null
  }[]
  // Sin reabrir no tiene sentido proponer sobre una ya resuelta: se prefieren las abiertas.
  if (estado !== 'pendiente') {
    const abiertas = filas.filter((o) => o.estado !== 'resuelta')
    if (abiertas.length > 0) filas = abiertas
  }
  const unidad = textoArg(argumentos, 'unidad').toLowerCase()
  if (filas.length > 1 && unidad) {
    filas = filas.filter((o) => o.unidad?.nombre.toLowerCase().includes(unidad))
  }
  if (filas.length === 0) return { error: `No encontré ninguna orden de mantenimiento «${titulo}».` }
  if (filas.length > 1) {
    return {
      error: 'Hay más de una orden con ese título.',
      ordenes: filas.map((o) => `${o.titulo} (${o.unidad?.nombre ?? 'edificio'}, ${o.estado})`),
      instruccion: 'Preguntale a la persona cuál es, o pedile la unidad.',
    }
  }
  const orden = filas[0]
  if (orden.estado === estado) return { error: `La orden «${orden.titulo}» ya está ${estado.replace('_', ' ')}.` }
  return preparada({ tipo: 'estado_orden', ordenId: orden.id, titulo: orden.titulo, estado })
}

export async function proponerObjetoDevuelto(argumentos: Argumentos) {
  const buscado = terminoBusqueda(textoArg(argumentos, 'objeto'))
  if (!buscado) return { error: 'Decime qué objeto (una palabra de la descripción).' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('objetos_perdidos')
    .select('id, descripcion')
    .eq('estado', 'guardado')
    .ilike('descripcion', `%${buscado}%`)
    .order('fecha_hallazgo', { ascending: false })
    .limit(6)
  if (error) return noSePudoLeer(error, 'proponer_objeto_devuelto', 'los objetos perdidos')
  const filas = (data ?? []) as { id: string; descripcion: string }[]
  if (filas.length === 0) return { error: `No hay ningún objeto guardado que diga «${buscado}».` }
  if (filas.length > 1) {
    return {
      error: 'Hay más de un objeto guardado que coincide.',
      objetos: filas.map((o) => enmascararDatosPersonales(o.descripcion)),
      instruccion: 'Preguntale a la persona cuál es.',
    }
  }
  return preparada({ tipo: 'objeto_devuelto', objetoId: filas[0].id, descripcion: filas[0].descripcion })
}
