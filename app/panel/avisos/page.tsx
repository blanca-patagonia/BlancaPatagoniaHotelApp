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
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import { FormularioAviso } from './formulario'
import { borrarAviso, alternarFijado } from './actions'

interface Aviso {
  id: string
  mensaje: string
  creado_en: string
  fijado: boolean
  autor_id: string | null
  autor: { nombre: string } | null
}

/** Fecha legible y relativa para el tablón. */
function cuando(iso: string): string {
  const fecha = new Date(iso)
  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000)
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `hace ${minutos} min`
  if (minutos < 60 * 24) return `hace ${Math.floor(minutos / 60)} h`
  return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function AvisosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const sesion = await requerirAcceso('avisos')
  const { q } = await searchParams
  const supabase = await crearClienteServidor()

  let consulta = supabase
    .from('avisos')
    .select('id, mensaje, creado_en, fijado, autor_id, autor:perfiles(nombre)')
    // Los fijados van primero; dentro de cada grupo, del más nuevo al más viejo.
    .order('fijado', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(100)

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

      <Tarjeta className="mb-4 p-5">
        <FormularioAviso />
      </Tarjeta>

      <BarraHerramientas>
        <Buscador
          accion="/panel/avisos"
          valor={q}
          etiqueta="Buscar avisos"
          placeholder="Buscar en los mensajes…"
        />
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
                {a.fijado && (
                  <p className="mb-1.5">
                    <Etiqueta tono="alerta">Fijado</Etiqueta>
                  </p>
                )}
                <p className="whitespace-pre-line text-stone-800">{a.mensaje}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-400">
                  <span>
                    {a.autor?.nombre ?? 'Staff'} · {cuando(a.creado_en)}
                  </span>
                  <span className="flex items-center gap-3">
                    <form action={alternarFijado}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="fijar" value={a.fijado ? '0' : '1'} />
                      <button
                        className="inline-flex items-center gap-1 text-stone-400 transition hover:text-lenga-700"
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
                          extra="text-stone-400 hover:text-red-600"
                          cargando="Borrando…"
                          confirmar={`¿Borrar el aviso «${a.mensaje.slice(0, 60)}${a.mensaje.length > 60 ? '…' : ''}»? No se puede recuperar.`}
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
