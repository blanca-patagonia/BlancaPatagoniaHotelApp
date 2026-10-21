import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import { registrarFalla } from '@/lib/acciones'
import { patronOr } from '@/lib/listados'
import { traerTodo } from '@/lib/paginado'
import type { FilaInforme } from '@/lib/domain/bandeja-informes'
import type {
  CanalBandeja,
  EstadoConversacion,
  EstadoMensaje,
  Prioridad,
  TipoMensaje,
  TonoEtiqueta,
  VistaBandeja,
} from '@/lib/domain/bandeja'
import type { EstadoReserva } from '@/lib/domain/reservas'

/**
 * Lecturas de la bandeja de mensajes (ADR 0043).
 *
 * Todas con el cliente del USUARIO: RLS (0125) decide qué ve cada rol. Cada
 * función devuelve el dato y si la lectura falló, porque la pantalla tiene que
 * distinguir «no hay conversaciones» de «no se pudo leer» (regla de las
 * lecturas, auditoría QA/UX 2026-09-09).
 */

export interface Lectura<T> {
  datos: T
  fallo: boolean
}

export interface FilaLista {
  id: string
  numero: number
  estado: EstadoConversacion
  prioridad: Prioridad | null
  asignada_a: string | null
  pospuesta_hasta: string | null
  ultima_actividad_en: string
  esperando_desde: string | null
  no_leidos: number
  crm_bandejas: { canal: CanalBandeja }
  crm_contactos: { nombre: string; email: string | null; telefono: string | null }
}

export interface Detalle extends FilaLista {
  contacto_id: string
  reserva_id: string | null
  asunto: string | null
  ultimo_entrante_en: string | null
  crm_identidades: { externo_id: string }
  crm_contactos: FilaLista['crm_contactos'] & {
    id: string
    notas: string | null
    huesped_id: string | null
    bloqueado: boolean
  }
}

export interface FilaMensaje {
  id: string
  tipo: TipoMensaje
  contenido: string
  adjuntos: unknown
  autor_id: string | null
  estado: EstadoMensaje
  error: string | null
  creado_en: string
}

export interface EtiquetaBandeja {
  id: string
  nombre: string
  color: TonoEtiqueta
}

export interface FiltrosLista {
  vista: VistaBandeja
  estado: EstadoConversacion
  canal?: CanalBandeja
  etiqueta?: string
  /** Ya escapado para LIKE (`terminoBusqueda`). */
  termino: string | null
  usuarioId: string
  ahora: Date
}

const SELECT_LISTA =
  'id, numero, estado, prioridad, asignada_a, pospuesta_hasta, ultima_actividad_en, esperando_desde, no_leidos, ' +
  'crm_bandejas!inner(canal), crm_contactos!inner(nombre, email, telefono)'

const SELECT_DETALLE =
  'id, numero, estado, prioridad, asignada_a, pospuesta_hasta, ultima_actividad_en, esperando_desde, no_leidos, ' +
  'contacto_id, reserva_id, asunto, ultimo_entrante_en, crm_bandejas!inner(canal), ' +
  'crm_contactos!inner(id, nombre, email, telefono, notas, huesped_id, bloqueado), crm_identidades!inner(externo_id)'

/** Los filtros de la lista, menos el término: se aplican igual a las dos búsquedas. */
function conFiltros(supabase: Awaited<ReturnType<typeof crearClienteServidor>>, f: FiltrosLista) {
  const ahoraISO = f.ahora.toISOString()
  let consulta = supabase
    .from('crm_conversaciones')
    // Con filtro de etiqueta, el embed `!inner` acota la fila madre; sin él, no
    // se pide (un embed normal no filtra: AGENTS.md, «la trampa más silenciosa»).
    .select(f.etiqueta ? `${SELECT_LISTA}, crm_conversacion_etiquetas!inner(etiqueta_id)` : SELECT_LISTA)
    .order('ultima_actividad_en', { ascending: false })
    .limit(60)

  // Una pospuesta vencida se lista como abierta (`estadoEfectivo`), sin cron.
  if (f.estado === 'abierta') {
    consulta = consulta.or(`estado.eq.abierta,and(estado.eq.pospuesta,pospuesta_hasta.lte.${ahoraISO})`)
  } else if (f.estado === 'pospuesta') {
    consulta = consulta.eq('estado', 'pospuesta').gt('pospuesta_hasta', ahoraISO)
  } else {
    consulta = consulta.eq('estado', f.estado)
  }
  if (f.vista === 'mias') consulta = consulta.eq('asignada_a', f.usuarioId)
  if (f.vista === 'sin_asignar') consulta = consulta.is('asignada_a', null)
  if (f.canal) consulta = consulta.eq('crm_bandejas.canal', f.canal)
  if (f.etiqueta) consulta = consulta.eq('crm_conversacion_etiquetas.etiqueta_id', f.etiqueta)
  return consulta
}

