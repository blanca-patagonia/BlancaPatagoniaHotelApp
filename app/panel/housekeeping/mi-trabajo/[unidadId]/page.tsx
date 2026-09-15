import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { ESTADOS_ACTIVOS } from '@/lib/domain/reservas'
import { ETIQUETAS_ESTADO_HK, type EstadoHousekeeping } from '@/lib/domain/unidades'
import { MOTIVOS_PRIORIDAD, ETIQUETAS_PRIORIDAD, prioridadDe } from '@/lib/domain/housekeeping'
import { hoyISO, fechaHoraHotel } from '@/lib/fechas'
import { CAMPO, Campo, Encabezado, Mensaje, Pagina, Tarjeta, botonClases } from '../../../_components/ui'
import { SubirFoto } from '../../../_components/subir-foto'
import { FotoAdjunta } from '../../../_components/foto-adjunta'
import { BotonEnvio } from '../../../_components/boton-envio'
import { agregarRegistroLimpieza } from '../../actions'

/**
 * Detalle de una unidad de housekeeping: contexto de la habitación + historial
 * de limpieza + alta de un registro nuevo (comentario y/o foto).
 *
 * ── Por qué es una pantalla aparte y no algo más en la tarjeta de «Mi trabajo» ──
 *
 * La tarjeta principal tiene un solo botón, a propósito (ver el encabezado de
 * `mi-trabajo/page.tsx`): la mucama no elige entre estados, marca hecho. Meter
 * un formulario de comentario y foto ahí trabaría ese flujo de un toque. Esta
 * pantalla es **opcional** — se llega con un link chico desde la tarjeta — y
 * no reemplaza ni esconde el botón principal.
 */

const MENSAJES_ERROR: Record<string, string> = {
  registro_vacio: 'Escribí un comentario o adjuntá una foto antes de guardar.',
  foto_subida: 'No se pudo subir la foto. Probá de nuevo.',
  registro_guardar: 'No se pudo guardar el registro. Probá de nuevo.',
}

interface UnidadRow {
  id: string
  nombre: string
  estado: EstadoHousekeeping
  asignada_a: string | null
  tipo: { nombre: string } | null
}

interface RegistroRow {
  id: string
  comentario: string
  fotos: string[]
  creado_en: string
  mucama: { nombre: string } | null
}

