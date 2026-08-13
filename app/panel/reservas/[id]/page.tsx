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
  cambiarUnidadReserva,
} from '../actions'
import { motivoNoFacturable, MENSAJES_NO_FACTURABLE } from '@/lib/domain/facturacion'
import { puedeCambiarUnidad, MENSAJES_RECHAZO_MUDANZA } from '@/lib/domain/mudanzas'
import { unidadesDisponibles } from '@/lib/availability/disponibilidad'
import { BotonEnvio } from '../../_components/boton-envio'
import { TONO_ESTADO } from '../../_components/estilos'
import { Encabezado, Etiqueta, Mensaje, Pagina } from '../../_components/ui'
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

/**
 * Mensajes de error que puede devolver cualquier acción de esta pantalla.
 *
 * Antes era una cadena de ternarios anidados: cada error nuevo agregaba un
 * nivel de indentación y el último quedaba a diez niveles de profundidad. Como
 * mapa, sumar un caso es una línea.
 */
const MENSAJES_ERROR: Record<string, string> = {
  transicion: 'Esa transición de estado no es válida.',
  overlap: 'No se pudo reprogramar: la unidad ya está ocupada en esas fechas.',
  tarifa: 'No hay tarifa cargada para esas fechas.',
  fechas: 'Revisá las fechas de reprogramación.',
  sin_consumir: MENSAJES_NO_FACTURABLE.sin_consumir,
  anulada: MENSAJES_NO_FACTURABLE.anulada,
  ya_facturada: MENSAJES_NO_FACTURABLE.ya_facturada,
  cuit: 'Para emitir una factura A hace falta un CUIT válido del receptor. Cargalo en la ficha del huésped o de la agencia.',
  cae: 'El proveedor de facturación rechazó el comprobante. Revisá los importes.',
  // Escrituras que la base puede rechazar. Antes fallaban en silencio: la
  // pantalla recargaba igual y no había forma de saber que no se había guardado.
  estado: 'No se pudo guardar el estado nuevo. La reserva quedó como estaba.',
  agencia: 'La reserva se creó, pero no se pudo vincular con la agencia. Asignala desde la ficha: de eso dependen la tarifa y la cuenta corriente.',
  puntos: 'Se registró el check-out, pero no se pudieron acreditar los puntos de fidelidad. Cargalos a mano desde la ficha del huésped.',
  saldada: 'Se registró el pago, pero la reserva no quedó marcada como pagada. Revisá el estado antes de seguir.',
  consumo: 'No se pudo cargar el consumo. No se cobró ni se descontó del stock.',
  quitar_consumo: 'No se pudo quitar el consumo. Sigue cargado a la cuenta.',
  factura:
    'Se pidió el CAE y se consumió el número de comprobante, pero la factura NO quedó guardada. Avisá antes de volver a emitir: el número ya se usó.',
  total: 'El cambio se hizo, pero no se pudo recalcular el precio. La reserva quedó con el total anterior.',
  repro: 'No se pudo reprogramar la estadía.',
  // Cambio de unidad.
  ...MENSAJES_RECHAZO_MUDANZA,
  ocupada: 'Esa unidad ya está ocupada en las fechas de la reserva.',
  sin_destino: 'Elegí la unidad de destino.',
  sin_estadia: 'La reserva no tiene una estadía asociada.',
  destino_inexistente: 'La unidad de destino no existe.',
  destino_inactivo: 'La unidad de destino está dada de baja.',
  tarifa_destino:
    'La mudanza se hizo, pero no hay tarifa cargada para el tipo de destino: el total quedó sin recotizar.',
  mudanza: 'No se pudo cambiar la unidad.',
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
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirAcceso('reservas')
  const { id } = await params
  const { error: errorParam, ok: okParam } = await searchParams
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
  // Misma regla que usa la acción: la pantalla no puede ofrecer algo que
  // el servidor va a rechazar.
  const motivoFactura = motivoNoFacturable(reserva.estado, Boolean(factura))
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )

  // Unidades a las que se puede mudar la reserva. Solo se consulta si el estado
  // lo permite: para un check-out o una cancelación la lista no tendría sentido.
  // La unidad actual no aparece —está ocupada por esta misma reserva—, que es
  // justo lo que se quiere.
  const puedeMudarse = Boolean(periodo) && puedeCambiarUnidad(reserva.estado)
  const [libres, tiposData] = puedeMudarse && periodo
    ? await Promise.all([
        unidadesDisponibles(periodo.desde, periodo.hasta),
        supabase.from('tipos_unidad').select('id, nombre'),
      ])
    : [[], { data: [] }]
  const nombreTipo = new Map(
    ((tiposData.data ?? []) as { id: string; nombre: string }[]).map((t) => [t.id, t.nombre]),
  )

  return (
    <Pagina>
      <Link
        href="/panel/reservas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reservas
      </Link>

      <Encabezado
        titulo={reserva.codigo}
        descripcion={
          reserva.huesped
            ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}`
            : 'Sin huésped asociado'
        }
        icono="reservas"
        acciones={
          <Etiqueta tono={TONO_ESTADO[reserva.estado]}>
            {ETIQUETAS_ESTADO_RESERVA[reserva.estado]}
          </Etiqueta>
        }
      />

      {errorParam && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[errorParam] ?? 'No se pudo completar la operación.'}
        </Mensaje>
      )}

      {okParam === 'mudanza' && (
        <Mensaje tono="ok">
          Unidad cambiada. La habitación liberada quedó marcada para limpieza si el huésped ya
          estaba alojado.
        </Mensaje>
      )}

      {/*
        Dos columnas en escritorio, con TODO a la vista al mismo tiempo: nada de
        pestañas ni bloques plegados. A la izquierda la reserva y qué hacer con
        ella; a la derecha la plata. En el teléfono se apila en ese mismo orden.
      */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
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

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Acciones</h2>
        {transiciones.length === 0 ? (
          <p className="text-sm text-stone-400">La reserva está en un estado final.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {transiciones.map((t) => (
              <form key={t} action={cambiarEstadoReserva}>
                <input type="hidden" name="reserva_id" value={reserva.id} />
                <input type="hidden" name="nuevo_estado" value={t} />
                {/* `BotonEnvio` bloquea el botón mientras la acción viaja al
                    servidor: sin eso, un segundo clic impaciente repetía la
                    operación. Cancelar y no-show piden confirmación porque no
                    tienen vuelta atrás: son estados terminales. */}
                <BotonEnvio
                  variante="primario"
                  extra={`text-white ${ACCION_ESTADO[t].color}`}
                  cargando="Aplicando…"
                  confirmar={
                    t === 'cancelada'
                      ? `¿Cancelar la reserva ${reserva.codigo}?${cargo && cargo.monto > 0 ? ` Corresponde un cargo de USD ${cargo.monto.toLocaleString('es-AR')}.` : ''} No se puede deshacer.`
                      : t === 'no_show'
                        ? `¿Marcar ${reserva.codigo} como no-show? Se cobra la estadía completa y no se puede deshacer.`
                        : undefined
                  }
                >
                  {ACCION_ESTADO[t].verbo}
                </BotonEnvio>
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
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Reprogramar</h2>
          <form action={reprogramarReserva} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="reserva_id" value={reserva.id} />
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Nuevo check-in</span>
              <input type="date" name="check_in" defaultValue={periodo.desde} className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Nuevo check-out</span>
              <input type="date" name="check_out" defaultValue={periodo.hasta} className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
            </label>
            <BotonEnvio extra="w-full sm:w-auto" cargando="Reprogramando…">
              Reprogramar
            </BotonEnvio>
          </form>
          <p className="mt-2 text-xs text-stone-400">
            Recotiza el total; se rechaza si la unidad ya está ocupada en esas fechas.
          </p>
        </div>
      )}

      {puedeMudarse && (
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-stone-700">Cambiar de unidad</h2>
          <p className="mb-3 text-xs text-stone-400">
            Para averías, pedidos del huésped o para liberar la habitación. Solo se listan las
            unidades libres en {formatoFechaCorta(periodo!.desde)} – {formatoFechaCorta(periodo!.hasta)}.
          </p>

          {libres.length === 0 ? (
            <p className="text-sm text-stone-400">
              No hay otra unidad libre en esas fechas. Se puede liberar una reprogramando o
              cancelando otra reserva.
            </p>
          ) : (
            <form action={cambiarUnidadReserva} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Nueva unidad</span>
                <select
                  name="unidad_destino"
                  required
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Elegir…</option>
                  {libres.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} · {nombreTipo.get(u.tipo_unidad_id) ?? 'sin tipo'}
                      {u.estado === 'sucia' ? ' (sucia)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Motivo</span>
                <input
                  name="motivo"
                  placeholder="Calefactor roto"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Si cambia el tipo</span>
                <select
                  name="politica_tarifa"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                >
                  <option value="mantener">Mantener la tarifa pactada</option>
                  <option value="recotizar">Recotizar según el nuevo tipo</option>
                </select>
              </label>
              <BotonEnvio extra="w-full sm:w-auto" cargando="Mudando…">
                Mudar
              </BotonEnvio>
            </form>
          )}
          <p className="mt-2 text-xs text-stone-400">
            Dentro del mismo tipo el precio no cambia. La unidad que se libera queda sucia solo si
            el huésped ya había hecho el check-in.
          </p>
        </div>
      )}
        </div>

        {/* Columna de la cuenta: lo que se cobró y lo que se consumió. */}
        <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Pagos</h2>
        {/* Total / pagado / saldo son importes en USD: en tres columnas de
            110px se cortaban. En móvil van de a uno. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Medio</span>
              <select name="medio" className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm">
                {MEDIOS_MANUALES.map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETAS_MEDIO[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Tipo</span>
              <select
                name="tipo"
                defaultValue={resumen.tieneSenia ? 'saldo' : 'senia'}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              >
                {TIPOS_PAGO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_PAGO[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
              <span className="text-stone-500">Monto (USD)</span>
              <input
                name="monto"
                type="number"
                step="0.01"
                min="0"
                defaultValue={resumen.tieneSenia ? resumen.saldo : senia}
                className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-32"
              />
            </label>
            {/* El caso que más importa: sin bloqueo, un segundo clic
                registraba el pago dos veces. */}
            <BotonEnvio
              extra="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 sm:w-auto"
              cargando="Registrando…"
            >
              Registrar pago
            </BotonEnvio>
          </form>
        )}
        <p className="mt-3 text-xs text-stone-400">
          Seña sugerida (primera noche): USD {senia.toLocaleString('es-AR')}. Las pasarelas
          (MercadoPago / Stripe) ingresan por webhook.
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-stone-700">Consumos y cuenta</h2>
          {factura ? (
            <Link
              href={`/panel/reservas/${reserva.id}/factura`}
              className="text-sm font-medium text-lago-700 hover:underline"
            >
              Ver factura {factura.numero}
            </Link>
          ) : motivoFactura ? (
            /* El botón no se ofrece si no corresponde: es más claro explicar por
               qué que dejar apretar y devolver un error. */
            <span className="max-w-sm text-right text-xs text-stone-400">
              {MENSAJES_NO_FACTURABLE[motivoFactura]}
            </span>
          ) : (
            <form action={emitirFactura}>
              <input type="hidden" name="reserva_id" value={reserva.id} />
              <BotonEnvio
                cargando="Emitiendo…"
                confirmar={`¿Emitir la factura de ${reserva.codigo}? Una vez emitida no se puede anular desde el sistema.`}
              >
                Emitir factura
              </BotonEnvio>
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
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Producto / servicio</span>
            <select
              name="producto_id"
              required
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            >
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — USD {Number(p.precio).toLocaleString('es-AR')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
            <span className="text-stone-500">Cant.</span>
            <input
              name="cantidad"
              type="number"
              min="1"
              defaultValue={1}
              className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <BotonEnvio extra="w-full sm:w-auto" cargando="Cargando…">
            Cargar
          </BotonEnvio>
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
      </div>
    </Pagina>
  )
}