/**
 * La lista de conversaciones según los filtros.
 *
 * Con un término, busca en DOS lugares y une los resultados: en el contacto
 * (nombre, email, teléfono) y en el TEXTO de los mensajes —«¿quién preguntó por
 * las mascotas?»—, que es lo que Chatwoot llama buscar en mensajes. Son dos
 * consultas y no un `or` porque PostgREST no puede combinar una condición del
 * contacto con una de otra tabla en el mismo `or`.
 */
export async function listarConversaciones(f: FiltrosLista): Promise<Lectura<FilaLista[]>> {
  const supabase = await crearClienteServidor()
  const base = conFiltros(supabase, f)

  if (!f.termino) {
    const { data, error } = await base
    registrarFalla(error, 'bandeja:lista')
    return { datos: (data ?? []) as unknown as FilaLista[], fallo: Boolean(error) }
  }

  const p = patronOr(f.termino)
  const { data: coincidencias, error: eMsgs } = await supabase
    .from('crm_mensajes')
    .select('conversacion_id')
    .in('tipo', ['entrante', 'saliente'])
    .ilike('contenido', `%${f.termino}%`)
    .order('creado_en', { ascending: false })
    .limit(200)
  registrarFalla(eMsgs, 'bandeja:buscar_en_mensajes')
  const ids = [...new Set(((coincidencias ?? []) as { conversacion_id: string }[]).map((m) => m.conversacion_id))].slice(0, 100)

  const [porContacto, porMensaje] = await Promise.all([
    base.or(`nombre.ilike.${p},email.ilike.${p},telefono.ilike.${p}`, { referencedTable: 'crm_contactos' }),
    ids.length > 0 ? conFiltros(supabase, f).in('id', ids) : Promise.resolve({ data: [], error: null }),
  ])
  registrarFalla(porContacto.error, 'bandeja:lista')
  registrarFalla(porMensaje.error, 'bandeja:lista_por_mensaje')

  const unidas = new Map<string, FilaLista>()
  for (const fila of [...((porContacto.data ?? []) as unknown as FilaLista[]), ...((porMensaje.data ?? []) as unknown as FilaLista[])]) {
    unidas.set(fila.id, fila)
  }
  const datos = [...unidas.values()].sort((a, b) => b.ultima_actividad_en.localeCompare(a.ultima_actividad_en)).slice(0, 60)
  return { datos, fallo: Boolean(porContacto.error) }
}

/** El último mensaje visible y las etiquetas de cada conversación de la lista. */
export async function resumenDeLista(ids: string[]): Promise<{
  previas: Map<string, { contenido: string; adjuntos: unknown; tipo: TipoMensaje }>
  etiquetasDe: Map<string, string[]>
}> {
  const previas = new Map<string, { contenido: string; adjuntos: unknown; tipo: TipoMensaje }>()
  const etiquetasDe = new Map<string, string[]>()
  if (ids.length === 0) return { previas, etiquetasDe }

  const supabase = await crearClienteServidor()
  const [{ data: ultimos, error: eUlt }, { data: marcadas, error: eMarc }] = await Promise.all([
    supabase
      .from('crm_mensajes')
      .select('conversacion_id, contenido, adjuntos, tipo')
      .in('conversacion_id', ids)
      .in('tipo', ['entrante', 'saliente'])
      .order('creado_en', { ascending: false })
      .limit(600),
    supabase.from('crm_conversacion_etiquetas').select('conversacion_id, etiqueta_id').in('conversacion_id', ids),
  ])
  // Accesorias: sin ellas la lista se ve igual, sólo sin el renglón de vista previa.
  registrarFalla(eUlt, 'bandeja:vista_previa')
  registrarFalla(eMarc, 'bandeja:etiquetas_lista')

  for (const m of (ultimos ?? []) as { conversacion_id: string; contenido: string; adjuntos: unknown; tipo: TipoMensaje }[]) {
    if (!previas.has(m.conversacion_id)) previas.set(m.conversacion_id, m)
  }
  for (const m of (marcadas ?? []) as { conversacion_id: string; etiqueta_id: string }[]) {
    etiquetasDe.set(m.conversacion_id, [...(etiquetasDe.get(m.conversacion_id) ?? []), m.etiqueta_id])
  }
  return { previas, etiquetasDe }
}

