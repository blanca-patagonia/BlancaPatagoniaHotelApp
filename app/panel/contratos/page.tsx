import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'
import { construirQuery, terminoBusqueda } from '@/lib/listados'
import {
  ESTADOS_CONTRATO,
  ETIQUETAS_ESTADO_CONTRATO,
  ETIQUETAS_TIPO_CONTRATO,
  estaVigente,
  vencidoPorFecha,
  type EstadoContrato,
  type TipoContrato,
} from '@/lib/domain/contratos'
import {
  BarraHerramientas,
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
  type Tono,
} from '../_components/ui'
import { FormularioContrato, type OpcionEntidad } from './formulario'
import { vencerContratos } from './actions'

/** Tono de la etiqueta de cada estado del contrato. */
const TONO_CONTRATO: Record<EstadoContrato, Tono> = {
  borrador: 'neutro',
  enviado: 'lago',
  firmado: 'exito',
  rechazado: 'peligro',
  vencido: 'alerta',
}

interface ContratoRow {
  id: string
  tipo: TipoContrato
  entidad_id: string
  titulo: string
  estado: EstadoContrato
  vigencia_desde: string | null
  vigencia_hasta: string | null
  fecha_firma: string | null
}

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; tipo?: string; ok?: string }>
}) {
  await requerirAcceso('contratos')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = (ESTADOS_CONTRATO as readonly string[]).includes(sp.estado ?? '')
    ? (sp.estado as EstadoContrato)
    : undefined
  const tipo = ['agencia', 'proveedor', 'empleado'].includes(sp.tipo ?? '')
    ? (sp.tipo as TipoContrato)
    : undefined

  let consulta = supabase
    .from('contratos')
    .select('id, tipo, entidad_id, titulo, estado, vigencia_desde, vigencia_hasta, fecha_firma')
    .order('creado_en', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  if (tipo) consulta = consulta.eq('tipo', tipo)
  const termino = terminoBusqueda(sp.q)
  if (termino) consulta = consulta.ilike('titulo', `%${termino}%`)

  // Las entidades son polimórficas: se traen las tres tablas y se arma un mapa
  // de nombres para mostrar con quién se firma cada contrato.
  const [{ data }, { data: agencias }, { data: proveedores }, { data: empleados }] =
    await Promise.all([
      consulta,
      supabase.from('agencias').select('id, nombre').order('nombre'),
      supabase.from('proveedores').select('id, nombre').order('nombre'),
      supabase.from('perfiles').select('id, nombre').eq('activo', true).order('nombre'),
    ])

  const contratos = (data ?? []) as ContratoRow[]
  const nombres = new Map<string, string>()
  for (const a of agencias ?? []) nombres.set(a.id as string, a.nombre as string)
  for (const p of proveedores ?? []) nombres.set(p.id as string, p.nombre as string)
  for (const e of empleados ?? []) nombres.set(e.id as string, e.nombre as string)

  const opciones = (
    filas: { id: string; nombre: string }[] | null,
    t: TipoContrato,
  ): OpcionEntidad[] =>
    (filas ?? []).map((f) => ({ valor: `${t}:${f.id}`, nombre: f.nombre }))

  const hoy = hoyISO()
  const vigentes = contratos.filter((c) => estaVigente(c, hoy)).length
  const pendientesFirma = contratos.filter((c) => c.estado === 'enviado').length
  const porVencer = contratos.filter(
    (c) => c.estado === 'enviado' && vencidoPorFecha(c.vigencia_hasta, hoy),
  ).length

  const filtros = { q: sp.q, estado, tipo }
  const hayFiltros = Boolean(sp.q || estado || tipo)

  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Contratos"
        descripcion="Convenios con agencias, proveedores y empleados, con firma electrónica."
        icono="contratos"
        acciones={
          porVencer > 0 ? (
            <form action={vencerContratos}>
              <button className={botonClases('secundario')}>Marcar vencidos ({porVencer})</button>
            </form>
          ) : null
        }
      />

      {sp.ok === 'vencidos' && (
        <Mensaje tono="ok">Se marcaron como vencidos los contratos fuera de vigencia.</Mensaje>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi titulo="Total" valor={String(contratos.length)} detalle="en el listado" icono="contratos" />
        <Kpi titulo="Vigentes" valor={String(vigentes)} detalle="firmados y en fecha" icono="ok" tono="exito" />
        <Kpi
          titulo="Esperando firma"
          valor={String(pendientesFirma)}
          detalle="enviados sin responder"
          icono="firma"
          tono="lago"
        />
        <Kpi
          titulo="Fuera de vigencia"
          valor={String(porVencer)}
          detalle="enviados y ya vencidos"
          icono="alerta"
          tono={porVencer > 0 ? 'peligro' : 'neutro'}
        />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/contratos"
          valor={sp.q}
          etiqueta="Buscar contratos"
          placeholder="Título del contrato…"
          ocultos={{ estado, tipo }}
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip href={`/panel/contratos${construirQuery(filtros, { estado: undefined })}`} activo={!estado}>
            Todos
          </Chip>
          {ESTADOS_CONTRATO.map((e) => (
            <Chip
              key={e}
              href={`/panel/contratos${construirQuery(filtros, { estado: e })}`}
              activo={estado === e}
            >
              {ETIQUETAS_ESTADO_CONTRATO[e]}
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['agencia', 'proveedor', 'empleado'] as TipoContrato[]).map((t) => (
            <Chip
              key={t}
              href={`/panel/contratos${construirQuery(filtros, { tipo: tipo === t ? undefined : t })}`}
              activo={tipo === t}
            >
              {ETIQUETAS_TIPO_CONTRATO[t]}
            </Chip>
          ))}
        </div>
        {hayFiltros && (
          <Link href="/panel/contratos" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
          Redactar un contrato nuevo
        </summary>
        <div className="border-t border-stone-100 p-5">
          <FormularioContrato
            agencias={opciones(agencias as { id: string; nombre: string }[], 'agencia')}
            proveedores={opciones(proveedores as { id: string; nombre: string }[], 'proveedor')}
            empleados={opciones(empleados as { id: string; nombre: string }[], 'empleado')}
          />
        </div>
      </details>

      <Tarjeta className="overflow-hidden">
        {contratos.length === 0 ? (
          <EstadoVacio
            titulo={hayFiltros ? 'Ningún contrato coincide' : 'Todavía no hay contratos'}
            descripcion={
              hayFiltros
                ? 'Probá con otro término o quitá los filtros.'
                : 'Redactá el primero con el formulario de arriba y enviálo a firmar.'
            }
            icono="contratos"
          />
        ) : (
          <Tabla resumen="Contratos con su contraparte, vigencia y estado de firma">
            <thead>
              <tr>
                <th className={TH}>Título</th>
                <th className={TH}>Contraparte</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Vigencia</th>
                <th className={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id} className={FILA}>
                  <td className={TD}>
                    <Link
                      href={`/panel/contratos/${c.id}`}
                      className="font-medium text-lago-700 hover:underline"
                    >
                      {c.titulo}
                    </Link>
                  </td>
                  <td className={`${TD} text-stone-700`}>
                    {nombres.get(c.entidad_id) ?? '—'}
                  </td>
                  <td className={`${TD} text-stone-500`}>{ETIQUETAS_TIPO_CONTRATO[c.tipo]}</td>
                  <td className={`${TD} text-stone-600`}>
                    {c.vigencia_desde || c.vigencia_hasta ? (
                      <>
                        {c.vigencia_desde ? formatoFechaCorta(c.vigencia_desde) : '—'}
                        {' → '}
                        {c.vigencia_hasta ? formatoFechaCorta(c.vigencia_hasta) : 'sin fin'}
                      </>
                    ) : (
                      <span className="text-stone-400">sin definir</span>
                    )}
                  </td>
                  <td className={TD}>
                    <Etiqueta tono={TONO_CONTRATO[c.estado]}>
                      {ETIQUETAS_ESTADO_CONTRATO[c.estado]}
                    </Etiqueta>
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
