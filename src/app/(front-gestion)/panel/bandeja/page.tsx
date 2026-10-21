import Image from 'next/image'
import Link from 'next/link'
import { requerirAcceso } from '@/lib/auth/session'
import { construirQuery, mensajeDe, terminoBusqueda } from '@/lib/listados'
import { deLista } from '@/lib/domain/listas'
import { esDireccion } from '@/lib/domain/permisos'
import { ETIQUETAS_ESTADO_RESERVA } from '@/lib/domain/reservas'
import {
  CANALES_BANDEJA,
  DESCRIPCION_ESTADO,
  ESTADOS_CONVERSACION,
  ETIQUETAS_CANAL,
  ETIQUETAS_ESTADO,
  ETIQUETAS_ESTADO_MENSAJE,
  ETIQUETAS_POSPONER,
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_VISTA,
  OPCIONES_POSPONER,
  PRIORIDADES,
  VISTAS_BANDEJA,
  adjuntosDe,
  esperaLarga,
  estadoEfectivo,
  iniciales,
  nombreDeContacto,
  primerNombre,
  rotuloAdjunto,
  rotuloDeDia,
  seAgrupa,
  tiempoEsperando,
  ventanaDeRespuesta,
  vistaPrevia,
  type Adjunto,
  type EstadoConversacion,
  type Prioridad,
  type TonoEtiqueta,
} from '@/lib/domain/bandeja'
import { puedeEnviar } from '@/lib/bandeja/canales'
import { estadoDeCanales } from '@/lib/bandeja/conexion'
import {
  buscarHuespedes,
  contarPorEstado,
  contextoDeConversacion,
  leerConversacion,
  listarConversaciones,
  listarEtiquetas,
  resumenDeLista,
  type Detalle,
  type EtiquetaBandeja,
  type FilaMensaje,
} from '@/lib/bandeja/consultas'
import { fechaDelHotel, fechaHoraHotel, fechaHotel, horaHotel, sumarDias } from '@/lib/fechas'
import { Chip, Encabezado, EstadoVacio, Etiqueta, Mensaje, Pagina, botonClases, CAMPO, type Tono } from '../_components/ui'
import { BotonEnvio } from '../_components/boton-envio'
import { Icono } from '../_components/iconos'
import { AlFinal, EnVivo, MarcarLeida } from './en-vivo'
import { Compositor } from './compositor'
import { FormContacto } from './form-contacto'
import { IconoCanal } from './icono-canal'
import { SubNavBandeja } from './subnav'
import {
  asignar,
  bloquearContacto,
  cambiarEstado,
  cambiarPrioridad,
  etiquetar,
  posponer,
  quitarEtiqueta,
  vincularHuesped,
  vincularReserva,
} from './actions'

/**
 * Bandeja de mensajes con huéspedes (ADR 0043 y 0044).
 *
 * Tres columnas, como Chatwoot: la lista de conversaciones, el hilo con la caja
 * de respuesta, y el contacto con su ficha de huésped y sus reservas — esto
 * último no lo tiene Chatwoot y es la razón de hacerlo dentro del PMS.
 *
 * En el teléfono se ve una columna por vez: la lista, o la conversación
 * elegida con un «volver» arriba.
 *
 * Cuando todavía no llegó ningún mensaje no se muestran dos paneles vacíos: se
 * muestra la guía de cómo conectar los canales, que es lo que quien llega acá
 * por primera vez necesita.
 */

const MENSAJES_ERROR: Record<string, string> = {
  estado: 'No se pudo cambiar el estado de la conversación.',
  posponer: 'No se pudo posponer la conversación.',
  asignar: 'No se pudo asignar la conversación.',
  asignar_perfil: 'Esa persona no atiende la bandeja (o está dada de baja).',
  prioridad: 'No se pudo cambiar la prioridad.',
  etiqueta: 'No se pudo cambiar la etiqueta.',
  vincular: 'No se pudo vincular el contacto con la ficha del huésped.',
  reserva: 'No se pudo vincular la reserva.',
  bloquear: 'No se pudo bloquear o desbloquear al contacto.',
}

const TONO_ETIQUETA: Record<TonoEtiqueta, Tono> = {
  lago: 'lago',
  calafate: 'calafate',
  lenga: 'alerta',
  exito: 'exito',
  alerta: 'alerta',
  peligro: 'peligro',
  neutro: 'neutro',
}

const TONO_ESTADO: Record<EstadoConversacion, Tono> = {
  abierta: 'lago',
  pendiente: 'alerta',
  pospuesta: 'neutro',
  resuelta: 'exito',
}

const TONO_PRIORIDAD: Record<Prioridad, Tono> = {
  baja: 'neutro',
  media: 'lago',
  alta: 'alerta',
  urgente: 'peligro',
}

const ALTO = 'lg:h-[calc(100dvh-15rem)] lg:min-h-[32rem]'

type Params = Record<string, string | undefined>

