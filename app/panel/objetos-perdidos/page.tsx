import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { formatoFechaCorta } from '@/lib/fechas'
import { construirQuery, terminoBusqueda } from '@/lib/listados'
import {
  BarraHerramientas,
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
} from '../_components/ui'
import { FormularioObjeto } from './formulario'
import { marcarDevuelto } from './actions'

interface Objeto {
  id: string
  descripcion: string
  ubicacion: string
  fecha_hallazgo: string
  estado: 'guardado' | 'devuelto'
}

export default async function ObjetosPerdidosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>
}) {
  await requerirAcceso('objetos_perdidos')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = sp.estado === 'guardado' || sp.estado === 'devuelto' ? sp.estado : undefined

  let consulta = supabase
    .from('objetos_perdidos')
    .select('id, descripcion, ubicacion, fecha_hallazgo, estado')
    .order('fecha_hallazgo', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  const termino = terminoBusqueda(sp.q)
  if (termino) consulta = consulta.or(`descripcion.ilike.%${termino}%,ubicacion.ilike.%${termino}%`)

  const [{ data }, { data: todosData }] = await Promise.all([
    consulta,
    supabase.from('objetos_perdidos').select('estado'),
  ])

  const objetos = (data ?? []) as Objeto[]
  const todos = (todosData ?? []) as { estado: string }[]
  const guardados = todos.filter((o) => o.estado === 'guardado').length
  const devueltos = todos.filter((o) => o.estado === 'devuelto').length

  const vigentes = { q: sp.q, estado }
  const hayFiltros = Boolean(sp.q || estado)

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado
        titulo="Objetos perdidos"
        descripcion="Registro y devolución de objetos olvidados por los huéspedes."
        icono="objetos"
        acciones={<BotonExportar href="/panel/exportar/objetos-perdidos" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="En depósito" valor={String(guardados)} detalle="sin reclamar" icono="objetos" tono="alerta" />
        <Kpi titulo="Devueltos" valor={String(devueltos)} detalle="entregados" icono="ok" tono="exito" />
        <Kpi titulo="Total" valor={String(todos.length)} detalle="registros" icono="reportes" />
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

      <details className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-stone-700 marker:text-lago-600">
          Registrar un objeto encontrado
        </summary>
        <div className="border-t border-stone-100 p-5">
          <FormularioObjeto />
        </div>
      </details>

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
      </Tarjeta>
    </div>
  )
}
