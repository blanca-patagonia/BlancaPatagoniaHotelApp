import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, diasEntre, formatoFechaCorta } from '@/lib/fechas'
import {
  construirQuery,
  terminoBusqueda,
  patronOr,
  paginaActual,
  rangoDePagina,
} from '@/lib/listados'
import {
  BarraHerramientas,
  Paginacion,
  BotonExportar,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  CAMPO,
  Campo,
  Kpi,
  Pagina,
  Tarjeta,
  botonClases,
  type Tono,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import {
  PERIODICIDADES,
  planVencido,
  esInminente,
  diasParaProxima,
} from '@/lib/domain/preventivo'
import { Mensaje } from '../_components/ui'
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

/**
 * Motivos con que las acciones de esta pantalla pueden volver por `?error=`.
 *
 * Antes solo se mostraba `plan`; cualquier otro motivo no se renderizaba y el
 * usuario no veía nada.
 */
const MENSAJES_ERROR: Record<string, string> = {
  plan: 'Revisá el título y la periodicidad del plan.',
  plan_guardar: 'No se pudo guardar el plan. No quedó cargado.',
  estado_orden: 'No se pudo cambiar el estado de la orden. Quedó como estaba.',
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
    pagina?: string
  }>
}) {
  await requerirAcceso('mantenimiento')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = ESTADOS.includes(sp.estado as EstadoM) ? (sp.estado as EstadoM) : undefined
  const prioridad = PRIORIDADES.includes(sp.prioridad as Prioridad)
    ? (sp.prioridad as Prioridad)
    : undefined

  /*
    Pagina. Sin esto la consulta traía la tabla entera y PostgREST la cortaba en
    1000 filas **sin avisar**: el listado se quedaba mudo a partir de ahí y nadie
    podía saber que faltaban órdenes.
  */
  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('ordenes_mantenimiento')
    .select('id, titulo, descripcion, prioridad, estado, creada_en, unidad:unidades(nombre)', {
      count: 'exact',
    })
    .order('creada_en', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  if (prioridad) consulta = consulta.eq('prioridad', prioridad)
  const termino = terminoBusqueda(sp.q)
  if (termino) consulta = consulta.or(`titulo.ilike.${patronOr(termino)},descripcion.ilike.${patronOr(termino)}`)

  /*
    Los indicadores se cuentan EN LA BASE, no trayendo la tabla.

    Antes esto era `select('estado, prioridad')` sobre `ordenes_mantenimiento`
    entera, y PostgREST corta en 1000 filas (`max_rows`, supabase/config.toml:10)
    **con HTTP 200 y sin ningún aviso**. Verificado sembrando 1100 filas: la app
    recibía 1000, `Content-Range: 0-999/*`, sin error. O sea que a partir de la
    fila 1001 el KPI mostraba un número equivocado y nada lo delataba.

    Con `count: 'exact', head: true` la cuenta la hace Postgres y no viaja ni una
    fila: es correcto a cualquier volumen y además más barato.
  */
  const [
    { data: ordenesData, count: enFiltro },
    { data: unidadesData },
    { count: pendientesCount },
    { count: enProcesoCount },
    { count: urgentesCount },
    { data: planesData },
  ] = await Promise.all([
    consulta.range(desde, hasta),
    supabase.from('unidades').select('id, nombre').eq('activo', true).order('nombre'),
    supabase
      .from('ordenes_mantenimiento')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'pendiente'),
    supabase
      .from('ordenes_mantenimiento')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'en_proceso'),
    supabase
      .from('ordenes_mantenimiento')
      .select('*', { count: 'exact', head: true })
      .eq('prioridad', 'alta')
      .neq('estado', 'resuelta'),
    supabase
      .from('planes_mantenimiento')
      .select('id, titulo, cada_meses, proxima_ejecucion, activo, unidad:unidades(nombre)')
      .eq('activo', true)
      .order('proxima_ejecucion'),
  ])

  const ordenes = (ordenesData ?? []) as unknown as Orden[]
  const totalFiltrado = enFiltro ?? 0
  const unidades = (unidadesData ?? []) as { id: string; nombre: string }[]

  const pendientes = pendientesCount ?? 0
  const enProceso = enProcesoCount ?? 0
  const urgentes = urgentesCount ?? 0

  const hoy = hoyISO()
  const planes = (planesData ?? []) as unknown as PlanPreventivo[]
  const planesVencidos = planes.filter((p) => planVencido(p.proxima_ejecucion, hoy)).length
  const vigentes = { q: sp.q, estado, prioridad }
  const hayFiltros = Boolean(sp.q || estado || prioridad)

  return (
    <Pagina>
      <Encabezado
        titulo="Mantenimiento"
        descripcion="Órdenes de trabajo por unidad."
        icono="mantenimiento"
        acciones={
          <>
            <BotonExportar href="/panel/exportar/mantenimiento" />
            {/* La acción principal del módulo, visible desde el primer vistazo. */}
            <Link href="/panel/mantenimiento/nueva" className={botonClases('primario')}>
              <Icono nombre="mas" tam={16} />
              Crear orden
            </Link>
          </>
        }
      />

      {/* Tres KPIs en 375px daban columnas de ~110px: el número quedaba
          partido. Se apilan de a uno y recién en `sm` van los tres. */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      {sp.error && (
        <Mensaje tono="error">
          {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
        </Mensaje>
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
                    <p className="text-xs text-stone-600">
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

        <form
          action={crearPlanPreventivo}
          className="grid gap-x-4 gap-y-4 border-t border-stone-100 p-5 sm:grid-cols-4"
        >
          <div className="sm:col-span-2">
            <Campo
              etiqueta="Tarea a repetir"
              requerido
              ayuda="Se va a generar sola una orden cada tanto."
            >
              <input
                name="titulo"
                required
                className={CAMPO}
                placeholder="Revisión de calefacción"
              />
            </Campo>
          </div>
          <Campo etiqueta="Unidad">
            <select name="unidad_id" defaultValue="" className={CAMPO}>
              <option value="">Todas / general</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Cada cuánto">
            <select name="cada_meses" defaultValue="6" className={CAMPO}>
              {PERIODICIDADES.map((p) => (
                <option key={p.meses} value={p.meses}>
                  {p.etiqueta}
                </option>
              ))}
            </select>
          </Campo>
          <div className="sm:col-span-4">
            <BotonEnvio variante="secundario" cargando="Agregando…">
              <Icono nombre="mas" tam={16} />
              Agregar plan
            </BotonEnvio>
          </div>
        </form>
      </Tarjeta>

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
                  <p className="text-xs text-stone-600">
                    {o.unidad?.nombre ?? 'General'}
                    {o.descripcion ? ` · ${o.descripcion}` : ''}
                  </p>
                </div>
                {o.estado !== 'resuelta' && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
                      demorada ? 'font-medium text-lenga-700' : 'text-stone-600'
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

      {totalFiltrado > 0 && (
        <Paginacion
          base="/panel/mantenimiento"
          params={{ q: sp.q, estado, prioridad }}
          pagina={pagina}
          total={totalFiltrado}
        />
      )}
    </Pagina>
  )
}
