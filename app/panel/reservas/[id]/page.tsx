import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  transicionesPosibles,
  ETIQUETAS_ESTADO_RESERVA,
  type EstadoReserva,
} from '@/lib/domain/reservas'
import {
  cargoPorCancelacion,
  montoCancelacion,
  type ReglaCancelacion,
} from '@/lib/domain/cancelacion'
import { parsearPeriodo, formatoFechaCorta, diasEntre, hoyISO } from '@/lib/fechas'
import { cambiarEstadoReserva, registrarPago } from '../actions'
import { BADGE_ESTADO } from '../../_components/estilos'
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

const MEDIOS_MANUALES: MedioPago[] = ['efectivo', 'transferencia', 'tarjeta']

interface PagoRow {
  id: string
  medio: MedioPago
  tipo: TipoPago
  monto: number | string
  estado: EstadoPago
  creado_en: string
}

const ACCION_ESTADO: Record<EstadoReserva, { verbo: string; color: string }> = {
  pendiente: { verbo: 'Marcar pendiente', color: 'bg-stone-600 hover:bg-stone-700' },
  confirmada: { verbo: 'Confirmar', color: 'bg-sky-700 hover:bg-sky-800' },
  pagada: { verbo: 'Marcar pagada', color: 'bg-emerald-600 hover:bg-emerald-700' },
  in_house: { verbo: 'Check-in', color: 'bg-amber-600 hover:bg-amber-700' },
  checkout: { verbo: 'Check-out', color: 'bg-stone-700 hover:bg-stone-800' },
  cancelada: { verbo: 'Cancelar', color: 'bg-red-600 hover:bg-red-700' },
  no_show: { verbo: 'No-show', color: 'bg-red-600 hover:bg-red-700' },
}

interface Reserva {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  canal: string
  tarifa_tipo: string
  notas: string
  huesped: { apellido: string; nombre: string; email: string | null; doc_numero: string } | null
  estadias: {
    periodo: string
    precio_noche: number | string
    huespedes: number
    unidad: { nombre: string; tipo: { nombre: string } | null } | null
  }[]
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-400">{etiqueta}</dt>
      <dd className="mt-0.5 text-stone-800">{valor}</dd>
    </div>
  )
}

export default async function DetalleReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  await requerirAcceso('reservas')
  const { id } = await params
  const { error: errorParam } = await searchParams
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('reservas')
    .select(
      'id, codigo, estado, total, canal, tarifa_tipo, notas, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, email, doc_numero), estadias(periodo, precio_noche, huespedes, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('id', id)
    .single()

  if (!data) notFound()
  const reserva = data as unknown as Reserva
  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const transiciones = transicionesPosibles(reserva.estado)

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
    const monto = montoCancelacion({
      cargo: tipoCargo,
      totalEstadia: Number(reserva.total),
      primeraNoche: Number(estadia.precio_noche),
    })
    cargo = { dias, monto }
  }

  const { data: pagosData } = await supabase
    .from('pagos')
    .select('id, medio, tipo, monto, estado, creado_en')
    .eq('reserva_id', id)
    .order('creado_en')
  const pagos = (pagosData ?? []) as PagoRow[]
  const resumen = resumenPagos(
    Number(reserva.total),
    pagos.map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado }) as Pago),
  )
  const senia = seniaSugerida(Number(reserva.total), noches)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/panel/reservas" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Reservas
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{reserva.codigo}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_ESTADO[reserva.estado]}`}>
          {ETIQUETAS_ESTADO_RESERVA[reserva.estado]}
        </span>
      </div>

      {errorParam === 'transicion' && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Esa transición de estado no es válida.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Huésped</h2>
          <dl className="flex flex-col gap-3">
            <Dato
              etiqueta="Nombre"
              valor={reserva.huesped ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}` : '—'}
            />
            <Dato etiqueta="Email" valor={reserva.huesped?.email || '—'} />
            <Dato etiqueta="Documento" valor={reserva.huesped?.doc_numero || '—'} />
          </dl>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
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
            <Dato etiqueta="Huéspedes" valor={String(estadia?.huespedes ?? '—')} />
            <Dato
              etiqueta="Canal / tarifa"
              valor={`${reserva.canal} · ${reserva.tarifa_tipo}`}
            />
            <Dato etiqueta="Total" valor={`USD ${Number(reserva.total).toLocaleString('es-AR')}`} />
          </dl>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Acciones</h2>
        {transiciones.length === 0 ? (
          <p className="text-sm text-stone-400">La reserva está en un estado final.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {transiciones.map((t) => (
              <form key={t} action={cambiarEstadoReserva}>
                <input type="hidden" name="reserva_id" value={reserva.id} />
                <input type="hidden" name="nuevo_estado" value={t} />
                <button
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition ${ACCION_ESTADO[t].color}`}
                >
                  {ACCION_ESTADO[t].verbo}
                </button>
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
              USD {cargo.monto.toLocaleString('es-AR')}
            </span>{' '}
            según la política estándar.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Pagos</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-stone-50 px-4 py-3">
            <p className="text-xs text-stone-400">Total</p>
            <p className="text-lg font-semibold text-stone-900">
              USD {Number(reserva.total).toLocaleString('es-AR')}
            </p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-4 py-3">
            <p className="text-xs text-emerald-600">Pagado</p>
            <p className="text-lg font-semibold text-emerald-700">
              USD {resumen.pagado.toLocaleString('es-AR')}
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-600">Saldo</p>
            <p className="text-lg font-semibold text-amber-700">
              USD {resumen.saldo.toLocaleString('es-AR')}
            </p>
          </div>
        </div>

        {pagos.length > 0 && (
          <ul className="mt-4 divide-y divide-stone-100 text-sm">
            {pagos.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span className="text-stone-600">
                  {ETIQUETAS_TIPO_PAGO[p.tipo]} · {ETIQUETAS_MEDIO[p.medio]}
                </span>
                <span
                  className={`font-medium ${p.tipo === 'reembolso' ? 'text-red-600' : 'text-stone-800'}`}
                >
                  {p.tipo === 'reembolso' ? '−' : ''}USD {Number(p.monto).toLocaleString('es-AR')}
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
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-stone-500">Medio</span>
              <select name="medio" className="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
                {MEDIOS_MANUALES.map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETAS_MEDIO[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-stone-500">Tipo</span>
              <select
                name="tipo"
                defaultValue={resumen.tieneSenia ? 'saldo' : 'senia'}
                className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              >
                {TIPOS_PAGO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_PAGO[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-stone-500">Monto (USD)</span>
              <input
                name="monto"
                type="number"
                step="0.01"
                min="0"
                defaultValue={resumen.tieneSenia ? resumen.saldo : senia}
                className="w-32 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700">
              Registrar pago
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-stone-400">
          Seña sugerida (primera noche): USD {senia.toLocaleString('es-AR')}. Las pasarelas
          (MercadoPago / Stripe) ingresan por webhook.
        </p>
      </div>
    </div>
  )
}
