import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  saldoCuenta,
  ETIQUETAS_TIPO_CUENTA,
  type TipoCuenta,
  type Movimiento,
} from '@/lib/domain/cuentas'
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
import { FormularioAgencia } from './formulario'

interface Agencia {
  id: string
  nombre: string
  tipo: TipoCuenta
  descuento_pct: number
  activo: boolean
}

export default async function AgenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string }>
}) {
  const sesion = await requerirAcceso('agencias')
  const { q, saldo: filtroSaldo } = await searchParams
  const supabase = await crearClienteServidor()

  let consulta = supabase
    .from('agencias')
    .select('id, nombre, tipo, descuento_pct, activo')
    .order('nombre')
  const termino = terminoBusqueda(q)
  if (termino) consulta = consulta.ilike('nombre', `%${termino}%`)

  const [{ data: agenciasData }, { data: movsData }] = await Promise.all([
    consulta,
    supabase.from('movimientos_cuenta').select('agencia_id, tipo, monto'),
  ])
  const agencias = (agenciasData ?? []) as Agencia[]
  const movs = (movsData ?? []) as {
    agencia_id: string
    tipo: 'cargo' | 'pago'
    monto: number | string
  }[]

  const porAgencia = new Map<string, Movimiento[]>()
  for (const m of movs) {
    const arr = porAgencia.get(m.agencia_id) ?? []
    arr.push({ tipo: m.tipo, monto: Number(m.monto) })
    porAgencia.set(m.agencia_id, arr)
  }

  const conSaldo = agencias.map((a) => ({ ...a, saldo: saldoCuenta(porAgencia.get(a.id) ?? []) }))
  const soloPendientes = filtroSaldo === 'pendiente'
  const visibles = soloPendientes ? conSaldo.filter((a) => a.saldo > 0) : conSaldo

  // Lo que las agencias le deben al hotel (cuentas por cobrar).
  const totalACobrar = conSaldo.reduce((acc, a) => acc + Math.max(0, a.saldo), 0)
  const puedeCrear = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const vigentes = { q, saldo: filtroSaldo }

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado
        titulo="Agencias y empresas"
        descripcion="Cuentas corrientes: cargos, pagos y saldo."
        icono="agencias"
        acciones={<BotonExportar href={`/panel/exportar/agencias${construirQuery({ q })}`} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi
          titulo="Total a cobrar"
          valor={`USD ${totalACobrar.toLocaleString('es-AR')}`}
          detalle="saldo pendiente de agencias"
          icono="agencias"
          tono={totalACobrar > 0 ? 'alerta' : 'exito'}
        />
        <Kpi titulo="Cuentas" valor={String(conSaldo.length)} detalle="dadas de alta" icono="huespedes" />
        <Kpi
          titulo="Con saldo"
          valor={String(conSaldo.filter((a) => a.saldo > 0).length)}
          detalle="adeudan al hotel"
          icono="alerta"
          tono="peligro"
        />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/agencias"
          valor={q}
          etiqueta="Buscar agencias"
          placeholder="Nombre de la agencia…"
          ocultos={{ saldo: filtroSaldo }}
        />
        <div className="flex gap-1.5">
          <Chip href={`/panel/agencias${construirQuery(vigentes, { saldo: undefined })}`} activo={!soloPendientes}>
            Todas
          </Chip>
          <Chip
            href={`/panel/agencias${construirQuery(vigentes, { saldo: 'pendiente' })}`}
            activo={soloPendientes}
          >
            Con saldo
          </Chip>
        </div>
        {(q || filtroSaldo) && (
          <Link href="/panel/agencias" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {puedeCrear && (
        <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
            Registrar una agencia o empresa
          </summary>
          <div className="border-t border-stone-100 p-5">
            <FormularioAgencia />
          </div>
        </details>
      )}

      <Tarjeta className="overflow-hidden">
        {visibles.length === 0 ? (
          <EstadoVacio
            titulo={q || soloPendientes ? 'Ninguna cuenta coincide' : 'Todavía no hay agencias'}
            descripcion={
              q || soloPendientes
                ? 'Probá con otro término o quitá los filtros.'
                : 'Las agencias permiten facturar a cuenta corriente con tarifa neta.'
            }
            icono="agencias"
          />
        ) : (
          <Tabla resumen="Agencias y empresas con su tipo, descuento y saldo de cuenta corriente">
            <thead>
              <tr>
                <th className={TH}>Nombre</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Estado</th>
                <th className={`${TH} text-right`}>Descuento</th>
                <th className={`${TH} text-right`}>Saldo (USD)</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.id} className={FILA}>
                  <td className={TD}>
                    <Link
                      href={`/panel/agencias/${a.id}`}
                      className="font-medium text-lago-700 hover:underline"
                    >
                      {a.nombre}
                    </Link>
                  </td>
                  <td className={`${TD} text-stone-600`}>{ETIQUETAS_TIPO_CUENTA[a.tipo]}</td>
                  <td className={TD}>
                    {a.activo ? (
                      <Etiqueta tono="exito">Activa</Etiqueta>
                    ) : (
                      <Etiqueta tono="neutro">Inactiva</Etiqueta>
                    )}
                  </td>
                  <td className={`${TD} tabular text-right text-stone-600`}>{a.descuento_pct}%</td>
                  <td
                    className={`${TD} tabular text-right font-medium ${
                      a.saldo > 0 ? 'text-red-600' : 'text-stone-800'
                    }`}
                  >
                    {a.saldo.toLocaleString('es-AR')}
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
