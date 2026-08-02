import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { saldoCuenta, type Movimiento } from '@/lib/domain/cuentas'
import {
  resumenAntiguedad,
  totalAdeudado,
  totalVencido,
  TRAMOS,
  ETIQUETAS_TRAMO,
  type ComprobanteDeuda,
} from '@/lib/domain/antiguedad'
import { hoyISO } from '@/lib/fechas'
import { construirQuery, terminoBusqueda } from '@/lib/listados'
import {
  BarraHerramientas,
  BotonExportar,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../_components/ui'
import { FormularioProveedor } from './formulario'

interface Proveedor {
  id: string
  nombre: string
  rubro: string | null
  activo: boolean
}

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string }>
}) {
  await requerirAcceso('proveedores')
  const { q, saldo: filtroSaldo } = await searchParams
  const supabase = await crearClienteServidor()

  let consulta = supabase.from('proveedores').select('id, nombre, rubro, activo').order('nombre')
  const termino = terminoBusqueda(q)
  if (termino) consulta = consulta.or(`nombre.ilike.%${termino}%,rubro.ilike.%${termino}%`)

  const [{ data: provData }, { data: movsData }] = await Promise.all([
    consulta,
    supabase
      .from('movimientos_proveedor')
      .select('proveedor_id, tipo, monto, estado, vencimiento'),
  ])
  const proveedores = (provData ?? []) as Proveedor[]
  const movs = (movsData ?? []) as (ComprobanteDeuda & { proveedor_id: string })[]

  // Reporte de antigüedad de saldos: cuánto se debe y desde hace cuánto.
  const hoy = hoyISO()
  const antiguedad = resumenAntiguedad(movs, hoy)
  const adeudado = totalAdeudado(antiguedad)
  const vencido = totalVencido(antiguedad)
  const maxTramo = Math.max(1, ...TRAMOS.map((t) => antiguedad[t]))

  const porProveedor = new Map<string, Movimiento[]>()
  for (const m of movs) {
    const arr = porProveedor.get(m.proveedor_id) ?? []
    arr.push({ tipo: m.tipo, monto: Number(m.monto) })
    porProveedor.set(m.proveedor_id, arr)
  }

  const conSaldo = proveedores.map((p) => ({
    ...p,
    saldo: saldoCuenta(porProveedor.get(p.id) ?? []),
  }))
  const soloPendientes = filtroSaldo === 'pendiente'
  const visibles = soloPendientes ? conSaldo.filter((p) => p.saldo > 0) : conSaldo

  // El total a pagar se calcula sobre TODOS los proveedores, no sobre el filtro.
  const totalAPagar = conSaldo.reduce((acc, p) => acc + Math.max(0, p.saldo), 0)
  const vigentes = { q, saldo: filtroSaldo }

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado
        titulo="Proveedores"
        descripcion="Cuentas por pagar: facturas, pagos y saldo."
        icono="proveedores"
        acciones={<BotonExportar href={`/panel/exportar/proveedores${construirQuery({ q })}`} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi
          titulo="Total a pagar"
          valor={`USD ${totalAPagar.toLocaleString('es-AR')}`}
          detalle="suma de saldos pendientes"
          icono="proveedores"
          tono={totalAPagar > 0 ? 'alerta' : 'exito'}
        />
        <Kpi
          titulo="Proveedores"
          valor={String(conSaldo.length)}
          detalle="dados de alta"
          icono="agencias"
        />
        <Kpi
          titulo="Con deuda"
          valor={String(conSaldo.filter((p) => p.saldo > 0).length)}
          detalle="con saldo pendiente"
          icono="alerta"
          tono="peligro"
        />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/proveedores"
          valor={q}
          etiqueta="Buscar proveedores"
          placeholder="Nombre o rubro…"
          ocultos={{ saldo: filtroSaldo }}
        />
        <div className="flex gap-1.5">
          <Chip href={`/panel/proveedores${construirQuery(vigentes, { saldo: undefined })}`} activo={!soloPendientes}>
            Todos
          </Chip>
          <Chip
            href={`/panel/proveedores${construirQuery(vigentes, { saldo: 'pendiente' })}`}
            activo={soloPendientes}
          >
            Con saldo
          </Chip>
        </div>
        {(q || filtroSaldo) && (
          <Link href="/panel/proveedores" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {/* El alta queda plegada para que la lista sea lo primero que se ve. */}
      <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
          Registrar un proveedor nuevo
        </summary>
        <div className="border-t border-stone-100 p-5">
          <FormularioProveedor />
        </div>
      </details>

      {/* Antigüedad de saldos: no es lo mismo deber a 5 días que a 100. */}
      <Tarjeta
        titulo="Antigüedad de saldos"
        descripcion="Deuda pendiente según hace cuánto venció cada comprobante"
        className="mb-4"
      >
        <div className="p-5">
          {adeudado === 0 ? (
            <p className="text-sm text-stone-500">
              No hay comprobantes pendientes de pago.
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-6 text-sm">
                <span>
                  <span className="text-stone-500">Total adeudado: </span>
                  <span className="tabular font-semibold text-stone-900">
                    USD {adeudado.toLocaleString('es-AR')}
                  </span>
                </span>
                <span>
                  <span className="text-stone-500">Vencido: </span>
                  <span
                    className={`tabular font-semibold ${vencido > 0 ? 'text-red-600' : 'text-emerald-700'}`}
                  >
                    USD {vencido.toLocaleString('es-AR')}
                  </span>
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {TRAMOS.map((t) => (
                  <div key={t} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-stone-500">{ETIQUETAS_TRAMO[t]}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={`h-full rounded-full ${t === 'corriente' ? 'bg-lago-400' : t === 'd90_mas' ? 'bg-red-500' : 'bg-lenga-400'}`}
                        style={{ width: `${(antiguedad[t] / maxTramo) * 100}%` }}
                      />
                    </div>
                    <span className="tabular w-24 text-right font-medium text-stone-700">
                      {antiguedad[t].toLocaleString('es-AR')}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        {visibles.length === 0 ? (
          <EstadoVacio
            titulo={
              q || soloPendientes ? 'Ningún proveedor coincide' : 'Todavía no hay proveedores'
            }
            descripcion={
              q || soloPendientes
                ? 'Probá con otro término o quitá los filtros.'
                : 'Cargá el primero con el formulario de arriba.'
            }
            icono="proveedores"
          />
        ) : (
          <Tabla resumen="Proveedores con su rubro y saldo a pagar">
            <thead>
              <tr>
                <th className={TH}>Nombre</th>
                <th className={TH}>Rubro</th>
                <th className={TH}>Estado</th>
                <th className={`${TH} text-right`}>Saldo a pagar (USD)</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id} className={FILA}>
                  <td className={TD}>
                    <Link
                      href={`/panel/proveedores/${p.id}`}
                      className="font-medium text-lago-700 hover:underline"
                    >
                      {p.nombre}
                    </Link>
                  </td>
                  <td className={`${TD} text-stone-600`}>{p.rubro || '—'}</td>
                  <td className={TD}>
                    {p.activo ? (
                      <Etiqueta tono="exito">Activo</Etiqueta>
                    ) : (
                      <Etiqueta tono="neutro">Inactivo</Etiqueta>
                    )}
                  </td>
                  <td
                    className={`${TD} tabular text-right font-medium ${
                      p.saldo > 0 ? 'text-red-600' : 'text-stone-800'
                    }`}
                  >
                    {p.saldo.toLocaleString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </div>
  )
}
