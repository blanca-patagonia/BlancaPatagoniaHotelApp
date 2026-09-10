import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteAdmin } from '@/lib/supabase/admin'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import {
  ETIQUETAS_COMPROBANTE,
  ETIQUETAS_CONDICION_IVA,
  formatearCuit,
  caeVigente,
  type CondicionIva,
  type TipoComprobante,
} from '@/lib/domain/facturacion'
import { hoyISO, parsearPeriodo, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { formatearUSD, importe } from '@/lib/domain/moneda'
import { BotonImprimir } from '../../../panel/reservas/[id]/factura/boton-imprimir'
import { Marco, Tarjeta } from '../../../_publico/ui'

/**
 * Portal del huésped: ver y descargar su propia factura.
 *
 * Patrón de referencia: el portal de facturas de Invoice Ninja. «Descargar» es
 * imprimir/guardar-como-PDF del navegador (`BotonImprimir`, ya existía para
 * el staff) y no un generador de PDF propio: sumar una librería para esto solo
 * sería una dependencia nueva sin necesidad (AGENTS.md).
 *
 * El token opaco es la misma credencial que ya usa
 * `/reservar/confirmacion/[token]`: quien lo tiene, entra. Por eso esta
 * pantalla usa `service_role` y no depende de sesión.
 *
 * ⚠️ Esta es una versión más simple del comprobante que ve el staff en
 * `/panel/reservas/[id]/factura` — no comparten componente. Duplicar la caja
 * visual acá fue la decisión: extraer un componente compartido tocaría una
 * pantalla que además emite notas de crédito con CAE real, y no es el momento
 * de arriesgar esa pantalla por evitar 100 líneas repetidas.
 */
interface Reserva {
  codigo: string
  total: number | string
  huesped: { apellido: string; nombre: string; doc_numero: string } | null
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

export default async function FacturaPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const admin = crearClienteAdmin()

  const { data } = await admin
    .from('reservas')
    .select(
      'id, codigo, total, huesped:huespedes!reservas_huesped_id_fkey(apellido, nombre, doc_numero), estadias(periodo, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))',
    )
    .eq('token', token)
    .single()
  if (!data) notFound()
  const reserva = data as unknown as Reserva & { id: string }

  const [{ data: consumosData }, { data: factura }] = await Promise.all([
    admin
      .from('consumos')
      .select('cantidad, precio_unitario, producto:productos_servicios(nombre)')
      .eq('reserva_id', reserva.id)
      .order('creado_en'),
    admin
      .from('facturas')
      .select(
        'id, total, numero, tipo_comprobante, numero_fiscal, neto, iva, alicuota_iva, exento, motivo_exencion, cae, cae_vto, cuit_receptor, condicion_iva_receptor',
      )
      .eq('reserva_id', reserva.id)
      .maybeSingle(),
  ])
  const consumos = (consumosData ?? []) as unknown as ConsumoRow[]

  // Sin factura emitida todavía no hay nada que mostrar — no es un error del
  // huésped, es que la cuenta no se cerró (ver `motivoNoCargable`, ADR/P3).
  if (!factura) {
    return (
      <Marco ancho="angosto">
        <Tarjeta>
          <div className="px-6 py-8 text-center sm:px-8">
            <p className="font-medium text-stone-800">Todavía no hay factura para esta reserva.</p>
            <p className="mt-2 text-sm text-stone-600">
              Se emite al cerrar la cuenta, normalmente en el check-out. Volvé a esta misma
              dirección más adelante.
            </p>
            <Link href={`/reservar/confirmacion/${token}`} className="mt-4 inline-block text-sm text-lago-700 underline">
              ‹ Volver a mi reserva
            </Link>
          </div>
        </Tarjeta>
      </Marco>
    )
  }

  const fac = factura as {
    id: string
    total: number | string
    numero: string
    tipo_comprobante: TipoComprobante | null
    numero_fiscal: string | null
    neto: number | string | null
    iva: number | string | null
    alicuota_iva: number | string | null
    exento: number | string | null
    motivo_exencion: string | null
    cae: string | null
    cae_vto: string | null
    cuit_receptor: string | null
    condicion_iva_receptor: CondicionIva | null
  }

  const estadia = reserva.estadias?.[0]
  const periodo = estadia ? parsearPeriodo(estadia.periodo) : null
  const noches = periodo ? diasEntre(periodo.desde, periodo.hasta) : 0
  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    consumos.map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo),
  )
  const esFiscal = Boolean(fac.cae && fac.tipo_comprobante)

  return (
    <Marco ancho="normal">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/reservar/confirmacion/${token}`} className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Volver a mi reserva
        </Link>
        <BotonImprimir />
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-8 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <p className="text-lg font-semibold tracking-tight text-lago-700">Blanca Patagonia</p>
            <p className="text-xs text-stone-500">Hostería Boutique &amp; Cabañas · El Calafate, Santa Cruz</p>
          </div>
          <div className="text-right text-sm">
            {esFiscal ? (
              <>
                <div className="flex items-center justify-end gap-2">
                  <span className="flex size-8 items-center justify-center rounded border border-stone-400 font-display text-lg font-semibold text-stone-800">
                    {fac.tipo_comprobante}
                  </span>
                  <span className="font-semibold text-stone-800">
                    {ETIQUETAS_COMPROBANTE[fac.tipo_comprobante!]}
                  </span>
                </div>
                <p className="tabular text-stone-600">{fac.numero_fiscal}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-stone-800">Comprobante interno</p>
                <p className="text-stone-500">{fac.numero}</p>
              </>
            )}
            <p className="text-xs text-stone-600">Reserva {reserva.codigo}</p>
          </div>
        </div>

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
            <p className="text-stone-800">{estadia?.unidad?.tipo?.nombre ?? estadia?.unidad?.nombre ?? '—'}</p>
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
                <td className="tabular py-2 text-right text-stone-800">{importe(cuenta.alojamiento)}</td>
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
              {esFiscal && Number(fac.exento) > 0 && (
                <tr className="border-t border-stone-200">
                  <td className="py-1.5 text-stone-600">Operaciones exentas</td>
                  <td className="tabular py-1.5 text-right text-stone-700">{importe(Number(fac.exento))}</td>
                </tr>
              )}
              {esFiscal && fac.tipo_comprobante === 'A' && (
                <>
                  <tr className="border-t border-stone-200">
                    <td className="py-1.5 text-stone-600">
                      Neto gravado
                      {Number(fac.exento) > 0 && <span className="text-stone-500"> (sin lo exento)</span>}
                    </td>
                    <td className="tabular py-1.5 text-right text-stone-700">
                      {importe(Number(fac.neto) - Number(fac.exento))}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-stone-600">IVA {Number(fac.alicuota_iva)}%</td>
                    <td className="tabular py-1.5 text-right text-stone-700">{importe(Number(fac.iva))}</td>
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
                <span className="tabular font-medium text-stone-800">{fac.cae}</span>
              </span>
              <span>
                <span className="text-stone-500">Vencimiento del CAE: </span>
                <span className="tabular font-medium text-stone-800">
                  {fac.cae_vto ? formatoFechaCorta(fac.cae_vto) : '—'}
                </span>
              </span>
            </div>
            {fac.cuit_receptor && (
              <p className="mt-1 text-sm">
                <span className="text-stone-500">CUIT del receptor: </span>
                <span className="tabular text-stone-800">{formatearCuit(fac.cuit_receptor)}</span>
              </p>
            )}
            {fac.condicion_iva_receptor && (
              <p className="text-sm">
                <span className="text-stone-500">Condición IVA: </span>
                <span className="text-stone-800">{ETIQUETAS_CONDICION_IVA[fac.condicion_iva_receptor]}</span>
              </p>
            )}
            {fac.motivo_exencion && (
              <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600">{fac.motivo_exencion}</p>
            )}
            {!caeVigente(fac.cae_vto, hoyISO()) && (
              <p className="mt-2 text-xs font-medium text-red-600">
                El CAE está vencido: este comprobante ya no puede entregarse.
              </p>
            )}
            <p className="mt-3 text-xs text-stone-600">
              ⚠️ CAE emitido por un proveedor <strong>simulado</strong>: este comprobante NO tiene validez
              fiscal.
            </p>
          </div>
        ) : (
          <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-600">
            Comprobante interno sin CAE. No válido como factura fiscal. Tarifas en dólares; IVA incluido en
            el alojamiento.
          </p>
        )}
      </div>
    </Marco>
  )
}
