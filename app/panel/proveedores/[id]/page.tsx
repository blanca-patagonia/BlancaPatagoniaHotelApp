import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { saldoCuenta, type TipoMovimiento, type Movimiento } from '@/lib/domain/cuentas'
import { registrarMovimientoProveedor, marcarComprobantePagado } from '../actions'
import {
  ETIQUETAS_ESTADO_COMPROBANTE,
  clasificarTramo,
  ETIQUETAS_TRAMO,
  type EstadoComprobante,
} from '@/lib/domain/antiguedad'
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'
import { Encabezado, Etiqueta, Mensaje, Pagina, botonClases } from '../../_components/ui'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'

interface Proveedor {
  id: string
  nombre: string
  rubro: string | null
  cuit: string | null
  email: string | null
  telefono: string | null
  activo: boolean
  token: string
}
interface MovRow {
  id: string
  tipo: TipoMovimiento
  monto: number | string
  concepto: string
  fecha: string
  estado: EstadoComprobante
  vencimiento: string | null
  comprobante: string | null
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
    supabase.from('proveedores').select('id, nombre, rubro, cuit, email, telefono, token, activo').eq('id', id).single(),
    supabase
      .from('movimientos_proveedor')
      .select('id, tipo, monto, concepto, fecha, estado, vencimiento, comprobante')
      .eq('proveedor_id', id)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false }),
  ])
  if (!provData) notFound()
  const proveedor = provData as Proveedor
  const cabeceras = await headers()
  const origen = `${cabeceras.get('x-forwarded-proto') ?? 'http'}://${cabeceras.get('host') ?? 'localhost:3000'}`
  const movs = (movsData ?? []) as MovRow[]
  const saldo = saldoCuenta(movs.map((m) => ({ tipo: m.tipo, monto: Number(m.monto) }) as Movimiento))
  const hoy = hoyISO()

  return (
    <Pagina>
      <Link
        href="/panel/proveedores"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a proveedores
      </Link>

      <Encabezado
        titulo={proveedor.nombre}
        descripcion={`${proveedor.rubro ? `${proveedor.rubro} · ` : ''}${proveedor.cuit ? `CUIT ${proveedor.cuit} · ` : ''}${proveedor.email || 'sin email'}`}
        icono="proveedores"
        acciones={
          <Link
            href={`/panel/proveedores/${proveedor.id}/editar`}
            className={botonClases('secundario')}
          >
            <Icono nombre="config" tam={16} />
            Editar datos
          </Link>
        }
      />
      {!proveedor.activo && (
        <div className="mb-4">
          <Mensaje tono="error">
            Este proveedor está dado de baja: no aparece al cargar gastos nuevos.
          </Mensaje>
        </div>
      )}

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
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-stone-500">N.º comprobante</span>
            <input
              name="comprobante"
              placeholder="0001-00001234"
              className="w-32 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {/* Solo aplica a las facturas: es lo que alimenta el aging report. */}
            <span className="text-stone-500">Vence (solo facturas)</span>
            <input
              name="vencimiento"
              type="date"
              className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          {/* Mueve dinero: el botón se bloquea mientras viaja al servidor para
              que un segundo clic no duplique el comprobante. */}
          <BotonEnvio cargando="Registrando…">Registrar</BotonEnvio>
        </form>
      </div>


      {/* Edición de los datos: sin esto había que tocar la base a mano. */}
      {/* Enlace del portal: el socio ve sus contratos y su cuenta sin cuenta de usuario. */}
      <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold text-stone-900">Portal del socio</h2>
        <p className="mt-1 text-sm text-stone-500">
          Enlace personal para que consulte sus contratos y su cuenta corriente. Quien lo tenga
          accede: mandalo solo al contacto de la empresa.
        </p>
        <code className="mt-3 block rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-700 ring-1 ring-stone-200">
          {origen}/portal/{proveedor.token}
        </code>
        <a
          href={`/portal/${proveedor.token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Abrir el portal
        </a>
      </section>

      <h2 className="mt-6 mb-2 text-sm font-medium text-stone-700">Movimientos</h2>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Concepto</th>
              <th className="px-4 py-2.5">Vencimiento</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5 text-right">Factura</th>
              <th className="px-4 py-2.5 text-right">Pago</th>
            </tr>
          </thead>
          <tbody>
            {movs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Sin movimientos.
                </td>
              </tr>
            )}
            {movs.map((m) => (
              <tr key={m.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2 text-stone-500">{m.fecha}</td>
                <td className="px-4 py-2 text-stone-700">
                  {m.concepto || (m.tipo === 'cargo' ? 'Factura' : 'Pago')}
                  {m.comprobante && (
                    <span className="ml-1.5 text-xs text-stone-400">{m.comprobante}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-stone-500">
                  {m.vencimiento ? (
                    <>
                      {formatoFechaCorta(m.vencimiento)}
                      {m.estado !== 'pagado' && (
                        <span className="ml-1.5 text-xs text-stone-400">
                          {ETIQUETAS_TRAMO[clasificarTramo(m.vencimiento, hoy)]}
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2">
                  {m.tipo === 'pago' ? (
                    <Etiqueta tono="exito">Registrado</Etiqueta>
                  ) : m.estado === 'pagado' ? (
                    <Etiqueta tono="exito">Pagado</Etiqueta>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Etiqueta tono={m.estado === 'vencido' ? 'peligro' : 'alerta'}>
                        {ETIQUETAS_ESTADO_COMPROBANTE[m.estado]}
                      </Etiqueta>
                      <form action={marcarComprobantePagado}>
                        <input type="hidden" name="movimiento_id" value={m.id} />
                        <input type="hidden" name="proveedor_id" value={proveedor.id} />
                        <button className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 transition hover:bg-stone-200">
                          Saldar
                        </button>
                      </form>
                    </span>
                  )}
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
    </Pagina>
  )
}
