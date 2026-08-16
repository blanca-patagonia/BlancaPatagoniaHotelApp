import { obtenerSesion } from '@/lib/auth/session'
import { puedeAcceder, type Area } from '@/lib/domain/permisos'
import { crearClienteServidor } from '@/lib/supabase/server'
import { aCsv, respuestaCsv, type Columna } from '@/lib/csv'
import { traerTodo } from '@/lib/paginado'
import { parsearPeriodo, mesActual, hoyISO } from '@/lib/fechas'
import {
  metricasDeMes,
  ultimosMeses,
  type EstadiaMetrica,
  type MetricasMes,
} from '@/lib/domain/metricas'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { resumenPagos, type EstadoPago, type TipoPago } from '@/lib/domain/pagos'
import { esVista, type VistaReservas } from '@/lib/domain/vistas-reservas'
import {
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  type Garantia,
  type Plan,
  type Segmento,
} from '@/lib/domain/reservas'
import { consultaReservas, filtroTermino } from '../../reservas/consulta'

/**
 * Punto único de exportación a CSV del panel.
 *
 * Concentrar todas las descargas en un solo handler permite auditar en un
 * único lugar que cada recurso exige el permiso del área correspondiente: una
 * mucama no puede bajarse la base de huéspedes cambiando la URL a mano.
 */

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>

/**
 * Tope de filas por archivo, para no tumbar el servidor con una descarga.
 *
 * ⚠️ `.limit(MAX_FILAS)` **no alcanzaba** para traer esta cantidad: PostgREST
 * aplica su propio techo (`max_rows = 1000` en supabase/config.toml) y recorta
 * la respuesta sin error y sin aviso. Todas las exportaciones venían saliendo
 * con mil filas, y quien descargaba el archivo no tenía cómo notarlo.
 *
 * Por eso las consultas van por `traerTodo`, que pagina en tramos de mil hasta
 * completar, y avisa si igual quedó truncado.
 */
const MAX_FILAS = 5000

interface Definicion {
  area: Area
  archivo: string
  generar: (supabase: Cliente, params: URLSearchParams) => Promise<string>
}

/** Construye un generador simple: una consulta y sus columnas. */
function simple<T>(
  tabla: string,
  select: string,
  orden: string,
  columnas: Columna<T>[],
): (supabase: Cliente, params: URLSearchParams) => Promise<string> {
  return async (supabase) => {
    const { filas, truncado } = await traerTodo<T>(
      (desde, hasta) =>
        supabase.from(tabla).select(select).order(orden).range(desde, hasta) as never,
      MAX_FILAS,
    )
    if (truncado) {
      console.warn(`[exportar] «${tabla}» superó ${MAX_FILAS} filas: el CSV sale incompleto.`)
    }
    return aCsv(filas, columnas)
  }
}

const SI_NO = (v: boolean) => (v ? 'Sí' : 'No')

interface FilaReserva {
  codigo: string
  estado: EstadoReserva
  total: number | string
  canal: string
  creada_en: string
  huesped: { apellido: string; nombre: string; email: string | null } | null
  estadias: { periodo: string }[]
  /** Para el saldo. Llega del `SELECT_RESERVAS` compartido con la pantalla. */
  pagos: { tipo: TipoPago; monto: number | string; estado: EstadoPago }[]
  /* Desglose comercial y fiscal (paso 6). */
  plan: string
  garantia: string
  segmento: string
  total_neto: number | string
  iva: number | string
}

/** Saldo de una fila, con el mismo cálculo que usa la pantalla. */
function saldoDe(r: FilaReserva) {
  return resumenPagos(
    Number(r.total),
    (r.pagos ?? []).map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
  )
}

