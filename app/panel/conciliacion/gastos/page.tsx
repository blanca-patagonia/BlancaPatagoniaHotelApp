import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda, patronOr } from '@/lib/listados'
import { fechaHotel } from '@/lib/fechas'
import { formatearUSD } from '@/lib/domain/moneda'
import {
  CATEGORIAS_GASTO,
  ETIQUETAS_CATEGORIA_GASTO,
  totalPorCategoria,
  type CategoriaGasto,
} from '@/lib/domain/gastos'
import {
  BarraHerramientas,
  BotonExportar,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  FILA,
  Kpi,
  Mensaje,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  Pagina,
} from '../../_components/ui'
import { BotonEnvio } from '../../_components/boton-envio'
import { eliminarGasto } from './actions'

const MENSAJES_ERROR: Record<string, string> = {
  eliminar: 'No se pudo eliminar el gasto.',
}

interface Gasto {
  id: string
  categoria: CategoriaGasto
  descripcion: string
  monto: number | string
  moneda: string
  fecha: string
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoria?: string; pagina?: string; error?: string }>
}) {
  await requerirAcceso('conciliacion')
  const sp = await searchParams
  const q = terminoBusqueda(sp.q)
  const categoria = (CATEGORIAS_GASTO as readonly string[]).includes(sp.categoria ?? '')
    ? (sp.categoria as CategoriaGasto)
    : undefined
  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)
  const supabase = await crearClienteServidor()

  let consulta = supabase
    .from('gastos_operativos')
    .select('id, categoria, descripcion, monto, moneda, fecha', { count: 'exact' })
    .order('fecha', { ascending: false })
  if (categoria) consulta = consulta.eq('categoria', categoria)
  if (q) consulta = consulta.ilike('descripcion', `%${patronOr(q)}%`)

  const { data, count } = await consulta.range(desde, hasta)
  const gastos = (data ?? []) as Gasto[]
  const total = count ?? 0

  // Para el resumen por categoría se necesita el total SIN paginar: traer solo
  // la página actual daría un número que cambia según en qué página se esté.
  const { data: todosData } = await supabase
    .from('gastos_operativos')
    .select('categoria, monto')
  const totales = totalPorCategoria(
    ((todosData ?? []) as { categoria: CategoriaGasto; monto: number | string }[]).map((g) => ({
      categoria: g.categoria,
      monto: Number(g.monto),
    })),
  )
  const totalGeneral = Object.values(totales).reduce((a, b) => a + b, 0)

  const filtros = { q: sp.q, categoria }

  return (
    <Pagina>
      <Link
        href="/panel/conciliacion"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
      >
        ‹ Volver a conciliación
      </Link>

      <Encabezado
        titulo="Gastos operativos"
        descripcion="Sueldos, servicios y todo lo que el hotel paga sin una factura de proveedor de por medio."
        icono="conciliacion"
        acciones={
          <Link href="/panel/conciliacion/gastos/nuevo" className={botonClases('primario')}>
            + Registrar gasto
          </Link>
        }
      />

      {sp.error && <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}</Mensaje>}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi titulo="Total" valor={formatearUSD(totalGeneral)} detalle="todas las categorías" icono="conciliacion" />
        {CATEGORIAS_GASTO.map((c) => (
          <Kpi
            key={c}
            titulo={ETIQUETAS_CATEGORIA_GASTO[c]}
            valor={formatearUSD(totales[c])}
            detalle="ver solo esta"
            icono="conciliacion"
            href={`/panel/conciliacion/gastos${construirQuery(filtros, { categoria: c, pagina: undefined })}`}
          />
        ))}
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/conciliacion/gastos"
          valor={q ?? undefined}
          etiqueta="Buscar gastos"
          placeholder="Buscar por descripción…"
          ocultos={{ categoria }}
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip
            href={`/panel/conciliacion/gastos${construirQuery(filtros, { categoria: undefined, pagina: undefined })}`}
            activo={!categoria}
          >
            Todas
          </Chip>
          {CATEGORIAS_GASTO.map((c) => (
            <Chip
              key={c}
              href={`/panel/conciliacion/gastos${construirQuery(filtros, { categoria: c, pagina: undefined })}`}
              activo={categoria === c}
            >
              {ETIQUETAS_CATEGORIA_GASTO[c]}
            </Chip>
          ))}
        </div>
        <BotonExportar href={`/panel/exportar/gastos${construirQuery(filtros)}`} />
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        {gastos.length === 0 ? (
          <EstadoVacio
            titulo="Sin gastos registrados"
            descripcion="Se van a ver acá los sueldos, servicios y demás gastos sin factura de proveedor."
            icono="conciliacion"
            accion={
              <Link href="/panel/conciliacion/gastos/nuevo" className={botonClases('primario')}>
                Registrar el primero
              </Link>
            }
          />
        ) : (
          <>
            <Tabla resumen="Gastos operativos con fecha, categoría, descripción y monto">
              <thead>
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Categoría</th>
                  <th className={TH}>Descripción</th>
                  <th className={TH}>Monto</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {gastos.map((g) => (
                  <tr key={g.id} className={FILA}>
                    <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                      {fechaHotel(g.fecha)}
                    </td>
                    <td className={`${TD} text-stone-700`}>{ETIQUETAS_CATEGORIA_GASTO[g.categoria]}</td>
                    <td className={`${TD} text-stone-700`}>{g.descripcion}</td>
                    <td className={`${TD} tabular font-medium text-stone-900`}>
                      {formatearUSD(Number(g.monto))}
                    </td>
                    <td className={TD}>
                      <form action={eliminarGasto}>
                        <input type="hidden" name="id" value={g.id} />
                        <BotonEnvio
                          confirmar="¿Eliminar este gasto? No se puede deshacer."
                          variante="fantasma"
                          extra="text-red-700"
                        >
                          Eliminar
                        </BotonEnvio>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
            <Paginacion base="/panel/conciliacion/gastos" params={filtros} pagina={pagina} total={total} />
          </>
        )}
      </Tarjeta>
    </Pagina>
  )
}
