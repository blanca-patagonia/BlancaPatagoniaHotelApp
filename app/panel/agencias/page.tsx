import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { saldoCuenta, ETIQUETAS_TIPO_CUENTA, type TipoCuenta, type Movimiento } from '@/lib/domain/cuentas'
import { FormularioAgencia } from './formulario'

interface Agencia {
  id: string
  nombre: string
  tipo: TipoCuenta
  descuento_pct: number
  activo: boolean
}

export default async function AgenciasPage() {
  const sesion = await requerirAcceso('agencias')
  const supabase = await crearClienteServidor()

  const [{ data: agenciasData }, { data: movsData }] = await Promise.all([
    supabase.from('agencias').select('id, nombre, tipo, descuento_pct, activo').order('nombre'),
    supabase.from('movimientos_cuenta').select('agencia_id, tipo, monto'),
  ])
  const agencias = (agenciasData ?? []) as Agencia[]
  const movs = (movsData ?? []) as { agencia_id: string; tipo: 'cargo' | 'pago'; monto: number | string }[]

  const saldoPorAgencia = new Map<string, Movimiento[]>()
  for (const m of movs) {
    const arr = saldoPorAgencia.get(m.agencia_id) ?? []
    arr.push({ tipo: m.tipo, monto: Number(m.monto) })
    saldoPorAgencia.set(m.agencia_id, arr)
  }

  const puedeCrear = sesion.rol === 'admin' || sesion.rol === 'gerencia'

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Agencias y empresas</h1>
      <p className="mt-1 text-sm text-stone-500">Cuentas corrientes: cargos, pagos y saldo.</p>

      {puedeCrear && (
        <div className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-stone-700">Nueva agencia / empresa</h2>
          <FormularioAgencia />
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5 text-right">Descuento</th>
              <th className="px-4 py-2.5 text-right">Saldo (USD)</th>
            </tr>
          </thead>
          <tbody>
            {agencias.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-stone-400">
                  Sin agencias todavía.
                </td>
              </tr>
            )}
            {agencias.map((a) => {
              const saldo = saldoCuenta(saldoPorAgencia.get(a.id) ?? [])
              return (
                <tr key={a.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/panel/agencias/${a.id}`} className="font-medium text-sky-700 hover:underline">
                      {a.nombre}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">{ETIQUETAS_TIPO_CUENTA[a.tipo]}</td>
                  <td className="px-4 py-2.5 text-right text-stone-600">{a.descuento_pct}%</td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${saldo > 0 ? 'text-red-600' : 'text-stone-800'}`}
                  >
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
