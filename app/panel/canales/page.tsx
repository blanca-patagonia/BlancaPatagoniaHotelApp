import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerProveedorCanal } from '@/lib/canales'
import { formatoFechaCorta, hoyISO } from '@/lib/fechas'
import { construirQuery } from '@/lib/listados'
import { Icono } from '../_components/iconos'
import { BotonEnvio } from '../_components/boton-envio'
import {
  BarraHerramientas,
  CAMPO,
  Campo,
  Chip,
  Encabezado,
  EstadoVacio,
  Etiqueta,
  FILA,
  Kpi,
  Mensaje,
  Pagina,
  TD,
  TH,
  Tabla,
  Tarjeta,
} from '../_components/ui'
import { ImportarCsv } from './importar-csv'
import {
  cargarMensaje,
  cargarResena,
  ignorarEntrante,
  importarUna,
  marcarMensajeAtendido,
  reintentarEntrante,
  responderResena,
  sincronizarCanal,
} from './actions'
import { importe } from '@/lib/domain/moneda'

/**
 * Canales de venta: el panel único de lo que llega de Booking.
 *
 * Tres vistas —reservas entrantes, mensajes y reseñas— más el estado de la
 * sincronización. Es lo que pedía el objetivo: ver en un mismo lugar las
 * llegadas, salidas y estancias del canal, los pedidos del huésped y las reseñas.
 *
 * ⚠️ **La advertencia de arriba no es decorativa.** Los dos proveedores que se
 * pueden usar sin ser partner certificado (CSV e iCal) son de solo lectura: nadie
 * le informa a Booking qué queda libre, así que Booking **puede vender una unidad
 * que el mostrador ya vendió**. Sin decirlo en pantalla, alguien va a creer que
 * está cubierto porque «el sistema sincroniza con Booking».
 */

const VISTAS = ['entrantes', 'mensajes', 'resenas'] as const
type Vista = (typeof VISTAS)[number]

const ETIQUETAS_VISTA: Record<Vista, string> = {
  entrantes: 'Reservas entrantes',
  mensajes: 'Mensajes y peticiones',
  resenas: 'Reseñas',
}

const ESTADOS_ENTRANTE = ['pendiente', 'importada', 'error', 'ignorada'] as const
type EstadoEntrante = (typeof ESTADOS_ENTRANTE)[number]

const ETIQUETAS_ESTADO: Record<EstadoEntrante, string> = {
  pendiente: 'Sin importar',
  importada: 'Importada',
  error: 'Con problema',
  ignorada: 'Descartada',
}

const TONO_ESTADO: Record<EstadoEntrante, 'neutro' | 'lago' | 'exito' | 'alerta' | 'peligro'> = {
  pendiente: 'alerta',
  importada: 'exito',
  error: 'peligro',
  ignorada: 'neutro',
}

const MENSAJES_ERROR: Record<string, string> = {
  sin_sondeo:
    'El proveedor configurado no sabe traer reservas por sí solo. Usá la importación del informe CSV.',
  sondeo: 'No se pudo consultar el canal. Revisá la configuración de los feeds y probá de nuevo.',
  importar: 'No se pudo importar. El motivo quedó anotado en la fila, abajo.',
  falta_id: 'Faltó indicar cuál era la reserva.',
  ignorar: 'No se pudo descartar la reserva. Quedó como estaba.',
  reintentar: 'No se pudo volver a marcar como pendiente. Quedó como estaba.',
  mensaje: 'No se pudo guardar el mensaje.',
  cuerpo: 'Escribí el texto del mensaje.',
  resena: 'No se pudo guardar la reseña.',
  puntaje: 'El puntaje de Booking va de 0 a 10.',
  resena_vacia: 'Escribí al menos lo positivo o lo negativo de la reseña.',
  respuesta: 'No se pudo guardar la respuesta.',
  respuesta_vacia: 'Escribí la respuesta antes de guardar.',
}

interface EntranteRow {
  id: string
  canal: string
  external_id: string
  operacion: string
  estado: EstadoEntrante
  motivo: string
  huesped_apellido: string
  huesped_nombre: string
  huesped_email: string | null
  huesped_pais: string | null
  tipo_unidad_codigo: string
  check_in: string
  check_out: string
  huespedes: number
  importe_canal: number | string | null
  moneda_canal: string | null
  comision: number | string | null
  notas: string
  reserva_id: string | null
  reserva: { codigo: string } | null
}

