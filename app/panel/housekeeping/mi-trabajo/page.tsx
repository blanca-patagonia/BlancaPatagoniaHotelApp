import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import {
  ETIQUETAS_PRIORIDAD,
  MOTIVOS_PRIORIDAD,
  accionMucama,
  avance,
  contadores,
  ordenarPorPrioridad,
  prioridadDe,
  type Prioridad,
  type UnidadHousekeeping,
} from '@/lib/domain/housekeeping'
import { hoyISO } from '@/lib/fechas'
import { Icono } from '../../_components/iconos'
import { BotonEnvio } from '../../_components/boton-envio'
import { Encabezado, EstadoVacio, Mensaje, Pagina, botonClases } from '../../_components/ui'
import { marcarLimpiaDesdeMovil } from '../actions'

/**
 * «Mi trabajo»: la vista de la mucama, pensada para el celular.
 *
 * ── Por qué una pantalla aparte y no una columna más en el tablero ───────────
 *
 * El tablero de housekeeping es una herramienta de administración: filtros,
 * asignaciones, contadores de todo el hotel. Quien limpia no necesita nada de eso.
 * Necesita **tres cosas, en el orden correcto, con el pulgar**:
 *
 *  1. Qué habitación sigue.
 *  2. Por qué ésa y no otra.
 *  3. Un botón grande para decir «lista».
 *
 * Meter eso en el tablero habría significado esconder lo demás detrás de filtros —y
 * el proyecto prohíbe esconder cosas (Fase 15)— o dejar a la mucama leyendo una
 * tabla de veinte filas en una pantalla de 5 pulgadas.
 *
 * ── Decisiones de interfaz ──────────────────────────────────────────────────
 *
 * · **Una tarjeta por habitación, no una fila de tabla.** Una tabla en el teléfono
 *   obliga a desplazarse de costado, y este proyecto lo prohíbe.
 * · **Orden por prioridad, con el motivo escrito.** «Urgente» sin motivo no dice
 *   qué hacer; con «llega alguien hoy» se entiende sin preguntar.
 * · **La prioridad se comunica con ícono, texto y color**, nunca sólo color.
 * · **Un solo botón por tarjeta.** La mucama no elige entre cuatro estados: marca
 *   hecho. La inspección es de la gobernanta.
 */

const MENSAJES_ERROR: Record<string, string> = {
  ajena: 'Esa habitación está asignada a otra persona.',
  no_corresponde: 'Esa habitación ya estaba marcada. No hacía falta tocar nada.',
  no_existe: 'No se encontró la habitación.',
  estado: 'No se pudo guardar el cambio. Probá de nuevo.',
}

/** Colores y ícono de cada prioridad. Siempre acompañados de texto. */
const ESTILO_PRIORIDAD: Record<
  Prioridad,
  { caja: string; insignia: string; icono: 'alerta' | 'ok' }
> = {
  urgente: {
    caja: 'border-red-300 bg-red-50',
    insignia: 'bg-red-600 text-white',
    icono: 'alerta',
  },
  alta: {
    caja: 'border-lenga-300 bg-lenga-50',
    insignia: 'bg-lenga-600 text-white',
    icono: 'alerta',
  },
  normal: {
    caja: 'border-stone-300 bg-white',
    insignia: 'bg-stone-600 text-white',
    icono: 'ok',
  },
  sin_tarea: {
    caja: 'border-stone-200 bg-stone-50',
    insignia: 'bg-emerald-600 text-white',
    icono: 'ok',
  },
}

interface UnidadRow {
  id: string
  nombre: string
  estado: EstadoHousekeeping
  asignada_a: string | null
  tipo: { nombre: string } | null
}

