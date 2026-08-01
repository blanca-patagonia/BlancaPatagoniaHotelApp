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
import {
  cambiarEstadoReserva,
  registrarPago,
  agregarConsumo,
  quitarConsumo,
  emitirFactura,
  reprogramarReserva,
} from '../actions'
import { TONO_ESTADO } from '../../_components/estilos'
import { Etiqueta } from '../../_components/ui'
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

const MEDIOS_MANUALES: MedioPago[] = ['efectivo', 'transferencia', 'tarjeta']

interface PagoRow {
  id: string
  medio: MedioPago
  tipo: TipoPago
  monto: number | string
  estado: EstadoPago
  creado_en: string
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
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/panel/reservas" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Reservas
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-stone-900">
          {reserva.codigo}
        </h1>
        <Etiqueta tono={TONO_ESTADO[reserva.estado]}>
          {ETIQUETAS_ESTADO_RESERVA[reserva.estado]}
        </Etiqueta>
      </div>

      {errorParam && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorParam === 'transicion'
            ? 'Esa transición de estado no es válida.'
            : errorParam === 'overlap'
              ? 'No se pudo reprogramar: la unidad ya está ocupada en esas fechas.'
              : errorParam === 'tarifa'
                ? 'No hay tarifa cargada para esas fechas.'
                : errorParam === 'fechas'
                  ? 'Revisá las fechas de reprogramación.'
                  : 'No se pudo completar la operación.'}
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

      {periodo && !['cancelada', 'no_show', 'checkout'].includes(reserva.estado) && (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Reprogramar</h2>
          <form action={reprogramarReserva} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="reserva_id" value={reserva.id} />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-stone-500">Nuevo check-in</span>
              <input type="date" name="check_in" defaultValue={periodo.desde} className="rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-stone-500">Nuevo check-out</span>
              <input type="date" name="check_out" defaultValue={periodo.hasta} className="rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
            </label>
            <button className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-900">
              Reprogramar
            </button>
          </form>
          <p className="mt-2 text-xs text-stone-400">
            Recotiza el total; se rechaza si la unidad ya está ocupada en esas fechas.
          </p>
        </div>
      )}

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
          <div className="rounded-lg bg-lenga-50 px-4 py-3">
            <p className="text-xs text-lenga-600">Saldo</p>
            <p className="text-lg font-semibold text-lenga-700">
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

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-stone-700">Consumos y cuenta</h2>
          {factura ? (
            <Link
              href={`/panel/reservas/${reserva.id}/factura`}
              className="text-sm font-medium text-lago-700 hover:underline"
            >
              Ver factura {factura.numero}
            </Link>
          ) : (
            <form action={emitirFactura}>
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-stone-900">
                Emitir factura
              </button>
            </form>
          )}
        </div>

        {consumos.length > 0 && (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {consumos.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="text-stone-600">
                  {c.cantidad}× {c.producto?.nombre}
                  <span className="ml-2 text-xs text-stone-400">
                    {c.producto ? ETIQUETAS_CATEGORIA_PRODUCTO[c.producto.categoria] : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-stone-800">
                    USD {(c.cantidad * Number(c.precio_unitario)).toLocaleString('es-AR')}
                  </span>
                  <form action={quitarConsumo}>
                    <input type="hidden" name="reserva_id" value={reserva.id} />
                    <input type="hidden" name="consumo_id" value={c.id} />
                    <button className="text-xs text-stone-400 transition hover:text-red-600" title="Quitar">
                      ✕
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form action={agregarConsumo} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="reserva_id" value={reserva.id} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Producto / servicio</span>
            <select
              name="producto_id"
              required
              className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — USD {Number(p.precio).toLocaleString('es-AR')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Cant.</span>
            <input
              name="cantidad"
              type="number"
              min="1"
              defaultValue={1}
              className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800">
            Cargar
          </button>
        </form>

        <dl className="mt-4 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Alojamiento</dt>
            <dd className="text-stone-700">USD {cuenta.alojamiento.toLocaleString('es-AR')}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Consumos</dt>
            <dd className="text-stone-700">USD {cuenta.consumos.toLocaleString('es-AR')}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-stone-100 pt-1 font-semibold text-stone-900">
            <dt>Total cuenta</dt>
            <dd>USD {cuenta.total.toLocaleString('es-AR')}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