const RECURSOS: Record<string, Definicion> = {
  reservas: {
    area: 'reservas',
    archivo: 'reservas',
    generar: async (supabase, params) => {
      const q = params.get('q') ?? undefined
      const orTermino = await filtroTermino(supabase, q)
      const consulta = consultaReservas(
        supabase,
        {
          q,
          estado: params.get('estado') ?? undefined,
          canal: params.get('canal') ?? undefined,
          desde: params.get('desde') ?? undefined,
          hasta: params.get('hasta') ?? undefined,
          grupo: params.get('grupo') ?? undefined,
          // La vista tiene que viajar o el CSV bajaría todas las reservas
          // mientras la pantalla muestra sólo las llegadas de hoy. El botón de
          // exportar ya conserva los filtros vigentes en la URL.
          vista: esVista(params.get('vista') ?? undefined)
            ? (params.get('vista') as VistaReservas)
            : undefined,
          plan: params.get('plan') ?? undefined,
          garantia: params.get('garantia') ?? undefined,
          segmento: params.get('segmento') ?? undefined,
          hoy: hoyISO(),
        },
        orTermino,
      )
      const { filas: crudas, truncado } = await traerTodo<FilaReserva>(
        (desde, hasta) => consulta.range(desde, hasta) as never,
        MAX_FILAS,
      )
      if (truncado) {
        console.warn(`[exportar] «reservas» superó ${MAX_FILAS} filas: el CSV sale incompleto.`)
      }
      const filas = crudas

      return aCsv<FilaReserva>(filas, [
        { titulo: 'Código', valor: (r) => r.codigo },
        {
          titulo: 'Huésped',
          valor: (r) => (r.huesped ? `${r.huesped.apellido}, ${r.huesped.nombre}` : ''),
        },
        { titulo: 'Email', valor: (r) => r.huesped?.email ?? '' },
        {
          titulo: 'Check-in',
          valor: (r) => (r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo).desde : ''),
        },
        {
          titulo: 'Check-out',
          valor: (r) => (r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo).hasta : ''),
        },
        { titulo: 'Canal', valor: (r) => r.canal },
        { titulo: 'Estado', valor: (r) => ETIQUETAS_ESTADO_RESERVA[r.estado] ?? r.estado },
        { titulo: 'Plan', valor: (r) => ETIQUETAS_PLAN[r.plan as Plan] ?? r.plan ?? '' },
        {
          titulo: 'Garantía',
          valor: (r) => ETIQUETAS_GARANTIA[r.garantia as Garantia] ?? r.garantia ?? '',
        },
        {
          titulo: 'Segmento',
          valor: (r) => ETIQUETAS_SEGMENTO[r.segmento as Segmento] ?? r.segmento ?? '',
        },
        // Neto e IVA discriminados: es lo que administración necesita para
        // conciliar, y antes del paso 6 no se podía sacar del total.
        { titulo: 'Neto sin IVA USD', valor: (r) => Number(r.total_neto ?? 0).toFixed(2) },
        { titulo: 'IVA USD', valor: (r) => Number(r.iva ?? 0).toFixed(2) },
        { titulo: 'Total con IVA USD', valor: (r) => Number(r.total).toFixed(2) },
        // Pagado y saldo salen de `resumenPagos`, el mismo cálculo que muestra la
        // pantalla: el CSV y el listado no pueden decir cosas distintas.
        {
          titulo: 'Pagado USD',
          valor: (r) => saldoDe(r).pagado.toFixed(2),
        },
        {
          titulo: 'Saldo USD',
          valor: (r) => saldoDe(r).saldo.toFixed(2),
        },
        { titulo: 'Creada', valor: (r) => r.creada_en?.slice(0, 10) ?? '' },
      ])
    },
  },

  reportes: {
    area: 'reportes',
    archivo: 'metricas-mensuales',
    generar: async (supabase, params) => {
      const mes = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : mesActual()
      const [{ data: unidades }, { data: estadias }] = await Promise.all([
        supabase.from('unidades').select('id').eq('activo', true),
        supabase
          .from('estadias')
          .select('periodo, precio_noche')
          .in('estado', ['pendiente', 'confirmada', 'pagada', 'in_house', 'checkout']),
      ])

      // Un año móvil terminando en el mes consultado.
      const serie = ultimosMeses(mes, 12).map((m) =>
        metricasDeMes((estadias ?? []) as unknown as EstadiaMetrica[], m, unidades?.length ?? 0),
      )

      return aCsv<MetricasMes>(serie, [
        { titulo: 'Mes', valor: (m) => m.mes },
        { titulo: 'Noches vendidas', valor: (m) => m.nochesVendidas },
        { titulo: 'Noches disponibles', valor: (m) => m.nochesDisponibles },
        { titulo: 'Ocupación %', valor: (m) => m.ocupacionPct },
        { titulo: 'Ingreso alojamiento USD', valor: (m) => m.ingreso.toFixed(2) },
        { titulo: 'ADR USD', valor: (m) => m.adr },
        { titulo: 'RevPAR USD', valor: (m) => m.revpar },
      ])
    },
  },

  huespedes: {
    area: 'huespedes',
    archivo: 'huespedes',
    generar: simple<{
      apellido: string
      nombre: string
      doc_tipo: string | null
      doc_numero: string
      email: string | null
      telefono: string | null
      nacionalidad: string | null
      puntos: number | null
    }>(
      'huespedes',
      'apellido, nombre, doc_tipo, doc_numero, email, telefono, nacionalidad, puntos',
      'apellido',
      [
        { titulo: 'Apellido', valor: (h) => h.apellido },
        { titulo: 'Nombre', valor: (h) => h.nombre },
        { titulo: 'Tipo doc.', valor: (h) => h.doc_tipo ?? '' },
        { titulo: 'Documento', valor: (h) => h.doc_numero },
        { titulo: 'Email', valor: (h) => h.email ?? '' },
        { titulo: 'Teléfono', valor: (h) => h.telefono ?? '' },
        { titulo: 'Nacionalidad', valor: (h) => h.nacionalidad ?? '' },
        { titulo: 'Puntos', valor: (h) => h.puntos ?? 0 },
      ],
    ),
  },

  agencias: {
    area: 'agencias',
    archivo: 'agencias',
    generar: simple<{
      nombre: string
      tipo: string
      cuit: string | null
      email: string | null
      descuento_pct: number
      activo: boolean
    }>('agencias', 'nombre, tipo, cuit, email, descuento_pct, activo', 'nombre', [
      { titulo: 'Nombre', valor: (a) => a.nombre },
      { titulo: 'Tipo', valor: (a) => a.tipo },
      { titulo: 'CUIT', valor: (a) => a.cuit ?? '' },
      { titulo: 'Email', valor: (a) => a.email ?? '' },
      { titulo: 'Descuento %', valor: (a) => a.descuento_pct },
      { titulo: 'Activa', valor: (a) => SI_NO(a.activo) },
    ]),
  },

  proveedores: {
    area: 'proveedores',
    archivo: 'proveedores',
    generar: simple<{
      nombre: string
      rubro: string | null
      cuit: string | null
      email: string | null
      telefono: string | null
      activo: boolean
    }>('proveedores', 'nombre, rubro, cuit, email, telefono, activo', 'nombre', [
      { titulo: 'Nombre', valor: (p) => p.nombre },
      { titulo: 'Rubro', valor: (p) => p.rubro ?? '' },
      { titulo: 'CUIT', valor: (p) => p.cuit ?? '' },
      { titulo: 'Email', valor: (p) => p.email ?? '' },
      { titulo: 'Teléfono', valor: (p) => p.telefono ?? '' },
      { titulo: 'Activo', valor: (p) => SI_NO(p.activo) },
    ]),
  },

  mantenimiento: {
    area: 'mantenimiento',
    archivo: 'ordenes-mantenimiento',
    generar: simple<{
      titulo: string
      descripcion: string | null
      prioridad: string
      estado: string
      creada_en: string
      unidad: { nombre: string } | null
    }>(
      'ordenes_mantenimiento',
      'titulo, descripcion, prioridad, estado, creada_en, unidad:unidades(nombre)',
      'creada_en',
      [
        { titulo: 'Unidad', valor: (o) => o.unidad?.nombre ?? '' },
        { titulo: 'Título', valor: (o) => o.titulo },
        { titulo: 'Descripción', valor: (o) => o.descripcion ?? '' },
        { titulo: 'Prioridad', valor: (o) => o.prioridad },
        { titulo: 'Estado', valor: (o) => o.estado },
        { titulo: 'Creada', valor: (o) => o.creada_en?.slice(0, 10) ?? '' },
      ],
    ),
  },

  'objetos-perdidos': {
    area: 'objetos_perdidos',
    archivo: 'objetos-perdidos',
    generar: simple<{
      descripcion: string
      ubicacion: string | null
      fecha_hallazgo: string
      estado: string
    }>('objetos_perdidos', 'descripcion, ubicacion, fecha_hallazgo, estado', 'fecha_hallazgo', [
      { titulo: 'Descripción', valor: (o) => o.descripcion },
      { titulo: 'Ubicación', valor: (o) => o.ubicacion ?? '' },
      { titulo: 'Hallazgo', valor: (o) => o.fecha_hallazgo },
      { titulo: 'Estado', valor: (o) => o.estado },
    ]),
  },
}

export async function GET(
  peticion: Request,
  { params }: { params: Promise<{ recurso: string }> },
) {
  const { recurso } = await params
  const definicion = RECURSOS[recurso]
  if (!definicion) return new Response('Recurso desconocido', { status: 404 })

  const sesion = await obtenerSesion()
  if (!sesion) return new Response('Sesión requerida', { status: 401 })
  if (!puedeAcceder(sesion.rol, definicion.area)) {
    return new Response('Sin permiso sobre esta sección', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const params_url = new URL(peticion.url).searchParams
  const contenido = await definicion.generar(supabase, params_url)

  const fecha = new Date().toISOString().slice(0, 10)
  return respuestaCsv(contenido, `${definicion.archivo}-${fecha}.csv`)
}
