import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { construirQuery, paginaActual, rangoDePagina, terminoBusqueda } from '@/lib/listados'
import { fechaHoraHotel, hoyISO } from '@/lib/fechas'
import { PLANTILLAS } from '@/lib/domain/plantillas'
import {
  ESTADOS_NOTIFICACION,
  ETIQUETAS_ESTADO,
  SIGNIFICADO_ESTADO,
  esEstadoNotificacion,
  sePuedeReintentar,
  type EstadoNotificacion,
} from '@/lib/domain/notificaciones'
import {
  BarraHerramientas,
  Buscador,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  Pagina,
  Paginacion,
  TD,
  TH,
  Tabla,
  Tarjeta,
  botonClases,
  COL_SECUNDARIA,
  type Tono,
} from '../_components/ui'
import { BotonEnvio } from '../_components/boton-envio'
import { reencolarNotificacion } from './actions'

/**
 * Registro de envíos (bandeja de salida, migraciones 0075 y 0086).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * La tabla `notificaciones` guardaba desde la 0075 todo lo que el sistema
 * comunica —qué se mandó, a quién, si salió, si falló, cuántas veces se
 * reintentó— y **nadie podía verla**. Es el mismo defecto que la Fase 2 de la
 * auditoría corrigió con `/panel/errores`: un dato que se guarda y nadie mira no
 * sirve para nada, y encima da la sensación de que el problema está resuelto.
 *
 * La pregunta que trae a alguien acá es siempre la misma y llega por teléfono:
 * «no me llegó nada». Sin esta pantalla la respuesta era «debe ser tu casilla».
 *
 * ── De solo lectura, salvo reintentar ───────────────────────────────────────
 *
 * No hay borrar ni editar: es un registro de lo que pasó. Lo único que se puede
 * hacer es **volver a poner en cola** lo que falló, y sólo eso, porque es la
 * única acción que arregla algo —el resto sería falsear el rastro—.
 */

const TONO_ESTADO: Record<EstadoNotificacion, Tono> = {
  pendiente: 'neutro',
  enviada: 'lago',
  entregada: 'exito',
  leida: 'exito',
  fallida: 'peligro',
  cancelada: 'alerta',
}

/** Nombre legible del evento. Sale del catálogo, así que uno nuevo aparece solo. */
const NOMBRE_EVENTO: Record<string, string> = Object.fromEntries(
  Object.values(PLANTILLAS).map((p) => [p.evento, p.nombre]),
)

const MENSAJES_ERROR: Record<string, string> = {
  reencolar: 'No se pudo volver a poner en cola el aviso. Probá de nuevo.',
  estado: 'Ese aviso no se puede reintentar: sólo lo fallido y lo cancelado.',
}

interface Fila {
  id: string
  evento: string
  canal: string
  estado: string
  destinatario: string
  intentos: number
  error: string | null
  creado_en: string
  proximo_en: string | null
  enviada_en: string | null
  entregada_en: string | null
  leida_en: string | null
}

