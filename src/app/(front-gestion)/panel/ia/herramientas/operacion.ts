import 'server-only'
import { diasEntre, fechaDelHotel, hoyISO } from '@/lib/fechas'
import { enmascararDatosPersonales } from '@/lib/domain/ia-datos'
import { terminoBusqueda } from '@/lib/listados'
import { crearClienteServidor } from '@/lib/supabase/server'
import { SELECTS_IA, noSePudoLeer, textoArg, unidadPorNombre, type Argumentos } from './comun'

/**
 * Herramientas de la operación diaria: limpieza, mantenimiento, objetos
 * perdidos y la cartelera interna.
 *
 * Los textos libres que escribió el personal (la descripción de un objeto, un
 * aviso) pasan por `enmascararDatosPersonales` antes de volver al modelo:
 * alguien pudo anotar el teléfono del huésped que perdió la campera, y eso no
 * sale del sistema (ADR 0039).
 */

/** Tope de filas que vuelven al modelo: lo que viaja no crece sin techo. */
const TOPE = 25

/** Cuántas unidades hay en cada estado de limpieza y cuáles están sucias. */
export async function estadoLimpieza() {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('unidades')
    .select(SELECTS_IA.estadoUnidades)
    .eq('activo', true)
    .order('nombre')
  if (error) return noSePudoLeer(error, 'estado_limpieza', 'el estado de las unidades')
  const filas = (data ?? []) as { nombre: string; estado: string }[]
  const porEstado: Record<string, number> = {}
  for (const u of filas) porEstado[u.estado] = (porEstado[u.estado] ?? 0) + 1
  return {
    total: filas.length,
    porEstado,
    sucias: filas.filter((u) => u.estado === 'sucia').map((u) => u.nombre),
  }
}

const ORDEN_PRIORIDAD: Record<string, number> = { alta: 0, media: 1, baja: 2 }

/** Órdenes de mantenimiento: las abiertas primero por prioridad y antigüedad. */
export async function ordenesMantenimiento(argumentos: Argumentos) {
  const estado = textoArg(argumentos, 'estado').toLowerCase()
  const nombreUnidad = textoArg(argumentos, 'unidad')
  const supabase = await crearClienteServidor()

  let unidadId: string | null = null
  if (nombreUnidad) {
    const u = await unidadPorNombre(nombreUnidad, 'ordenes_mantenimiento')
    if ('error' in u) return u
    unidadId = u.unidad.id
  }

  let consulta = supabase
    .from('ordenes_mantenimiento')
    .select(SELECTS_IA.ordenesMantenimiento)
    .order('creada_en', { ascending: false })
    .limit(100)
  if (estado.startsWith('resuelt')) consulta = consulta.eq('estado', 'resuelta')
  else if (estado !== 'todas') consulta = consulta.in('estado', ['pendiente', 'en_proceso'])
  if (unidadId) consulta = consulta.eq('unidad_id', unidadId)

  const { data, error } = await consulta
  if (error) return noSePudoLeer(error, 'ordenes_mantenimiento', 'las órdenes de mantenimiento')
  const hoy = hoyISO()
  const filas = (
    (data ?? []) as unknown as {
      id: string
      titulo: string
      prioridad: string
      estado: string
      creada_en: string
      resuelta_en: string | null
      unidad: { nombre: string } | null
    }[]
  )
    .map((o) => {
      const abierta = fechaDelHotel(o.creada_en)
      return {
        titulo: enmascararDatosPersonales(o.titulo),
        prioridad: o.prioridad,
        estado: o.estado === 'en_proceso' ? 'en proceso' : o.estado,
        unidad: o.unidad?.nombre ?? 'edificio (sin unidad)',
        abierta,
        diasAbierta: o.resuelta_en ? null : diasEntre(abierta, hoy),
        resuelta: o.resuelta_en ? fechaDelHotel(o.resuelta_en) : null,
        enlace: `/panel/mantenimiento/${o.id}`,
      }
    })
    .sort(
      (a, b) =>
        (ORDEN_PRIORIDAD[a.prioridad] ?? 9) - (ORDEN_PRIORIDAD[b.prioridad] ?? 9) ||
        (b.diasAbierta ?? 0) - (a.diasAbierta ?? 0),
    )
  return {
    cantidad: filas.length,
    altas: filas.filter((o) => o.prioridad === 'alta').length,
    ordenes: filas.slice(0, TOPE),
    ...(filas.length > TOPE ? { aviso: `Hay ${filas.length}: se muestran las ${TOPE} más urgentes.` } : {}),
  }
}

/** Objetos perdidos, por omisión los que siguen guardados. */
export async function objetosPerdidos(argumentos: Argumentos) {
  const estado = textoArg(argumentos, 'estado').toLowerCase()
  const buscado = terminoBusqueda(textoArg(argumentos, 'buscar'))
  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('objetos_perdidos')
    .select(SELECTS_IA.objetosPerdidos)
    .order('fecha_hallazgo', { ascending: false })
    .limit(TOPE)
  if (estado.startsWith('devuelt')) consulta = consulta.eq('estado', 'devuelto')
  else if (estado !== 'todos') consulta = consulta.eq('estado', 'guardado')
  // `.ilike` viaja como parámetro; dentro de un `.or()` hace falta `patronOr`.
  if (buscado) consulta = consulta.ilike('descripcion', `%${buscado}%`)

  const { data, error } = await consulta
  if (error) return noSePudoLeer(error, 'objetos_perdidos', 'los objetos perdidos')
  const filas = (data ?? []) as unknown as {
    descripcion: string
    ubicacion: string
    fecha_hallazgo: string
    estado: string
    reserva: { codigo: string } | null
  }[]
  return {
    cantidad: filas.length,
    objetos: filas.map((o) => ({
      descripcion: enmascararDatosPersonales(o.descripcion),
      encontradoEn: enmascararDatosPersonales(o.ubicacion) || null,
      fecha: o.fecha_hallazgo,
      estado: o.estado,
      reserva: o.reserva?.codigo ?? null,
    })),
    enlace: '/panel/objetos-perdidos',
  }
}

/** La cartelera interna: los fijados primero y después los más recientes. */
export async function avisosInternos() {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('avisos')
    .select(SELECTS_IA.avisosInternos)
    .order('fijado', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(15)
  if (error) return noSePudoLeer(error, 'avisos_internos', 'la cartelera')
  const filas = (data ?? []) as { mensaje: string; fijado: boolean; creado_en: string }[]
  return {
    avisos: filas.map((a) => ({
      mensaje: enmascararDatosPersonales(a.mensaje).slice(0, 400),
      fijado: a.fijado,
      fecha: fechaDelHotel(a.creado_en),
    })),
    enlace: '/panel/avisos',
  }
}
