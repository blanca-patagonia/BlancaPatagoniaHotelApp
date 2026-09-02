import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda } from '@/lib/listados'
import { hoyISO } from '@/lib/fechas'
import {
  BarraHerramientas,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  COL_SECUNDARIA,
  type Tono,
} from '../_components/ui'

/**
 * Errores del servidor (Fase 2 de la auditoría, ADR 0029).
 *
 * Sin esta pantalla, la tabla `errores` sería un lugar donde los errores quedan
 * guardados y nadie los ve — que es exactamente el problema que se quería
 * resolver, con un paso más. Lo que hace útil a la observabilidad no es
 * registrar: es que alguien se entere.
 *
 * De solo lectura a propósito: no hay botón de borrar. Un rastro que quien lo
 * mira puede limpiar deja de ser un rastro; la tabla se purga sola a los 90 días
 * (`purgar_errores`, migración 0068).
 */

const NIVELES = ['error', 'aviso'] as const
type Nivel = (typeof NIVELES)[number]

const ETIQUETAS_NIVEL: Record<Nivel, string> = {
  error: 'Errores',
  aviso: 'Avisos',
}

const TONO_NIVEL: Record<string, Tono> = {
  error: 'peligro',
  aviso: 'alerta',
}

interface Registro {
  id: string
  evento: string
  nivel: string
  detalle: string | null
  pedido: string | null
  digest: string | null
  ruta: string | null
  datos: Record<string, unknown> | null
  creado_en: string
}

export default async function ErroresPage({
  searchParams,
}: {
  searchParams: Promise<{ nivel?: string; q?: string; pagina?: string }>
}) {
  await requerirAcceso('errores')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const nivel = (NIVELES as readonly string[]).includes(sp.nivel ?? '')
    ? (sp.nivel as Nivel)
    : undefined
  const termino = terminoBusqueda(sp.q)

  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('errores')
    .select('*', { count: 'exact' })
    .order('creado_en', { ascending: false })

  if (nivel) consulta = consulta.eq('nivel', nivel)
  // `.ilike` es seguro con el valor pelado: viaja como parámetro y no como
  // sintaxis del filtro. `patronOr()` haría falta solo dentro de un `.or()`.
  if (termino) consulta = consulta.ilike('evento', `%${termino}%`)

  const { data, count } = await consulta.range(desde, hasta)
  const registros = (data ?? []) as Registro[]
  const total = count ?? 0

  // Cuántos hoy: es el número que dice si hay algo pasando AHORA, que es la
  // pregunta que trae a alguien a esta pantalla. `hoyISO()` resuelve en la zona
  // del hotel, no en UTC (ver `lib/fechas.ts`).
  const { count: deHoy } = await supabase
    .from('errores')
    .select('id', { count: 'exact', head: true })
    .gte('creado_en', `${hoyISO()}T00:00:00-03:00`)

  const filtros = { nivel, q: sp.q }

  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Errores del sistema"
        descripcion="Qué falló, cuándo y en qué pantalla. Se borra solo a los 90 días."
        icono="alerta"
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="En el filtro" valor={String(total)} detalle="registros" icono="alerta" />
        <Kpi
          titulo="Hoy"
          valor={String(deHoy ?? 0)}
          detalle="desde las 00:00 del hotel"
          icono="ocupacion"
        />
        <Kpi
          titulo="Retención"
          valor="90 días"
          detalle="después se purgan solos"
          icono="config"
        />
      </div>

      <BarraHerramientas>
        <div className="flex flex-wrap gap-1.5">
          <Chip href={`/panel/errores${construirQuery(filtros, { nivel: undefined })}`} activo={!nivel}>
            Todos
          </Chip>
          {NIVELES.map((n) => (
            <Chip
              key={n}
              href={`/panel/errores${construirQuery(filtros, { nivel: n, pagina: undefined })}`}
              activo={nivel === n}
            >
              {ETIQUETAS_NIVEL[n]}
            </Chip>
          ))}
        </div>
        <Buscador
          accion="/panel/errores"
          valor={sp.q ?? ''}
          etiqueta="Buscar por evento"
          placeholder="escritura_fallida, webhook…"
          ocultos={{ nivel }}
        />
        {(nivel || termino) && (
          <Link href="/panel/errores" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      <Tarjeta className="overflow-hidden">
        {registros.length === 0 ? (
          <EstadoVacio
            titulo={nivel || termino ? 'Sin resultados' : 'No hay errores registrados'}
            descripcion={
              nivel || termino
                ? 'Probá con otro filtro.'
                : 'Es lo esperable. Acá aparecen las fallas del servidor cuando ocurren.'
            }
            icono="ok"
          />
        ) : (
          <>
            <Tabla resumen="Errores del servidor con fecha, evento, pantalla y código de referencia">
              <thead>
                <tr>
                  <th className={TH}>Cuándo</th>
                  <th className={TH}>Qué pasó</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Pantalla</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Código</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id} className={FILA}>
                    <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                      {new Date(r.creado_en).toLocaleString('es-AR')}
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Etiqueta tono={TONO_NIVEL[r.nivel] ?? 'neutro'}>{r.evento}</Etiqueta>
                      </div>
                      {r.detalle && (
                        <p className="mt-1 text-xs break-words text-stone-600">{r.detalle}</p>
                      )}
                      {/* En el teléfono la pantalla y el código se pliegan acá
                          debajo en vez de perderse: son justamente lo que hace
                          falta para pedir ayuda. */}
                      <p className="mt-1 text-xs text-stone-500 sm:hidden">
                        {r.ruta ?? 'sin ruta'}
                        {r.digest && <span className="tabular"> · {r.digest}</span>}
                      </p>
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA} text-xs text-stone-600`}>
                      {r.ruta ?? '—'}
                    </td>
                    <td className={`${TD} ${COL_SECUNDARIA} tabular text-xs text-stone-500`}>
                      {/* El digest es lo que ve quien se topó con el error. Es el
                          único hilo entre «me salió un error» y esta fila. */}
                      {r.digest ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
            <Paginacion
              base="/panel/errores"
              params={{ nivel, q: sp.q }}
              pagina={pagina}
              total={total}
            />
          </>
        )}
      </Tarjeta>

      <p className="mt-3 text-xs text-stone-600">
        Los datos sensibles —contraseñas, tokens, números de tarjeta— se ocultan antes de
        guardarse, incluso si vinieran dentro del mensaje de error.
      </p>
    </div>
  )
}
