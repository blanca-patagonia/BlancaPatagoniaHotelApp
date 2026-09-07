import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import {
  ETIQUETAS_COMPROBANTE,
  ETIQUETAS_CONDICION_IVA,
  formatearCuit,
  caeVigente,
  type CondicionIva,
  type TipoComprobante,
} from '@/lib/domain/facturacion'
import { fechaHotel, hoyISO } from '@/lib/fechas'
import { parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { BotonImprimir } from './boton-imprimir'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { MENSAJES_NO_ACREDITAR, saldoAcreditable } from '@/lib/domain/facturacion'
import { emitirNotaCredito } from '../../actions'
import { BotonEnvio } from '../../../_components/boton-envio'
import { Mensaje } from '../../../_components/ui'

/**
 * Fallos que pueden llegar a esta pantalla al emitir una nota de crédito.
 *
 * Los cinco primeros son los de `motivoNoAcreditar`; los otros, escrituras que la
 * base puede rechazar. Sin este mapa, `?error=` recargaría la pantalla sin decir
 * nada — la trampa que documenta `AGENTS.md`.
 */
const MENSAJES_ERROR: Record<string, string> = {
  ...MENSAJES_NO_ACREDITAR,
  cae: 'El proveedor de facturación rechazó la nota de crédito. Revisá el importe.',
  numeracion_nc: 'No se pudo asignar el número de la nota de crédito. Probá de nuevo.',
  nota_credito:
    'Se pidió el CAE y se consumió el número, pero la nota NO quedó guardada. Avisá antes de volver a emitir: el número ya se usó.',
  lectura_factura: 'No se pudo leer la factura. No se emitió nada.',
  lectura_notas: 'No se pudieron leer las notas de crédito anteriores. No se emitió nada.',
}

interface Reserva {
  codigo: string
  total: number | string
  huesped: {
    apellido: string
    nombre: string
    doc_numero: string
    email: string | null
  } | null
  estadias: {
    periodo: string
    unidad: { nombre: string; tipo: { nombre: string } | null } | null
  }[]
}
interface ConsumoRow {
  cantidad: number
  precio_unitario: number | string
  producto: { nombre: string } | null
}

export default async function FacturaPage({
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
      'codigo, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, doc_numero, email), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('id', id)
    .single()
  if (!data) notFound()
  const reserva = data as unknown as Reserva

  const [{ data: consumosData }, { data: factura }] = await Promise.all([
    supabase
      .from('consumos')
      .select('cantidad, precio_unitario, producto:productos_servicios(nombre)')
      .eq('reserva_id', id)
      .order('creado_en'),
    supabase
      .from('facturas')
      .select(
        'id, total, numero, emitida_en, tipo_comprobante, numero_fiscal, neto, iva, alicuota_iva, exento, motivo_exencion, cae, cae_vto, cuit_receptor, condicion_iva_receptor',
      )
      .eq('reserva_id', id)
      .maybeSingle(),
  ])
  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]

  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )
  const fac = factura as {
    id: string
    total: number | string
    numero: string
    emitida_en: string
    tipo_comprobante: TipoComprobante | null
    numero_fiscal: string | null
    neto: number | string | null
    iva: number | string | null
    alicuota_iva: number | string | null
    /** Parte del `neto` que no tributa (RG 3971). Subconjunto, no sumando. */
    exento: number | string | null
    /** Fundamento legal de la exención, impreso al pie del comprobante. */
    motivo_exencion: string | null
    cae: string | null
    cae_vto: string | null
    cuit_receptor: string | null
    condicion_iva_receptor: CondicionIva | null
  } | null

  // Un comprobante con CAE es fiscal; sin CAE, sigue siendo la proforma interna.
  const esFiscal = Boolean(fac?.cae && fac?.tipo_comprobante)

  /*
    Notas de crédito (migración 0076).

    Se leen siempre, no sólo cuando hay: si existen, cambian lo que el comprobante
    dice de verdad, y una factura de 100 con una nota de 40 acreditados no vale
    100. Mostrar sólo la factura sería publicar un número que ya no es cierto.
  */
  const { data: notasData } = await supabase
    .from('notas_credito')
    .select('id, numero, numero_fiscal, total, motivo, emitida_en, cae')
    .eq('factura_id', fac?.id ?? '00000000-0000-0000-0000-000000000000')
    .order('emitida_en')

  const notas = (notasData ?? []) as {
    id: string
    numero: string
    numero_fiscal: string | null
    total: number | string
    motivo: string
    emitida_en: string
    cae: string | null
  }[]

  const acreditado = notas.reduce((a, n) => a + Number(n.total), 0)
  const porAcreditar = saldoAcreditable(Number(fac?.total ?? 0), acreditado)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/panel/reservas/${id}`} className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Reserva
        </Link>
        <BotonImprimir />
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-8 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <p className="text-lg font-semibold tracking-tight text-lago-700">Blanca Patagonia</p>
            <p className="text-xs text-stone-500">
              Hostería Boutique &amp; Cabañas · El Calafate, Santa Cruz
            </p>
          </div>
          <div className="text-right text-sm">
            {esFiscal ? (
              <>
                <div className="flex items-center justify-end gap-2">
                  <span className="flex size-8 items-center justify-center rounded border border-stone-400 font-display text-lg font-semibold text-stone-800">
                    {fac!.tipo_comprobante}
                  </span>
                  <span className="font-semibold text-stone-800">
                    {ETIQUETAS_COMPROBANTE[fac!.tipo_comprobante!]}
                  </span>
                </div>
                <p className="tabular text-stone-600">{fac!.numero_fiscal}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-stone-800">Comprobante interno</p>
                <p className="text-stone-500">{fac?.numero ?? '(proforma)'}</p>
              </>
            )}
            <p className="text-xs text-stone-600">Reserva {reserva.codigo}</p>
          </div>
        </div>

        {/* En papel el comprobante siempre lleva las dos columnas; en un
            teléfono se apilan para que los datos no queden partidos. */}
        <div className="grid grid-cols-1 gap-4 py-4 text-sm sm:grid-cols-2 print:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-600">Huésped</p>
            <p className="text-stone-800">
              {reserva.huesped ? `${reserva.huesped.apellido}, ${reserva.huesped.nombre}` : '—'}
            </p>
            <p className="text-stone-500">{reserva.huesped?.doc_numero || ''}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-600">Estadía</p>
            <p className="text-stone-800">
              {estadia?.unidad?.tipo?.nombre ?? estadia?.unidad?.nombre ?? '—'}
            </p>
            <p className="text-stone-500">
              {periodo
                ? `${formatoFechaCorta(periodo.desde)} → ${formatoFechaCorta(periodo.hasta)} (${noches} noches)`
                : ''}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-t border-stone-200 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-600">
              <th className="py-2">Detalle</th>
              <th className="py-2 text-right">Importe (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-stone-100">
              <td className="py-2 text-stone-700">
                Alojamiento · {estadia?.unidad?.tipo?.nombre ?? ''} ({noches} noches)
              </td>
              <td className="tabular py-2 text-right text-stone-800">
                {importe(cuenta.alojamiento)}
              </td>
            </tr>
            {consumos.map((c, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="py-2 text-stone-700">
                  {c.cantidad}× {c.producto?.nombre}
                </td>
                <td className="tabular py-2 text-right text-stone-800">
                  {importe(c.cantidad * Number(c.precio_unitario))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Operación exenta (RG 3971, ADR 0024).
                Se muestra en TODA letra de comprobante, no solo en la A: el
                monto no gravado es un dato del comprobante, no una
                discriminación de impuesto. Una factura B a un turista del
                exterior también tiene que decir cuánto salió exento y por qué. */}
            {esFiscal && Number(fac!.exento) > 0 && (
              <tr className="border-t border-stone-200">
                <td className="py-1.5 text-stone-600">Operaciones exentas</td>
                <td className="tabular py-1.5 text-right text-stone-700">
                  {importe(Number(fac!.exento))}
                </td>
              </tr>
            )}
            {/* La factura A discrimina el IVA; la B y la C lo llevan incluido. */}
            {esFiscal && fac!.tipo_comprobante === 'A' && (
              <>
                <tr className="border-t border-stone-200">
                  <td className="py-1.5 text-stone-600">
                    Neto gravado
                    {Number(fac!.exento) > 0 && (
                      <span className="text-stone-500"> (sin lo exento)</span>
                    )}
                  </td>
                  <td className="tabular py-1.5 text-right text-stone-700">
                    {importe(Number(fac!.neto) - Number(fac!.exento))}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 text-stone-600">
                    IVA {Number(fac!.alicuota_iva)}%
                  </td>
                  <td className="tabular py-1.5 text-right text-stone-700">
                    {importe(Number(fac!.iva))}
                  </td>
                </tr>
              </>
            )}
            <tr className="border-t-2 border-stone-300">
              <td className="py-2 font-semibold text-stone-900">Total</td>
              <td className="tabular py-2 text-right text-lg font-bold text-stone-900">
                {formatearUSD(cuenta.total)}
              </td>
            </tr>
            </tfoot>
          </table>
        </div>

        {esFiscal ? (
          <div className="mt-6 border-t border-stone-200 pt-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>
                <span className="text-stone-500">CAE: </span>
                <span className="tabular font-medium text-stone-800">{fac!.cae}</span>
              </span>
              <span>
                <span className="text-stone-500">Vencimiento del CAE: </span>
                <span className="tabular font-medium text-stone-800">
                  {fac!.cae_vto ? formatoFechaCorta(fac!.cae_vto) : '—'}
                </span>
              </span>
            </div>
            {fac!.cuit_receptor && (
              <p className="mt-1 text-sm">
                <span className="text-stone-500">CUIT del receptor: </span>
                <span className="tabular text-stone-800">{formatearCuit(fac!.cuit_receptor)}</span>
              </p>
            )}
            {fac!.condicion_iva_receptor && (
              <p className="text-sm">
                <span className="text-stone-500">Condición IVA: </span>
                <span className="text-stone-800">
                  {ETIQUETAS_CONDICION_IVA[fac!.condicion_iva_receptor]}
                </span>
              </p>
            )}
            {/* El fundamento va IMPRESO, no solo guardado: una exención sin la
                norma citada en el comprobante no es oponible ante una
                inspección. La restricción `facturas_exencion_fundada` de la
                migración 0058 garantiza que si hay monto exento, este texto
                existe. */}
            {fac!.motivo_exencion && (
              <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600">
                {fac!.motivo_exencion}
              </p>
            )}
            {!caeVigente(fac!.cae_vto, hoyISO()) && (
              <p className="mt-2 text-xs font-medium text-red-600">
                El CAE está vencido: este comprobante ya no puede entregarse al cliente.
              </p>
            )}
            <p className="mt-3 text-xs text-stone-600">
              ⚠️ CAE emitido por un proveedor <strong>simulado</strong>: este comprobante NO tiene
              validez fiscal. La integración con AFIP/ARCA queda documentada en el ADR 0012.
              Tarifas en dólares.
            </p>
          </div>
        ) : (
          <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-600">
            Comprobante interno sin CAE. No válido como factura fiscal. Tarifas en dólares;
            IVA incluido en el alojamiento.
          </p>
        )}
      </div>

      {/* ── Notas de crédito ────────────────────────────────────────────────
          Fuera de la caja del comprobante y con `print:hidden` en el formulario:
          lo que se imprime y se le entrega al cliente es la factura, no la
          herramienta para corregirla. Las notas ya emitidas SÍ se imprimen —
          cambian lo que el comprobante vale de verdad. */}
      {esFiscal && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-800">Notas de crédito</h2>

          <div className="print:hidden">
            {sp.error && (
              <Mensaje tono="error">
                {MENSAJES_ERROR[sp.error] ?? 'No se pudo emitir la nota de crédito.'}
              </Mensaje>
            )}
            {sp.ok === 'nota_credito' && (
              <Mensaje tono="ok">Nota de crédito emitida.</Mensaje>
            )}
          </div>

          {notas.length === 0 ? (
            <p className="mt-2 text-xs text-stone-600">
              No hay ninguna. Se emite una cuando hay que corregir o anular este comprobante:
              la factura es inmutable y no se puede editar.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100 text-sm">
              {notas.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium text-stone-800">
                      {n.numero_fiscal ?? n.numero}
                    </span>
                    <span className="ml-2 text-xs text-stone-500">
                      {fechaHotel(n.emitida_en)}
                    </span>
                    <span className="mt-0.5 block text-xs break-words text-stone-600">
                      {n.motivo}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-red-600">
                    −{formatearUSD(Number(n.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {notas.length > 0 && (
            <p className="mt-3 border-t border-stone-100 pt-2 text-sm">
              Acreditado: <strong>{formatearUSD(acreditado)}</strong> · Neto del comprobante:{' '}
              <strong>{formatearUSD(Number(fac!.total) - acreditado)}</strong>
            </p>
          )}

          {porAcreditar > 0 ? (
            <form
              action={emitirNotaCredito}
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4 print:hidden"
            >
              <input type="hidden" name="reserva_id" value={id} />
              <label className="flex w-full flex-col gap-1 text-xs sm:w-auto">
                <span className="text-stone-500">Importe a acreditar</span>
                <input
                  name="monto"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={porAcreditar}
                  required
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm sm:w-40"
                />
              </label>
              <label className="flex w-full min-w-0 flex-1 flex-col gap-1 text-xs">
                <span className="text-stone-500">Motivo</span>
                <input
                  name="motivo"
                  required
                  minLength={5}
                  placeholder="Por qué se acredita (queda en el comprobante)"
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              {/* Sin vuelta atrás: la nota se emite con CAE y es inmutable. */}
              <BotonEnvio
                confirmar={`Se va a emitir una nota de crédito con CAE. No se puede deshacer. Quedan ${formatearUSD(porAcreditar)} sin acreditar.`}
              >
                Emitir nota de crédito
              </BotonEnvio>
              <p className="w-full text-xs text-stone-500">
                Quedan {formatearUSD(porAcreditar)} sin acreditar de esta factura.
              </p>
            </form>
          ) : (
            <p className="mt-3 border-t border-stone-100 pt-2 text-xs text-stone-600 print:hidden">
              La factura está acreditada por completo: no queda nada por acreditar.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
