import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  resumenAntiguedad,
  totalAdeudado,
  totalVencido,
  TRAMOS,
  ETIQUETAS_TRAMO,
  porVencer,
  esDeudaViva,
  type ComprobanteDeuda,
} from '@/lib/domain/antiguedad'
import { hoyISO, formatoFechaCorta, diasEntre } from '@/lib/fechas'
import { construirQuery, terminoBusqueda, patronOr } from '@/lib/listados'
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
  Mensaje,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  Pagina,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import { vencerComprobantes } from './actions'

interface Proveedor {
  id: string
  nombre: string
  rubro: string | null
  activo: boolean
}

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string; vencidos?: string }>
}) {
  const sesion = await requerirAcceso('proveedores')
  // Solo admin y gerencia dan de alta: la acción lo exige, así que la pantalla
  // no ofrece un botón que el servidor va a rechazar.
  const puedeGestionar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const sp = await searchParams
  const { q, saldo: filtroSaldo } = sp
  const supabase = await crearClienteServidor()

  let consulta = supabase.from('proveedores').select('id, nombre, rubro, activo').order('nombre')
  const termino = terminoBusqueda(q)
  if (termino) consulta = consulta.or(`nombre.ilike.${patronOr(termino)},rubro.ilike.${patronOr(termino)}`)

  const [{ data: provData }, { data: movsData }, { data: saldosData }] = await Promise.all([
    consulta,
    // Para el aging alcanza con la deuda VIVA: los pagos y lo ya saldado no
    // aportan al informe y son la mayor parte del historial.
    supabase
      .from('movimientos_proveedor')
      .select('proveedor_id, tipo, monto, estado, vencimiento, concepto, comprobante')
      .eq('tipo', 'cargo')
      .in('estado', ['pendiente', 'vencido']),
    // El saldo por proveedor lo agrega la base.
    supabase.from('saldos_proveedores').select('proveedor_id, saldo'),
  ])
  const proveedores = (provData ?? []) as Proveedor[]
  const movs = (movsData ?? []) as (ComprobanteDeuda & {
    proveedor_id: string
    concepto: string
    comprobante: string | null
  })[]

  // Reporte de antigüedad de saldos: cuánto se debe y desde hace cuánto.
  const hoy = hoyISO()
  const antiguedad = resumenAntiguedad(movs, hoy)
  const adeudado = totalAdeudado(antiguedad)
  const vencido = totalVencido(antiguedad)
  const maxTramo = Math.max(1, ...TRAMOS.map((t) => antiguedad[t]))

  // Recordatorio: facturas impagas que vencen dentro de la semana. Es lo que
  // evita enterarse del vencimiento cuando ya pasó.
  const DIAS_AVISO = 7
  const proximosVencimientos = porVencer(movs.filter(esDeudaViva), hoy, DIAS_AVISO).sort((a, b) =>
    (a.vencimiento ?? '').localeCompare(b.vencimiento ?? ''),
  )

  const nombrePorProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]))
  const saldos = new Map(
    ((saldosData ?? []) as { proveedor_id: string; saldo: number | string }[]).map((s) => [
      s.proveedor_id,
      Number(s.saldo),
    ]),
  )

  const conSaldo = proveedores.map((p) => ({ ...p, saldo: saldos.get(p.id) ?? 0 }))
  const soloPendientes = filtroSaldo === 'pendiente'
  const visibles = soloPendientes ? conSaldo.filter((p) => p.saldo > 0) : conSaldo

  // El total a pagar se calcula sobre TODOS los proveedores, no sobre el filtro.
  const totalAPagar = conSaldo.reduce((acc, p) => acc + Math.max(0, p.saldo), 0)
  const vigentes = { q, saldo: filtroSaldo }

  return (
    <Pagina>
      <Encabezado
        titulo="Proveedores"
        descripcion="Cuentas por pagar: facturas, pagos y saldo."
        icono="proveedores"
        acciones={
          <>
            <form action={vencerComprobantes}>
              <BotonEnvio variante="secundario" cargando="Actualizando…">
                Actualizar vencidos
              </BotonEnvio>
            </form>
            <BotonExportar href={`/panel/exportar/proveedores${construirQuery({ q })}`} />
            {/* La acción principal del módulo, visible desde el primer vistazo. */}
            {puedeGestionar && (
              <Link href="/panel/proveedores/nuevo" className={botonClases('primario')}>
                <Icono nombre="mas" tam={16} />
                Registrar proveedor
              </Link>
            )}
          </>
        }
      />

      {sp.vencidos && (
        <Mensaje tono="ok">
          Se marcaron {sp.vencidos} comprobante(s) como vencidos.
        </Mensaje>
      )}

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

      {/* Recordatorio de vencimientos: solo aparece cuando hay algo que pagar. */}
      {proximosVencimientos.length > 0 && (
        <Tarjeta
          titulo={`Vencen en los próximos ${DIAS_AVISO} días`}
          descripcion="Facturas impagas con vencimiento cercano."
          className="mb-4"
        >
          <ul>
            {proximosVencimientos.map((m, i) => {
              const dias = diasEntre(hoy, m.vencimiento!)
              const nombre = nombrePorProveedor.get(m.proveedor_id) ?? 'Proveedor'
              return (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-3 border-t border-stone-100 px-5 py-2.5 first:border-0"
                >
                  <div className="min-w-40 flex-1">
                    <p className="font-medium text-stone-800">{nombre}</p>
                    <p className="text-xs text-stone-400">
                      {m.concepto || 'Factura'}
                      {m.comprobante && ` · ${m.comprobante}`}
                    </p>
                  </div>
                  <Etiqueta tono={dias <= 2 ? 'peligro' : 'alerta'}>
                    {dias === 0 ? 'vence hoy' : dias === 1 ? 'vence mañana' : `en ${dias} días`}
                  </Etiqueta>
                  <span className="tabular text-sm text-stone-500">
                    {formatoFechaCorta(m.vencimiento!)}
                  </span>
                  <span className="tabular w-24 text-right font-medium text-stone-800">
                    USD {Number(m.monto).toLocaleString('es-AR')}
                  </span>
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      )}

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
                : 'Cargá el primero para empezar a registrar movimientos.'
            }
            icono="proveedores"
            /*
              La descripción decía «quitá los filtros» pero no daba con qué. Para
              quien no usa mucho la computadora, la diferencia entre leer una
              instrucción y tener el botón es la diferencia entre seguir o
              trabarse. Lo mismo con el alta: un listado vacío sin salida es un
              callejón.
            */
            accion={
              q || soloPendientes ? (
                <Link
                  href="/panel/proveedores"
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  Quitar filtros
                </Link>
              ) : (
                <Link
                  href="/panel/proveedores/nuevo"
                  className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800"
                >
                  Cargar el primero
                </Link>
              )
            }
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
    </Pagina>
  )
}
