import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  saldoCuenta,
  ETIQUETAS_TIPO_CUENTA,
  ETIQUETAS_MOVIMIENTO,
  type TipoCuenta,
  type TipoMovimiento,
  type Movimiento,
} from '@/lib/domain/cuentas'
import { registrarMovimiento } from '../actions'

interface Agencia {
  id: string
  nombre: string
  tipo: TipoCuenta
  cuit: string | null
  email: string | null
  descuento_pct: number
  token: string
}
interface MovRow {
  id: string
  tipo: TipoMovimiento
  monto: number | string
  concepto: string
  fecha: string
  reserva: { codigo: string } | null
}

export default async function AgenciaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requerirAcceso('agencias')
  const { id } = await params
  const supabase = await crearClienteServidor()

  const [{ data: agenciaData }, { data: movsData }] = await Promise.all([
    supabase.from('agencias').select('id, nombre, tipo, cuit, email, descuento_pct, token').eq('id', id).single(),
    supabase
      .from('movimientos_cuenta')
      .select('id, tipo, monto, concepto, fecha, reserva:reservas(codigo)')
      .eq('agencia_id', id)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false }),
  ])
  if (!agenciaData) notFound()
  const agencia = agenciaData as Agencia
  const cabeceras = await headers()
  const origen = `${cabeceras.get('x-forwarded-proto') ?? 'http'}://${cabeceras.get('host') ?? 'localhost:3000'}`
  const movs = (movsData ?? []) as unknown as MovRow[]
  const saldo = saldoCuenta(movs.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) }) as Movimiento))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href="/panel/agencias" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Agencias
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{agencia.nombre}</h1>
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-600">
          {ETIQUETAS_TIPO_CUENTA[agencia.tipo]}
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        {agencia.cuit ? `CUIT ${agencia.cuit} · ` : ''}
        {agencia.email || 'sin email'} · descuento {agencia.descuento_pct}%
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-400">Saldo</p>
          <p className={`text-2xl font-semibold ${saldo > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            USD {saldo.toLocaleString('es-AR')}
          </p>
          <p className="text-xs text-stone-400">{saldo > 0 ? 'adeuda al hotel' : 'sin deuda'}</p>
        </div>
        <form action={registrarMovimiento} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="agencia_id" value={agencia.id} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Tipo</span>
            <select name="tipo" className="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
              <option value="cargo">Cargo</option>
              <option value="pago">Pago</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Monto (USD)</span>
            <input
              name="monto"
              type="number"
              step="0.01"
              min="0"
              className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Concepto</span>
            <input name="concepto" className="w-40 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <button className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800">
            Registrar
          </button>
        </form>
      </div>


      {/* Enlace del portal: el socio ve sus contratos y su cuenta sin cuenta de usuario. */}
      <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold text-stone-900">Portal del socio</h2>
        <p className="mt-1 text-sm text-stone-500">
          Enlace personal para que consulte sus contratos y su cuenta corriente. Quien lo tenga
          accede: mandalo solo al contacto de la empresa.
        </p>
        <code className="mt-3 block rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-700 ring-1 ring-stone-200">
          {origen}/portal/{agencia.token}
        </code>
        <a
          href={`/portal/${agencia.token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Abrir el portal
        </a>
      </section>

      <h2 className="mt-6 mb-2 text-sm font-medium text-stone-700">Movimientos</h2>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Concepto</th>
              <th className="px-4 py-2.5 text-right">Cargo</th>
              <th className="px-4 py-2.5 text-right">Pago</th>
            </tr>
          </thead>
          <tbody>
            {movs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                  Sin movimientos.
                </td>
              </tr>
            )}
            {movs.map((m) => (
              <tr key={m.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2 text-stone-500">{m.fecha}</td>
                <td className="px-4 py-2 text-stone-700">
                  {m.concepto || ETIQUETAS_MOVIMIENTO[m.tipo]}
                  {m.reserva && <span className="ml-2 text-xs text-stone-400">{m.reserva.codigo}</span>}
                </td>
                <td className="px-4 py-2 text-right text-stone-800">
                  {m.tipo === 'cargo' ? Number(m.monto).toLocaleString('es-AR') : ''}
                </td>
                <td className="px-4 py-2 text-right text-emerald-700">
                  {m.tipo === 'pago' ? Number(m.monto).toLocaleString('es-AR') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
