import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { fechaHoraHotel } from '@/lib/fechas'
import { Encabezado, Etiqueta, Mensaje, Pagina, Tarjeta, type Tono } from '../../_components/ui'
import { SubirFoto } from '../../_components/subir-foto'
import { FotoAdjunta } from '../../_components/foto-adjunta'
import { BotonEnvio } from '../../_components/boton-envio'
import { agregarFotoOrden } from '../actions'

type Prioridad = 'baja' | 'media' | 'alta'
type EstadoM = 'pendiente' | 'en_proceso' | 'resuelta'

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

interface Orden {
  id: string
  titulo: string
  descripcion: string
  prioridad: Prioridad
  estado: EstadoM
  creada_en: string
  fotos: string[]
  unidad: { nombre: string } | null
}

/** Motivos con que `agregarFotoOrden` puede volver por `?error=`. */
const MENSAJES_ERROR: Record<string, string> = {
  foto_falta: 'Elegí un archivo antes de subir.',
  foto_subida: 'No se pudo subir el archivo. Probá de nuevo.',
  foto_leer: 'No se pudo leer la orden para adjuntar la foto. No se guardó nada.',
  foto_guardar: 'La foto se subió pero no se pudo asociar a la orden. Probá de nuevo.',
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

  const { data, error: errorLectura } = await supabase
    .from('ordenes_mantenimiento')
    .select('id, titulo, descripcion, prioridad, estado, creada_en, fotos, unidad:unidades(nombre)')
    .eq('id', id)
    .maybeSingle()
  if (errorLectura) registrarFalla(errorLectura, 'mantenimiento:detalle_orden')
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
        descripcion={orden.unidad?.nombre ?? 'General'}
        icono="mantenimiento"
        acciones={
          <>
            <Etiqueta tono={TONO_PRIORIDAD[orden.prioridad]}>
              {ETIQUETA_PRIORIDAD[orden.prioridad]}
            </Etiqueta>
            <Etiqueta tono={TONO_ESTADO_M[orden.estado]}>{ETIQUETA_ESTADO[orden.estado]}</Etiqueta>
          </>
        }
      />

      <Tarjeta titulo="Detalle" className="mt-4">
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Unidad</p>
            <p className="text-sm text-stone-800">{orden.unidad?.nombre ?? 'General'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Creada</p>
            <p className="text-sm text-stone-800">{fechaHoraHotel(orden.creada_en)}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-stone-500">Descripción</p>
            <p className="text-sm whitespace-pre-wrap text-stone-800">
              {orden.descripcion || 'Sin descripción.'}
            </p>
          </div>
        </div>
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