export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string; pagina?: string; error?: string; ok?: string }>
}) {
  await requerirAcceso('notificaciones')
  const sp = await searchParams
  const supabase = await crearClienteServidor()

  const estado = esEstadoNotificacion(sp.estado ?? '') ? (sp.estado as EstadoNotificacion) : undefined
  const termino = terminoBusqueda(sp.q)

  const pagina = paginaActual(sp.pagina)
  const { desde, hasta } = rangoDePagina(pagina)

  let consulta = supabase
    .from('notificaciones')
    .select(
      'id, evento, canal, estado, destinatario, intentos, error, creado_en, proximo_en, enviada_en, entregada_en, leida_en',
      { count: 'exact' },
    )
    .order('creado_en', { ascending: false })

  if (estado) consulta = consulta.eq('estado', estado)
  /*
    `.ilike` con el valor pelado es seguro: viaja como parámetro y no como
    sintaxis del filtro. `patronOr()` haría falta sólo dentro de un `.or()`.

    Se busca por destinatario porque es el dato con el que llega el reclamo: el
    huésped dice su correo, no el nombre interno del evento.
  */
  if (termino) consulta = consulta.ilike('destinatario', `%${termino}%`)

  const { data, count } = await consulta.range(desde, hasta)
  const filas = (data ?? []) as Fila[]
  const total = count ?? 0

  /*
    Los dos números que dicen si hay algo pasando ahora.

    `hoyISO()` resuelve en la zona del hotel y no en UTC: con `toISOString()`
    pelado, entre las 21 y la medianoche de El Calafate el corte sería el del día
    siguiente y el contador daría cero (ver `lib/fechas.ts`).
  */
  const desdeHoy = `${hoyISO()}T00:00:00-03:00`
  const [{ count: deHoy }, { count: fallidas }] = await Promise.all([
    supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .gte('creado_en', desdeHoy),
    supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'fallida'),
  ])

  const filtros = { estado, q: sp.q }

  return (
    <Pagina>
      <Encabezado
        titulo="Avisos enviados"
        descripcion="Qué comunicó el sistema, a quién y cómo terminó cada envío."
        icono="sobre"
      />

      {sp.error && (
        <div className="mb-4">
          <Mensaje tono="error">
            {MENSAJES_ERROR[sp.error] ?? 'No se pudo completar la operación.'}
          </Mensaje>
        </div>
      )}
      {sp.ok === 'reencolada' && (
        <div className="mb-4">
          <Mensaje tono="ok">
            El aviso volvió a la cola. Sale en la próxima corrida, dentro de unos minutos.
          </Mensaje>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi titulo="En el filtro" valor={String(total)} detalle="avisos" icono="sobre" />
        <Kpi
          titulo="Hoy"
          valor={String(deHoy ?? 0)}
          detalle="desde las 00:00 del hotel"
          icono="ocupacion"
        />
        <Kpi
          titulo="Fallidos"
          valor={String(fallidas ?? 0)}
          detalle="sin reintentos por delante"
          icono="alerta"
        />
      </div>

      <BarraHerramientas>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            href={`/panel/notificaciones${construirQuery(filtros, { estado: undefined, pagina: undefined })}`}
            activo={!estado}
          >
            Todos
          </Chip>
          {ESTADOS_NOTIFICACION.map((e) => (
            <Chip
              key={e}
              href={`/panel/notificaciones${construirQuery(filtros, { estado: e, pagina: undefined })}`}
              activo={estado === e}
            >
              {ETIQUETAS_ESTADO[e]}
            </Chip>
          ))}
        </div>
        <Buscador
          accion="/panel/notificaciones"
          valor={sp.q ?? ''}
          etiqueta="Buscar por destinatario"
          placeholder="correo del huésped…"
          ocultos={{ estado }}
        />
        {(estado || termino) && (
          <Link href="/panel/notificaciones" className={botonClases('fantasma')}>
            Limpiar
          </Link>
        )}
      </BarraHerramientas>

      {estado && (
        <p className="mb-3 text-xs text-stone-600">{SIGNIFICADO_ESTADO[estado]}</p>
      )}

      <Tarjeta className="overflow-hidden">
        {filas.length === 0 ? (
          <EstadoVacio
            titulo={estado || termino ? 'Sin resultados' : 'Todavía no se envió ningún aviso'}
            descripcion={
              estado || termino
                ? 'Probá con otro filtro.'
                : 'Acá van a aparecer las confirmaciones, los recordatorios y los avisos internos a medida que el sistema los mande.'
            }
            icono="sobre"
          />
        ) : (
          <>
            <Tabla resumen="Avisos enviados, con destinatario, estado, intentos y fechas">
              <thead>
                <tr>
                  <th className={TH}>Cuándo</th>
                  <th className={TH}>Qué se avisó</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>A quién</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} ${COL_SECUNDARIA}`}>Reintentar</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((n) => {
                  const est = esEstadoNotificacion(n.estado) ? n.estado : undefined
                  const interno = n.canal === 'interno'
                  return (
                    <tr key={n.id} className={FILA}>
                      <td className={`${TD} tabular whitespace-nowrap text-stone-500`}>
                        {fechaHoraHotel(n.creado_en)}
                      </td>
                      <td className={TD}>
                        <span className="text-stone-800">
                          {NOMBRE_EVENTO[n.evento] ?? n.evento}
                        </span>
                        {interno && (
                          <span className="ml-1.5">
                            <Etiqueta tono="lago">Interno</Etiqueta>
                          </span>
                        )}
                        {/* En el teléfono el destinatario se pliega acá debajo en
                            vez de perderse: es el dato con el que llega el reclamo. */}
                        <p className="mt-1 text-xs break-all text-stone-500 sm:hidden">
                          {n.destinatario}
                        </p>
                        {n.error && (
                          <p className="mt-1 text-xs break-words text-red-700">{n.error}</p>
                        )}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA} text-xs break-all text-stone-600`}>
                        {n.destinatario}
                      </td>
                      <td className={TD}>
                        <Etiqueta tono={est ? TONO_ESTADO[est] : 'neutro'}>
                          {est ? ETIQUETAS_ESTADO[est] : n.estado}
                        </Etiqueta>
                        {n.intentos > 0 && (
                          <p className="mt-1 text-xs text-stone-500">
                            {n.intentos} intento{n.intentos === 1 ? '' : 's'}
                          </p>
                        )}
                        {/* El sello más avanzado que tenga: dice hasta dónde
                            llegó de verdad, que es más que el nombre del estado. */}
                        {(n.leida_en || n.entregada_en || n.enviada_en) && (
                          <p className="tabular mt-1 text-xs text-stone-500">
                            {fechaHoraHotel(
                              (n.leida_en ?? n.entregada_en ?? n.enviada_en) as string,
                            )}
                          </p>
                        )}
                      </td>
                      <td className={`${TD} ${COL_SECUNDARIA}`}>
                        {sePuedeReintentar(n.estado) ? (
                          <form action={reencolarNotificacion}>
                            <input type="hidden" name="id" value={n.id} />
                            <BotonEnvio variante="fantasma" cargando="Encolando…">
                              Volver a la cola
                            </BotonEnvio>
                          </form>
                        ) : (
                          <span className="text-xs text-stone-500">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabla>
            <Paginacion
              base="/panel/notificaciones"
              params={{ estado, q: sp.q }}
              pagina={pagina}
              total={total}
            />
          </>
        )}
      </Tarjeta>

      <p className="mt-3 text-xs text-stone-600">
        <strong>«Enviada» no es «entregada»:</strong> entre las dos está el rebote. Y que un
        aviso no figure como leído no prueba que no se haya leído — muchos programas de correo
        bloquean la señal de apertura.
      </p>
    </Pagina>
  )
}
