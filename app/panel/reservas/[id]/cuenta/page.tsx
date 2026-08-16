import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ETIQUETAS_FOLIO,
  FOLIOS,
  agruparPorDepartamento,
  folioBEnUso,
  folioOpuesto,
  foliosCierran,
  importeLinea,
  totalesDeCuenta,
  type Folio,
  type LineaCuenta,
} from '@/lib/domain/folios'
import { formatoFechaCorta, parsearPeriodo } from '@/lib/fechas'
import { Icono } from '../../../_components/iconos'
import { BotonEnvio } from '../../../_components/boton-envio'
import {
  CAMPO,
  Campo,
  Encabezado,
  Etiqueta,
  Mensaje,
  Pagina,
  Tarjeta,
  botonClases,
} from '../../../_components/ui'
import { CargoManual, type OpcionDepartamento } from './cargo-manual'
import { guardarTitularB, moverAlojamientoDeFolio, moverConsumoDeFolio } from './actions'

/**
 * Cuenta del huésped con folios, departamentos y split.
 *
 * ── Por qué es una pantalla aparte ──────────────────────────────────────────
 *
 * El detalle de la reserva ya tiene 700 líneas y muestra la cuenta consolidada, que
 * alcanza para el 90 % de los casos. Esto es la vista de administración: el detalle
 * línea por línea agrupado por departamento, los dos folios y el split. Meterlo
 * dentro del detalle habría empujado abajo del pliegue el resto —el estado, los
 * pagos, las acciones— para un caso que no es el diario.
 *
 * ── La invariante que la pantalla vigila ────────────────────────────────────
 *
 * La suma de los folios tiene que dar el total general. Si no da, se dice arriba:
 * mostrar números que no suman y dejar que quien cobra los descubra frente al
 * huésped es la peor forma de enterarse.
 */

const MENSAJES_ERROR: Record<string, string> = {
  folio: 'El folio indicado no existe.',
  mover: 'No se pudo mover el cargo de folio. Quedó donde estaba.',
  titular: 'No se pudo guardar el titular del folio B.',
}

interface ConsumoRow {
  id: string
  cantidad: number
  precio_unitario: number | string
  fecha: string
  folio: string
  comprobante: string
  nota: string
  moneda_origen: string | null
  importe_origen: number | string | null
  cotizacion_usada: number | string | null
  producto: { nombre: string } | null
  departamento: { nombre: string; padre: { nombre: string } | null } | null
}

interface PagoRow {
  id: string
  tipo: string
  monto: number | string
  estado: string
  creado_en: string
  medio: string
}