export default async function DetalleUnidadHousekeepingPage({
  params,
  searchParams,
}: {
  params: Promise<{ unidadId: string }>
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  await requerirAcceso('housekeeping')
  const { unidadId } = await params
  const { ok, error } = await searchParams
  const supabase = await crearClienteServidor()
  const hoy = hoyISO()

  const { data: unidadData, error: errorUnidad } = await supabase
    .from('unidades')
    .select('id, nombre, estado, asignada_a, tipo:tipos_unidad(nombre)')
    .eq('id', unidadId)
    .maybeSingle()
  if (errorUnidad) registrarFalla(errorUnidad, 'housekeeping:detalle_unidad')
  if (!unidadData) {
    if (errorUnidad) {
      return (
        <Pagina ancho="angosto">
          <Mensaje tono="error">No se pudo cargar la habitación. Probá de nuevo en un momento.</Mensaje>
        </Pagina>
      )
    }
    notFound()
  }
  const unidad = unidadData as unknown as UnidadRow

  const [{ data: estadiasData, error: errorEstadias }, { data: ordenesData, error: errorOrdenes }, { data: registrosData, error: errorRegistros }] =
    await Promise.all([
      supabase
        .from('estadias')
        .select('check_in, check_out, estado')
        .eq('unidad_id', unidadId)
        .in('estado', [...ESTADOS_ACTIVOS])
        .or(`check_in.eq.${hoy},check_out.eq.${hoy}`),
      supabase.from('ordenes_mantenimiento').select('id').eq('unidad_id', unidadId).neq('estado', 'resuelta'),
      supabase
        .from('housekeeping_registros')
        .select('id, comentario, fotos, creado_en, mucama:perfiles(nombre)')
        .eq('unidad_id', unidadId)
        .order('creado_en', { ascending: false }),
    ])
  if (errorEstadias) registrarFalla(errorEstadias, 'housekeeping:detalle_unidad_estadias')
  if (errorOrdenes) registrarFalla(errorOrdenes, 'housekeeping:detalle_unidad_ordenes')
  if (errorRegistros) registrarFalla(errorRegistros, 'housekeeping:detalle_unidad_registros')

  const llegaHoy = (estadiasData ?? []).some((e) => e.check_in === hoy)
  const saleHoy = (estadiasData ?? []).some((e) => e.check_out === hoy)
  const enReparacion = (ordenesData ?? []).length > 0

  const prioridad = prioridadDe({
    id: unidad.id,
    nombre: unidad.nombre,
    estado: unidad.estado,
    asignadaA: unidad.asignada_a,
    tipo: unidad.tipo?.nombre ?? '',
    ocupada: false,
    saleHoy,
    llegaHoy,
    enReparacion,
  })

  const registros = (registrosData ?? []) as unknown as RegistroRow[]

  return (
    <Pagina ancho="angosto">
      <Link
        href="/panel/housekeeping/mi-trabajo"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a mi trabajo
      </Link>

      {error && <Mensaje tono="error">{MENSAJES_ERROR[error] ?? 'No se pudo completar la operación.'}</Mensaje>}
      {ok === 'registro' && <Mensaje tono="ok">Registro guardado.</Mensaje>}
      {(errorEstadias || errorOrdenes) && (
        <Mensaje tono="error">
          No se pudo leer el contexto completo de la habitación (llegadas/salidas o mantenimiento). La
          prioridad que se ve abajo puede no estar actualizada.
        </Mensaje>
      )}

      <Encabezado titulo={unidad.nombre} descripcion={unidad.tipo?.nombre ?? ''} icono="housekeeping" />

      <Tarjeta titulo="Estado actual" className="mt-4">
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Estado de limpieza</p>
            <p className="text-sm text-stone-800">{ETIQUETAS_ESTADO_HK[unidad.estado]}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Prioridad</p>
            <p className="text-sm text-stone-800">{ETIQUETAS_PRIORIDAD[prioridad]}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-stone-500">Motivo</p>
            <p className="text-sm text-stone-800">{MOTIVOS_PRIORIDAD[prioridad]}</p>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-600 sm:col-span-2">
            {llegaHoy && <span>· Llega hoy</span>}
            {saleHoy && <span>· Sale hoy</span>}
            {enReparacion && <span className="font-medium text-stone-800">· En reparación</span>}
          </div>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Historial de limpieza"
        descripcion="Registros anteriores de esta habitación, con comentario y foto."
        className="mt-4"
      >
        {registros.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">Todavía no hay registros de esta habitación.</p>
        ) : (
          <ul className="flex flex-col gap-4 p-5">
            {registros.map((r) => (
              <li key={r.id} className="border-b border-stone-100 pb-4 last:border-0 last:pb-0">
                <p className="text-xs text-stone-500">
                  {fechaHoraHotel(r.creado_en)} {r.mucama?.nombre ? `· ${r.mucama.nombre}` : ''}
                </p>
                {r.comentario && <p className="mt-1 text-sm text-stone-800">{r.comentario}</p>}
                {r.fotos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {r.fotos.map((ruta) => (
                      <FotoAdjunta key={ruta} ruta={ruta} alt={`Foto de limpieza de ${unidad.nombre}`} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Agregar un registro"
        descripcion="Opcional: un comentario, una foto, o las dos cosas."
        className="mt-4"
      >
        <form action={agregarRegistroLimpieza} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="unidad_id" value={unidad.id} />

          <Campo etiqueta="Comentario" ayuda="Por ejemplo: falta un toallón, se rompió la persiana.">
            <textarea name="comentario" rows={3} className={CAMPO} />
          </Campo>

          <SubirFoto nombre="foto" etiqueta="Foto (opcional)" />

          <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
            Guardar registro
          </BotonEnvio>
        </form>
      </Tarjeta>

      <p className="mt-4 text-right">
        <Link href="/panel/housekeeping/mi-trabajo" className={botonClases('secundario')}>
          Volver a mi trabajo
        </Link>
      </p>
    </Pagina>
  )
}
