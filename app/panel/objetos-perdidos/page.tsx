import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { formatoFechaCorta } from '@/lib/fechas'
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
  FILA,
  Kpi,
  COL_SECUNDARIA,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  Pagina,
  Mensaje,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { marcarDevuelto } from './actions'

interface Objeto {
  id: string
  descripcion: string
  ubicacion: string
  fecha_hallazgo: string
  estado: 'guardado' | 'devuelto'
}

/**
 * Motivos con que las acciones de esta pantalla pueden volver por `?error=`.
 * El fallback cubre cualquiera que no esté acá.
 */
const MENSAJES_ERROR: Record<string, string> = {
  devuelto: 'No se pudo marcar el objeto como devuelto. Sigue en depósito.',
}

export default async function ObjetosPerdidosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; pagina?: string; error?: string }>
}) {
  await requerirAcceso('objetos_perdidos')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = sp.estado === 'guardado' || sp.estado === 'devuelto' ? sp.estado : undefined

  /*
    Pagina, como huéspedes y reservas. Sin esto la consulta traía la tabla entera
    y PostgREST la cortaba en 1000 filas **sin avisar**: el listado se quedaba
    mudo a partir de ahí y nadie podía saber que faltaban registros.
  */
  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('objetos_perdidos')
    .select('id, descripcion, ubicacion, fecha_hallazgo, estado', { count: 'exact' })
    .order('fecha_hallazgo', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  const termino = terminoBusqueda(sp.q)
  if (termino) consulta = consulta.or(`descripcion.ilike.${patronOr(termino)},ubicacion.ilike.${patronOr(termino)}`)

  /*
    Los contadores los resuelve la base.

    Antes traía `objetos_perdidos` entera para contarla en JavaScript, y PostgREST
    corta en 1000 filas con HTTP 200 y sin aviso (`max_rows`,
    supabase/config.toml:10). Comprobado con 1100 filas sembradas: llegaban 1000 y
    el KPI decía 1000. Un número equivocado que no falla es peor que un error.
  */
  const [{ data, count: enFiltro }, { count: guardadosCount }, { count: devueltosCount }, { count: totalCount }] =
    await Promise.all([
    consulta.range(desde, hasta),
    supabase
      .from('objetos_perdidos')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'guardado'),
    supabase
      .from('objetos_perdidos')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'devuelto'),
    supabase.from('objetos_perdidos').select('*', { count: 'exact', head: true }),
  ])

  const objetos = (data ?? []) as Objeto[]
  const guardados = guardadosCount ?? 0
  const devueltos = devueltosCount ?? 0
  const total = totalCount ?? 0
  const totalFiltrado = enFiltro ?? 0

  const vigentes = { q: sp.q, estado }
  const hayFiltros = Boolean(sp.q || estado)

  return (
    <Pagina>
      <Encabezado
        titulo="Objetos perdidos"
        descripcion="Registro y devolución de objetos olvidados por los huéspedes."
        icono="objetos"
        acciones={
          <>
            <BotonExportar href="/panel/exportar/objetos-perdidos" />
            {/* La acción principal del módulo, visible desde el primer vistazo. */}
            <Link href="/panel/objetos-perdidos/nuevo" className={botonClases('primario')}>
              <Icono nombre="mas" tam={16} />
              Registrar objeto
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

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="En depósito" valor={String(guardados)} detalle="sin reclamar" icono="objetos" tono="alerta" />
        <Kpi titulo="Devueltos" valor={String(devueltos)} detalle="entregados" icono="ok" tono="exito" />
        <Kpi titulo="Total" valor={String(total)} detalle="registros" icono="reportes" />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/objetos-perdidos"
          valor={sp.q}
          etiqueta="Buscar objetos"
          placeholder="Objeto o ubicación…"
          ocultos={{ estado }}
        />
        <div className="flex gap-1.5">
          <Chip
            href={`/panel/objetos-perdidos${construirQuery(vigentes, { estado: undefined })}`}
            activo={!estado}
          >
            Todos
          </Chip>
          <Chip
            href={`/panel/objetos-perdidos${construirQuery(vigentes, { estado: 'guardado' })}`}
            activo={estado === 'guardado'}
          >
            En depósito
          </Chip>
          <Chip
            href={`/panel/objetos-perdidos${construirQuery(vigentes, { estado: 'devuelto' })}`}
            activo={estado === 'devuelto'}
          >
            Devueltos
          </Chip>
        </div>
        {hayFiltros && (
          <Link href="/panel/objetos-perdidos" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        {objetos.length === 0 ? (
          <EstadoVacio
            titulo={hayFiltros ? 'Ningún objeto coincide' : 'No hay objetos registrados'}
            descripcion={
              hayFiltros
                ? 'Probá con otro término o quitá los filtros.'
                : 'Registrá acá lo que los huéspedes se olvidan en las habitaciones.'
            }
            icono="objetos"
            /*
              La descripción indicaba «quitá los filtros» sin dar con qué. Tener
              el botón, y no solo la instrucción, es lo que hace la diferencia
              para quien no usa mucho la computadora.
            */
            accion={
              hayFiltros ? (
                <Link
                  href="/panel/objetos-perdidos"
                  className={botonClases('secundario')}
                >
                  Quitar filtros
                </Link>
              ) : (
                <Link
                  href="/panel/objetos-perdidos/nuevo"
                  className={botonClases('primario')}
                >
                  Registrar el primero
                </Link>
              )
            }
          />
        ) : (
          <Tabla resumen="Objetos perdidos con fecha de hallazgo, ubicación y estado">
            <thead>
              <tr>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Hallazgo</th>
                <th className={TH}>Objeto</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Ubicación</th>
                <th className={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {objetos.map((o) => (
                <tr key={o.id} className={FILA}>
                  <td className={`${TD} ${COL_SECUNDARIA} tabular text-stone-500`}>
                    {formatoFechaCorta(o.fecha_hallazgo)}
                  </td>
                  <td className={`${TD} font-medium text-stone-800`}>
                    {o.descripcion}
                    {/* Fecha y lugar del hallazgo son lo que permite reconocer
                        el objeto: en móvil se pliegan bajo la descripción. */}
                    <span className="block text-xs font-normal text-stone-500 sm:hidden">
                      {formatoFechaCorta(o.fecha_hallazgo)}
                      {o.ubicacion ? ` · ${o.ubicacion}` : ''}
                    </span>
                  </td>
                  <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>{o.ubicacion || '—'}</td>
                  <td className={TD}>
                    {o.estado === 'devuelto' ? (
                      <Etiqueta tono="exito">Devuelto</Etiqueta>
                    ) : (
                      <form action={marcarDevuelto} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={o.id} />
                        <Etiqueta tono="alerta">En depósito</Etiqueta>
                        <button className={botonClases('secundario', 'px-2.5 py-1 text-xs')}>
                          Marcar devuelto
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
        {totalFiltrado > 0 && (
          <Paginacion
            base="/panel/objetos-perdidos"
            params={{ q: sp.q, estado }}
            pagina={pagina}
            total={totalFiltrado}
          />
        )}
      </Tarjeta>
    </Pagina>
  )
}
