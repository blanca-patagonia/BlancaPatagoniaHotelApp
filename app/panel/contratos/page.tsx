import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { hoyISO, formatoFechaCorta } from '@/lib/fechas'
import {
  construirQuery,
  terminoBusqueda,
  paginaActual,
  rangoDePagina,
} from '@/lib/listados'
import {
  ESTADOS_CONTRATO,
  ETIQUETAS_ESTADO_CONTRATO,
  ETIQUETAS_TIPO_CONTRATO,
  type EstadoContrato,
  type TipoContrato,
} from '@/lib/domain/contratos'
import {
  BarraHerramientas,
  Paginacion,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  COL_SECUNDARIA,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  type Tono,
  Pagina,
} from '../_components/ui'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import { vencerContratos } from './actions'

/** Tono de la etiqueta de cada estado del contrato. */
const TONO_CONTRATO: Record<EstadoContrato, Tono> = {
  borrador: 'neutro',
  enviado: 'lago',
  firmado: 'exito',
  rechazado: 'peligro',
  vencido: 'alerta',
}

interface ContratoRow {
  id: string
  tipo: TipoContrato
  entidad_id: string
  titulo: string
  estado: EstadoContrato
  vigencia_desde: string | null
  vigencia_hasta: string | null
  fecha_firma: string | null
}

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; tipo?: string; pagina?: string; ok?: string; error?: string }>
}) {
  const sesion = await requerirAcceso('contratos')
  // Redactar lo restringe la acción a admin y gerencia: la pantalla no ofrece
  // un botón que el servidor va a rechazar.
  const puedeRedactar = sesion.rol === 'admin' || sesion.rol === 'gerencia'
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = (ESTADOS_CONTRATO as readonly string[]).includes(sp.estado ?? '')
    ? (sp.estado as EstadoContrato)
    : undefined
  const tipo = ['agencia', 'proveedor', 'empleado'].includes(sp.tipo ?? '')
    ? (sp.tipo as TipoContrato)
    : undefined

  /*
    Pagina. Sin esto la consulta traía la tabla entera y PostgREST la cortaba en
    1000 filas **sin avisar**.
  */
  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('contratos')
    .select(
      'id, tipo, entidad_id, titulo, estado, vigencia_desde, vigencia_hasta, fecha_firma',
      { count: 'exact' },
    )
    .order('creado_en', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  if (tipo) consulta = consulta.eq('tipo', tipo)
  const termino = terminoBusqueda(sp.q)
  if (termino) consulta = consulta.ilike('titulo', `%${termino}%`)

  // Las entidades son polimórficas: se traen las tres tablas y se arma un mapa
  // de nombres para mostrar con quién se firma cada contrato.
  const [{ data, count: enFiltro }, { data: agencias }, { data: proveedores }, { data: empleados }] =
    await Promise.all([
      consulta.range(desde, hasta),
      supabase.from('agencias').select('id, nombre').order('nombre'),
      supabase.from('proveedores').select('id, nombre').order('nombre'),
      supabase.from('perfiles').select('id, nombre').eq('activo', true).order('nombre'),
    ])

  const contratos = (data ?? []) as ContratoRow[]
  const nombres = new Map<string, string>()
  for (const a of agencias ?? []) nombres.set(a.id as string, a.nombre as string)
  for (const p of proveedores ?? []) nombres.set(p.id as string, p.nombre as string)
  for (const e of empleados ?? []) nombres.set(e.id as string, e.nombre as string)

  const hoy = hoyISO()

  /*
    Los KPI se cuentan EN LA BASE, sobre todos los contratos y no sobre la página.

    Al paginar el listado, calcularlos con `contratos.filter(...)` los habría dejado
    contando solo las 25 filas visibles: los indicadores dirían una cosa distinta en
    cada página. Es el mismo error que la auditoría encontró en mantenimiento y en
    objetos perdidos, que ahí venía de PostgREST cortando en 1000 filas y acá vendría
    de la paginación. La regla es la misma: un indicador se cuenta, no se filtra.

    `vigentes` reproduce `estaVigente()` en SQL: firmado, ya empezado y no vencido.
    Si esa regla cambia en el dominio hay que cambiarla acá — el test de
    `lib/domain/contratos.ts` la fija, y este comentario avisa dónde está la copia.
  */
  const [
    { count: totalCount },
    { count: vigentesCount },
    { count: pendientesCount },
    { count: porVencerCount },
  ] = await Promise.all([
      supabase.from('contratos').select('*', { count: 'exact', head: true }),
      supabase
        .from('contratos')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'firmado')
        .or(`vigencia_desde.is.null,vigencia_desde.lte.${hoy}`)
        .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`),
      supabase
        .from('contratos')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'enviado'),
      supabase
        .from('contratos')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'enviado')
        .lt('vigencia_hasta', hoy),
    ])

  const total = totalCount ?? 0
  const vigentes = vigentesCount ?? 0
  const pendientesFirma = pendientesCount ?? 0
  const porVencer = porVencerCount ?? 0

  const filtros = { q: sp.q, estado, tipo }
  const hayFiltros = Boolean(sp.q || estado || tipo)

  return (
    <Pagina>
      <Encabezado
        titulo="Contratos"
        descripcion="Convenios con agencias, proveedores y empleados, con firma electrónica."
        icono="contratos"
        acciones={
          <>
            {porVencer > 0 && (
              <form action={vencerContratos}>
                <BotonEnvio variante="secundario" cargando="Marcando…">
                  Marcar vencidos ({porVencer})
                </BotonEnvio>
              </form>
            )}
            {/* La acción principal del módulo, visible desde el primer vistazo. */}
            {puedeRedactar && (
              <Link href="/panel/contratos/nuevo" className={botonClases('primario')}>
                <Icono nombre="mas" tam={16} />
                Redactar contrato
              </Link>
            )}
          </>
        }
      />

      {sp.error && (
        <div className="mb-4">
          <Mensaje tono="error">
            {sp.error === 'vencer'
              ? 'No se pudieron marcar los contratos vencidos. Los que veías siguen figurando como vigentes.'
              : 'No se pudo completar la operación.'}
          </Mensaje>
        </div>
      )}
      {sp.ok === 'vencidos' && (
        <Mensaje tono="ok">Se marcaron como vencidos los contratos fuera de vigencia.</Mensaje>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/*
          El total se cuenta en la base, no con `contratos.length`.

          `contratos` es la PÁGINA (25 filas como máximo), así que con 137 contratos
          cargados el indicador decía «25» y el paginador, dos centímetros más abajo,
          «1–25 de 137». Se cuenta global —sin aplicar los filtros— para que los cuatro
          indicadores hablen de lo mismo: los otros tres ya se contaban así. El
          subconjunto que el filtro deja a la vista lo informa el paginador.
        */}
        <Kpi titulo="Total" valor={String(total)} detalle="contratos cargados" icono="contratos" />
        <Kpi titulo="Vigentes" valor={String(vigentes)} detalle="firmados y en fecha" icono="ok" tono="exito" />
        <Kpi
          titulo="Esperando firma"
          valor={String(pendientesFirma)}
          detalle="enviados sin responder"
          icono="firma"
          tono="lago"
        />
        <Kpi
          titulo="Fuera de vigencia"
          valor={String(porVencer)}
          detalle="enviados y ya vencidos"
          icono="alerta"
          tono={porVencer > 0 ? 'peligro' : 'neutro'}
        />
      </div>

      <BarraHerramientas>
        <Buscador
          accion="/panel/contratos"
          valor={sp.q}
          etiqueta="Buscar contratos"
          placeholder="Título del contrato…"
          ocultos={{ estado, tipo }}
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip href={`/panel/contratos${construirQuery(filtros, { estado: undefined })}`} activo={!estado}>
            Todos
          </Chip>
          {ESTADOS_CONTRATO.map((e) => (
            <Chip
              key={e}
              href={`/panel/contratos${construirQuery(filtros, { estado: e })}`}
              activo={estado === e}
            >
              {ETIQUETAS_ESTADO_CONTRATO[e]}
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['agencia', 'proveedor', 'empleado'] as TipoContrato[]).map((t) => (
            <Chip
              key={t}
              href={`/panel/contratos${construirQuery(filtros, { tipo: tipo === t ? undefined : t })}`}
              activo={tipo === t}
            >
              {ETIQUETAS_TIPO_CONTRATO[t]}
            </Chip>
          ))}
        </div>
        {hayFiltros && (
          <Link href="/panel/contratos" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>


      <Tarjeta className="overflow-hidden">
        {contratos.length === 0 ? (
          <EstadoVacio
            titulo={hayFiltros ? 'Ningún contrato coincide' : 'Todavía no hay contratos'}
            descripcion={
              hayFiltros
                ? 'Probá con otro término o quitá los filtros.'
                : 'Redactá el primero con el formulario de arriba y enviálo a firmar.'
            }
            icono="contratos"
            /*
              La descripción indicaba «quitá los filtros» sin dar con qué. Tener
              el botón, y no solo la instrucción, es lo que hace la diferencia
              para quien no usa mucho la computadora.
            */
            accion={
              hayFiltros ? (
                <Link
                  href="/panel/contratos"
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  Quitar filtros
                </Link>
              ) : (
                <Link
                  href="/panel/contratos/nuevo"
                  className="rounded-lg bg-lago-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-lago-800"
                >
                  Crear el primero
                </Link>
              )
            }
          />
        ) : (
          <Tabla resumen="Contratos con su contraparte, vigencia y estado de firma">
            <thead>
              <tr>
                <th className={TH}>Título</th>
                <th className={TH}>Contraparte</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Tipo</th>
                <th className={`${TH} ${COL_SECUNDARIA}`}>Vigencia</th>
                <th className={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id} className={FILA}>
                  <td className={TD}>
                    <Link
                      href={`/panel/contratos/${c.id}`}
                      className="font-medium text-lago-700 hover:underline"
                    >
                      {c.titulo}
                    </Link>
                  </td>
                  <td className={`${TD} text-stone-700`}>
                    {nombres.get(c.entidad_id) ?? '—'}
                  </td>
                  <td className={`${TD} ${COL_SECUNDARIA} text-stone-500`}>
                    {ETIQUETAS_TIPO_CONTRATO[c.tipo]}
                  </td>
                  <td className={`${TD} ${COL_SECUNDARIA} text-stone-600`}>
                    {c.vigencia_desde || c.vigencia_hasta ? (
                      <>
                        {c.vigencia_desde ? formatoFechaCorta(c.vigencia_desde) : '—'}
                        {' → '}
                        {c.vigencia_hasta ? formatoFechaCorta(c.vigencia_hasta) : 'sin fin'}
                      </>
                    ) : (
                      <span className="text-stone-600">sin definir</span>
                    )}
                  </td>
                  <td className={TD}>
                    <Etiqueta tono={TONO_CONTRATO[c.estado]}>
                      {ETIQUETAS_ESTADO_CONTRATO[c.estado]}
                    </Etiqueta>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
        {(enFiltro ?? 0) > 0 && (
          <Paginacion
            base="/panel/contratos"
            params={{ q: sp.q, estado, tipo }}
            pagina={pagina}
            total={enFiltro ?? 0}
          />
        )}
      </Tarjeta>
    </Pagina>
  )
}