export default async function CuentaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  await requerirAcceso('reservas')
  const { id } = await params
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const { data } = await supabase
    .from('reservas')
    .select(
      'id, codigo, estado, total, folio_alojamiento, folio_b_titular, creada_en, ' +
        'huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre), ' +
        'estadias(periodo, unidad:unidades(nombre))',
    )
    .eq('id', id)
    .single()

  if (!data) notFound()

  const reserva = data as unknown as {
    id: string
    codigo: string
    estado: string
    total: number | string
    folio_alojamiento: string
    folio_b_titular: string
    creada_en: string
    huesped: { apellido: string; nombre: string } | null
    estadias: { periodo: string; unidad: { nombre: string } | null }[]
  }

  const [{ data: consumosData }, { data: pagosData }, { data: deptosData }] = await Promise.all([
    supabase
      .from('consumos')
      .select(
        'id, cantidad, precio_unitario, fecha, folio, comprobante, nota, moneda_origen, importe_origen, cotizacion_usada, ' +
          'producto:productos_servicios(nombre), departamento:departamentos(nombre, padre:departamentos(nombre))',
      )
      .eq('reserva_id', id)
      .order('fecha'),
    supabase
      .from('pagos')
      .select('id, tipo, monto, estado, creado_en, medio')
      .eq('reserva_id', id)
      .eq('estado', 'aprobado')
      .order('creado_en'),
    supabase
      .from('departamentos')
      .select('id, nombre, orden, padre:departamentos(nombre, orden)')
      .eq('activo', true)
      .order('orden'),
  ])

  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]
  const pagos = (pagosData ?? []) as unknown as PagoRow[]

  const departamentos: OpcionDepartamento[] = (
    (deptosData ?? []) as unknown as { id: string; nombre: string; padre: { nombre: string } | null }[]
  ).map((d) => ({
    id: d.id,
    etiqueta: d.padre ? `${d.padre.nombre} › ${d.nombre}` : d.nombre,
  }))

  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null

  // ── Se arman las líneas de la cuenta ────────────────────────────────────────
  // Todo se modela igual —alojamiento, consumos y anticipos— para que el dominio
  // los ordene y los sume con el mismo código. Es lo que hace que no haya tres
  // formas distintas de calcular un total.
  const lineas: LineaCuenta[] = []

  lineas.push({
    id: 'alojamiento',
    clase: 'alojamiento',
    fecha: periodo?.desde ?? reserva.creada_en.slice(0, 10),
    concepto: periodo
      ? `Alojamiento ${formatoFechaCorta(periodo.desde)} – ${formatoFechaCorta(periodo.hasta)}`
      : 'Alojamiento',
    comprobante: reserva.codigo,
    departamento: 'Alojamiento',
    subdepartamento: '',
    folio: (reserva.folio_alojamiento as Folio) ?? 'A',
    cantidad: 1,
    importeUnitario: Number(reserva.total),
  })

  for (const c of consumos) {
    lineas.push({
      id: c.id,
      clase: 'consumo',
      fecha: c.fecha,
      // La nota tiene prioridad: en un cargo manual el producto es genérico
      // («Cargo manual») y el concepto real está en la nota.
      concepto: c.nota || c.producto?.nombre || 'Consumo',
      comprobante: c.comprobante,
      departamento: c.departamento?.padre?.nombre ?? c.departamento?.nombre ?? '',
      subdepartamento: c.departamento?.padre ? c.departamento.nombre : '',
      folio: (c.folio as Folio) ?? 'A',
      cantidad: c.cantidad,
      importeUnitario: Number(c.precio_unitario),
      monedaOrigen: c.moneda_origen,
      importeOrigen: c.importe_origen == null ? null : Number(c.importe_origen),
    })
  }

  for (const p of pagos) {
    if (p.tipo === 'reembolso') continue
    lineas.push({
      id: p.id,
      clase: 'anticipo',
      fecha: p.creado_en.slice(0, 10),
      concepto: p.tipo === 'senia' ? `Anticipo (${p.medio})` : `Pago a cuenta (${p.medio})`,
      comprobante: '',
      departamento: 'Alojamiento',
      subdepartamento: '',
      // Los anticipos van al folio del alojamiento: es lo que se está pagando.
      folio: (reserva.folio_alojamiento as Folio) ?? 'A',
      cantidad: 1,
      importeUnitario: -Number(p.monto),
    })
  }

  const totales = totalesDeCuenta(lineas)
  const cierran = foliosCierran(lineas)
  const mostrarB = folioBEnUso(lineas, reserva.folio_b_titular)
  const huesped = reserva.huesped
    ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}`
    : 'Sin huésped'

  return (
    <Pagina ancho="ancho">
      <Link
        href={`/panel/reservas/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a la reserva
      </Link>

      <Encabezado
        titulo={`Cuenta de ${reserva.codigo}`}
        descripcion={`${huesped}${estadia?.unidad ? ` · ${estadia.unidad.nombre}` : ''}`}
        icono="reportes"
        acciones={
          <Link href={`/panel/reservas/${id}/factura`} className={botonClases('secundario')}>
            Ver factura
          </Link>
        }
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>}
      {sp.ok === 'movido' && <Mensaje tono="ok">El cargo cambió de folio.</Mensaje>}
      {sp.ok === 'titular' && <Mensaje tono="ok">Titular del folio B guardado.</Mensaje>}

      {/* La invariante: si los folios no suman el total general, se dice acá. */}
      {!cierran && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200">
          <span className="mt-0.5 shrink-0 text-red-700">
            <Icono nombre="alerta" tam={18} />
          </span>
          <p className="text-sm text-red-900">
            <strong className="font-semibold">La cuenta no cierra:</strong> la suma de los folios no
            coincide con el total general. Hay alguna línea con un folio no válido. No factures hasta
            revisarlo.
          </p>
        </div>
      )}

      {/* ── Totales ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {(mostrarB ? FOLIOS : (['A'] as const)).map((f) => {
          const t = totales.porFolio.find((x) => x.folio === f)!
          return (
            <div key={f} className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-medium text-stone-700">{ETIQUETAS_FOLIO[f]}</h2>
              <p className="tabular mt-1.5 text-2xl leading-none font-semibold text-stone-900">
                USD {t.saldo.toLocaleString('es-AR')}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {t.lineas} cargo(s) por USD {t.cargos.toLocaleString('es-AR')}
                {t.anticipos > 0 && ` · anticipos USD ${t.anticipos.toLocaleString('es-AR')}`}
              </p>
              {f === 'B' && reserva.folio_b_titular && (
                <p className="mt-1 text-xs font-medium text-stone-700">
                  A nombre de: {reserva.folio_b_titular}
                </p>
              )}
            </div>
          )
        })}

        <div className="rounded-xl border border-lago-300 bg-lago-50 p-4">
          <h2 className="text-sm font-medium text-lago-900">Total general</h2>
          <p className="tabular mt-1.5 text-2xl leading-none font-semibold text-lago-950">
            USD {totales.saldo.toLocaleString('es-AR')}
          </p>
          <p className="mt-1 text-xs text-lago-800">
            cargos USD {totales.cargos.toLocaleString('es-AR')} · anticipos USD{' '}
            {totales.anticipos.toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      {/* ── Titular del folio B ─────────────────────────────────────────────── */}
      <Tarjeta
        titulo="Folio B — quién lo paga"
        descripcion="Si la habitación la paga una empresa o agencia, acá va a nombre de quién se factura."
      >
        <form action={guardarTitularB} className="flex flex-wrap items-end gap-3 p-5">
          <input type="hidden" name="reserva_id" value={id} />
          <div className="w-full sm:w-80">
            <Campo etiqueta="Titular del folio B">
              <input
                name="titular"
                defaultValue={reserva.folio_b_titular}
                placeholder="Empresa SRL, agencia, acompañante…"
                className={CAMPO}
              />
            </Campo>
          </div>
          <BotonEnvio variante="secundario" cargando="Guardando…" extra="w-full sm:w-auto">
            Guardar
          </BotonEnvio>
        </form>
      </Tarjeta>

      {/* ── Detalle por folio ───────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-4">
        {(mostrarB ? FOLIOS : (['A'] as const)).map((f) => {
          const grupos = agruparPorDepartamento(lineas, f)
          const t = totales.porFolio.find((x) => x.folio === f)!
          const anticipos = lineas.filter((l) => l.clase === 'anticipo' && l.folio === f)

          return (
            <Tarjeta
              key={f}
              titulo={ETIQUETAS_FOLIO[f]}
              descripcion={`Saldo USD ${t.saldo.toLocaleString('es-AR')}`}
            >
              {grupos.length === 0 && anticipos.length === 0 ? (
                <p className="px-5 py-6 text-sm text-stone-600">
                  Este folio no tiene cargos. Se pueden mover desde el otro folio con el botón
                  «Mover a {f}».
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <caption className="sr-only">
                      Detalle del {ETIQUETAS_FOLIO[f]}, agrupado por departamento
                    </caption>
                    <thead>
                      <tr className="border-b border-stone-200 text-xs tracking-wide text-stone-500 uppercase">
                        <th className="px-4 py-2 text-left">Fecha</th>
                        <th className="px-4 py-2 text-left">Concepto</th>
                        <th className="px-4 py-2 text-left">Comprobante</th>
                        <th className="px-2 py-2 text-right">Cant.</th>
                        <th className="px-4 py-2 text-right">Importe</th>
                        <th className="px-4 py-2 text-left">Mover</th>
                      </tr>
                    </thead>

                    {grupos.map((g) => (
                      <tbody key={g.departamento}>
                        {/* Encabezado del departamento */}
                        <tr className="bg-stone-50">
                          <th
                            colSpan={4}
                            scope="colgroup"
                            className="px-4 py-1.5 text-left text-xs font-semibold tracking-wide text-stone-700 uppercase"
                          >
                            {g.departamento}
                          </th>
                          <td className="tabular px-4 py-1.5 text-right text-xs font-semibold text-stone-700">
                            USD {g.total.toLocaleString('es-AR')}
                          </td>
                          <td />
                        </tr>

                        {[
                          ...g.sueltas.map((l) => ({ l, sub: '' })),
                          ...g.subgrupos.flatMap((s) =>
                            s.lineas.map((l) => ({ l, sub: s.subdepartamento })),
                          ),
                        ].map(({ l, sub }) => (
                          <tr key={l.id} className="border-t border-stone-100">
                            <td className="tabular px-4 py-2 whitespace-nowrap text-stone-600">
                              {formatoFechaCorta(l.fecha)}
                            </td>
                            <td className="px-4 py-2 text-stone-800">
                              {l.concepto}
                              {sub && (
                                <span className="ml-2 text-xs text-stone-500">{sub}</span>
                              )}
                              {/* Si se cobró en otra moneda, se dice: sin esto el
                                  huésped ve un importe en dólares que no coincide
                                  con lo que pagó y nadie sabe explicar por qué. */}
                              {l.monedaOrigen && (
                                <span className="block text-xs text-stone-500">
                                  cobrado en {l.monedaOrigen}{' '}
                                  {Number(l.importeOrigen).toLocaleString('es-AR')}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-stone-500">
                              {l.comprobante || '—'}
                            </td>
                            <td className="tabular px-2 py-2 text-right text-stone-600">
                              {l.cantidad}
                            </td>
                            <td className="tabular px-4 py-2 text-right font-medium text-stone-900">
                              USD {importeLinea(l).toLocaleString('es-AR')}
                            </td>
                            <td className="px-4 py-2">
                              {mostrarB || l.folio === 'A' ? (
                                <form
                                  action={
                                    l.clase === 'alojamiento'
                                      ? moverAlojamientoDeFolio
                                      : moverConsumoDeFolio
                                  }
                                >
                                  <input type="hidden" name="reserva_id" value={id} />
                                  {l.clase !== 'alojamiento' && (
                                    <input type="hidden" name="consumo_id" value={l.id} />
                                  )}
                                  <input type="hidden" name="folio" value={folioOpuesto(f)} />
                                  <BotonEnvio variante="fantasma" cargando="…">
                                    Mover a {folioOpuesto(f)}
                                  </BotonEnvio>
                                </form>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    ))}

                    {/* Anticipos, aparte de los cargos: no son consumo, son plata
                        que ya entró. */}
                    {anticipos.length > 0 && (
                      <tbody>
                        <tr className="bg-emerald-50">
                          <th
                            colSpan={4}
                            scope="colgroup"
                            className="px-4 py-1.5 text-left text-xs font-semibold tracking-wide text-emerald-900 uppercase"
                          >
                            Anticipos y pagos
                          </th>
                          <td className="tabular px-4 py-1.5 text-right text-xs font-semibold text-emerald-900">
                            −USD {t.anticipos.toLocaleString('es-AR')}
                          </td>
                          <td />
                        </tr>
                        {anticipos.map((l) => (
                          <tr key={l.id} className="border-t border-stone-100">
                            <td className="tabular px-4 py-2 whitespace-nowrap text-stone-600">
                              {formatoFechaCorta(l.fecha)}
                            </td>
                            <td className="px-4 py-2 text-stone-800">{l.concepto}</td>
                            <td className="px-4 py-2 text-xs text-stone-500">—</td>
                            <td />
                            <td className="tabular px-4 py-2 text-right font-medium text-emerald-800">
                              −USD {Math.abs(importeLinea(l)).toLocaleString('es-AR')}
                            </td>
                            <td className="px-4 py-2">
                              <Etiqueta tono="neutro">no se mueve</Etiqueta>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    )}

                    <tfoot className="border-t-2 border-stone-300 bg-stone-50">
                      <tr>
                        <th colSpan={4} scope="row" className="px-4 py-2.5 text-left font-semibold text-stone-800">
                          Saldo del folio {f}
                        </th>
                        <td className="tabular px-4 py-2.5 text-right font-semibold text-stone-900">
                          USD {t.saldo.toLocaleString('es-AR')}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Tarjeta>
          )
        })}
      </div>

      <div className="mt-4">
        <Tarjeta
          titulo="Cargo manual"
          descripcion="Para lo que no está en el catálogo: lavandería, roturas, llamadas. Se puede cobrar en otra moneda."
        >
          <CargoManual reservaId={id} departamentos={departamentos} />
        </Tarjeta>
      </div>
    </Pagina>
  )
}