export default async function BandejaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sesion = await requerirAcceso('bandeja')
  const sp = await searchParams
  const ahora = new Date()
  const direccion = esDireccion(sesion.rol)

  const vista = deLista(VISTAS_BANDEJA, sp.vista) ?? 'todas'
  const estado = deLista(ESTADOS_CONVERSACION, sp.estado) ?? 'abierta'
  const canal = deLista(CANALES_BANDEJA, sp.canal)
  const etiquetaFiltro = /^[0-9a-f-]{36}$/i.test(sp.etiqueta ?? '') ? sp.etiqueta : undefined
  const termino = terminoBusqueda(sp.q)
  const seleccion = /^[0-9a-f-]{36}$/i.test(sp.c ?? '') ? sp.c : undefined
  const filtros: Params = { vista, estado, canal, etiqueta: etiquetaFiltro, q: sp.q }

  const [lista, lecturaEtiquetas, conteo] = await Promise.all([
    listarConversaciones({ vista, estado, canal, etiqueta: etiquetaFiltro, termino, usuarioId: sesion.userId, ahora }),
    listarEtiquetas(),
    contarPorEstado({ usuarioId: sesion.userId, vista, canal, ahora }),
  ])
  const filas = lista.datos
  const etiquetas = lecturaEtiquetas.datos
  const { previas, etiquetasDe } = await resumenDeLista(filas.map((f) => f.id))
  const etiquetaPorId = new Map(etiquetas.map((e) => [e.id, e]))

  const totalGeneral = conteo.datos.abierta + conteo.datos.pendiente + conteo.datos.pospuesta + conteo.datos.resuelta
  // Sin ninguna conversación y sin filtros: lo que sirve es la guía, no dos paneles vacíos.
  const sinConversaciones = totalGeneral === 0 && !conteo.fallo && !lista.fallo && vista === 'todas' && !canal && !termino && !etiquetaFiltro
  const estadosDeCanales = estadoDeCanales(CANALES_BANDEJA)
  const sinConectar = estadosDeCanales.filter((e) => e.nivel === 'a_medias' || e.nivel === 'sin_conectar')

  const lecturaDetalle = seleccion ? await leerConversacion(seleccion) : null
  const detalle = lecturaDetalle?.datos.detalle ?? null
  const mensajes = lecturaDetalle?.datos.mensajes ?? []
  const errorDetalle = lecturaDetalle?.fallo ?? false

  return (
    <Pagina ancho="ancho">
      <EnVivo />
      <Encabezado
        titulo="Bandeja de mensajes"
        descripcion="WhatsApp, Instagram, Messenger, correo, Telegram y el chat de la web, en un solo lugar."
        icono="chat"
      />
      <SubNavBandeja direccion={direccion} />

      {sp.error && <Mensaje tono="error">{mensajeDe(MENSAJES_ERROR, sp.error, 'No se pudo completar la acción.')}</Mensaje>}
      {(lista.fallo || conteo.fallo) && (
        <Mensaje tono="error">No se pudo leer la bandeja. Lo que ves abajo puede estar incompleto: recargá la página en unos segundos.</Mensaje>
      )}

      {sinConversaciones ? (
        <Bienvenida estados={estadosDeCanales} direccion={direccion} />
      ) : (
        <>
          {sinConectar.length > 0 && (
            <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-lenga-50 px-4 py-2.5 text-sm text-lenga-900 ring-1 ring-lenga-200">
              <span>
                {sinConectar.map((e) => ETIQUETAS_CANAL[e.canal]).join(', ')}: {sinConectar.length === 1 ? 'todavía no está conectado' : 'todavía no están conectados'}.
              </span>
              <Link href="/panel/bandeja/conectar" className="font-medium underline">
                {direccion ? 'Conectar' : 'Ver cómo se conectan'}
              </Link>
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)_19rem]">
            {/* ── Columna 1: lista ── */}
            <section
              aria-label="Conversaciones"
              className={`flex min-h-0 min-w-0 flex-col rounded-2xl border border-stone-200 bg-white shadow-sm ${ALTO} ${seleccion ? 'hidden lg:flex' : 'flex'}`}
            >
              <div className="space-y-3 border-b border-stone-100 p-3">
                <form action="/panel/bandeja" className="flex gap-2">
                  {Object.entries({ vista, estado, canal, etiqueta: etiquetaFiltro }).map(([k, v]) =>
                    v ? <input key={k} type="hidden" name={k} value={v} /> : null,
                  )}
                  <label className="sr-only" htmlFor="buscar-bandeja">
                    Buscar por nombre, teléfono o texto de un mensaje
                  </label>
                  <input id="buscar-bandeja" name="q" defaultValue={sp.q ?? ''} placeholder="Nombre, teléfono o mensaje" className={CAMPO} />
                  <button type="submit" className={botonClases('secundario')} aria-label="Buscar">
                    <Icono nombre="buscar" tam={16} />
                  </button>
                </form>

                <div className="flex flex-wrap gap-1.5" aria-label="Estado de las conversaciones">
                  {ESTADOS_CONVERSACION.map((e) => (
                    <Chip key={e} href={`/panel/bandeja${construirQuery(filtros, { estado: e, c: undefined })}`} activo={estado === e}>
                      {ETIQUETAS_ESTADO[e]}s <span className="ml-1 text-xs opacity-80">{conteo.datos[e]}</span>
                    </Chip>
                  ))}
                </div>

                <div className="inline-flex rounded-lg bg-stone-100 p-0.5" aria-label="Quién la atiende">
                  {VISTAS_BANDEJA.map((v) => (
                    <Link
                      key={v}
                      href={`/panel/bandeja${construirQuery(filtros, { vista: v, c: undefined })}`}
                      aria-current={vista === v ? 'true' : undefined}
                      className={`toque rounded-md px-3 py-1 text-xs font-medium transition ${vista === v ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
                    >
                      {ETIQUETAS_VISTA[v]}
                    </Link>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5" aria-label="Canal">
                  <Link
                    href={`/panel/bandeja${construirQuery(filtros, { canal: undefined, c: undefined })}`}
                    aria-current={!canal ? 'true' : undefined}
                    className={`toque rounded-lg px-2.5 py-1 text-xs font-medium ${!canal ? 'bg-stone-800 text-white' : 'text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50'}`}
                  >
                    Todos
                  </Link>
                  {CANALES_BANDEJA.map((c) => (
                    <Link
                      key={c}
                      href={`/panel/bandeja${construirQuery(filtros, { canal: c, c: undefined })}`}
                      aria-current={canal === c ? 'true' : undefined}
                      title={ETIQUETAS_CANAL[c]}
                      className={`rounded-xl p-0.5 transition ${canal === c ? 'ring-2 ring-lago-600 ring-offset-1' : 'hover:scale-105'}`}
                    >
                      <IconoCanal canal={c} tam={28} />
                    </Link>
                  ))}
                </div>

                {etiquetas.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5" aria-label="Etiqueta">
                    {etiquetaFiltro && (
                      <Link href={`/panel/bandeja${construirQuery(filtros, { etiqueta: undefined })}`} className="text-xs text-lago-700 underline">
                        Quitar etiqueta
                      </Link>
                    )}
                    {etiquetas.map((e) => (
                      <Link
                        key={e.id}
                        href={`/panel/bandeja${construirQuery(filtros, { etiqueta: e.id })}`}
                        aria-current={etiquetaFiltro === e.id ? 'true' : undefined}
                        className={etiquetaFiltro === e.id ? 'rounded-full ring-2 ring-lago-600' : ''}
                      >
                        <Etiqueta tono={TONO_ETIQUETA[e.color]}>{e.nombre}</Etiqueta>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <ul className="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto">
                {filas.length === 0 && !lista.fallo && (
                  <li>
                    <EstadoVacio
                      icono="chat"
                      titulo={termino ? 'Ninguna conversación coincide' : `No hay conversaciones ${ETIQUETAS_ESTADO[estado].toLowerCase()}s`}
                      descripcion={termino ? 'Se busca en el nombre, el teléfono, el email y el texto de los mensajes.' : 'Probá con otra pestaña de arriba.'}
                    />
                  </li>
                )}
                {filas.map((f) => {
                  const previa = previas.get(f.id)
                  const nombre = nombreDeContacto(f.crm_contactos)
                  const espera = tiempoEsperando(f.esperando_desde, ahora)
                  const activa = f.id === seleccion
                  return (
                    <li key={f.id}>
                      <Link
                        href={`/panel/bandeja${construirQuery(filtros, { c: f.id })}`}
                        aria-current={activa ? 'true' : undefined}
                        className={`flex gap-3 border-l-[3px] px-3 py-3 transition ${activa ? 'border-lago-600 bg-lago-50' : 'border-transparent hover:bg-stone-50'}`}
                      >
                        <Avatar nombre={nombre} canal={f.crm_bandejas.canal} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`truncate text-sm ${f.no_leidos > 0 ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'}`}>{nombre}</span>
                            <span className="shrink-0 text-xs text-stone-500">{horaOFecha(f.ultima_actividad_en, ahora)}</span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5">
                            <span className={`block min-w-0 flex-1 truncate text-sm ${f.no_leidos > 0 ? 'text-stone-800' : 'text-stone-600'}`}>
                              {previa?.tipo === 'saliente' && <span className="text-stone-500">Vos: </span>}
                              {previa ? vistaPrevia(previa.contenido, adjuntosDe(previa.adjuntos)) || '—' : '—'}
                            </span>
                            {f.no_leidos > 0 && (
                              <span className="shrink-0 rounded-full bg-lago-700 px-1.5 text-xs font-semibold text-white">
                                {f.no_leidos}
                                <span className="sr-only"> sin leer</span>
                              </span>
                            )}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {espera && (
                              <span className={`text-xs ${esperaLarga(f.esperando_desde, ahora) ? 'font-semibold text-red-700' : 'text-lenga-800'}`}>Espera {espera}</span>
                            )}
                            {f.prioridad && <Etiqueta tono={TONO_PRIORIDAD[f.prioridad]}>{ETIQUETAS_PRIORIDAD[f.prioridad]}</Etiqueta>}
                            {(etiquetasDe.get(f.id) ?? []).slice(0, 2).map((id) => {
                              const e = etiquetaPorId.get(id)
                              return e ? (
                                <Etiqueta key={id} tono={TONO_ETIQUETA[e.color]}>
                                  {e.nombre}
                                </Etiqueta>
                              ) : null
                            })}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>

            {/* ── Columnas 2 y 3: conversación + contacto ── */}
            {!seleccion ? (
              <section className={`hidden items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white ${ALTO} lg:flex xl:col-span-2`}>
                <EstadoVacio
                  icono="chat"
                  titulo="Elegí una conversación"
                  descripcion="Las que esperan respuesta hace más de una hora figuran en rojo."
                />
              </section>
            ) : !detalle ? (
              <section className="rounded-2xl border border-stone-200 bg-white p-6 xl:col-span-2">
                <Link href={`/panel/bandeja${construirQuery(filtros)}`} className="mb-4 inline-block text-sm text-lago-700 underline lg:hidden">
                  ← Volver a la lista
                </Link>
                {errorDetalle ? (
                  <Mensaje tono="error">No se pudo leer la conversación. Recargá la página en unos segundos.</Mensaje>
                ) : (
                  <EstadoVacio titulo="No se encontró la conversación" descripcion="Puede que no exista o que no tengas acceso." />
                )}
              </section>
            ) : (
              <Conversacion
                detalle={detalle}
                mensajes={mensajes}
                errorMensajes={errorDetalle}
                filtros={filtros}
                ahora={ahora}
                usuarioId={sesion.userId}
                nombreUsuario={sesion.nombre}
                etiquetas={etiquetas}
                busquedaHuesped={sp.bh}
              />
            )}
          </div>
        </>
      )}
    </Pagina>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function horaOFecha(iso: string, ahora: Date): string {
  const mismoDia = fechaHotel(iso) === fechaHotel(ahora)
  return mismoDia ? horaHotel(iso, { hour: '2-digit', minute: '2-digit' }) : fechaHotel(iso, { day: '2-digit', month: '2-digit' })
}

function Avatar({ nombre, canal, tam = 44 }: { nombre: string; canal: Parameters<typeof IconoCanal>[0]['canal']; tam?: number }) {
  return (
    <span className="relative mt-0.5 shrink-0" style={{ width: tam, height: tam }}>
      <span
        className="flex items-center justify-center rounded-full bg-stone-100 font-semibold text-stone-700"
        style={{ width: tam, height: tam, fontSize: Math.round(tam * 0.3) }}
      >
        {iniciales(nombre)}
      </span>
      <span className="absolute -right-1.5 -bottom-1.5 rounded-md ring-2 ring-white">
        <IconoCanal canal={canal} tam={Math.round(tam * 0.4)} />
      </span>
    </span>
  )
}

/** La guía de la primera vez: qué hacer para que lleguen mensajes. */
function Bienvenida({ estados, direccion }: { estados: ReturnType<typeof estadoDeCanales>; direccion: boolean }) {
  const conectados = estados.filter((e) => e.nivel === 'conectado').length
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-xl font-semibold text-stone-900">Todavía no llegó ningún mensaje</h2>
        <p className="mt-1 text-sm text-stone-600">
          Cuando un huésped escriba por cualquiera de estos canales, la conversación aparece acá y se le responde desde esta misma pantalla.
          {conectados === 0 && ' Empezá conectando el primero.'}
        </p>

        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ['1', 'Conectá un canal', 'WhatsApp, Instagram, correo… Cada uno tiene un asistente paso a paso.'],
            ['2', 'Probalo', 'El chat de la web ya funciona sin claves: abrí el portal y escribile a recepción.'],
            ['3', 'Respondé desde acá', 'Con respuestas guardadas, etiquetas y la ficha del huésped al lado.'],
          ].map(([n, t, d]) => (
            <li key={n} className="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
              <span className="flex size-6 items-center justify-center rounded-full bg-lago-700 text-xs font-semibold text-white">{n}</span>
              <p className="mt-2 text-sm font-semibold text-stone-900">{t}</p>
              <p className="text-xs text-stone-600">{d}</p>
            </li>
          ))}
        </ol>

        <ul className="mt-6 divide-y divide-stone-100 rounded-xl border border-stone-200">
          {estados.map((e) => (
            <li key={e.canal} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <IconoCanal canal={e.canal} tam={34} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-stone-900">{ETIQUETAS_CANAL[e.canal]}</span>
                <span className="block text-xs text-stone-500">
                  {e.nivel === 'siempre'
                    ? 'Siempre activo'
                    : e.nivel === 'conectado'
                      ? 'Conectado'
                      : e.nivel === 'a_medias'
                        ? (e.diagnostico?.indicacion ?? 'Faltan datos')
                        : 'Sin conectar'}
                </span>
              </span>
              <Link
                href={`/panel/bandeja/conectar/${e.canal}`}
                className={botonClases(e.nivel === 'conectado' || e.nivel === 'siempre' ? 'fantasma' : 'primario', 'text-xs')}
              >
                {e.nivel === 'conectado' || e.nivel === 'siempre' ? 'Ajustes' : direccion ? 'Conectar' : 'Ver cómo'}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

async function Conversacion({
  detalle,
  mensajes,
  errorMensajes,
  filtros,
  ahora,
  usuarioId,
  nombreUsuario,
  etiquetas,
  busquedaHuesped,
}: {
  detalle: Detalle
  mensajes: FilaMensaje[]
  errorMensajes: boolean
  filtros: Params
  ahora: Date
  usuarioId: string
  nombreUsuario: string
  etiquetas: EtiquetaBandeja[]
  busquedaHuesped?: string
}) {
  const contacto = detalle.crm_contactos
  const canal = detalle.crm_bandejas.canal
  const estadoVisible = estadoEfectivo(detalle.estado, detalle.pospuesta_hasta, ahora)
  const ctx = await contextoDeConversacion(detalle, mensajes)
  const { nombres: nombreDe, etiquetasPuestas: marcadasIds, huesped, reservas: reservasLista, otras, equipo, respuestas } = ctx

  const ventana = ventanaDeRespuesta(canal, detalle.ultimo_entrante_en, ahora, {
    agenteHumano: process.env.META_HUMAN_AGENT?.trim() === '1',
  })
  const bloqueo = contacto.bloqueado
    ? 'El contacto está bloqueado.'
    : !puedeEnviar(canal)
      ? `${ETIQUETAS_CANAL[canal]} todavía no tiene sus claves cargadas, así que no se puede responder desde acá.`
      : ventana.motivo
  const nombre = nombreDeContacto(contacto)
  const asignadaA = detalle.asignada_a ? (equipo.find((p) => p.id === detalle.asignada_a)?.nombre ?? 'otra persona') : null
  const hoy = fechaDelHotel(ahora)
  const ayer = sumarDias(hoy, -1)

  return (
    <>
      <MarcarLeida conversacionId={detalle.id} noLeidos={detalle.no_leidos} />

      {/* ── Hilo ── */}
      <section aria-label={`Conversación con ${nombre}`} className={`flex min-h-[70dvh] min-w-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm ${ALTO}`}>
        <header className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-3">
          <Link href={`/panel/bandeja${construirQuery({ ...filtros })}`} className="text-sm text-lago-700 underline lg:hidden">
            ← Lista
          </Link>
          <Avatar nombre={nombre} canal={canal} tam={46} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-stone-900">{nombre}</p>
            <p className="truncate text-xs text-stone-500">
              {ETIQUETAS_CANAL[canal]} · #{detalle.numero}
              {detalle.asunto ? ` · ${detalle.asunto}` : ''}
              {' · '}
              {asignadaA ? `Atiende ${asignadaA}` : 'Sin asignar'}
            </p>
          </div>
          <span title={DESCRIPCION_ESTADO[estadoVisible]}>
            <Etiqueta tono={TONO_ESTADO[estadoVisible]}>
              {ETIQUETAS_ESTADO[estadoVisible]}
              {estadoVisible === 'pospuesta' && detalle.pospuesta_hasta ? ` hasta ${fechaHoraHotel(detalle.pospuesta_hasta)}` : ''}
            </Etiqueta>
          </span>
          <form action={cambiarEstado}>
            <input type="hidden" name="conversacion_id" value={detalle.id} />
            <input type="hidden" name="estado" value={estadoVisible === 'resuelta' ? 'abierta' : 'resuelta'} />
            <BotonEnvio variante={estadoVisible === 'resuelta' ? 'secundario' : 'primario'} cargando="…">
              {estadoVisible === 'resuelta' ? 'Reabrir' : 'Resolver'}
            </BotonEnvio>
          </form>
        </header>

        {ventana.cierraEn && ventana.abierta && (
          <p className="border-b border-stone-100 bg-stone-50 px-4 py-1.5 text-xs text-stone-600">
            {ventana.agenteHumano ? 'Respuesta extendida (agente humano) hasta' : 'Se puede responder hasta'} {fechaHoraHotel(ventana.cierraEn)}.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50/60 px-4 py-4" aria-live="polite">
          {errorMensajes && <Mensaje tono="error">No se pudieron leer los mensajes. Recargá la página.</Mensaje>}
          {mensajes.map((m, i) => {
            const dia = fechaDelHotel(m.creado_en)
            const nuevoDia = i === 0 || fechaDelHotel(mensajes[i - 1].creado_en) !== dia
            const conAnterior = !nuevoDia && seAgrupa(m, mensajes[i - 1])
            const conSiguiente = i < mensajes.length - 1 && fechaDelHotel(mensajes[i + 1].creado_en) === dia && seAgrupa(mensajes[i + 1], m)
            return (
              <div key={m.id}>
                {nuevoDia && (
                  <p className="my-3 flex items-center gap-3 text-xs font-medium text-stone-500">
                    <span className="h-px flex-1 bg-stone-200" />
                    {rotuloDeDia(dia, hoy, ayer)}
                    <span className="h-px flex-1 bg-stone-200" />
                  </p>
                )}
                <Burbuja
                  m={m}
                  autor={m.autor_id ? (m.autor_id === usuarioId ? 'Vos' : (nombreDe.get(m.autor_id) ?? 'Equipo')) : null}
                  conAnterior={conAnterior}
                  mostrarPie={!conSiguiente}
                />
              </div>
            )
          })}
          <AlFinal marca={`${detalle.id}:${mensajes.length}`} />
        </div>

        <Compositor
          key={detalle.id}
          conversacionId={detalle.id}
          respuestas={respuestas}
          bloqueo={bloqueo}
          canal={ETIQUETAS_CANAL[canal]}
          variables={{ nombre: primerNombre(contacto.nombre), nombre_completo: contacto.nombre, agente: nombreUsuario }}
        />
      </section>

      {/* ── Contacto y acciones ── */}
      <aside aria-label="Contacto" className="min-w-0 space-y-4 lg:col-span-2 xl:col-span-1 xl:h-[calc(100dvh-15rem)] xl:min-h-[32rem] xl:overflow-y-auto">
        <Bloque titulo="Atención">
          <form action={asignar} className="flex flex-col gap-1.5">
            <input type="hidden" name="conversacion_id" value={detalle.id} />
            <label htmlFor="asignar" className="text-xs font-medium text-stone-600">
              Asignada a
            </label>
            <span className="flex gap-1">
              <select id="asignar" name="perfil_id" defaultValue={detalle.asignada_a ?? ''} className={`${CAMPO} py-1.5 text-sm`}>
                <option value="">Nadie</option>
                {equipo.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre || 'Sin nombre'}
                    {p.id === usuarioId ? ' (vos)' : ''}
                  </option>
                ))}
              </select>
              <BotonEnvio variante="secundario" cargando="…">
                Asignar
              </BotonEnvio>
            </span>
          </form>

          <form action={cambiarPrioridad} className="flex flex-col gap-1.5">
            <input type="hidden" name="conversacion_id" value={detalle.id} />
            <label htmlFor="prioridad" className="text-xs font-medium text-stone-600">
              Prioridad
            </label>
            <span className="flex gap-1">
              <select id="prioridad" name="prioridad" defaultValue={detalle.prioridad ?? ''} className={`${CAMPO} py-1.5 text-sm`}>
                <option value="">Sin prioridad</option>
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {ETIQUETAS_PRIORIDAD[p]}
                  </option>
                ))}
              </select>
              <BotonEnvio variante="secundario" cargando="…">
                Cambiar
              </BotonEnvio>
            </span>
          </form>

          {estadoVisible !== 'resuelta' && (
            <div className="space-y-2">
              <form action={cambiarEstado}>
                <input type="hidden" name="conversacion_id" value={detalle.id} />
                <input type="hidden" name="estado" value={estadoVisible === 'pendiente' ? 'abierta' : 'pendiente'} />
                <BotonEnvio variante="secundario" cargando="…" extra="w-full">
                  {estadoVisible === 'pendiente' ? 'Volver a abierta' : 'Marcar pendiente'}
                </BotonEnvio>
              </form>
              <div>
                <p className="mb-1 text-xs font-medium text-stone-600">Posponer</p>
                <div className="flex flex-wrap gap-1.5">
                  {OPCIONES_POSPONER.map((o) => (
                    <form key={o} action={posponer}>
                      <input type="hidden" name="conversacion_id" value={detalle.id} />
                      <input type="hidden" name="opcion" value={o} />
                      <BotonEnvio variante="fantasma" cargando="…" extra="ring-1 ring-stone-200 text-xs">
                        {ETIQUETAS_POSPONER[o]}
                      </BotonEnvio>
                    </form>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Bloque>

        <Bloque titulo="Etiquetas">
          {etiquetas.length === 0 ? (
            <p className="text-sm text-stone-500">Todavía no hay etiquetas creadas.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {etiquetas.map((e) => {
                const puesta = marcadasIds.has(e.id)
                return (
                  <form key={e.id} action={puesta ? quitarEtiqueta : etiquetar}>
                    <input type="hidden" name="conversacion_id" value={detalle.id} />
                    <input type="hidden" name="etiqueta_id" value={e.id} />
                    <button
                      type="submit"
                      aria-pressed={puesta}
                      title={puesta ? 'Quitar etiqueta' : 'Poner etiqueta'}
                      className={`toque rounded-full ${puesta ? 'ring-2 ring-lago-600' : 'opacity-60 hover:opacity-100'}`}
                    >
                      <Etiqueta tono={TONO_ETIQUETA[e.color]}>
                        {puesta ? '✓ ' : '+ '}
                        {e.nombre}
                      </Etiqueta>
                    </button>
                  </form>
                )
              })}
            </div>
          )}
        </Bloque>

        <Bloque titulo="Huésped">
          {huesped ? (
            <div className="space-y-2 text-sm">
              <p>
                <Link href={`/panel/huespedes/${huesped.id}`} className="font-medium text-lago-700 underline">
                  {`${huesped.nombre ?? ''} ${huesped.apellido ?? ''}`.trim() || 'Ver ficha'}
                </Link>
              </p>
              {reservasLista.length === 0 ? (
                <p className="text-stone-500">Sin reservas.</p>
              ) : (
                <ul className="space-y-1.5">
                  {reservasLista.map((r) => {
                    const e = r.estadias?.[0]
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-1">
                        <Link href={`/panel/reservas/${r.id}`} className="font-mono text-xs text-lago-700 underline">
                          {r.codigo}
                        </Link>
                        <span className="text-xs text-stone-600">{e ? `${fechaHotel(e.check_in)} → ${fechaHotel(e.check_out)}` : ''}</span>
                        <Etiqueta>{ETIQUETAS_ESTADO_RESERVA[r.estado] ?? r.estado}</Etiqueta>
                      </li>
                    )
                  })}
                </ul>
              )}
              {reservasLista.length > 0 && (
                <form action={vincularReserva} className="flex flex-col gap-1">
                  <input type="hidden" name="conversacion_id" value={detalle.id} />
                  <label htmlFor="reserva" className="text-xs font-medium text-stone-600">
                    Reserva de la que se habla
                  </label>
                  <span className="flex gap-1">
                    <select id="reserva" name="reserva_id" defaultValue={detalle.reserva_id ?? ''} className={`${CAMPO} py-1.5 text-sm`}>
                      <option value="">Ninguna</option>
                      {reservasLista.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.codigo}
                        </option>
                      ))}
                    </select>
                    <BotonEnvio variante="secundario" cargando="…">
                      Guardar
                    </BotonEnvio>
                  </span>
                </form>
              )}
              <form action={vincularHuesped}>
                <input type="hidden" name="contacto_id" value={contacto.id} />
                <input type="hidden" name="conversacion_id" value={detalle.id} />
                <input type="hidden" name="huesped_id" value="" />
                <BotonEnvio variante="fantasma" cargando="…" extra="text-xs" confirmar="¿Desvincular el contacto de esta ficha de huésped?">
                  Desvincular de la ficha
                </BotonEnvio>
              </form>
            </div>
          ) : (
            <BuscarHuesped
              contactoId={contacto.id}
              conversacionId={detalle.id}
              sugerido={contacto.email ?? contacto.telefono ?? contacto.nombre}
              busqueda={busquedaHuesped}
              filtros={filtros}
            />
          )}
        </Bloque>

        <Bloque titulo="Contacto">
          <FormContacto contacto={contacto} />
          <Link href={`/panel/bandeja/contactos/${contacto.id}`} className="mt-2 inline-block text-xs text-lago-700 underline">
            Ver todo lo de este contacto
          </Link>
          <form action={bloquearContacto} className="mt-3">
            <input type="hidden" name="contacto_id" value={contacto.id} />
            <input type="hidden" name="conversacion_id" value={detalle.id} />
            <input type="hidden" name="bloquear" value={contacto.bloqueado ? '0' : '1'} />
            <BotonEnvio
              variante={contacto.bloqueado ? 'secundario' : 'peligro'}
              cargando="…"
              extra="w-full"
              confirmar={contacto.bloqueado ? undefined : '¿Bloquear a este contacto? Sus mensajes nuevos no van a entrar a la bandeja.'}
            >
              {contacto.bloqueado ? 'Desbloquear contacto' : 'Bloquear (spam)'}
            </BotonEnvio>
          </form>
        </Bloque>

        {otras.length > 0 && (
          <Bloque titulo="Otras conversaciones">
            <ul className="space-y-1 text-sm">
              {otras.map((o) => (
                <li key={o.id}>
                  <Link href={`/panel/bandeja${construirQuery(filtros, { c: o.id, estado: o.estado })}`} className="text-lago-700 underline">
                    #{o.numero} · {ETIQUETAS_CANAL[o.crm_bandejas.canal]}
                  </Link>{' '}
                  <span className="text-xs text-stone-500">
                    {ETIQUETAS_ESTADO[o.estado]} · {fechaHotel(o.ultima_actividad_en)}
                  </span>
                </li>
              ))}
            </ul>
          </Bloque>
        )}
      </aside>
    </>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-stone-900">{titulo}</h2>
      {children}
    </section>
  )
}

/** La URL de un adjunto: pública del canal, o nuestro proxy para los de WhatsApp. */
function urlDeAdjunto(a: Adjunto): string | null {
  if (a.url) return a.url
  if (a.nombre?.startsWith('media:')) return `/api/bandeja/medio/${encodeURIComponent(a.nombre.slice('media:'.length))}`
  return null
}

function Adjuntos({ adjuntos }: { adjuntos: Adjunto[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {adjuntos.map((a, i) => {
        const url = urlDeAdjunto(a)
        const nombre = a.nombre && !a.nombre.startsWith('media:') ? a.nombre : null
        if (url && a.tipo === 'imagen') {
          return (
            <li key={i}>
              <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                {/* `unoptimized`: es una imagen de un tercero con sesión o con URL que vence; el optimizador de Next no puede pedirla. */}
                <Image src={url} alt={nombre ?? 'Foto enviada'} width={320} height={240} unoptimized className="h-auto max-h-64 w-auto max-w-full rounded-lg" />
              </a>
            </li>
          )
        }
        if (url && a.tipo === 'audio') {
          return (
            <li key={i}>
              <audio controls preload="none" src={url} className="max-w-full" />
            </li>
          )
        }
        if (url && a.tipo === 'video') {
          return (
            <li key={i}>
              <video controls preload="none" src={url} className="max-h-64 max-w-full rounded-lg" />
            </li>
          )
        }
        return (
          <li key={i} className="text-xs">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                [{rotuloAdjunto(a.tipo)}
                {nombre ? `: ${nombre}` : ''}]
              </a>
            ) : (
              <span title="El archivo queda en la app del canal: desde acá se ve que se mandó, no su contenido.">
                [{rotuloAdjunto(a.tipo)}
                {nombre ? `: ${nombre}` : ''}]
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Burbuja({ m, autor, conAnterior, mostrarPie }: { m: FilaMensaje; autor: string | null; conAnterior: boolean; mostrarPie: boolean }) {
  const adjuntos = adjuntosDe(m.adjuntos)

  if (m.tipo === 'actividad') {
    return (
      <p className="py-1 text-center text-xs text-stone-500">
        {m.contenido} · {horaHotel(m.creado_en, { hour: '2-digit', minute: '2-digit' })}
      </p>
    )
  }

  const saliente = m.tipo === 'saliente'
  const nota = m.tipo === 'nota'
  const lado = saliente || nota ? 'items-end' : 'items-start'
  const color = nota
    ? 'bg-lenga-50 text-lenga-950 ring-1 ring-lenga-200'
    : saliente
      ? 'bg-lago-700 text-white'
      : 'bg-white text-stone-800 ring-1 ring-stone-200'

  return (
    <div className={`flex flex-col ${lado} ${conAnterior ? 'mt-0.5' : 'mt-2'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${color}`}>
        {nota && <p className="mb-0.5 text-xs font-semibold">Nota privada</p>}
        {m.contenido && <p className="break-words whitespace-pre-line">{m.contenido}</p>}
        {adjuntos.length > 0 && <Adjuntos adjuntos={adjuntos} />}
      </div>
      {mostrarPie && (
        <p className="mt-0.5 px-1 text-xs text-stone-500">
          {autor ? `${autor} · ` : saliente ? 'Automático · ' : ''}
          {horaHotel(m.creado_en, { hour: '2-digit', minute: '2-digit' })}
          {saliente && (
            <>
              {' · '}
              <span className={m.estado === 'fallido' ? 'font-semibold text-red-700' : ''}>{ETIQUETAS_ESTADO_MENSAJE[m.estado]}</span>
            </>
          )}
        </p>
      )}
      {saliente && m.estado === 'fallido' && m.error && <p className="max-w-[85%] px-1 text-xs text-red-700">{m.error}</p>}
    </div>
  )
}

async function BuscarHuesped({
  contactoId,
  conversacionId,
  sugerido,
  busqueda,
  filtros,
}: {
  contactoId: string
  conversacionId: string
  sugerido: string
  busqueda?: string
  filtros: Params
}) {
  const termino = terminoBusqueda(busqueda)
  const lectura = termino ? await buscarHuespedes(termino) : { datos: [], fallo: false }
  const encontrados = lectura.datos

  return (
    <div className="space-y-2 text-sm">
      <p className="text-stone-600">No está vinculado a ninguna ficha de huésped.</p>
      <form action="/panel/bandeja" className="flex flex-col gap-1">
        {Object.entries({ ...filtros, c: conversacionId }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <label htmlFor="bh" className="text-xs font-medium text-stone-600">
          Buscar huésped
        </label>
        <span className="flex gap-1">
          <input id="bh" name="bh" defaultValue={busqueda ?? sugerido} className={`${CAMPO} py-1.5 text-sm`} />
          <button type="submit" className={botonClases('secundario', 'px-2 py-1.5')}>
            Buscar
          </button>
        </span>
      </form>
      {lectura.fallo && <p className="text-red-700">No se pudo buscar. Probá de nuevo.</p>}
      {termino && !lectura.fallo && encontrados.length === 0 && <p className="text-stone-500">Ningún huésped coincide.</p>}
      <ul className="space-y-1">
        {encontrados.map((h) => (
          <li key={h.id}>
            <form action={vincularHuesped} className="flex items-center justify-between gap-2">
              <input type="hidden" name="contacto_id" value={contactoId} />
              <input type="hidden" name="conversacion_id" value={conversacionId} />
              <input type="hidden" name="huesped_id" value={h.id} />
              <span className="min-w-0 truncate">
                {h.apellido}, {h.nombre}
                {h.email ? <span className="block truncate text-xs text-stone-500">{h.email}</span> : null}
              </span>
              <BotonEnvio variante="secundario" cargando="…" extra="text-xs">
                Vincular
              </BotonEnvio>
            </form>
          </li>
        ))}
      </ul>
      <Link href="/panel/huespedes/nuevo" className="inline-block text-xs text-lago-700 underline">
        Crear la ficha de un huésped nuevo
      </Link>
    </div>
  )
}
