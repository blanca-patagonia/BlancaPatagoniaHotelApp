import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, sumarDias, formatoFecha, parsearPeriodo } from '@/lib/fechas'
import { formatearUSD } from '@/lib/domain/moneda'
import { resumenMovimientos, totalPorMedio, type MovimientoDelDia } from '@/lib/domain/cierre-diario'
import { MEDIOS_PAGO, ETIQUETAS_MEDIO } from '@/lib/domain/pagos'
import type { EstadoReserva } from '@/lib/domain/reservas'
import { CAMPO, Campo, Encabezado, Kpi, Mensaje, Pagina, Tarjeta, botonClases } from '../_components/ui'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Cierre del día (night audit), de solo lectura.
 *
 * Patrón de referencia: el night audit de Hotel PMS. No existía nada parecido:
 * el dashboard muestra el día de HOY, pero no hay forma de repasar un día ya
 * pasado antes de darlo por cerrado. Esta pantalla junta, para la fecha que se
 * elija, lo que un cierre de noche necesita mirar — no actúa por su cuenta
 * sobre ninguna reserva ni marca no-shows: eso sigue siendo una decisión de
 * una persona (ADR 0019, todavía sin decidir en cuánto de esto se cobra).
 */
export default async function CierreDiarioPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>
}) {
  await requerirAcceso('reportes')
  const sp = await searchParams
  const fecha = RE_FECHA.test(sp.fecha ?? '') ? sp.fecha! : hoyISO()
  const manana = sumarDias(fecha, 1)
  const supabase = await crearClienteServidor()

  const [{ data: llegadasData }, { data: salidasData }, { data: pagosData }, { count: nuevas }, { count: canceladas }, { data: unidadesData }, { data: ocupadasData }] =
    await Promise.all([
      supabase.from('estadias').select('reserva:reservas(estado)').eq('check_in', fecha),
      supabase.from('estadias').select('reserva:reservas(estado)').eq('check_out', fecha),
      supabase
        .from('pagos')
        .select('medio, monto, tipo')
        .eq('estado', 'aprobado')
        .gte('creado_en', fecha)
        .lt('creado_en', manana),
      supabase
        .from('reservas')
        .select('*', { count: 'exact', head: true })
        .gte('creada_en', fecha)
        .lt('creada_en', manana),
      supabase
        .from('reservas')
        .select('*', { count: 'exact', head: true })
        .gte('cancelada_en', fecha)
        .lt('cancelada_en', manana),
      supabase.from('unidades').select('id').eq('activo', true),
      supabase.from('estadias').select('periodo').in('estado', ['pendiente', 'confirmada', 'pagada', 'in_house']),
    ])

  // Una reserva cancelada nunca iba a llegar/salir esa noche: si se cuenta como
  // «prevista», una cancelada semanas atrás infla el número de hoy sin que
  // nadie la haya esperado de verdad.
  const llegadas = ((llegadasData ?? []) as unknown as { reserva: { estado: EstadoReserva } | null }[])
    .filter((f) => f.reserva && f.reserva.estado !== 'cancelada')
    .map((f): MovimientoDelDia => ({ tipo: 'llegada', estado: f.reserva!.estado }))
  const salidas = ((salidasData ?? []) as unknown as { reserva: { estado: EstadoReserva } | null }[])
    .filter((f) => f.reserva && f.reserva.estado !== 'cancelada')
    .map((f): MovimientoDelDia => ({ tipo: 'salida', estado: f.reserva!.estado }))
  const movimientos = resumenMovimientos([...llegadas, ...salidas])

  // Solo pagos de alojamiento/consumos, no reembolsos: un reembolso no es plata
  // que entró, y sumarlo acá inflaría el cierre del día equivocado.
  const pagos = ((pagosData ?? []) as { medio: (typeof MEDIOS_PAGO)[number]; monto: number | string; tipo: string }[])
    .filter((p) => p.tipo !== 'reembolso')
    .map((p) => ({ medio: p.medio, monto: Number(p.monto) }))
  const totales = totalPorMedio(pagos, MEDIOS_PAGO)
  const totalCobrado = Object.values(totales).reduce((a, b) => a + b, 0)

  const totalUnidades = (unidadesData ?? []).length
  const ocupadasEsaNoche = ((ocupadasData ?? []) as { periodo: string }[]).filter((e) => {
    const p = parsearPeriodo(e.periodo)
    return fecha >= p.desde && fecha < p.hasta
  }).length

  const esHoy = fecha === hoyISO()

  return (
    <Pagina>
      <Link
        href="/panel/reportes"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a reportes
      </Link>

      <Encabezado
        titulo="Cierre del día"
        descripcion="Repaso de fin de día: quién llegó, quién no apareció, quién se fue y cuánto entró."
        icono="reportes"
      />

      <Tarjeta className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3 p-5">
          <Campo etiqueta="Fecha">
            <input type="date" name="fecha" defaultValue={fecha} max={hoyISO()} className={CAMPO} />
          </Campo>
          <button type="submit" className={botonClases('secundario')}>
            Ver ese día
          </button>
          {!esHoy && (
            <Link href="/panel/cierre-diario" className={botonClases('fantasma')}>
              Volver a hoy
            </Link>
          )}
        </form>
      </Tarjeta>

      {!esHoy && (
        <Mensaje tono="ok">Mostrando el cierre de {formatoFecha(fecha)}, no el de hoy.</Mensaje>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Llegadas"
          valor={`${movimientos.llegadasEfectivas} / ${movimientos.llegadasPrevistas}`}
          detalle="llegaron de las previstas"
          icono="reservas"
          tono="exito"
        />
        <Kpi
          titulo="No-show"
          valor={String(movimientos.noShows)}
          detalle="no aparecieron"
          icono="alerta"
          tono={movimientos.noShows > 0 ? 'alerta' : undefined}
        />
        <Kpi
          titulo="Salidas"
          valor={`${movimientos.salidasEfectivas} / ${movimientos.salidasPrevistas}`}
          detalle="se fueron de las previstas"
          icono="salir"
        />
        <Kpi
          titulo="Ocupación esa noche"
          valor={totalUnidades ? `${Math.round((ocupadasEsaNoche / totalUnidades) * 100)}%` : '—'}
          detalle={`${ocupadasEsaNoche} de ${totalUnidades} unidades`}
          icono="ocupacion"
        />
        <Kpi titulo="Reservas nuevas" valor={String(nuevas ?? 0)} detalle="cargadas ese día" icono="reservas" />
        <Kpi
          titulo="Canceladas"
          valor={String(canceladas ?? 0)}
          detalle="canceladas ese día"
          icono="reservas"
          tono={(canceladas ?? 0) > 0 ? 'alerta' : undefined}
        />
        <Kpi
          titulo="Total cobrado"
          valor={formatearUSD(totalCobrado)}
          detalle="pagos aprobados del día"
          icono="ok"
          tono="exito"
        />
      </div>

      <Tarjeta className="mt-6" titulo="Cobrado por medio de pago">
        <ul className="p-5">
          {MEDIOS_PAGO.map((m) => (
            <li key={m} className="flex items-center justify-between border-t border-stone-100 py-2 first:border-0">
              <span className="text-stone-700">{ETIQUETAS_MEDIO[m]}</span>
              <span className="tabular font-medium text-stone-900">{formatearUSD(totales[m])}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </Pagina>
  )
}
