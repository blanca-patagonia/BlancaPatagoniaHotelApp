import Link from 'next/link'
import { crearClienteServidor } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/paginado'
import { registrarFalla } from '@/lib/acciones'
import { inicioDelDiaHotel, inicioFinDeMes, sumarDias, formatoFechaCorta } from '@/lib/fechas'
import {
  cajaEnPeriodo,
  cajaPorDia,
  diasDelMesHasta,
  mismoTramoDelMesAnterior,
  type Deudor,
  type MovimientoCaja,
} from '@/lib/domain/caja'
import { facturadoEnPeriodo } from '@/lib/domain/metricas-facturacion'
import { etiquetaMes, mesRelativo, ultimosMeses, variacionPct } from '@/lib/domain/metricas'
import { formatearUSD } from '@/lib/domain/moneda'
import { Variacion } from '../reportes/_componentes'
import { Icono } from '../_components/iconos'
import { Mensaje, Tarjeta } from '../_components/ui'

/** Meses del gráfico mensual. */
const MESES = 6
/** Deudores que se listan en el tablero; el resto, en la vista del listado. */
const DEUDORES_VISIBLES = 5

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>

/**
 * Pagos aprobados desde el primer día del gráfico mensual. Una sola lectura
 * alimenta las tarjetas y los dos gráficos, así no pueden contar distinto.
 * Pasa por `traerTodo`: PostgREST corta en 1000 filas sin avisar.
 */
function leerPagos(supabase: Cliente, desde: string) {
  return traerTodo<MovimientoCaja>((d, h) =>
    supabase
      .from('pagos')
      .select('tipo, monto, estado, creado_en')
      .eq('estado', 'aprobado')
      .gte('creado_en', inicioDelDiaHotel(desde))
      .order('id')
      .range(d, h),
  )
}

/**
 * Facturas y notas de crédito (en negativo) desde `desde`. Es la misma regla
 * que el informe de facturación y el libro de ventas: lo facturado es neto de
 * las notas de crédito.
 */
async function leerComprobantes(supabase: Cliente, desde: string) {
  const leer = (tabla: 'facturas' | 'notas_credito') =>
    traerTodo<{ total: number | string; emitida_en: string }>((d, h) =>
      supabase
        .from(tabla)
        .select('total, emitida_en')
        .gte('emitida_en', inicioDelDiaHotel(desde))
        .order('id')
        .range(d, h),
    )
  const [f, n] = await Promise.all([leer('facturas'), leer('notas_credito')])
  return {
    filas: [
      ...f.filas.map((x) => ({ total: Number(x.total), emitida_en: x.emitida_en })),
      ...n.filas.map((x) => ({ total: -Number(x.total), emitida_en: x.emitida_en })),
    ],
    truncado: f.truncado || n.truncado,
    error: f.error ?? n.error,
  }
}

/** Una cifra grande con su rótulo, para la franja de la caja. */
function Cifra({
  titulo,
  valor,
  children,
  href,
}: {
  titulo: string
  valor: string
  children?: React.ReactNode
  href?: string
}) {
  const contenido = (
    <>
      <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">{titulo}</p>
      <p className="tabular mt-2 font-display text-2xl leading-none font-semibold text-stone-900 sm:text-3xl">
        {valor}
      </p>
      <div className="mt-1.5 text-xs text-stone-600">{children}</div>
    </>
  )
  const clases = 'min-w-0 rounded-xl bg-stone-50 p-4 ring-1 ring-stone-100'
  return href ? (
    <Link href={href} className={`${clases} block transition hover:bg-lago-50 hover:ring-lago-200`}>
      {contenido}
    </Link>
  ) : (
    <div className={clases}>{contenido}</div>
  )
}

/**
 * Gráfico de barras hecho con CSS, como los de Reportes (no hay librería de
 * gráficos en el proyecto y no hace falta una). La barra resaltada es la de hoy
 * o la del mes en curso. Cada barra tiene su importe en el `title` y la serie
 * entera va en una lista para lectores de pantalla.
 */
