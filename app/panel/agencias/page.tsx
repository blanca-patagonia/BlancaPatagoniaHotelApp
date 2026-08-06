import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ETIQUETAS_TIPO_CUENTA, type TipoCuenta } from '@/lib/domain/cuentas'
import {
  ETAPAS_COMERCIALES,
  ETIQUETAS_ETAPA,
  conteoPorEtapa,
  tasaConversion,
  etapasPosibles,
  esGanada,
  esPerdida,
  type EtapaComercial,
} from '@/lib/domain/comercial'
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
  Pagina,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { cambiarEtapaAgencia } from './actions'

interface Agencia {
  id: string
  nombre: string
  tipo: TipoCuenta
  descuento_pct: number
  activo: boolean
  etapa: EtapaComercial
}

/** Tono de la píldora de cada etapa del embudo. */
const TONO_ETAPA: Record<EtapaComercial, 'neutro' | 'lago' | 'calafate' | 'exito' | 'peligro'> = {
  contacto: 'neutro',
  cotizacion_enviada: 'lago',
  convenio_firmado: 'calafate',
  activa: 'exito',
  perdida: 'peligro',
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
    .select('id, nombre, tipo, descuento_pct, activo, etapa')
    .order('nombre')
  const termino = terminoBusqueda(q)
  if (termino) consulta = consulta.ilike('nombre', `%${termino}%`)

  const [{ data: agenciasData }, { data: movsData }] = await Promise.all([
    consulta,
    // El saldo lo agrega la base (vista `saldos_agencias`): antes se traían
    // TODOS los movimientos para sumarlos en memoria.
    supabase.from('saldos_agencias').select('agencia_id, saldo'),
  ])
  const agencias = (agenciasData ?? []) as Agencia[]
  const saldos = new Map(
    ((movsData ?? []) as { agencia_id: string; saldo: number | string }[]).map((s) => [
      s.agencia_id,
      Number(s.saldo),
    ]),
  )

  const conSaldo = agencias.map((a) => ({ ...a, saldo: saldos.get(a.id) ?? 0 }))
  const soloPendientes = filtroSaldo === 'pendiente'
  const visibles = soloPendientes ? conSaldo.filter((a) => a.saldo > 0) : conSaldo

  // Lo que las agencias le deben al hotel (cuentas por cobrar).
  const totalACobrar = conSaldo.reduce((acc, a) => acc + Math.max(0, a.saldo), 0)
  // Embudo comercial: en qué etapa está cada negociación de convenio.
  const embudo = conteoPorEtapa(conSaldo)
  const conversion = tasaConversion(conSaldo)
  const puedeCrear = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const vigentes = { q, saldo: filtroSaldo }

  return (
    <Pagina>
      <Encabezado
        titulo="Agencias y empresas"
        descripcion="Cuentas corrientes: cargos, pagos y saldo."
        icono="agencias"
        acciones={
          <>
            <BotonExportar href={`/panel/exportar/agencias${construirQuery({ q })}`} />
            {/* La acción principal del módulo, visible desde el primer vistazo. */}
            {puedeCrear && (
              <Link href="/panel/agencias/nueva" className={botonClases('primario')}>
                <Icono nombre="mas" tam={16} />
                Registrar cuenta
              </Link>
            )}
          </>
        }
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

      {/* Embudo comercial: el trabajo previo a que la cuenta exista. */}
      <Tarjeta
        titulo="Embudo comercial"
        descripcion={
          conversion !== null
            ? `Negociación de convenios · ${conversion}% de conversión sobre las cerradas`
            : 'Negociación de convenios de tarifas netas'
        }
        className="mb-4"
      >
        <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-5">
          {ETAPAS_COMERCIALES.map((e) => (
            <div
              key={e}
              className={`rounded-xl px-3 py-2.5 text-center ring-1 ${
                esGanada(e)
                  ? 'bg-emerald-50 ring-emerald-200'
                  : esPerdida(e)
                    ? 'bg-stone-50 ring-stone-200'
                    : 'bg-lago-50/60 ring-lago-100'
              }`}
            >
              <p className="tabular font-display text-2xl leading-none font-semibold text-stone-900">
                {embudo[e]}
              </p>
              <p className="mt-1 text-xs text-stone-500">{ETIQUETAS_ETAPA[e]}</p>
            </div>
          ))}
        </div>
      </Tarjeta>

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
                <th className={TH}>Etapa comercial</th>
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Etiqueta tono={TONO_ETAPA[a.etapa]}>{ETIQUETAS_ETAPA[a.etapa]}</Etiqueta>
                      {puedeCrear &&
                        etapasPosibles(a.etapa).map((siguiente) => (
                          <form key={siguiente} action={cambiarEtapaAgencia}>
                            <input type="hidden" name="agencia_id" value={a.id} />
                            <input type="hidden" name="etapa" value={siguiente} />
                            <button
                              className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 transition hover:bg-stone-200"
                              title={`Pasar a ${ETIQUETAS_ETAPA[siguiente]}`}
                            >
                              → {ETIQUETAS_ETAPA[siguiente]}
                            </button>
                          </form>
                        ))}
                    </div>
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
    </Pagina>
  )
}