interface SincroRow {
  proveedor: string
  origen: string
  leidas: number
  nuevas: number
  actualizadas: number
  rechazadas: number
  corrida_en: string
}

interface MensajeRow {
  id: string
  cuerpo: string
  autor: string
  atendido: boolean
  recibido_en: string
  entrante: { huesped_apellido: string; check_in: string } | null
}

interface ResenaRow {
  id: string
  autor: string
  puntaje: number | string | null
  positivo: string
  negativo: string
  publicada_en: string | null
  respondida: boolean
  respuesta: string
}

export default async function CanalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string
    estado?: string
    error?: string
    ok?: string
    codigo?: string
    nuevas?: string
    actualizadas?: string
    rechazadas?: string
  }>
}) {
  await requerirAcceso('canales')
  const sp = await searchParams

  const vista: Vista = (VISTAS as readonly string[]).includes(sp.vista ?? '')
    ? (sp.vista as Vista)
    : 'entrantes'
  const estado = (ESTADOS_ENTRANTE as readonly string[]).includes(sp.estado ?? '')
    ? (sp.estado as EstadoEntrante)
    : undefined

  const proveedor = obtenerProveedorCanal()
  const capacidades = proveedor.capacidades()

  const supabase = await crearClienteServidor()

  let consultaEntrantes = supabase
    .from('canal_reservas')
    .select(
      'id, canal, external_id, operacion, estado, motivo, huesped_apellido, huesped_nombre, huesped_email, huesped_pais, tipo_unidad_codigo, check_in, check_out, huespedes, importe_canal, moneda_canal, comision, notas, reserva_id, reserva:reservas(codigo)',
    )
    .order('check_in', { ascending: true })
    .limit(200)
  if (estado) consultaEntrantes = consultaEntrantes.eq('estado', estado)

  const [{ data: entrantesData }, { data: sincroData }, { data: mensajesData }, { data: resenasData }] =
    await Promise.all([
      consultaEntrantes,
      supabase
        .from('canal_sincronizaciones')
        .select('proveedor, origen, leidas, nuevas, actualizadas, rechazadas, corrida_en')
        .order('corrida_en', { ascending: false })
        .limit(5),
      supabase
        .from('canal_mensajes')
        .select(
          'id, cuerpo, autor, atendido, recibido_en, entrante:canal_reservas(huesped_apellido, check_in)',
        )
        .order('recibido_en', { ascending: false })
        .limit(100),
      supabase
        .from('canal_resenas')
        .select('id, autor, puntaje, positivo, negativo, publicada_en, respondida, respuesta')
        .order('publicada_en', { ascending: false, nullsFirst: false })
        .limit(100),
    ])

  const entrantes = (entrantesData ?? []) as unknown as EntranteRow[]
  const sincronizaciones = (sincroData ?? []) as SincroRow[]
  const mensajes = (mensajesData ?? []) as unknown as MensajeRow[]
  const resenas = (resenasData ?? []) as unknown as ResenaRow[]

  // Los contadores se cuentan sobre todo, no sobre lo filtrado: son la razón para
  // aplicar el filtro, así que no pueden depender de él.
  const { data: todosEstados } = await supabase.from('canal_reservas').select('estado')
  const conteo = new Map<string, number>()
  for (const r of (todosEstados ?? []) as { estado: string }[]) {
    conteo.set(r.estado, (conteo.get(r.estado) ?? 0) + 1)
  }

  const ultima = sincronizaciones[0]
  const hoy = hoyISO()
  const sinAtender = mensajes.filter((m) => !m.atendido).length
  const sinResponder = resenas.filter((r) => !r.respondida).length
  const vigentes = { vista: sp.vista, estado }

  return (
    <Pagina ancho="ancho">
      <Encabezado
        titulo="Canales de venta"
        descripcion="Reservas, mensajes y reseñas que llegan de Booking."
        icono="canales"
        acciones={
          capacidades.traeReservas ? (
            <form action={sincronizarCanal}>
              <BotonEnvio variante="secundario" cargando="Sincronizando…">
                <Icono nombre="siguiente" tam={16} />
                Sincronizar ahora
              </BotonEnvio>
            </form>
          ) : null
        }
      />

      {sp.error && (
        <Mensaje tono="error">{MENSAJES_ERROR[sp.error] ?? 'Ocurrió un error.'}</Mensaje>
      )}
      {sp.ok === 'sincro' && (
        <Mensaje tono="ok">
          Sincronización lista: {sp.nuevas ?? 0} nueva(s), {sp.actualizadas ?? 0} actualizada(s),{' '}
          {sp.rechazadas ?? 0} rechazada(s).
        </Mensaje>
      )}
      {sp.ok === 'importada' && (
        <Mensaje tono="ok">Reserva {sp.codigo} creada a partir de la del canal.</Mensaje>
      )}
      {sp.ok === 'importada_con_aviso' && (
        <Mensaje tono="ok">
          Reserva {sp.codigo} creada. El importe del canal no coincide con la cuenta del hotel —
          el detalle quedó anotado en la fila.
        </Mensaje>
      )}
      {sp.ok === 'ignorada' && <Mensaje tono="ok">Reserva descartada.</Mensaje>}
      {sp.ok === 'reintentar' && <Mensaje tono="ok">Quedó lista para volver a importar.</Mensaje>}
      {sp.ok === 'mensaje' && <Mensaje tono="ok">Mensaje guardado.</Mensaje>}
      {sp.ok === 'resena' && <Mensaje tono="ok">Reseña guardada.</Mensaje>}
      {sp.ok === 'respuesta' && <Mensaje tono="ok">Respuesta guardada.</Mensaje>}

      {/* ── La advertencia que no puede faltar ────────────────────────────────
          Sin esto alguien va a creer que está cubierto porque «el sistema
          sincroniza con Booking». Va con ícono Y texto, arriba de todo. */}
      {!capacidades.publicaDisponibilidad && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-lenga-50 px-4 py-3 ring-1 ring-lenga-200">
          <span className="mt-0.5 shrink-0 text-lenga-700">
            <Icono nombre="alerta" tam={18} />
          </span>
          <div className="text-sm text-lenga-900">
            <p className="font-semibold">
              Esta sincronización es de una sola dirección: no evita el overbooking.
            </p>
            <p className="mt-1 text-lenga-800">
              Traemos las reservas de Booking, pero <strong>no le informamos qué queda libre</strong>.
              Booking puede vender una unidad que el mostrador ya vendió. Hay que seguir cerrando
              fechas a mano en el extranet. Para sincronizar en las dos direcciones hace falta un{' '}
              <em>channel manager</em> — es una contratación del hotel, no algo que se resuelva con
              código.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Sin importar"
          valor={String(conteo.get('pendiente') ?? 0)}
          detalle="esperando revisión"
          icono="reservas"
          tono="alerta"
          href={`/panel/canales${construirQuery({ estado: 'pendiente' })}`}
        />
        <Kpi
          titulo="Con problema"
          valor={String(conteo.get('error') ?? 0)}
          detalle="no se pudieron importar"
          icono="alerta"
          tono="peligro"
          href={`/panel/canales${construirQuery({ estado: 'error' })}`}
        />
        <Kpi
          titulo="Mensajes sin atender"
          valor={String(sinAtender)}
          detalle="peticiones del huésped"
          icono="chat"
          href="/panel/canales?vista=mensajes"
        />
        <Kpi
          titulo="Reseñas sin responder"
          valor={String(sinResponder)}
          detalle="publicadas en el canal"
          icono="firma"
          href="/panel/canales?vista=resenas"
        />
      </div>

      {/* Estado del proveedor: qué está configurado y qué sabe hacer. */}
      <Tarjeta titulo="Estado de la sincronización">
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-stone-600">
              Proveedor: <strong className="text-stone-900">{proveedor.nombre}</strong>
              {!proveedor.esReal() && (
                <span className="ml-2 text-xs text-stone-500">
                  (simulado — no consulta ningún canal)
                </span>
              )}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-stone-600">
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.traeReservas ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.traeReservas
                  ? 'Trae reservas automáticamente'
                  : 'No trae reservas solo: hay que subir el informe CSV'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.publicaDisponibilidad ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.publicaDisponibilidad
                  ? 'Publica disponibilidad al canal'
                  : 'No publica disponibilidad (el canal puede sobrevender)'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.trae.importes ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.trae.importes
                  ? 'Informa importes y comisión'
                  : 'No informa importes: el total lo calcula el hotel'}
              </li>
              <li className="flex items-center gap-1.5">
                <Icono nombre={capacidades.trae.contacto ? 'ok' : 'cerrar'} tam={13} />
                {capacidades.trae.contacto
                  ? 'Informa email y teléfono'
                  : 'No informa contacto del huésped'}
              </li>
            </ul>
          </div>

          <div className="text-sm">
            {ultima ? (
              <>
                <p className="text-stone-600">
                  Última sincronización:{' '}
                  <strong className="text-stone-900">
                    {new Date(ultima.corrida_en).toLocaleString('es-AR')}
                  </strong>
                </p>
                <p className="mt-1 text-xs text-stone-600">
                  {ultima.proveedor}
                  {ultima.origen ? ` · ${ultima.origen}` : ''} — {ultima.leidas} leída(s),{' '}
                  {ultima.nuevas} nueva(s), {ultima.actualizadas} actualizada(s),{' '}
                  {ultima.rechazadas} rechazada(s)
                </p>
              </>
            ) : (
              <p className="text-stone-600">
                Todavía no se sincronizó nunca. Subí el informe del extranet abajo para empezar.
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      <div className="mt-4">
        <Tarjeta
          titulo="Importar el informe del extranet"
          descripcion="El camino que no necesita aprobación de Booking ni contratar nada."
        >
          <ImportarCsv />
        </Tarjeta>
      </div>

      <div className="mt-6 mb-4 flex flex-wrap gap-1.5">
        {VISTAS.map((v) => (
          <Chip
            key={v}
            href={`/panel/canales${construirQuery({ vista: v === 'entrantes' ? undefined : v })}`}
            activo={vista === v}
          >
            {ETIQUETAS_VISTA[v]}
          </Chip>
        ))}
      </div>

      {vista === 'entrantes' && (
        <>
          <BarraHerramientas>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                href={`/panel/canales${construirQuery(vigentes, { estado: undefined })}`}
                activo={!estado}
              >
                Todas
              </Chip>
              {ESTADOS_ENTRANTE.map((e) => (
                <Chip
                  key={e}
                  href={`/panel/canales${construirQuery(vigentes, { estado: e })}`}
                  activo={estado === e}
                >
                  {ETIQUETAS_ESTADO[e]} ({conteo.get(e) ?? 0})
                </Chip>
              ))}
            </div>
          </BarraHerramientas>

          <Tarjeta className="overflow-hidden">
            {entrantes.length === 0 ? (
              <EstadoVacio
                titulo={estado ? `No hay reservas «${ETIQUETAS_ESTADO[estado]}»` : 'Todavía no llegó ninguna reserva'}
                descripcion={
                  estado
                    ? 'Probá con otro estado o quitá el filtro.'
                    : 'Subí el informe del extranet, o configurá los feeds iCal para que se sincronicen solas.'
                }
                icono="canales"
              />
            ) : (
              <div className="overflow-x-auto">
                <Tabla resumen="Reservas llegadas de canales externos, con su estado de importación">
                  <thead>
                    <tr>
                      <th className={TH}>Huésped</th>
                      <th className={TH}>Estadía</th>
                      <th className={TH}>Tipo pedido</th>
                      <th className={`${TH} text-right`}>Canal informa</th>
                      <th className={TH}>Estado</th>
                      <th className={TH}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entrantes.map((e) => {
                      const llegaHoy = e.check_in === hoy
                      const saleHoy = e.check_out === hoy
                      const enCurso = e.check_in <= hoy && e.check_out > hoy

                      return (
                        <tr key={e.id} className={FILA}>
                          <td className={TD}>
                            <span className="font-medium text-stone-800">
                              {e.huesped_apellido}
                              {e.huesped_nombre ? `, ${e.huesped_nombre}` : ''}
                            </span>
                            <span className="block text-xs text-stone-500">
                              {e.canal} · {e.external_id}
                              {e.huesped_pais ? ` · ${e.huesped_pais}` : ''}
                            </span>
                            {e.huesped_email && (
                              <span className="block text-xs text-stone-500">{e.huesped_email}</span>
                            )}
                          </td>

                          <td className={`${TD} text-stone-600`}>
                            <span className="tabular">
                              {formatoFechaCorta(e.check_in)} → {formatoFechaCorta(e.check_out)}
                            </span>
                            <span className="block text-xs text-stone-500">
                              {e.huespedes} huésped(es)
                            </span>
                            {/* Llegadas, salidas y estancias marcadas con texto,
                                no sólo con color. */}
                            {llegaHoy && (
                              <Etiqueta tono="exito">Llega hoy</Etiqueta>
                            )}
                            {saleHoy && <Etiqueta tono="alerta">Sale hoy</Etiqueta>}
                            {enCurso && !llegaHoy && <Etiqueta tono="lago">En curso</Etiqueta>}
                          </td>

                          <td className={`${TD} text-stone-600`}>
                            <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
                              {e.tipo_unidad_codigo}
                            </code>
                          </td>

                          <td className={`${TD} tabular text-right text-stone-600`}>
                            {Number(e.importe_canal ?? 0) > 0 ? (
                              <>
                                {e.moneda_canal} {Number(e.importe_canal).toLocaleString('es-AR')}
                                {e.comision != null && (
                                  <span className="block text-xs text-stone-500">
                                    comisión {importe(Number(e.comision))}
                                  </span>
                                )}
                              </>
                            ) : (
                              /* No se muestra «0» como si fuera un precio: el iCal
                                 no informa importes y un cero ahí se leería como
                                 «reserva gratis». */
                              <span className="text-xs text-stone-400">no informa</span>
                            )}
                          </td>

                          <td className={TD}>
                            <Etiqueta tono={TONO_ESTADO[e.estado]}>
                              {ETIQUETAS_ESTADO[e.estado]}
                            </Etiqueta>
                            {e.operacion === 'cancelada' && (
                              <span className="mt-1 block text-xs font-medium text-red-700">
                                el canal la canceló
                              </span>
                            )}
                            {e.reserva?.codigo && (
                              <Link
                                href={`/panel/reservas/${e.reserva_id}`}
                                className="mt-1 block text-xs font-medium text-lago-700 hover:underline"
                              >
                                {e.reserva.codigo}
                              </Link>
                            )}
                            {e.motivo && (
                              <span className="mt-1 block max-w-xs text-xs text-stone-600">
                                {e.motivo}
                              </span>
                            )}
                            {e.notas && (
                              <span className="mt-1 block max-w-xs text-xs text-stone-500 italic">
                                «{e.notas}»
                              </span>
                            )}
                          </td>

                          <td className={TD}>
                            <div className="flex flex-col gap-1.5">
                              {(e.estado === 'pendiente' || e.estado === 'error') &&
                                e.operacion !== 'cancelada' && (
                                  <form action={importarUna}>
                                    <input type="hidden" name="entrante_id" value={e.id} />
                                    <BotonEnvio cargando="Importando…" extra="w-full">
                                      Importar
                                    </BotonEnvio>
                                  </form>
                                )}

                              {e.estado === 'ignorada' && (
                                <form action={reintentarEntrante}>
                                  <input type="hidden" name="entrante_id" value={e.id} />
                                  <BotonEnvio
                                    variante="secundario"
                                    cargando="Reactivando…"
                                    extra="w-full"
                                  >
                                    Reactivar
                                  </BotonEnvio>
                                </form>
                              )}

                              {e.estado !== 'importada' && e.estado !== 'ignorada' && (
                                <form action={ignorarEntrante}>
                                  <input type="hidden" name="entrante_id" value={e.id} />
                                  <BotonEnvio
                                    variante="fantasma"
                                    cargando="Descartando…"
                                    extra="w-full"
                                    confirmar={`¿Descartar la reserva de ${e.huesped_apellido}? No se va a crear en el sistema.`}
                                  >
                                    Descartar
                                  </BotonEnvio>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Tabla>
              </div>
            )}
          </Tarjeta>
        </>
      )}

      {vista === 'mensajes' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Tarjeta
            titulo="Peticiones del huésped"
            descripcion="Un pedido sin atender termina siendo una queja en la reseña."
            className="lg:col-span-2"
          >
            {mensajes.length === 0 ? (
              <EstadoVacio
                titulo="No hay mensajes cargados"
                descripcion="Ni el informe CSV ni el feed iCal traen los mensajes de Booking: se cargan a mano acá al lado."
                icono="chat"
              />
            ) : (
              <ul className="divide-y divide-stone-100">
                {mensajes.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className={`text-sm ${m.atendido ? 'text-stone-500' : 'text-stone-800'}`}>
                        {m.cuerpo}
                      </p>
                      <p className="mt-1 text-xs text-stone-500">
                        {m.entrante
                          ? `${m.entrante.huesped_apellido} · llega ${formatoFechaCorta(m.entrante.check_in)} · `
                          : ''}
                        {new Date(m.recibido_en).toLocaleDateString('es-AR')}
                      </p>
                      {m.atendido && (
                        <Etiqueta tono="exito">Atendido</Etiqueta>
                      )}
                    </div>
                    <form action={marcarMensajeAtendido} className="shrink-0">
                      <input type="hidden" name="mensaje_id" value={m.id} />
                      <input type="hidden" name="atendido" value={String(m.atendido)} />
                      <BotonEnvio variante={m.atendido ? 'fantasma' : 'secundario'} cargando="…">
                        {m.atendido ? 'Reabrir' : 'Marcar atendido'}
                      </BotonEnvio>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo="Cargar una petición">
            <form action={cargarMensaje} className="flex flex-col gap-3 p-5">
              <Campo
                etiqueta="Qué pidió el huésped"
                ayuda="Cuna, llegada tardía, habitación en planta baja…"
              >
                <textarea name="cuerpo" rows={4} required className={CAMPO} />
              </Campo>
              <Campo etiqueta="Reserva del canal (opcional)">
                <select name="entrante_id" defaultValue="" className={CAMPO}>
                  <option value="">Sin asociar</option>
                  {entrantes.slice(0, 50).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.huesped_apellido} — {formatoFechaCorta(e.check_in)}
                    </option>
                  ))}
                </select>
              </Campo>
              <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
                Guardar petición
              </BotonEnvio>
            </form>
          </Tarjeta>
        </div>
      )}

      {vista === 'resenas' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Tarjeta
            titulo="Reseñas publicadas"
            descripcion="Las de Booking. El NPS propio se mide aparte, en las encuestas."
            className="lg:col-span-2"
          >
            {resenas.length === 0 ? (
              <EstadoVacio
                titulo="No hay reseñas cargadas"
                descripcion="Booking no las expone sin la API de partner: se cargan a mano acá al lado."
                icono="firma"
              />
            ) : (
              <ul className="divide-y divide-stone-100">
                {resenas.map((r) => (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-800">
                          {r.autor}
                          {r.puntaje != null && (
                            <span
                              className={`ml-2 rounded px-1.5 py-0.5 text-xs font-semibold ${
                                Number(r.puntaje) >= 8
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : Number(r.puntaje) >= 6
                                    ? 'bg-lenga-100 text-lenga-900'
                                    : 'bg-red-100 text-red-900'
                              }`}
                            >
                              {Number(r.puntaje).toFixed(1)} / 10
                            </span>
                          )}
                        </p>
                        {r.publicada_en && (
                          <p className="text-xs text-stone-500">
                            {formatoFechaCorta(r.publicada_en)}
                          </p>
                        )}
                      </div>
                      {r.respondida && <Etiqueta tono="exito">Respondida</Etiqueta>}
                    </div>

                    {r.positivo && (
                      <p className="mt-2 text-sm text-stone-700">
                        <span className="font-medium text-emerald-700">Le gustó:</span> {r.positivo}
                      </p>
                    )}
                    {r.negativo && (
                      <p className="mt-1 text-sm text-stone-700">
                        <span className="font-medium text-red-700">No le gustó:</span> {r.negativo}
                      </p>
                    )}

                    {r.respondida ? (
                      <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                        <span className="font-medium">Respuesta del hotel:</span> {r.respuesta}
                      </p>
                    ) : (
                      <form action={responderResena} className="mt-2 flex flex-col gap-2">
                        <input type="hidden" name="resena_id" value={r.id} />
                        <Campo etiqueta="Respuesta del hotel">
                          <textarea name="respuesta" rows={2} required className={CAMPO} />
                        </Campo>
                        <BotonEnvio
                          variante="secundario"
                          cargando="Guardando…"
                          extra="w-full sm:w-auto"
                        >
                          Guardar respuesta
                        </BotonEnvio>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo="Cargar una reseña">
            <form action={cargarResena} className="flex flex-col gap-3 p-5">
              <Campo etiqueta="Autor">
                <input name="autor" className={CAMPO} placeholder="Nombre o «Anónimo»" />
              </Campo>
              <Campo etiqueta="Puntaje" ayuda="Escala de Booking: 0 a 10, con un decimal.">
                <input
                  name="puntaje"
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  required
                  className={CAMPO}
                />
              </Campo>
              <Campo etiqueta="Le gustó">
                <textarea name="positivo" rows={2} className={CAMPO} />
              </Campo>
              <Campo etiqueta="No le gustó">
                <textarea name="negativo" rows={2} className={CAMPO} />
              </Campo>
              <Campo etiqueta="Fecha de publicación">
                <input name="publicada_en" type="date" className={CAMPO} />
              </Campo>
              <BotonEnvio cargando="Guardando…" extra="w-full sm:w-auto">
                Guardar reseña
              </BotonEnvio>
            </form>
          </Tarjeta>
        </div>
      )}
    </Pagina>
  )
}