export async function listarEtiquetas(): Promise<Lectura<EtiquetaBandeja[]>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('crm_etiquetas').select('id, nombre, color').order('nombre')
  registrarFalla(error, 'bandeja:etiquetas')
  return { datos: (data ?? []) as EtiquetaBandeja[], fallo: Boolean(error) }
}

export async function leerEtiqueta(id: string): Promise<Lectura<EtiquetaBandeja | null>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('crm_etiquetas').select('id, nombre, color').eq('id', id).maybeSingle()
  registrarFalla(error, 'bandeja:etiqueta')
  return { datos: (data as EtiquetaBandeja | null) ?? null, fallo: Boolean(error) }
}

export interface RespuestaFila {
  id: string
  atajo: string
  contenido: string
}

export async function listarRespuestas(): Promise<Lectura<RespuestaFila[]>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('crm_respuestas').select('id, atajo, contenido').order('atajo')
  registrarFalla(error, 'bandeja:respuestas')
  return { datos: (data ?? []) as RespuestaFila[], fallo: Boolean(error) }
}

export async function leerRespuesta(id: string): Promise<Lectura<RespuestaFila | null>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('crm_respuestas').select('id, atajo, contenido').eq('id', id).maybeSingle()
  registrarFalla(error, 'bandeja:respuesta')
  return { datos: (data as RespuestaFila | null) ?? null, fallo: Boolean(error) }
}

/** Bandejas con su interruptor. */
export async function listarBandejas(): Promise<Lectura<{ canal: CanalBandeja; activa: boolean }[]>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('crm_bandejas').select('canal, activa')
  registrarFalla(error, 'bandeja:bandejas')
  return { datos: (data ?? []) as { canal: CanalBandeja; activa: boolean }[], fallo: Boolean(error) }
}

/** Una conversación y sus últimos 200 mensajes, del más viejo al más nuevo. */
export async function leerConversacion(id: string): Promise<Lectura<{ detalle: Detalle | null; mensajes: FilaMensaje[] }>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('crm_conversaciones').select(SELECT_DETALLE).eq('id', id).maybeSingle()
  registrarFalla(error, 'bandeja:detalle')
  const detalle = (data as unknown as Detalle) ?? null
  if (!detalle) return { datos: { detalle: null, mensajes: [] }, fallo: Boolean(error) }

  const { data: ms, error: eMs } = await supabase
    .from('crm_mensajes')
    .select('id, tipo, contenido, adjuntos, autor_id, estado, error, creado_en')
    .eq('conversacion_id', id)
    .order('creado_en', { ascending: false })
    .limit(200)
  registrarFalla(eMs, 'bandeja:mensajes')
  return { datos: { detalle, mensajes: ((ms ?? []) as FilaMensaje[]).reverse() }, fallo: Boolean(error || eMs) }
}

export interface ReservaDelContacto {
  id: string
  codigo: string
  estado: EstadoReserva
  estadias: { check_in: string; check_out: string }[]
}

export interface ContextoConversacion {
  nombres: Map<string, string>
  equipo: { id: string; nombre: string }[]
  etiquetasPuestas: Set<string>
  respuestas: { atajo: string; contenido: string }[]
  huesped: { id: string; nombre: string | null; apellido: string | null } | null
  reservas: ReservaDelContacto[]
  otras: { id: string; numero: number; estado: EstadoConversacion; ultima_actividad_en: string; crm_bandejas: { canal: CanalBandeja } }[]
}