function Barras({
  serie,
  resaltada,
  alto = 'h-28',
  etiquetaCada = 1,
  resumen,
}: {
  serie: { clave: string; etiqueta: string; valor: number }[]
  resaltada: string
  alto?: string
  /** Muestra la etiqueta del eje cada N barras (el mes tiene hasta 31 días). */
  etiquetaCada?: number
  resumen: string
}) {
  const techo = Math.max(1, ...serie.map((s) => s.valor))
  return (
    <figure>
      <div className={`flex items-end gap-[3px] ${alto}`} aria-hidden="true">
        {serie.map((s) => (
          <div
            key={s.clave}
            title={`${s.etiqueta}: ${formatearUSD(s.valor)}`}
            className={`min-w-0 flex-1 rounded-t ${
              s.clave === resaltada ? 'bg-lenga-500' : s.valor > 0 ? 'bg-lago-500' : 'bg-stone-200'
            }`}
            style={{ height: `${s.valor > 0 ? Math.max(4, (s.valor / techo) * 100) : 2}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]" aria-hidden="true">
        {serie.map((s, i) => (
          <span
            key={s.clave}
            className={`min-w-0 flex-1 text-center text-[10px] ${
              s.clave === resaltada ? 'font-semibold text-lenga-800' : 'text-stone-500'
            }`}
          >
            {i % etiquetaCada === 0 || s.clave === resaltada ? s.etiqueta : ''}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        {resumen}
        <ul>
          {serie.map((s) => (
            <li key={s.clave}>
              {s.etiqueta}: {formatearUSD(s.valor)}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

/**
 * La plata del hotel, en el Inicio de la dirección (admin y gerencia).
 *
 * Lo pidió el docente al probar la demo: quien toma decisiones abre el sistema
 * y lo primero que quiere ver es cuánto entró hoy y en el mes, cuánto se
 * facturó, quién debe, y cómo viene la caja día por día y mes a mes. Todo sale
 * de las mismas reglas que los informes (`cajaEnPeriodo`, `facturadoEnPeriodo`)
 * y el saldo vencido, de la misma función que el aviso y la vista del listado.
 *
 * Va en un `Suspense` aparte en el tablero: lee seis meses de pagos y no tiene
 * por qué demorar las llegadas y salidas del día, que es lo que recepción mira.
 */
export async function CajaDelHotel({
  hoy,
  deudores,
  errorDeudores,
}: {
  hoy: string
  deudores: Deudor[]
  errorDeudores: boolean
}) {
  const supabase = await crearClienteServidor()
  const mes = hoy.slice(0, 7)
  const meses = ultimosMeses(mes, MESES)
  const desde = inicioFinDeMes(meses[0]).inicio
  const desdeComprobantes = inicioFinDeMes(mesRelativo(mes, -1)).inicio

  const [pagos, comprobantes] = await Promise.all([
    leerPagos(supabase, desde),
    leerComprobantes(supabase, desdeComprobantes),
  ])
  if (pagos.error) registrarFalla({ message: pagos.error }, 'dashboard:caja_pagos')
  if (comprobantes.error) registrarFalla({ message: comprobantes.error }, 'dashboard:caja_comprobantes')

  const tramoMes = { inicio: `${mes}-01`, fin: sumarDias(hoy, 1) }
  const tramoAnterior = mismoTramoDelMesAnterior(hoy)

  const delDia = cajaEnPeriodo(pagos.filas, { inicio: hoy, fin: sumarDias(hoy, 1) })
  const delMes = cajaEnPeriodo(pagos.filas, tramoMes)
  const mesAnterior = cajaEnPeriodo(pagos.filas, tramoAnterior)
  const facturadoMes = facturadoEnPeriodo(comprobantes.filas, tramoMes)
  const facturadoAnterior = facturadoEnPeriodo(comprobantes.filas, tramoAnterior)
  const deuda = deudores.reduce((a, d) => a + d.saldo, 0)

  // «▲ 12 % vs. mismos días de oct 26»: se compara del 1 a hoy contra del 1 al
  // mismo día del mes anterior, no contra el mes anterior completo.
  const baseComparacion = `mismos días de ${etiquetaMes(tramoAnterior.inicio.slice(0, 7))}`

  const porDia = cajaPorDia(pagos.filas, diasDelMesHasta(hoy)).map((d) => ({
    clave: d.dia,
    etiqueta: String(Number(d.dia.slice(8, 10))),
    valor: d.neto,
  }))
  const porMes = meses.map((m) => ({
    clave: m,
    etiqueta: etiquetaMes(m),
    valor: cajaEnPeriodo(pagos.filas, inicioFinDeMes(m)).neto,
  }))

  const huboError = Boolean(pagos.error || comprobantes.error || errorDeudores)
  const incompleto = pagos.truncado || comprobantes.truncado

  return (
    <Tarjeta
      titulo="Caja y cobranzas"
      descripcion="En dólares. Lo cobrado es lo que entró de verdad, ya restados los reembolsos."
      className="mt-6"
    >
      <div className="p-4 sm:p-5">
        {huboError && (
          <Mensaje tono="error">
            No se pudo leer toda la información de cobros y facturas. Los importes de esta sección
            pueden estar incompletos: no significa que no haya movimientos.
          </Mensaje>
        )}
        {incompleto && (
          <Mensaje tono="error">
            Hay más movimientos de los que se pudieron sumar: los importes de esta sección están
            por debajo del real. El detalle completo está en Reportes.
          </Mensaje>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Cobrado hoy" valor={formatearUSD(delDia.neto)}>
            {delDia.cobros === 0 ? 'todavía sin cobros' : delDia.cobros === 1 ? '1 cobro' : `${delDia.cobros} cobros`}
            {delDia.reembolsos > 0 && ` · ${formatearUSD(delDia.reembolsos)} devueltos`}
          </Cifra>
          <Cifra titulo={`Cobrado en ${etiquetaMes(mes)}`} valor={formatearUSD(delMes.neto)}>
            <Variacion valor={variacionPct(delMes.neto, mesAnterior.neto)} etiquetaBase={baseComparacion} />
          </Cifra>
          <Cifra
            titulo={`Facturado en ${etiquetaMes(mes)}`}
            valor={formatearUSD(facturadoMes)}
            href="/panel/reportes/facturacion"
          >
            <Variacion valor={variacionPct(facturadoMes, facturadoAnterior)} etiquetaBase={baseComparacion} />
          </Cifra>
          <Cifra titulo="Saldo vencido" valor={formatearUSD(deuda)} href="/panel/reservas?vista=por_cobrar">
            {deudores.length === 0
              ? 'nadie debe lo que ya tendría que haber pagado'
              : deudores.length === 1
                ? 'en 1 reserva'
                : `en ${deudores.length} reservas`}
          </Cifra>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-5">
          <div className="min-w-0 lg:col-span-3">
            <p className="mb-2 text-sm font-medium text-stone-700">
              Flujo de caja diario · {etiquetaMes(mes)}
            </p>
            <Barras
              serie={porDia}
              resaltada={hoy}
              etiquetaCada={5}
              resumen={`Cobrado neto por día, del 1 al ${formatoFechaCorta(hoy)}.`}
            />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <p className="mb-2 text-sm font-medium text-stone-700">
              Flujo de caja mensual · últimos {MESES} meses
            </p>
            <Barras serie={porMes} resaltada={mes} resumen="Cobrado neto por mes." />
          </div>
        </div>

        <div className="mt-5 border-t border-stone-100 pt-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-stone-700">Quién debe</p>
            {deudores.length > 0 && (
              <Link
                href="/panel/reservas?vista=por_cobrar"
                className="text-xs font-medium text-lago-700 hover:underline"
              >
                Ver {deudores.length === 1 ? 'la reserva' : `las ${deudores.length} reservas`} →
              </Link>
            )}
          </div>
          {deudores.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-stone-600">
              <span className="text-emerald-600">
                <Icono nombre="ok" tam={16} />
              </span>
              Ninguna reserva tiene saldo vencido.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {deudores.slice(0, DEUDORES_VISIBLES).map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/panel/reservas/${d.id}`}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-lago-50"
                  >
                    <span className="shrink-0 font-medium whitespace-nowrap text-lago-700">{d.codigo}</span>
                    <span className="min-w-0 flex-1 truncate text-stone-700" title={d.huesped}>
                      {d.huesped}
                    </span>
                    <span className="tabular font-semibold text-stone-900">{formatearUSD(d.saldo)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Tarjeta>
  )
}

/** Lo que se ve mientras la caja se calcula. */
export function CajaDelHotelCargando() {
  return (
    <div className="mt-6 h-96 animate-pulse rounded-2xl border border-stone-200 bg-white" aria-busy="true">
      <span className="sr-only">Cargando la caja del hotel…</span>
    </div>
  )
}
