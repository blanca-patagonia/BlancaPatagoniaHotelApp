import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { terminoBusqueda } from '@/lib/listados'
import {
  BarraHerramientas,
  Buscador,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  Tarjeta,
  botonClases,
  Pagina,
  Mensaje,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import { FormularioAviso } from './formulario'
import { borrarAviso, alternarFijado } from './actions'
import { fechaHotel } from '@/lib/fechas'
import { PLANTILLAS } from '@/lib/domain/plantillas'

interface Aviso {
  id: string
  mensaje: string
  creado_en: string
  fijado: boolean
  autor_id: string | null
  automatico: boolean
  evento: string | null
  autor: { nombre: string } | null
}

/** Fecha legible y relativa para el tablón. */
function cuando(iso: string): string {
  const fecha = new Date(iso)
  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000)
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `hace ${minutos} min`
  if (minutos < 60 * 24) return `hace ${Math.floor(minutos / 60)} h`
  return fechaHotel(fecha, { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Motivos con que las acciones de esta pantalla pueden volver por `?error=`.
 * El fallback cubre cualquier motivo que no esté acá, así que sumar uno nuevo en
 * una acción nunca deja al usuario sin respuesta.
 */
const MENSAJES_ERROR: Record<string, string> = {
  fijar: 'No se pudo fijar ni desfijar el aviso. Probá de nuevo.',
  borrar: 'No se pudo borrar el aviso. Probá de nuevo.',
}

/**
 * Vistas del tablón.
 *
 * Desde la 0086 conviven lo que escribió una persona y lo que generó el sistema.
 * Mezclados sin poder separarlos, «mañana viene el técnico del ascensor» queda
 * enterrado bajo diez «pago acreditado», que es exactamente lo que hace que
 * después nadie mire el tablón.
 */
/**
 * Nombre legible del evento que originó un aviso automático.
 *
 * Sale de `PLANTILLAS`, así que un evento nuevo aparece con su nombre sin tocar
 * esta pantalla. Se arma acá y no en el `map` para no recorrer el catálogo en
 * cada fila.
 */
const NOMBRE_EVENTO: Record<string, string> = Object.fromEntries(
  Object.values(PLANTILLAS).map((p) => [p.evento, p.nombre]),
)

const VISTAS = {
  todos: { etiqueta: 'Todos', descripcion: 'Todo el tablón.' },
  equipo: { etiqueta: 'Del equipo', descripcion: 'Lo que escribió una persona.' },
  sistema: { etiqueta: 'Del sistema', descripcion: 'Lo que generó el sistema solo.' },
} as const

type Vista = keyof typeof VISTAS

function esVista(v: string | undefined): v is Vista {
  return v === 'equipo' || v === 'sistema'
}

export default async function AvisosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; vista?: string }>
}) {
  const sesion = await requerirAcceso('avisos')
  const { q, error: errorParam, vista: vistaParam } = await searchParams
  const vista: Vista = esVista(vistaParam) ? vistaParam : 'todos'
  const supabase = await crearClienteServidor()

  let consulta = supabase
    .from('avisos')
    .select('id, mensaje, creado_en, fijado, autor_id, automatico, evento, autor:perfiles(nombre)')
    // Los fijados van primero; dentro de cada grupo, del más nuevo al más viejo.
    .order('fijado', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(100)

  if (vista !== 'todos') consulta = consulta.eq('automatico', vista === 'sistema')

  const termino = terminoBusqueda(q)
  if (termino) consulta = consulta.ilike('mensaje', `%${termino}%`)

  const { data } = await consulta
  const avisos = (data ?? []) as unknown as Aviso[]
  const fijados = avisos.filter((a) => a.fijado).length

  return (
    <Pagina ancho="angosto">
      <Encabezado
        titulo="Avisos"
        descripcion="Tablón interno del equipo: novedades, pedidos y recordatorios."
        icono="avisos"
      />

      {errorParam && (
        <div className="mb-4">
          <Mensaje tono="error">
            {MENSAJES_ERROR[errorParam] ?? 'No se pudo completar la operación.'}
          </Mensaje>
        </div>
      )}

      <Tarjeta className="mb-4 p-5">
        <FormularioAviso />
      </Tarjeta>

      <BarraHerramientas>
        {/* `ocultos` mantiene la vista al buscar; sin eso, buscar salta a «todos». */}
        <Buscador
          accion="/panel/avisos"
          valor={q}
          etiqueta="Buscar avisos"
          placeholder="Buscar en los mensajes⬦"
          ocultos={{ vista: vista === 'todos' ? undefined : vista }}
        />
        <span className="flex flex-wrap gap-1.5">
          {(Object.keys(VISTAS) as Vista[]).map((v) => (
            <Link
              key={v}
              href={
                v === 'todos'
                  ? `/panel/avisos${q ? `?q=${encodeURIComponent(q)}` : ''}`
                  : `/panel/avisos?vista=${v}${q ? `&q=${encodeURIComponent(q)}` : ''}`
              }
              className={botonClases(v === vista ? 'secundario' : 'fantasma')}
              aria-current={v === vista ? 'page' : undefined}
              title={VISTAS[v].descripcion}
            >
              {VISTAS[v].etiqueta}
            </Link>
          ))}
        </span>
        {fijados > 0 && (
          <span className="text-xs text-stone-500">
            {fijados} aviso(s) fijado(s)
          </span>
        )}
        {q && (
          <Link href="/panel/avisos" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {avisos.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            titulo={q ? 'Ningún aviso coincide con la búsqueda' : 'Todavía no hay avisos'}
            descripcion={
              q
                ? 'Probá con otras palabras.'
                : 'Usá el tablón para dejarle mensajes al resto del equipo.'
            }
            icono="avisos"
          />
        </Tarjeta>
      ) : (
        <ul className="flex flex-col gap-2">
          {avisos.map((a) => {
            const puedeBorrar = a.autor_id === sesion.userId || sesion.rol === 'admin'
            return (
              <li
                key={a.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${
                  a.fijado ? 'border-lenga-300 ring-1 ring-lenga-100' : 'border-stone-200'
                }`}
              >
                {(a.fijado || a.automatico) && (
                  <p className="mb-1.5 flex flex-wrap gap-1.5">
                    {a.fijado && <Etiqueta tono="alerta">Fijado</Etiqueta>}
                    {a.automatico && <Etiqueta tono="lago">Del sistema</Etiqueta>}
                  </p>
                )}
                <p className="whitespace-pre-line text-stone-800">{a.mensaje}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                  <span>
                    {/*
                      Un aviso del sistema no tiene autor, y decir «Staff» sería
                      atribuirle a una persona algo que no escribió.
                    */}
                    {a.automatico
                      ? (a.evento && NOMBRE_EVENTO[a.evento]) || 'Aviso automático'
                      : (a.autor?.nombre ?? 'Staff')}{' '}
                    · {cuando(a.creado_en)}
                  </span>
                  <span className="flex items-center gap-3">
                    <form action={alternarFijado}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="fijar" value={a.fijado ? '0' : '1'} />
                      <button
                        className="inline-flex items-center gap-1 text-stone-600 transition hover:text-lenga-700"
                        aria-label={a.fijado ? 'Desfijar el aviso' : 'Fijar el aviso arriba'}
                      >
                        <Icono nombre="montana" tam={13} />
                        {a.fijado ? 'Desfijar' : 'Fijar'}
                      </button>
                    </form>
                    {puedeBorrar && (
                      <form action={borrarAviso}>
                        <input type="hidden" name="id" value={a.id} />
                        {/* Borrar no tiene deshacer: se pregunta antes. */}
                        <BotonEnvio
                          variante="fantasma"
                          extra="text-stone-600 hover:text-red-600"
                          cargando="Borrando⬦"
                          confirmar={`¿Borrar el aviso «${a.mensaje.slice(0, 60)}${a.mensaje.length > 60 ? '⬦' : ''}»? No se puede recuperar.`}
                        >
                          Borrar
                        </BotonEnvio>
                      </form>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Pagina>
  )
}
