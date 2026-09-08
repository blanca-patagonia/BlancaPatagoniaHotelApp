import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import { traerTodo, type ResultadoCompleto } from '@/lib/paginado'
import type { EstadiaMetrica } from '@/lib/domain/metricas'
import type { EstadiaDeTipo, TipoConInventario } from '@/lib/domain/metricas-categoria'
import type { EstadoReserva } from '@/lib/domain/reservas'

/**
 * Las lecturas que alimentan los informes.
 *
 * Están acá y no dentro de cada pantalla porque los informes se partieron en
 * pantallas propias (una por informe, para poder tener varias abiertas a la
 * vez) y varias necesitan los mismos datos. Con la consulta copiada en cada
 * una, dos informes terminarían contando la misma cosa de dos maneras.
 *
 * ⚠️ **Todo lo que lee una tabla entera pasa por `traerTodo`.** PostgREST corta
 * en 1000 filas con HTTP 200 y sin aviso (`max_rows`, `supabase/config.toml`),
 * así que una agregación hecha en JavaScript sobre una consulta pelada empieza
 * a dar números equivocados a partir de la fila 1001 y nada falla. `traerTodo`
 * recorre por tramos y, si aun así corta, lo **informa** en `truncado`: cada
 * pantalla muestra el aviso en vez de dar el número por bueno.
 *
 * La ganancia de haber partido las pantallas, además de la que pidió el hotel:
 * antes una sola página traía seis tablas completas aunque sólo se quisiera
 * mirar el NPS. Ahora cada informe pide lo suyo.
 */

/** Unidades activas: es el denominador de la ocupación. */
export async function traerUnidades(): Promise<ResultadoCompleto<{ id: string }>> {
  const supabase = await crearClienteServidor()
  return traerTodo<{ id: string }>((d, h) =>
    supabase.from('unidades').select('id').eq('activo', true).order('id').range(d, h),
  )
}

/**
 * Estadías que cuentan como venta.
 *
 * Se excluyen `cancelada` y `no_show` por omisión: no ocuparon la unidad y
 * sumarlas inflaría la ocupación con noches que nadie durmió.
 */
export async function traerEstadias(): Promise<ResultadoCompleto<EstadiaMetrica>> {
  const supabase = await crearClienteServidor()
  return traerTodo<EstadiaMetrica>((d, h) =>
    supabase
      .from('estadias')
      .select('periodo, precio_noche')
      .in('estado', ['pendiente', 'confirmada', 'pagada', 'in_house', 'checkout'])
      .order('id')
      .range(d, h),
  )
}

/** Lo mismo, con el tipo con el que se vendió cada estadía. */
export async function traerEstadiasPorTipo(): Promise<ResultadoCompleto<EstadiaDeTipo>> {
  const supabase = await crearClienteServidor()
  const res = await traerTodo<{
    periodo: string
    precio_noche: number | string | null
    tipo_unidad_id: string | null
  }>((d, h) =>
    supabase
      .from('estadias')
      .select('periodo, precio_noche, tipo_unidad_id')
      .in('estado', ['pendiente', 'confirmada', 'pagada', 'in_house', 'checkout'])
      .order('id')
      .range(d, h),
  )

  return {
    ...res,
    filas: res.filas.map((f) => ({
      periodo: f.periodo,
      precio_noche: f.precio_noche,
      tipoUnidadId: f.tipo_unidad_id,
    })),
  }
}

/**
 * Tipos de unidad con su inventario activo.
 *
 * El conteo de unidades se hace acá y no con un `count` de PostgREST porque son
 * un puñado de tipos y ya se está trayendo la lista: una consulta por tipo
 * sería el N+1 clásico.
 */
export async function traerTiposConInventario(): Promise<{
  filas: TipoConInventario[]
  truncado: boolean
}> {
  const supabase = await crearClienteServidor()

  const [tipos, unidades] = await Promise.all([
    traerTodo<{ id: string; codigo: string; nombre: string; categoria: string }>((d, h) =>
      supabase
        .from('tipos_unidad')
        .select('id, codigo, nombre, categoria')
        .eq('activo', true)
        .order('id')
        .range(d, h),
    ),
    traerTodo<{ tipo_unidad_id: string }>((d, h) =>
      supabase
        .from('unidades')
        .select('tipo_unidad_id')
        .eq('activo', true)
        .order('id')
        .range(d, h),
    ),
  ])

  const porTipo = new Map<string, number>()
  for (const u of unidades.filas) {
    porTipo.set(u.tipo_unidad_id, (porTipo.get(u.tipo_unidad_id) ?? 0) + 1)
  }

  return {
    filas: tipos.filas.map((t) => ({ ...t, unidades: porTipo.get(t.id) ?? 0 })),
    truncado: tipos.truncado || unidades.truncado,
  }
}

/** Reservas históricas, para el ranking por canal y la distribución por estado. */
export async function traerReservas(): Promise<
  ResultadoCompleto<{ canal: string; estado: EstadoReserva; total: number | string }>
> {
  const supabase = await crearClienteServidor()
  return traerTodo<{ canal: string; estado: EstadoReserva; total: number | string }>((d, h) =>
    supabase.from('reservas').select('canal, estado, total').order('id').range(d, h),
  )
}

/** Pagos aprobados. ⚠️ `pagos.monto` está SIEMPRE en USD (ADR 0027). */
export async function traerPagos(): Promise<ResultadoCompleto<{ tipo: string; monto: number }>> {
  const supabase = await crearClienteServidor()
  return traerTodo<{ tipo: string; monto: number }>((d, h) =>
    supabase.from('pagos').select('tipo, monto').eq('estado', 'aprobado').order('id').range(d, h),
  )
}

/** Comprobantes emitidos. */
export async function traerFacturas(): Promise<ResultadoCompleto<{ total: number }>> {
  const supabase = await crearClienteServidor()
  return traerTodo<{ total: number }>((d, h) =>
    supabase.from('facturas').select('total').order('id').range(d, h),
  )
}

/** Encuestas de satisfacción, respondidas y sin responder. */
export async function traerEncuestas(): Promise<
  ResultadoCompleto<{ puntaje: number | null; respondida_en: string | null }>
> {
  const supabase = await crearClienteServidor()
  return traerTodo<{ puntaje: number | null; respondida_en: string | null }>((d, h) =>
    supabase
      .from('encuestas_satisfaccion')
      .select('puntaje, respondida_en')
      .order('id')
      .range(d, h),
  )
}

export interface FilaResumenCanal {
  canal: string
  reservas_totales: number
  reservas_vendidas: number
  bruto: number | string
  noches: number
  comision_informada: number | string
  sin_comision_informada: number
}

/**
 * Rentabilidad por canal del mes, desde la vista `resumen_canal_mes` (0055).
 *
 * NO sale de las reservas cargadas en memoria por dos razones: esa agregación
 * depende del techo de 1000 filas, y la comisión vive en `canal_cargos`, que no
 * está en aquella consulta. La vista imputa por fecha de **salida**, que es
 * cuando se consume la estadía y el criterio con el que el canal factura.
 */
export async function traerRentabilidadCanal(mes: string): Promise<FilaResumenCanal[]> {
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('resumen_canal_mes')
    .select(
      'canal, reservas_totales, reservas_vendidas, bruto, noches, comision_informada, sin_comision_informada',
    )
    .eq('mes', `${mes}-01`)

  return (data ?? []) as unknown as FilaResumenCanal[]
}
