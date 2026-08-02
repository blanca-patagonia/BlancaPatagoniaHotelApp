import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, diasEntre, formatoFechaCorta } from '@/lib/fechas'
import { construirQuery, terminoBusqueda } from '@/lib/listados'
import {
  BarraHerramientas,
  BotonExportar,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  Kpi,
  Tarjeta,
  botonClases,
  type Tono,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import {
  PERIODICIDADES,
  planVencido,
  esInminente,
  diasParaProxima,
} from '@/lib/domain/preventivo'
import { Mensaje } from '../_components/ui'
import { FormularioOrden } from './formulario'
import { cambiarEstadoOrden, crearPlanPreventivo, generarPreventivo } from './actions'

interface PlanPreventivo {
  id: string
  titulo: string
  cada_meses: number
  proxima_ejecucion: string
  activo: boolean
  unidad: { nombre: string } | null
}

type Prioridad = 'baja' | 'media' | 'alta'
type EstadoM = 'pendiente' | 'en_proceso' | 'resuelta'

const PRIORIDADES: Prioridad[] = ['alta', 'media', 'baja']
const ESTADOS: EstadoM[] = ['pendiente', 'en_proceso', 'resuelta']

const TONO_PRIORIDAD: Record<Prioridad, Tono> = {
  baja: 'neutro',
  media: 'alerta',
  alta: 'peligro',
}
const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}
const TONO_ESTADO_M: Record<EstadoM, Tono> = {
  pendiente: 'alerta',
  en_proceso: 'lago',
  resuelta: 'exito',
}
const ETIQUETA_ESTADO: Record<EstadoM, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
}
const SIGUIENTE: Record<EstadoM, { estado: EstadoM; label: string } | null> = {
  pendiente: { estado: 'en_proceso', label: 'Tomar' },
  en_proceso: { estado: 'resuelta', label: 'Resolver' },
  resuelta: null,
}

interface Orden {
  id: string
  titulo: string
  descripcion: string
  prioridad: Prioridad
  estado: EstadoM
  creada_en: string
  unidad: { nombre: string } | null
}

