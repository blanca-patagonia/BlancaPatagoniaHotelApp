import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saldoVencido } from '@/lib/domain/vistas-reservas'
import { resumenDeCuenta, type EstadoPago, type TipoPago } from '@/lib/domain/pagos'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { ordenarDeudores, type Deudor } from '@/lib/domain/caja'

/**
 * Reservas con saldo vencido: las que el tablero de Inicio anuncia en «Requiere
 * atención» y las que muestra la vista «Saldo pendiente» del listado.
 *
 * Las dos pantallas usan ESTA función, a propósito. El tablero tenía su propia
 * cuenta y el aviso enlazaba al listado sin filtro: decía «7 reservas con saldo
 * pendiente» y mostraba todas (lo marcó el docente al probar la demo). Con una
 * sola fuente, el número del aviso y las filas del listado no pueden diferir.
 *
 * El saldo se calcula en la aplicación (`saldoVencido`, dominio): PostgREST no
 * puede filtrar por una cuenta. Por eso se resuelven los ids y el listado filtra
 * por ellos. Las candidatas se acotan en la base —confirmadas con el check-in ya
 * pasado e in_house con el check-out hoy o antes—, así que viajan pocas filas y
 * no se roza el corte de 1000 de PostgREST: son, por definición, anomalías.
 *
 * Los ids salen ordenados como el listado (lo último cargado primero). Los
 * `deudores` —la misma lista, con huésped y saldo, de mayor a menor— son los
 * que el tablero muestra en «Quién debe».
 */
export async function reservasConSaldoVencido(
  supabase: SupabaseClient,
  hoy: string,
): Promise<{ ids: string[]; deudores: Deudor[]; error: { message: string } | null }> {
  const SELECT =
    'id, codigo, estado, total, creada_en, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), pagos(tipo, monto, estado), consumos(cantidad, precio_unitario), estadias!inner(check_in, check_out)'
  const [confirmadas, alojadas] = await Promise.all([
    supabase.from('reservas').select(SELECT).eq('estado', 'confirmada').lte('estadias.check_in', hoy),
    supabase.from('reservas').select(SELECT).eq('estado', 'in_house').lte('estadias.check_out', hoy),
  ])
  const error = confirmadas.error ?? alojadas.error
  if (error) return { ids: [], deudores: [], error }

  const filas = [...(confirmadas.data ?? []), ...(alojadas.data ?? [])] as unknown as {
    id: string
    codigo: string
    huesped: { apellido: string; nombre: string } | null
    estado: string
    total: number | string
    creada_en: string
    pagos: { tipo: TipoPago; monto: number | string; estado: EstadoPago }[]
    consumos: { cantidad: number; precio_unitario: number | string }[]
    estadias: { check_in: string; check_out: string }[]
  }[]

  const cuenta = (r: (typeof filas)[number]) => ({
    estado: r.estado,
    total: Number(r.total),
    pagos: r.pagos.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
    consumos: r.consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) })),
    estadias: r.estadias,
  })
  const vencidas = filas
    .filter((r) => saldoVencido(cuenta(r), hoy))
    .sort((a, b) => (a.creada_en < b.creada_en ? 1 : a.creada_en > b.creada_en ? -1 : 0))

  const deudores = ordenarDeudores(
    vencidas.map((r) => {
      const c = cuenta(r)
      return {
        id: r.id,
        codigo: r.codigo,
        huesped: r.huesped ? nombreCompleto(r.huesped) : 'Sin huésped',
        saldo: resumenDeCuenta(c.total, c.consumos, c.pagos).saldo,
      }
    }),
  )
  return { ids: vencidas.map((r) => r.id), deudores, error: null }
}