/** Lo que rodea a la conversación: equipo, etiquetas puestas, huésped y reservas. */
export async function contextoDeConversacion(detalle: Detalle, mensajes: FilaMensaje[]): Promise<ContextoConversacion> {
  const supabase = await crearClienteServidor()
  const contacto = detalle.crm_contactos
  const autores = [...new Set(mensajes.map((m) => m.autor_id).filter(Boolean))] as string[]

  const [
    { data: perfiles, error: eAut },
    { data: equipo, error: eEq },
    { data: marcadas, error: eMarc },
    { data: respuestas, error: eResp },
    { data: huesped, error: eHue },
    { data: reservas, error: eRes },
    { data: otras, error: eOtras },
  ] = await Promise.all([
    autores.length > 0
      ? supabase.from('perfiles').select('id, nombre').in('id', autores)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('perfiles').select('id, nombre').eq('activo', true).in('rol', ['admin', 'gerencia', 'recepcion']).order('nombre'),
    supabase.from('crm_conversacion_etiquetas').select('etiqueta_id').eq('conversacion_id', detalle.id),
    supabase.from('crm_respuestas').select('atajo, contenido').order('atajo'),
    contacto.huesped_id
      ? supabase.from('huespedes').select('id, nombre, apellido').eq('id', contacto.huesped_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contacto.huesped_id
      ? supabase
          .from('reservas')
          .select('id, codigo, estado, estadias(check_in, check_out)')
          .eq('huesped_id', contacto.huesped_id)
          .order('creada_en', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('crm_conversaciones')
      .select('id, numero, estado, ultima_actividad_en, crm_bandejas!inner(canal)')
      .eq('contacto_id', contacto.id)
      .neq('id', detalle.id)
      .order('ultima_actividad_en', { ascending: false })
      .limit(5),
  ])
  registrarFalla(eAut, 'bandeja:autores')
  registrarFalla(eEq, 'bandeja:equipo')
  registrarFalla(eMarc, 'bandeja:etiquetas_conversacion')
  registrarFalla(eResp, 'bandeja:respuestas')
  registrarFalla(eHue, 'bandeja:huesped')
  registrarFalla(eRes, 'bandeja:reservas')
  registrarFalla(eOtras, 'bandeja:otras_conversaciones')

  return {
    nombres: new Map(((perfiles ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre])),
    equipo: (equipo ?? []) as { id: string; nombre: string }[],
    etiquetasPuestas: new Set(((marcadas ?? []) as { etiqueta_id: string }[]).map((m) => m.etiqueta_id)),
    respuestas: (respuestas ?? []) as { atajo: string; contenido: string }[],
    huesped: (huesped as ContextoConversacion['huesped']) ?? null,
    reservas: (reservas ?? []) as unknown as ReservaDelContacto[],
    otras: (otras ?? []) as unknown as ContextoConversacion['otras'],
  }
}

/** Huéspedes que coinciden con un término, para vincular un contacto. */
export async function buscarHuespedes(termino: string): Promise<Lectura<{ id: string; nombre: string; apellido: string; email: string | null }[]>> {
  const supabase = await crearClienteServidor()
  const p = patronOr(termino)
  const { data, error } = await supabase
    .from('huespedes')
    .select('id, nombre, apellido, email')
    .or(`apellido.ilike.${p},nombre.ilike.${p},email.ilike.${p},telefono.ilike.${p}`)
    .limit(6)
  registrarFalla(error, 'bandeja:buscar_huesped')
  return { datos: (data ?? []) as { id: string; nombre: string; apellido: string; email: string | null }[], fallo: Boolean(error) }
}

export interface AjustesDeFila {
  canal: CanalBandeja
  activa: boolean
  saludo_activo: boolean
  saludo_mensaje: string
  fuera_horario_activo: boolean
  fuera_horario_mensaje: string
  horario_desde: string
  horario_hasta: string
  dias_atencion: number[]
  asignacion_automatica: boolean
}

/** Las seis bandejas con todos sus ajustes. */
export async function listarAjustesDeBandejas(): Promise<Lectura<AjustesDeFila[]>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('crm_bandejas')
    .select(
      'canal, activa, saludo_activo, saludo_mensaje, fuera_horario_activo, fuera_horario_mensaje, horario_desde, horario_hasta, dias_atencion, asignacion_automatica',
    )
  registrarFalla(error, 'bandeja:ajustes')
  return { datos: (data ?? []) as AjustesDeFila[], fallo: Boolean(error) }
}

/** Cuántas conversaciones hay en cada estado, para las pestañas de la lista. */
export async function contarPorEstado(f: { usuarioId: string; vista: VistaBandeja; canal?: CanalBandeja; ahora: Date }): Promise<Lectura<Record<EstadoConversacion, number>>> {
  const supabase = await crearClienteServidor()
  const ahoraISO = f.ahora.toISOString()
  const base = () => {
    let q = supabase.from('crm_conversaciones').select('id, crm_bandejas!inner(canal)', { count: 'exact', head: true })
    if (f.vista === 'mias') q = q.eq('asignada_a', f.usuarioId)
    if (f.vista === 'sin_asignar') q = q.is('asignada_a', null)
    if (f.canal) q = q.eq('crm_bandejas.canal', f.canal)
    return q
  }
  const [abierta, pendiente, pospuesta, resuelta] = await Promise.all([
    base().or(`estado.eq.abierta,and(estado.eq.pospuesta,pospuesta_hasta.lte.${ahoraISO})`),
    base().eq('estado', 'pendiente'),
    base().eq('estado', 'pospuesta').gt('pospuesta_hasta', ahoraISO),
    base().eq('estado', 'resuelta'),
  ])
  const error = abierta.error ?? pendiente.error ?? pospuesta.error ?? resuelta.error
  registrarFalla(error, 'bandeja:conteo_por_estado')
  return {
    datos: { abierta: abierta.count ?? 0, pendiente: pendiente.count ?? 0, pospuesta: pospuesta.count ?? 0, resuelta: resuelta.count ?? 0 },
    fallo: Boolean(error),
  }
}

// ── Contactos (el CRM) ──────────────────────────────────────────────────────

export const SEGMENTOS_CONTACTO = ['todos', 'huespedes', 'interesados', 'bloqueados'] as const
export type SegmentoContacto = (typeof SEGMENTOS_CONTACTO)[number]

export interface FilaContacto {
  id: string
  nombre: string
  email: string | null
  telefono: string | null
  huesped_id: string | null
  bloqueado: boolean
  ultima_actividad_en: string | null
  creado_en: string
  crm_identidades: { crm_bandejas: { canal: CanalBandeja } }[]
  crm_conversaciones: { count: number }[]
}

export async function listarContactos(f: {
  termino: string | null
  segmento: SegmentoContacto
  desde: number
  hasta: number
}): Promise<Lectura<{ filas: FilaContacto[]; total: number }>> {
  const supabase = await crearClienteServidor()
  let q = supabase
    .from('crm_contactos')
    .select(
      'id, nombre, email, telefono, huesped_id, bloqueado, ultima_actividad_en, creado_en, crm_identidades(crm_bandejas(canal)), crm_conversaciones(count)',
      { count: 'exact' },
    )
    .order('ultima_actividad_en', { ascending: false, nullsFirst: false })
    .range(f.desde, f.hasta)
  // «Huéspedes» son los vinculados a una ficha; «interesados», los que todavía no.
  if (f.segmento === 'huespedes') q = q.not('huesped_id', 'is', null)
  if (f.segmento === 'interesados') q = q.is('huesped_id', null).eq('bloqueado', false)
  if (f.segmento === 'bloqueados') q = q.eq('bloqueado', true)
  if (f.termino) {
    const p = patronOr(f.termino)
    q = q.or(`nombre.ilike.${p},email.ilike.${p},telefono.ilike.${p}`)
  }
  const { data, error, count } = await q
  registrarFalla(error, 'bandeja:contactos')
  return { datos: { filas: (data ?? []) as unknown as FilaContacto[], total: count ?? 0 }, fallo: Boolean(error) }
}

export interface DetalleContacto {
  id: string
  nombre: string
  email: string | null
  telefono: string | null
  notas: string | null
  huesped_id: string | null
  bloqueado: boolean
  creado_en: string
  ultima_actividad_en: string | null
  crm_identidades: { externo_id: string; crm_bandejas: { canal: CanalBandeja } }[]
}

export async function leerContacto(id: string): Promise<
  Lectura<{
    contacto: DetalleContacto | null
    conversaciones: { id: string; numero: number; estado: EstadoConversacion; ultima_actividad_en: string; crm_bandejas: { canal: CanalBandeja } }[]
    huesped: { id: string; nombre: string | null; apellido: string | null } | null
    reservas: ReservaDelContacto[]
  }>
> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('crm_contactos')
    .select('id, nombre, email, telefono, notas, huesped_id, bloqueado, creado_en, ultima_actividad_en, crm_identidades(externo_id, crm_bandejas(canal))')
    .eq('id', id)
    .maybeSingle()
  registrarFalla(error, 'bandeja:contacto')
  const contacto = (data as unknown as DetalleContacto) ?? null
  if (!contacto) return { datos: { contacto: null, conversaciones: [], huesped: null, reservas: [] }, fallo: Boolean(error) }

  const [{ data: convs, error: eConvs }, huesped, reservas] = await Promise.all([
    supabase
      .from('crm_conversaciones')
      .select('id, numero, estado, ultima_actividad_en, crm_bandejas!inner(canal)')
      .eq('contacto_id', id)
      .order('ultima_actividad_en', { ascending: false })
      .limit(30),
    contacto.huesped_id
      ? supabase.from('huespedes').select('id, nombre, apellido').eq('id', contacto.huesped_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contacto.huesped_id
      ? supabase
          .from('reservas')
          .select('id, codigo, estado, estadias(check_in, check_out)')
          .eq('huesped_id', contacto.huesped_id)
          .order('creada_en', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ])
  registrarFalla(eConvs, 'bandeja:contacto_conversaciones')
  registrarFalla(huesped.error, 'bandeja:contacto_huesped')
  registrarFalla(reservas.error, 'bandeja:contacto_reservas')

  return {
    datos: {
      contacto,
      conversaciones: (convs ?? []) as unknown as { id: string; numero: number; estado: EstadoConversacion; ultima_actividad_en: string; crm_bandejas: { canal: CanalBandeja } }[],
      huesped: (huesped.data as { id: string; nombre: string | null; apellido: string | null } | null) ?? null,
      reservas: (reservas.data ?? []) as unknown as ReservaDelContacto[],
    },
    fallo: Boolean(error || eConvs),
  }
}

// ── Informes ────────────────────────────────────────────────────────────────

/** Las conversaciones creadas en los últimos `dias` días, para los informes. */
export async function filasDeInforme(dias: number, ahora: Date): Promise<Lectura<FilaInforme[]> & { truncado: boolean }> {
  const supabase = await crearClienteServidor()
  const desde = new Date(ahora.getTime() - dias * 86_400_000).toISOString()
  const r = await traerTodo<{
    estado: EstadoConversacion
    asignada_a: string | null
    creado_en: string
    primera_respuesta_en: string | null
    resuelta_en: string | null
    esperando_desde: string | null
    crm_bandejas: { canal: CanalBandeja }
  }>((d, h) =>
    supabase
      .from('crm_conversaciones')
      .select('estado, asignada_a, creado_en, primera_respuesta_en, resuelta_en, esperando_desde, crm_bandejas!inner(canal)')
      .gte('creado_en', desde)
      .order('creado_en', { ascending: false })
      .range(d, h) as never,
  )
  if (r.error) registrarFalla({ message: r.error }, 'bandeja:informe')
  return {
    datos: r.filas.map((f) => ({ ...f, canal: f.crm_bandejas.canal })),
    fallo: Boolean(r.error),
    truncado: r.truncado,
  }
}

/** Nombres de las personas del equipo, para el informe por agente. */
export async function nombresDelEquipo(): Promise<Map<string, string>> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('perfiles').select('id, nombre').in('rol', ['admin', 'gerencia', 'recepcion'])
  registrarFalla(error, 'bandeja:equipo_nombres')
  return new Map(((data ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre]))
}
