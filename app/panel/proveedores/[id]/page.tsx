import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { saldoCuenta, type TipoMovimiento, type Movimiento } from '@/lib/domain/cuentas'
import { registrarMovimientoProveedor } from '../actions'

interface Proveedor {
  id: string
  nombre: string
  rubro: string | null
  cuit: string | null
  email: string | null
}
interface MovRow {
  id: string
  tipo: TipoMovimiento
  monto: number | string
  concepto: string
  fecha: string
}

export default async function ProveedorDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requerirAcceso('proveedores')
  const { id } = await params
  const supabase = await crearClienteServidor()

  const [{ data: provData }, { data: movsData }] = await Promise.all([
    supabase.from('proveedores').select('id, nombre, rubro, cuit, email').eq('id', id).single(),
    supabase
      .from('movimientos_proveedor')
      .select('id, tipo, monto, concepto, fecha')
      .eq('proveedor_id', id)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false }),
  ])
  if (!provData) notFound()
  const proveedor = provData as Proveedor
  const movs = (movsData ?? []) as MovRow[]
  const saldo = saldoCuenta(movs.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) }) as Movimiento))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href="/panel/proveedores" className="text-sm text-stone-500 hover:text-stone-800">
          ‹ Proveedores
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{proveedor.nombre}</h1>
      <p className="mt-1 text-sm text-stone-500">
        {proveedor.rubro ? `${proveedor.rubro} · ` : ''}
        {proveedor.cuit ? `CUIT ${proveedor.cuit} · ` : ''}
        {proveedor.email || 'sin email'}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-400">Saldo a pagar</p>
          <p className={`text-2xl font-semibold ${saldo > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            USD {saldo.toLocaleString('es-AR')}
          </p>
        </div>
        <form action={registrarMovimientoProveedor} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="proveedor_id" value={proveedor.id} />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Tipo</span>
            <select name="tipo" className="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
              <option value="cargo">Factura</option>
              <option value="pago">Pago</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Monto (USD)</span>
            <input name="monto" type="number" step="0.01" min="0" className="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">Concepto</span>
            <input name="concepto" className="w-40 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <button className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800">
            Registrar
          </button>
        </form>
      </div>

      <h2 className="mt-6 mb-2 text-sm font-medium text-stone-700">Movimientos</h2>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Concepto</th>
              <th className="px-4 py-2.5 text-right">Factura</th>
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
                <td className="px-4 py-2 text-stone-700">{m.concepto || (m.tipo === 'cargo' ? 'Factura' : 'Pago')}</td>
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
