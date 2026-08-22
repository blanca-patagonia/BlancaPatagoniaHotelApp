import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  ESTADOS_HK,
  ETIQUETAS_ESTADO_HK,
  type EstadoHousekeeping,
} from '@/lib/domain/unidades'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import { contadores, type UnidadHousekeeping } from '@/lib/domain/housekeeping'
import { hoyISO } from '@/lib/fechas'
import { construirQuery } from '@/lib/listados'
import {
  BarraHerramientas,
  Chip,
  EstadoUnidad,
  Encabezado,
  EstadoVacio,
  Kpi,
  Tarjeta,
  botonClases,
  Pagina,
  Mensaje,
} from '../_components/ui'
import { cambiarEstadoUnidad, asignarMucama } from './actions'

interface UnidadRow {
  id: string
  nombre: string
  estado: EstadoHousekeeping
  tipo: { nombre: string } | null
  asignada_a: string | null
}

interface Mucama {
  id: string
  nombre: string
}

/** Una unidad con sus botones de estado y su selector de responsable. */
function FilaUnidad({ u, mucamas }: { u: UnidadRow; mucamas: Mucama[] }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-stone-100 px-4 py-3 first:border-0">
      <EstadoUnidad estado={u.estado} />
      <div className="min-w-36 flex-1">
        <p className="font-medium text-stone-800">{u.nombre}</p>
        <p className="text-xs text-stone-600">{u.tipo?.nombre}</p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Estado de ${u.nombre}`}>
        {ESTADOS_HK.map((e) => (
          <form key={e} action={cambiarEstadoUnidad}>
            <input type="hidden" name="unidad_id" value={u.id} />
            <input type="hidden" name="estado" value={e} />
            <button
              disabled={u.estado === e}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                u.estado === e
                  ? 'bg-lago-700 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {ETIQUETAS_ESTADO_HK[e]}
            </button>
          </form>
        ))}
      </div>

      <form action={asignarMucama} className="flex items-center gap-1">
        <input type="hidden" name="unidad_id" value={u.id} />
        <select
          name="mucama_id"
          defaultValue={u.asignada_a ?? ''}
          aria-label={`Responsable de limpieza de ${u.nombre}`}
          className="rounded-md border border-stone-300 px-2 py-1 text-xs focus:border-lago-500 focus:outline-none"
        >
          <option value="">Sin asignar</option>
          {mucamas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
        <button className={botonClases('secundario', 'px-2 py-1 text-xs')}>Asignar</button>
      </form>
    </li>
  )
}

/**
 * Motivos con que las acciones de esta pantalla pueden volver por `?error=`.
 * El fallback cubre cualquiera que no esté acá.
 */
const MENSAJES_ERROR: Record<string, string> = {
  estado: 'No se pudo cambiar el estado de la unidad. Quedó como estaba.',
  asignar: 'No se pudo asignar la mucama/o. La unidad quedó como estaba.',
}

export default async function HousekeepingPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; mucama?: string; vista?: string; error?: string }>
}) {
  await requerirAcceso('housekeeping')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = ESTADOS_HK.includes(sp.estado as EstadoHousekeeping)
    ? (sp.estado as EstadoHousekeeping)
    : undefined
  const porMucama = sp.vista === 'mucama'

  const hoy = hoyISO()

  const [{ data }, { data: mucamasData }, { data: estadiasData }, { data: ordenesData }] =
    await Promise.all([
      supabase
        .from('unidades')
        .select('id, nombre, estado, tipo:tipos_unidad(nombre), asignada_a')
        .eq('activo', true)
        .order('nombre'),
      supabase
        .from('perfiles')
        .select('id, nombre')
        .eq('rol', 'housekeeping')
        .eq('activo', true)
        .order('nombre'),
      // ── Contexto del día ────────────────────────────────────────────────────
      // «Sucia» no significa lo mismo si esa habitación tiene una llegada hoy a las
      // 15:00. Sin esto, el orden de limpieza lo decidía quien se acordara de mirar
      // la planilla de llegadas.
      supabase
        .from('estadias')
        .select('unidad_id, check_in, check_out')
        .in('estado', [...ESTADOS_ACTIVOS])
        .or(`check_in.eq.${hoy},check_out.eq.${hoy}`),
      supabase.from('ordenes_mantenimiento').select('unidad_id').neq('estado', 'resuelta'),
    ])

  const todas = (data ?? []) as unknown as UnidadRow[]
  const mucamas = (mucamasData ?? []) as Mucama[]

  const llegaHoy = new Set<string>()
  const saleHoy = new Set<string>()
  for (const e of (estadiasData ?? []) as { unidad_id: string; check_in: string; check_out: string }[]) {
    if (e.check_in === hoy) llegaHoy.add(e.unidad_id)
    if (e.check_out === hoy) saleHoy.add(e.unidad_id)
  }
  const enReparacion = new Set(
    ((ordenesData ?? []) as { unidad_id: string | null }[])
      .map((o) => o.unidad_id)
      .filter((x): x is string => Boolean(x)),
  )

  /** Las unidades en la forma del dominio, para poder priorizarlas y contarlas. */
  const paraDominio: UnidadHousekeeping[] = todas.map((u) => ({
    id: u.id,
    nombre: u.nombre,
    estado: u.estado,
    asignadaA: u.asignada_a,
    tipo: u.tipo?.nombre ?? '',
    ocupada: false,
    saleHoy: saleHoy.has(u.id),
    llegaHoy: llegaHoy.has(u.id),
    enReparacion: enReparacion.has(u.id),
  }))
  const resumen = contadores(paraDominio)

  // Los contadores miran el total; el filtro solo afecta a lo que se lista.
  const conteo = new Map<EstadoHousekeeping, number>()
  for (const u of todas) conteo.set(u.estado, (conteo.get(u.estado) ?? 0) + 1)

  let unidades = todas
  if (estado) unidades = unidades.filter((u) => u.estado === estado)
  if (sp.mucama) {
    unidades =
      sp.mucama === 'sin'
        ? unidades.filter((u) => !u.asignada_a)
        : unidades.filter((u) => u.asignada_a === sp.mucama)
  }

  const vigentes = { estado, mucama: sp.mucama, vista: sp.vista }
  const nombreMucama = new Map(mucamas.map((m) => [m.id, m.nombre]))

  // Agrupación para la vista por responsable.
  const grupos = new Map<string, UnidadRow[]>()
  if (porMucama) {
    for (const u of unidades) {
      const clave = u.asignada_a ?? 'sin'
      const arr = grupos.get(clave) ?? []
      arr.push(u)
      grupos.set(clave, arr)
    }
  }

  return (
    <Pagina>
      <Encabezado
        titulo="Housekeeping"
        descripcion="Estado de limpieza y responsable de cada unidad."
        icono="housekeeping"
        acciones={
          <>
            <Chip
              href={`/panel/housekeeping${construirQuery(vigentes, { vista: undefined })}`}
              activo={!porMucama}
            >
              Por unidad
            </Chip>
            <Chip
              href={`/panel/housekeeping${construirQuery(vigentes, { vista: 'mucama' })}`}
              activo={porMucama}
            >
              Por responsable
            </Chip>
            {/* La vista de la mucama: el mismo dato, ordenado por prioridad y con
                botones para el pulgar. Se ofrece desde acá para que la gobernanta
                vea lo mismo que ve el equipo. */}
            <Link href="/panel/housekeeping/mi-trabajo" className={botonClases('primario')}>
              Vista para el celular
            </Link>
          </>
        }
      />

      {sp.error && (
        <div className="mb-4">
          <Mensaje tono="error">
            {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
          </Mensaje>
        </div>
      )}

      {/* ── Contexto operativo del día ────────────────────────────────────────
          Lo que WinPAX mostraba y acá faltaba: no sólo cuántas están sucias, sino
          cuántas tienen a alguien llegando hoy. Es la diferencia entre una lista de
          estados y un orden de trabajo. */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Faltan por hacer"
          valor={String(resumen.faltantes)}
          detalle={
            resumen.urgentes > 0
              ? `${resumen.urgentes} urgente(s): llega alguien hoy`
              : 'sin urgencias'
          }
          icono={resumen.urgentes > 0 ? 'alerta' : 'housekeeping'}
          tono={resumen.urgentes > 0 ? 'peligro' : 'alerta'}
        />
        <Kpi
          titulo="Llegadas hoy"
          valor={String(llegaHoy.size)}
          detalle="habitaciones que tienen que estar listas"
          icono="reservas"
          tono="exito"
        />
        <Kpi
          titulo="Salidas hoy"
          valor={String(saleHoy.size)}
          detalle="se desocupan y hay que prepararlas"
          icono="salir"
          tono="alerta"
        />
        <Kpi
          titulo="En reparación"
          valor={String(enReparacion.size)}
          detalle="no se limpian hasta resolverlas"
          icono="mantenimiento"
          href="/panel/mantenimiento"
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {ESTADOS_HK.map((e) => (
          <Kpi
            key={e}
            titulo={ETIQUETAS_ESTADO_HK[e]}
            valor={String(conteo.get(e) ?? 0)}
            detalle="unidades"
            icono="housekeeping"
            tono={e === 'limpia' ? 'exito' : e === 'bloqueada' ? 'peligro' : e === 'sucia' ? 'alerta' : 'lago'}
            href={`/panel/housekeeping${construirQuery(vigentes, { estado: e })}`}
          />
        ))}
      </div>

      <BarraHerramientas>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            href={`/panel/housekeeping${construirQuery(vigentes, { estado: undefined })}`}
            activo={!estado}
          >
            Todos los estados
          </Chip>
          {ESTADOS_HK.map((e) => (
            <Chip
              key={e}
              href={`/panel/housekeeping${construirQuery(vigentes, { estado: e })}`}
              activo={estado === e}
            >
              {ETIQUETAS_ESTADO_HK[e]}
            </Chip>
          ))}
        </div>

        {mucamas.length > 0 && (
          <form method="get" action="/panel/housekeeping" className="flex items-center gap-2">
            {estado && <input type="hidden" name="estado" value={estado} />}
            {sp.vista && <input type="hidden" name="vista" value={sp.vista} />}
            <select
              name="mucama"
              defaultValue={sp.mucama ?? ''}
              aria-label="Filtrar por responsable"
              className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm focus:border-lago-500 focus:outline-none"
            >
              <option value="">Todas las responsables</option>
              <option value="sin">Sin asignar</option>
              {mucamas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
            <button className={botonClases('secundario')}>Filtrar</button>
          </form>
        )}

        {(estado || sp.mucama) && (
          <Link href="/panel/housekeeping" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {unidades.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            titulo="Ninguna unidad coincide"
            descripcion="Probá quitando el filtro de estado o de responsable."
            icono="housekeeping"
          />
        </Tarjeta>
      ) : porMucama ? (
        <div className="flex flex-col gap-4">
          {[...grupos.entries()].map(([clave, lista]) => (
            <Tarjeta
              key={clave}
              titulo={clave === 'sin' ? 'Sin asignar' : (nombreMucama.get(clave) ?? 'Responsable')}
              descripcion={`${lista.length} unidad(es)`}
              className="overflow-hidden"
            >
              <ul>
                {lista.map((u) => (
                  <FilaUnidad key={u.id} u={u} mucamas={mucamas} />
                ))}
              </ul>
            </Tarjeta>
          ))}
        </div>
      ) : (
        <Tarjeta className="overflow-hidden">
          <ul>
            {unidades.map((u) => (
              <FilaUnidad key={u.id} u={u} mucamas={mucamas} />
            ))}
          </ul>
        </Tarjeta>
      )}
    </Pagina>
  )
}