export default async function MiTrabajoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; todas?: string }>
}) {
  const sesion = await requerirAcceso('housekeeping')
  const sp = await searchParams
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()

  // Admin y gerencia ven todo (la gobernanta usa la misma pantalla); una mucama ve
  // lo suyo. `?todas=1` le permite a la gobernanta mirar el conjunto.
  const soloMias = sesion.rol === 'housekeeping' && sp.todas !== '1'

  let consulta = supabase
    .from('unidades')
    .select('id, nombre, estado, asignada_a, tipo:tipos_unidad(nombre)')
    .eq('activo', true)
  if (soloMias) consulta = consulta.eq('asignada_a', sesion.userId)

  const [{ data: unidadesData }, { data: estadiasData }, { data: ordenesData }] = await Promise.all([
    consulta,
    // Llegadas y salidas de hoy, que es lo que define la prioridad.
    supabase
      .from('estadias')
      .select('unidad_id, check_in, check_out, estado')
      .in('estado', [...ESTADOS_ACTIVOS])
      .or(`check_in.eq.${hoy},check_out.eq.${hoy}`),
    // Órdenes de mantenimiento abiertas: no se manda a limpiar una habitación con
    // una cañería rota.
    supabase.from('ordenes_mantenimiento').select('unidad_id').neq('estado', 'resuelta'),
  ])

  const filas = (unidadesData ?? []) as unknown as UnidadRow[]

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

  const unidades: UnidadHousekeeping[] = filas.map((u) => ({
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

  const ordenadas = ordenarPorPrioridad(unidades)
  const c = contadores(unidades)
  const pct = avance(c)

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo={soloMias ? 'Mi trabajo de hoy' : 'Trabajo de limpieza'}
        descripcion={
          soloMias
            ? 'Tus habitaciones, en el orden en que conviene hacerlas.'
            : 'Todas las habitaciones, ordenadas por prioridad.'
        }
        icono="housekeeping"
        acciones={
          <Link href="/panel/housekeeping" className={botonClases('secundario')}>
            Tablero completo
          </Link>
        }
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>}
      {sp.ok === 'limpia' && <Mensaje tono="ok">Habitación marcada como limpia. ¡Gracias!</Mensaje>}

      {/* ── Avance del turno ────────────────────────────────────────────────
          Barra con el número al lado: la barra sola no dice cuánto falta. */}
      <div className="mb-4 rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-stone-700">Avance del turno</h2>
          <span className="tabular text-2xl leading-none font-semibold text-stone-900">{pct}%</span>
        </div>

        <div
          className="mt-2 h-3 overflow-hidden rounded-full bg-stone-200"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Avance del turno de limpieza"
        >
          <div
            className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-lago-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-2 text-sm text-stone-600">
          <strong className="text-stone-900">{c.faltantes}</strong> por hacer ·{' '}
          <strong className="text-stone-900">{c.limpiadas + c.inspeccionadas}</strong> listas
          {c.fueraDeServicio > 0 && ` · ${c.fueraDeServicio} fuera de servicio`}
        </p>

        {c.urgentes > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-800">
            <Icono nombre="alerta" tam={15} />
            {c.urgentes} urgente(s): llega alguien hoy y todavía no está lista
          </p>
        )}
      </div>

      {/* ── Las habitaciones ────────────────────────────────────────────────── */}
      {ordenadas.length === 0 ? (
        <EstadoVacio
          titulo={soloMias ? 'No tenés habitaciones asignadas' : 'No hay habitaciones activas'}
          descripcion={
            soloMias
              ? 'Cuando la gobernanta te asigne habitaciones van a aparecer acá, ordenadas por prioridad.'
              : 'Revisá que haya unidades activas en Configuración.'
          }
          icono="housekeeping"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {ordenadas.map((u) => {
            const p = prioridadDe(u)
            const estilo = ESTILO_PRIORIDAD[p]
            const accion = accionMucama(u.estado)
            const lista = u.estado === 'limpia' || u.estado === 'inspeccionada'

            return (
              <li key={u.id} className={`rounded-xl border-2 p-4 ${estilo.caja}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-xl leading-tight font-semibold text-stone-900">
                      {u.nombre}
                    </h3>
                    <p className="text-sm text-stone-600">{u.tipo}</p>
                  </div>

                  {/* Insignia con ícono + texto: la prioridad no se comunica sólo
                      con color. */}
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${estilo.insignia}`}
                  >
                    <Icono nombre={estilo.icono} tam={12} />
                    {p === 'sin_tarea' && lista
                      ? ETIQUETAS_ESTADO_HK[u.estado]
                      : ETIQUETAS_PRIORIDAD[p]}
                  </span>
                </div>

                {/* El motivo, escrito. Es lo que permite decidir si se puede dejar
                    para después sin preguntarle a nadie. */}
                <p className="mt-2 text-sm text-stone-700">{MOTIVOS_PRIORIDAD[p]}</p>

                {/* Contexto del día, con palabras. */}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-600">
                  {u.saleHoy && <span>· Sale hoy</span>}
                  {u.llegaHoy && <span>· Llega hoy</span>}
                  {u.enReparacion && (
                    <span className="font-medium text-stone-800">· En reparación</span>
                  )}
                  <span>· Estado: {ETIQUETAS_ESTADO_HK[u.estado]}</span>
                </div>

                {accion ? (
                  <form action={marcarLimpiaDesdeMovil} className="mt-3">
                    <input type="hidden" name="unidad_id" value={u.id} />
                    {/* Botón de ancho completo y alto generoso: se aprieta con el
                        pulgar, de pie, en un pasillo. */}
                    <BotonEnvio cargando="Guardando…" extra="w-full py-3 text-base">
                      {accion}
                    </BotonEnvio>
                  </form>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-800">
                    <Icono nombre="ok" tam={15} />
                    {u.enReparacion || u.estado === 'bloqueada'
                      ? 'No hay que limpiarla'
                      : 'Ya está lista'}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {sesion.rol === 'housekeeping' && (
        <p className="mt-6 text-center text-xs text-stone-500">
          {soloMias ? (
            <Link href="/panel/housekeeping/mi-trabajo?todas=1" className="hover:underline">
              Ver todas las habitaciones del hotel
            </Link>
          ) : (
            <Link href="/panel/housekeeping/mi-trabajo" className="hover:underline">
              Ver sólo las mías
            </Link>
          )}
        </p>
      )}
    </Pagina>
  )
}
