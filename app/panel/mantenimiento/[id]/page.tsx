import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { fechaHoraHotel } from '@/lib/fechas'
import { CAMPO, Campo, Encabezado, Mensaje, Pagina, Tarjeta } from '../../_components/ui'
import { SubirFoto } from '../../_components/subir-foto'
import { FotoAdjunta } from '../../_components/foto-adjunta'
import { BotonEnvio } from '../../_components/boton-envio'
import { agregarFotoOrden, cambiarEstadoOrden, editarOrden } from '../actions'

type Prioridad = 'baja' | 'media' | 'alta'
type EstadoM = 'pendiente' | 'en_proceso' | 'resuelta'

const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}
const ETIQUETA_ESTADO: Record<EstadoM, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
}

interface Orden {
  id: string
  titulo: string
  descripcion: string
  prioridad: Prioridad
  estado: EstadoM
  creada_en: string
  fotos: string[]
  unidad_id: string | null
  unidad: { nombre: string } | null
}

const PRIORIDADES: Prioridad[] = ['baja', 'media', 'alta']
const ESTADOS: EstadoM[] = ['pendiente', 'en_proceso', 'resuelta']

/** Motivos con que las acciones de esta pantalla pueden volver por `?error=`. */
const MENSAJES_ERROR: Record<string, string> = {
  foto_falta: 'Elegí un archivo antes de subir.',
  foto_subida: 'No se pudo subir el archivo. Probá de nuevo.',
  foto_leer: 'No se pudo leer la orden para adjuntar la foto. No se guardó nada.',
  foto_guardar: 'La foto se subió pero no se pudo asociar a la orden. Probá de nuevo.',
  orden_titulo: 'El título no puede quedar vacío.',
  orden_prioridad: 'Prioridad inválida.',
  orden_editar: 'No se pudieron guardar los cambios. Probá de nuevo.',
  estado_orden: 'No se pudo cambiar el estado. Quedó como estaba.',
}

export default async function DetalleOrdenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  await requerirAcceso('mantenimiento')
  const { id } = await params
  const { ok, error } = await searchParams
  const supabase = await crearClienteServidor()

  const [{ data, error: errorLectura }, { data: unidadesData, error: eUnidades }] =
    await Promise.all([
      supabase
        .from('ordenes_mantenimiento')
        .select('id, titulo, descripcion, prioridad, estado, creada_en, fotos, unidad_id, unidad:unidades(nombre)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('unidades').select('id, nombre').eq('activo', true).order('nombre'),
    ])
  if (errorLectura) registrarFalla(errorLectura, 'mantenimiento:detalle_orden')
  registrarFalla(eUnidades, 'mantenimiento:detalle_orden_unidades')
  const unidades = (unidadesData ?? []) as { id: string; nombre: string }[]
  if (!data) {
    if (errorLectura) {
      return (
        <Pagina>
          <Mensaje tono="error">No se pudo cargar la orden. Probá de nuevo en un momento.</Mensaje>
        </Pagina>
      )
    }
    notFound()
  }

  const orden = data as unknown as Orden

  return (
    <Pagina>
      <Link
        href="/panel/mantenimiento"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a mantenimiento
      </Link>

      {error && (
        <div className="mb-4">
          <Mensaje tono="error">{MENSAJES_ERROR[error] ?? 'No se pudo completar la operación.'}</Mensaje>
        </div>
      )}
      {ok === 'foto' && (
        <div className="mb-4">
          <Mensaje tono="ok">Foto agregada.</Mensaje>
        </div>
      )}

      <Encabezado
        titulo={orden.titulo}
        descripcion={`Creada el ${fechaHoraHotel(orden.creada_en)}`}
        icono="mantenimiento"
        acciones={
          <form action={cambiarEstadoOrden} className="flex items-center gap-2">
            <input type="hidden" name="id" value={orden.id} />
            <input type="hidden" name="origen" value="detalle" />
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              Estado
              <select
                name="estado"
                defaultValue={orden.estado}
                aria-label="Estado de la orden"
                className={`${CAMPO} py-1.5 text-sm`}
              >
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {ETIQUETA_ESTADO[e]}
                  </option>
                ))}
              </select>
            </label>
            <BotonEnvio variante="secundario" cargando="…" extra="px-3 py-1.5 text-sm">
              Guardar
            </BotonEnvio>
          </form>
        }
      />

      <Tarjeta
        titulo="Detalle"
        descripcion="Siempre editable: corregí lo que haga falta y guardá."
        className="mt-4"
      >
        <form action={editarOrden} className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          <input type="hidden" name="id" value={orden.id} />

          <Campo etiqueta="¿Qué hay que arreglar?" requerido anchoCompleto>
            <input name="titulo" required defaultValue={orden.titulo} className={CAMPO} />
          </Campo>

          <Campo etiqueta="Unidad afectada" ayuda="Dejalo en general si no es de una habitación puntual.">
            <select name="unidad_id" defaultValue={orden.unidad_id ?? ''} className={CAMPO}>
              <option value="">Sin unidad / general</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Prioridad" ayuda="Alta significa que impide usar la habitación.">
            <select name="prioridad" defaultValue={orden.prioridad} className={CAMPO}>
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {ETIQUETA_PRIORIDAD[p]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Detalle" ayuda="Lo que necesita saber quien lo va a resolver." anchoCompleto>
            <textarea name="descripcion" rows={4} defaultValue={orden.descripcion} className={CAMPO} />
          </Campo>

          <div className="sm:col-span-2">
            <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
              Guardar cambios
            </BotonEnvio>
          </div>
        </form>
      </Tarjeta>

      <Tarjeta
        titulo="Fotos"
        descripcion="La rotura, el arreglo terminado, o cualquier referencia visual de la orden."
        className="mt-4"
      >
        {orden.fotos.length === 0 ? (
          <p className="px-5 py-4 text-sm text-stone-500">Todavía no hay fotos adjuntas.</p>
        ) : (
          <div className="flex flex-wrap gap-3 p-5">
            {orden.fotos.map((ruta) => (
              <FotoAdjunta key={ruta} ruta={ruta} alt={`Foto de la orden ${orden.titulo}`} />
            ))}
          </div>
        )}

        <form
          action={agregarFotoOrden}
          className="flex flex-col gap-3 border-t border-stone-100 p-5 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="orden_id" value={orden.id} />
          <div className="flex-1">
            <SubirFoto nombre="foto" etiqueta="Agregar una foto" requerido />
          </div>
          <BotonEnvio cargando="Subiendo…" extra="w-full sm:w-auto">Subir foto</BotonEnvio>
        </form>
      </Tarjeta>
    </Pagina>
  )
}
