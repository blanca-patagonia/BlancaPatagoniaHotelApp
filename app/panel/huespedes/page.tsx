import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda } from '@/lib/listados'
import {
  BarraHerramientas,
  BotonExportar,
  Buscador,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Paginacion,
  COL_SECUNDARIA,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../_components/ui'
import { FormularioHuesped } from './formulario'

interface Huesped {
  id: string
  apellido: string
  nombre: string
  email: string | null
  telefono: string | null
  doc_numero: string
  nacionalidad: string | null
  puntos: number | null
}

export default async function HuespedesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>
}) {
  await requerirAcceso('huespedes')
  const { q, pagina: paginaCruda } = await searchParams
  const supabase = await crearClienteServidor()

  const pagina = paginaActual(paginaCruda)
  const { desde, hasta } = rangoDePagina(pagina)

  let query = supabase
    .from('huespedes')
    .select('id, apellido, nombre, email, telefono, doc_numero, nacionalidad, puntos', {
      count: 'exact',
    })
    .order('apellido')

  // Antes solo se buscaba por apellido; ahora también por nombre, documento y email.
  const termino = terminoBusqueda(q)
  if (termino) {
    query = query.or(
      `apellido.ilike.%${termino}%,nombre.ilike.%${termino}%,doc_numero.ilike.%${termino}%,email.ilike.%${termino}%`,
    )
  }

  const { data, count } = await query.range(desde, hasta)
  const huespedes = (data ?? []) as Huesped[]
  const total = count ?? 0

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado
        titulo="Huéspedes"
        descripcion="Base de huéspedes, historial y programa de fidelidad."
        icono="huespedes"
        acciones={<BotonExportar href={`/panel/exportar/huespedes${construirQuery({ q })}`} />}
      />

      <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
          Registrar un huésped nuevo
        </summary>
        <div className="border-t border-stone-100 p-5">
          <FormularioHuesped />
        </div>
      </details>

      <BarraHerramientas>
        <Buscador
          accion="/panel/huespedes"
          valor={q}
          etiqueta="Buscar huéspedes"
          placeholder="Apellido, nombre, documento o email…"
        />
        {q && (
          <Link href="/panel/huespedes" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        {huespedes.length === 0 ? (
          <EstadoVacio
            titulo={q ? 'Ningún huésped coincide con la búsqueda' : 'Todavía no hay huéspedes'}
            descripcion={
              q
                ? 'Se busca por apellido, nombre, documento o email.'
                : 'Los huéspedes se cargan al crear una reserva.'
            }
            icono="huespedes"
          />
        ) : (
          <>
            <Tabla resumen="Listado de huéspedes con documento, contacto y nivel de fidelidad">
              <thead>
                <tr>
                  <th className={TH}>Apellido y nombre</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Documento</th>
                  <th className={TH}>Contacto</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Nacionalidad</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Fidelidad</th>
                </tr>
              </thead>
              <tbody>
                {huespedes.map((h) => {
                  const puntos = h.puntos ?? 0
                  const nivel = nivelFidelidad(puntos)
                  return (
                    <tr key={h.id} className={FILA}>
                      <td className={TD}>
                        <Link
                          href={`/panel/huespedes/${h.id}`}
                          className="font-medium text-lago-700 hover:underline"
                        >
                          {h.apellido}, {h.nombre}
                        </Link>
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} tabular text-stone-600`}>
                        {h.doc_numero || '—'}
                      </td>
                      <td className={`${TD} text-stone-600`}>
                        {h.email || h.telefono ? (
                          <div className="leading-tight">
                            {/* En móvil se prioriza el teléfono: desde el
                                teléfono se llama, no se copia un correo. */}
                            {h.telefono && (
                              <a
                                href={`tel:${h.telefono.replace(/\s/g, '')}`}
                                className="text-lago-700 sm:hidden"
                              >
                                {h.telefono}
                              </a>
                            )}
                            {h.email && <p className="hidden sm:block">{h.email}</p>}
                            {h.telefono && (
                              <p className="hidden text-xs text-stone-400 sm:block">{h.telefono}</p>
                            )}
                            {!h.telefono && h.email && (
                              <p className="truncate sm:hidden">{h.email}</p>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                        {h.nacionalidad || '—'}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA}`}>
                        {puntos > 0 ? (
                          <Etiqueta tono="calafate">
                            {ETIQUETAS_NIVEL[nivel]} · {puntos} pts
                          </Etiqueta>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
            <Paginacion base="/panel/huespedes" params={{ q }} pagina={pagina} total={total} />
          </>
        )}
      </Tarjeta>
    </div>
  )
}