export default async function MantenimientoPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    estado?: string
    prioridad?: string
    ok?: string
    error?: string
    generadas?: string
  }>
}) {
  await requerirAcceso('mantenimiento')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = ESTADOS.includes(sp.estado as EstadoM) ? (sp.estado as EstadoM) : undefined
  const prioridad = PRIORIDADES.includes(sp.prioridad as Prioridad)
    ? (sp.prioridad as Prioridad)
    : undefined

  let consulta = supabase
    .from('ordenes_mantenimiento')
    .select('id, titulo, descripcion, prioridad, estado, creada_en, unidad:unidades(nombre)')
    .order('creada_en', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  if (prioridad) consulta = consulta.eq('prioridad', prioridad)
  const termino = terminoBusqueda(sp.q)
  if (termino) consulta = consulta.or(`titulo.ilike.%${termino}%,descripcion.ilike.%${termino}%`)

  const [{ data: ordenesData }, { data: unidadesData }, { data: todasData }, { data: planesData }] =
    await Promise.all([
      consulta,
      supabase.from('unidades').select('id, nombre').eq('activo', true).order('nombre'),
      // Sin filtrar: los indicadores deben reflejar el total, no la vista actual.
      supabase.from('ordenes_mantenimiento').select('estado, prioridad'),
      supabase
        .from('planes_mantenimiento')
        .select('id, titulo, cada_meses, proxima_ejecucion, activo, unidad:unidades(nombre)')
        .eq('activo', true)
        .order('proxima_ejecucion'),
    ])

  const ordenes = (ordenesData ?? []) as unknown as Orden[]
  const unidades = (unidadesData ?? []) as { id: string; nombre: string }[]
  const todas = (todasData ?? []) as { estado: EstadoM; prioridad: Prioridad }[]

  const pendientes = todas.filter((o) => o.estado === 'pendiente').length
  const enProceso = todas.filter((o) => o.estado === 'en_proceso').length
  const urgentes = todas.filter((o) => o.prioridad === 'alta' && o.estado !== 'resuelta').length

  const hoy = hoyISO()
  const planes = (planesData ?? []) as unknown as PlanPreventivo[]
  const planesVencidos = planes.filter((p) => planVencido(p.proxima_ejecucion, hoy)).length
  const vigentes = { q: sp.q, estado, prioridad }
  const hayFiltros = Boolean(sp.q || estado || prioridad)

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado
        titulo="Mantenimiento"
        descripcion="Órdenes de trabajo por unidad."
        icono="mantenimiento"
        acciones={<BotonExportar href="/panel/exportar/mantenimiento" />}
      />

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Kpi titulo="Pendientes" valor={String(pendientes)} icono="mantenimiento" tono="alerta" />
        <Kpi titulo="En proceso" valor={String(enProceso)} icono="config" tono="lago" />
        <Kpi
          titulo="Prioridad alta"
          valor={String(urgentes)}
          detalle="sin resolver"
          icono="alerta"
          tono="peligro"
        />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/mantenimiento"
          valor={sp.q}
          etiqueta="Buscar órdenes"
          placeholder="Título o descripción…"
          ocultos={{ estado, prioridad }}
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip href={`/panel/mantenimiento${construirQuery(vigentes, { estado: undefined })}`} activo={!estado}>
            Todas
          </Chip>
          {ESTADOS.map((e) => (
            <Chip
              key={e}
              href={`/panel/mantenimiento${construirQuery(vigentes, { estado: e })}`}
              activo={estado === e}
            >
              {ETIQUETA_ESTADO[e]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRIORIDADES.map((p) => (
            <Chip
              key={p}
              href={`/panel/mantenimiento${construirQuery(vigentes, {
                prioridad: prioridad === p ? undefined : p,
              })}`}
              activo={prioridad === p}
            >
              {ETIQUETA_PRIORIDAD[p]}
            </Chip>
          ))}
        </div>
        {hayFiltros && (
          <Link href="/panel/mantenimiento" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {sp.generadas && (
        <Mensaje tono="ok">
          Se generaron {sp.generadas} orden(es) a partir de los planes preventivos vencidos.
        </Mensaje>
      )}
      {sp.ok === 'plan' && <Mensaje tono="ok">Plan preventivo creado.</Mensaje>}
      {sp.error === 'plan' && (
        <Mensaje tono="error">Revisá el título y la periodicidad del plan.</Mensaje>
      )}

      {/* Mantenimiento preventivo: lo planificado, que es lo que evita la avería. */}
      <Tarjeta
        titulo="Mantenimiento preventivo"
        descripcion="Tareas recurrentes por unidad; generan la orden solas al vencer."
        className="mb-4"
        acciones={
          planesVencidos > 0 ? (
            <form action={generarPreventivo}>
              <button className={botonClases('primario')}>
                Generar órdenes ({planesVencidos})
              </button>
            </form>
          ) : null
        }
      >
        {planes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">
            No hay planes cargados. Por ejemplo: revisar la calefacción de cada cabaña cada 6 meses.
          </p>
        ) : (
          <ul>
            {planes.map((p) => {
              const vencido = planVencido(p.proxima_ejecucion, hoy)
              const pronto = esInminente(p.proxima_ejecucion, hoy)
              const dias = diasParaProxima(p.proxima_ejecucion, hoy)
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 border-t border-stone-100 px-5 py-2.5 first:border-0"
                >
                  <div className="min-w-40 flex-1">
                    <p className="font-medium text-stone-800">{p.titulo}</p>
                    <p className="text-xs text-stone-400">
                      {p.unidad?.nombre ?? 'General'} · cada {p.cada_meses}{' '}
                      {p.cada_meses === 1 ? 'mes' : 'meses'}
                    </p>
                  </div>
                  <span className="tabular text-xs text-stone-500">
                    {formatoFechaCorta(p.proxima_ejecucion)}
                  </span>
                  {vencido ? (
                    <Etiqueta tono="peligro">Vencido</Etiqueta>
                  ) : pronto ? (
                    <Etiqueta tono="alerta">En {dias} días</Etiqueta>
                  ) : (
                    <Etiqueta tono="neutro">En {dias} días</Etiqueta>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <form action={crearPlanPreventivo} className="grid gap-2 border-t border-stone-100 p-5 sm:grid-cols-4">
          <input
            name="titulo"
            required
            placeholder="Tarea (ej: revisión de calefacción)"
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lago-600 sm:col-span-2"
          />
          <select
            name="unidad_id"
            defaultValue=""
            aria-label="Unidad del plan"
            className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-lago-600 focus:outline-none"
          >
            <option value="">Todas / general</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
          <select
            name="cada_meses"
            defaultValue="6"
            aria-label="Periodicidad"
            className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-lago-600 focus:outline-none"
          >
            {PERIODICIDADES.map((p) => (
              <option key={p.meses} value={p.meses}>
                {p.etiqueta}
              </option>
            ))}
          </select>
          <button className={botonClases('secundario', 'sm:col-span-4')}>+ Agregar plan</button>
        </form>
      </Tarjeta>

      <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
          Crear una orden de trabajo
        </summary>
        <div className="border-t border-stone-100 p-5">
          <FormularioOrden unidades={unidades} />
        </div>
      </details>

      {ordenes.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            titulo={hayFiltros ? 'Ninguna orden coincide' : 'No hay órdenes de mantenimiento'}
            descripcion={
              hayFiltros
                ? 'Probá con otros filtros.'
                : 'Cuando registres una avería o una tarea, aparece acá.'
            }
            icono="mantenimiento"
          />
        </Tarjeta>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordenes.map((o) => {
            const sig = SIGUIENTE[o.estado]
            const dias = o.creada_en ? diasEntre(o.creada_en.slice(0, 10), hoy) : 0
            // Una orden abierta hace más de una semana merece destacarse.
            const demorada = o.estado !== 'resuelta' && dias >= 7
            return (
              <li
                key={o.id}
                className={`flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm ${
                  o.estado === 'resuelta' ? 'border-stone-200 opacity-60' : 'border-stone-200'
                } ${demorada ? 'ring-1 ring-lenga-200' : ''}`}
              >
                <Etiqueta tono={TONO_PRIORIDAD[o.prioridad]}>
                  {ETIQUETA_PRIORIDAD[o.prioridad]}
                </Etiqueta>
                <div className="min-w-40 flex-1">
                  <p className="font-medium text-stone-800">{o.titulo}</p>
                  <p className="text-xs text-stone-400">
                    {o.unidad?.nombre ?? 'General'}
                    {o.descripcion ? ` · ${o.descripcion}` : ''}
                  </p>
                </div>
                {o.estado !== 'resuelta' && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
                      demorada ? 'font-medium text-lenga-700' : 'text-stone-400'
                    }`}
                  >
                    {demorada && <Icono nombre="alerta" tam={13} />}
                    {dias === 0 ? 'hoy' : `hace ${dias} día${dias === 1 ? '' : 's'}`}
                  </span>
                )}
                <Etiqueta tono={TONO_ESTADO_M[o.estado]}>{ETIQUETA_ESTADO[o.estado]}</Etiqueta>
                {sig && (
                  <form action={cambiarEstadoOrden}>
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="estado" value={sig.estado} />
                    <button className={botonClases('primario', 'px-3 py-1.5 text-xs')}>
                      {sig.label}
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
