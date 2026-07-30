import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { saldoCuenta, type Movimiento } from '@/lib/domain/cuentas'
import { FormularioProveedor } from './formulario'

interface Proveedor {
  id: string
  nombre: string
  rubro: string | null
}

export default async function ProveedoresPage() {
  await requerirAcceso('proveedores')
  const supabase = await crearClienteServidor()

  const [{ data: provData }, { data: movsData }] = await Promise.all([
    supabase.from('proveedores').select('id, nombre, rubro').order('nombre'),
    supabase.from('movimientos_proveedor').select('proveedor_id, tipo, monto'),
  ])
  const proveedores = (provData ?? []) as Proveedor[]
  const movs = (movsData ?? []) as { proveedor_id: string; tipo: 'cargo' | 'pago'; monto: number | string }[]

  const porProveedor = new Map<string, Movimiento[]>()
  for (const m of movs) {
    const arr = porProveedor.get(m.proveedor_id) ?? []
    arr.push({ tipo: m.tipo, monto: Number(m.monto) })
    porProveedor.set(m.proveedor_id, arr)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Proveedores</h1>
      <p className="mt-1 text-sm text-stone-500">Cuentas por pagar: facturas, pagos y saldo.</p>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-stone-700">Nuevo proveedor</h2>
        <FormularioProveedor />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">Rubro</th>
              <th className="px-4 py-2.5 text-right">Saldo a pagar (USD)</th>
            </tr>
          </thead>
          <tbody>
            {proveedores.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-stone-400">
                  Sin proveedores todavía.
                </td>
              </tr>
            )}
            {proveedores.map((p) => {
              const saldo = saldoCuenta(porProveedor.get(p.id) ?? [])
              return (
                <tr key={p.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/panel/proveedores/${p.id}`} className="font-medium text-sky-700 hover:underline">
                      {p.nombre}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">{p.rubro || '—'}</td>
                  <td className={`px-4 py-2.5 text-right font-medium ${saldo > 0 ? 'text-red-600' : 'text-stone-800'}`}>
                    {saldo.toLocaleString('es-AR')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
