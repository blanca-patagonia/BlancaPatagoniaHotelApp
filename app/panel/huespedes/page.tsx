import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { nivelFidelidad, ETIQUETAS_NIVEL } from '@/lib/domain/fidelidad'
import {
  construirQuery,
  paginaActual,
  patronOr,
  rangoDePagina,
  terminoBusqueda,
} from '@/lib/listados'
import {
  BarraHerramientas,
  BotonExportar,
  Buscador,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Pagina,
  Paginacion,
  COL_SECUNDARIA,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
} from '../_components/ui'
import { Icono } from '../_components/iconos'

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
  //
  // El término va por `patronOr`, como en los otros seis listados. Interpolarlo
  // crudo dejaba inyectar condiciones: PostgREST separa los términos de un `or`
  // por comas, así que una coma en la búsqueda cierra la condición y abre otra
  // (buscar `x,id.gt.0` devolvía el padrón entero, ignorando el filtro).
  const termino = terminoBusqueda(q)
  if (termino) {
    const patron = patronOr(termino)
    query = query.or(
      `apellido.ilike.${patron},nombre.ilike.${patron},doc_numero.ilike.${patron},email.ilike.${patron}`,
    )
  }

  const { data, count } = await query.range(desde, hasta)
  const huespedes = (data ?? []) as Huesped[]
  const total = count ?? 0

  return (
    <Pagina>
      <Encabezado
        titulo="Huéspedes"
        descripcion="Base de huéspedes, historial y programa de fidelidad."
        icono="huespedes"
        acciones={
          <>
            <BotonExportar href={`/panel/exportar/huespedes${construirQuery({ q })}`} />
            {/* La acción principal del módulo, visible desde el primer vistazo.
                Antes vivía plegada en un `<details>` que parecía un título. */}
            <Link href="/panel/huespedes/nuevo" className={botonClases('primario')}>
              <Icono nombre="mas" tam={16} />
              Registrar huésped
            </Link>
          </>
        }
      />

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
            /* El texto anterior decía que los huéspedes «se cargan al crear una
               reserva», y arriba, en el encabezado, hay un botón «Registrar
               huésped» que funciona. Contradecir al botón que está a la vista
               hace dudar de cuál es el camino bueno: son los dos. */
            descripcion={
              q
                ? 'Se busca por apellido, nombre, documento o email.'
                : 'Se cargan solos al crear una reserva, o los podés registrar vos ahora.'
            }
            icono="huespedes"
            accion={
              q ? undefined : (
                <Link href="/panel/huespedes/nuevo" className={botonClases('primario')}>
                  Registrar huésped
                </Link>
              )
            }
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
                              <p className="hidden text-xs text-stone-600 sm:block">{h.telefono}</p>
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
                          <span className="text-stone-600">—</span>
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
    </Pagina>
  )
}
