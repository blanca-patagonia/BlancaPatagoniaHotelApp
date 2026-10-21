import { ZONA_HOTEL } from '@/lib/fechas'

/**
 * Bandeja de mensajes con huéspedes (lógica pura, ADR 0043).
 *
 * El modelo y las reglas vienen del núcleo de Chatwoot (licencia MIT): estados
 * de conversación, ventana de 24 horas de Meta, orden de los estados de entrega
 * y respuestas guardadas con atajo. Lo que es propio de este sistema está
 * marcado como tal.
 */

/** Canales de mensajería. El mismo orden en que aparecen en la pantalla. */
export const CANALES_BANDEJA = ['whatsapp', 'instagram', 'messenger', 'email', 'telegram', 'web'] as const
export type CanalBandeja = (typeof CANALES_BANDEJA)[number]

export const ETIQUETAS_CANAL: Record<CanalBandeja, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  email: 'Correo',
  telegram: 'Telegram',
  web: 'Chat de la web',
}

export const ESTADOS_CONVERSACION = ['abierta', 'pendiente', 'pospuesta', 'resuelta'] as const
export type EstadoConversacion = (typeof ESTADOS_CONVERSACION)[number]

export const ETIQUETAS_ESTADO: Record<EstadoConversacion, string> = {
  abierta: 'Abierta',
  pendiente: 'Pendiente',
  pospuesta: 'Pospuesta',
  resuelta: 'Resuelta',
}

/**
 * Qué quiere decir cada estado, para la ayuda y los títulos de los botones.
 * «Pendiente» en Chatwoot es «esperando algo de nuestro lado que no es
 * contestar» (un bot, una confirmación interna); acá se usa igual.
 */
export const DESCRIPCION_ESTADO: Record<EstadoConversacion, string> = {
  abierta: 'Hay que atenderla.',
  pendiente: 'Esperando algo interno antes de contestar (una confirmación, un precio).',
  pospuesta: 'Vuelve sola a «abierta» en la fecha elegida, o antes si el huésped escribe.',
  resuelta: 'Terminada. Si el huésped vuelve a escribir, se reabre sola.',
}

export const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'] as const
export type Prioridad = (typeof PRIORIDADES)[number]

export const ETIQUETAS_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

export const TONOS_ETIQUETA = ['lago', 'calafate', 'lenga', 'exito', 'alerta', 'peligro', 'neutro'] as const
export type TonoEtiqueta = (typeof TONOS_ETIQUETA)[number]

export const TIPOS_MENSAJE = ['entrante', 'saliente', 'nota', 'actividad'] as const
export type TipoMensaje = (typeof TIPOS_MENSAJE)[number]

export const ESTADOS_MENSAJE = ['pendiente', 'enviado', 'entregado', 'leido', 'fallido'] as const
export type EstadoMensaje = (typeof ESTADOS_MENSAJE)[number]

export const ETIQUETAS_ESTADO_MENSAJE: Record<EstadoMensaje, string> = {
  pendiente: 'Enviando…',
  enviado: 'Enviado',
  entregado: 'Entregado',
  leido: 'Leído',
  fallido: 'No se pudo enviar',
}

// ── Ventana de respuesta ──────────────────────────────────────────────────────

const HORA_MS = 60 * 60 * 1000

/** La ventana estándar de Meta: 24 horas desde el último mensaje del huésped. */
export const VENTANA_ESTANDAR_HORAS = 24

/**
 * Con la etiqueta HUMAN_AGENT, Instagram y Messenger dejan responder hasta 7
 * días después — sólo si lo escribe una persona y la app de Meta tiene ese
 * permiso aprobado (Chatwoot: `Facebook::HumanAgentTagHelpers`). WhatsApp no
 * tiene equivalente: fuera de las 24 horas sólo acepta plantillas.
 */
export const VENTANA_AGENTE_HUMANO_HORAS = 24 * 7

/** Canales de Meta, que imponen ventana. */
const CON_VENTANA: readonly CanalBandeja[] = ['whatsapp', 'instagram', 'messenger']

export interface Ventana {
  /** ¿Se le puede mandar texto libre ahora? */
  abierta: boolean
  /** Hay que mandar la etiqueta HUMAN_AGENT (fuera de las 24 h, dentro de los 7 días). */
  agenteHumano: boolean
  /** Cuándo se cierra, si el canal tiene ventana y hay mensaje del huésped. */
  cierraEn: Date | null
  /** Por qué no se puede, en castellano y para mostrar. */
  motivo: string | null
}

/**
 * ¿Se puede responder con texto libre por este canal?
 *
 * Por qué importa decidirlo ANTES de mandar: si no, Meta rechaza con un código
 * (131047 en WhatsApp, 10/2018278 en Messenger) que recién se ve cuando el
 * mensaje ya figura como escrito, y quien atiende cree que el huésped lo leyó.
 *
 * ⚠️ Sin ningún mensaje del huésped (`ultimoEntrante` nulo) la ventana está
 * CERRADA en los canales de Meta: no se puede iniciar una conversación por ahí.
 */
export function ventanaDeRespuesta(
  canal: CanalBandeja,
  ultimoEntrante: string | Date | null,
  ahora: Date = new Date(),
  opciones: { agenteHumano?: boolean } = {},
): Ventana {
  if (!CON_VENTANA.includes(canal)) {
    return { abierta: true, agenteHumano: false, cierraEn: null, motivo: null }
  }
  if (!ultimoEntrante) {
    return {
      abierta: false,
      agenteHumano: false,
      cierraEn: null,
      motivo: `${ETIQUETAS_CANAL[canal]} no deja iniciar una conversación: hay que esperar a que el huésped escriba.`,
    }
  }

  const desde = new Date(ultimoEntrante).getTime()
  const estandar = desde + VENTANA_ESTANDAR_HORAS * HORA_MS
  if (ahora.getTime() < estandar) {
    return { abierta: true, agenteHumano: false, cierraEn: new Date(estandar), motivo: null }
  }

  if (canal !== 'whatsapp' && opciones.agenteHumano) {
    const extendida = desde + VENTANA_AGENTE_HUMANO_HORAS * HORA_MS
    if (ahora.getTime() < extendida) {
      return { abierta: true, agenteHumano: true, cierraEn: new Date(extendida), motivo: null }
    }
  }

  return {
    abierta: false,
    agenteHumano: false,
    cierraEn: new Date(estandar),
    motivo:
      canal === 'whatsapp'
        ? 'Pasaron más de 24 horas desde el último mensaje del huésped. WhatsApp sólo deja mandar plantillas aprobadas: escribile por correo o esperá a que vuelva a escribir.'
        : `Pasaron más de 24 horas desde el último mensaje del huésped y ${ETIQUETAS_CANAL[canal]} ya no acepta respuestas.`,
  }
}

// ── Estados de entrega ────────────────────────────────────────────────────────

const ORDEN_ENTREGA: Record<EstadoMensaje, number> = {
  pendiente: 0,
  enviado: 1,
  entregado: 2,
  leido: 3,
  fallido: 1,
}

/**
 * ¿El estado nuevo es información nueva?
 *
 * Los avisos de entrega llegan DESORDENADOS (el de «leído» puede entrar antes
 * que el de «entregado»): aplicarlos a ciegas haría retroceder el mensaje. Es la
 * misma regla que `esAvance` de los correos (`lib/domain/entregas.ts`).
 *
 * `fallido` pisa a `pendiente` y a `enviado`, pero no a `entregado` ni a
 * `leido`: un mensaje que el huésped ya leyó no puede haber fallado.
 */
export function esAvanceMensaje(actual: EstadoMensaje, nuevo: EstadoMensaje): boolean {
  if (actual === nuevo) return false
  if (actual === 'fallido') return false
  if (nuevo === 'fallido') return actual === 'pendiente' || actual === 'enviado'
  return ORDEN_ENTREGA[nuevo] > ORDEN_ENTREGA[actual]
}

// ── Estado efectivo y posponer ───────────────────────────────────────────────

/**
 * El estado que hay que mostrar: una pospuesta cuya fecha ya pasó cuenta como
 * abierta. Se resuelve al leer, no con una tarea programada que la reabra: así
 * no hay un cron más que vigilar y una conversación no queda dormida porque el
 * cron no corrió.
 */
export function estadoEfectivo(
  estado: EstadoConversacion,
  pospuestaHasta: string | null,
  ahora: Date = new Date(),
): EstadoConversacion {
  if (estado === 'pospuesta' && pospuestaHasta && new Date(pospuestaHasta) <= ahora) return 'abierta'
  return estado
}

export const OPCIONES_POSPONER = ['una_hora', 'manana', 'proxima_semana'] as const
export type OpcionPosponer = (typeof OPCIONES_POSPONER)[number]

export const ETIQUETAS_POSPONER: Record<OpcionPosponer, string> = {
  una_hora: 'Una hora',
  manana: 'Mañana a las 9',
  proxima_semana: 'En una semana',
}

/** Diferencia fija del hotel con UTC (UTC−3, sin horario de verano). */
const DESFASE_HOTEL_HORAS = -3

/**
 * Hasta cuándo se pospone. «Mañana a las 9» es a las 9 DEL HOTEL: calcularlo
 * con la hora del servidor (UTC en Vercel) la reabriría a las 6 de la mañana.
 */
export function pospuestaHasta(opcion: OpcionPosponer, ahora: Date = new Date()): Date {
  if (opcion === 'una_hora') return new Date(ahora.getTime() + HORA_MS)
  if (opcion === 'proxima_semana') return new Date(ahora.getTime() + 7 * 24 * HORA_MS)

  // Fecha del hotel de «ahora», más un día, a las 9:00 del hotel.
  const local = new Date(ahora.getTime() + DESFASE_HOTEL_HORAS * HORA_MS)
  const manana = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 9)
  return new Date(manana - DESFASE_HOTEL_HORAS * HORA_MS)
}

// ── Filtros del listado ──────────────────────────────────────────────────────

export const VISTAS_BANDEJA = ['mias', 'sin_asignar', 'todas'] as const
export type VistaBandeja = (typeof VISTAS_BANDEJA)[number]

export const ETIQUETAS_VISTA: Record<VistaBandeja, string> = {
  mias: 'Mías',
  sin_asignar: 'Sin asignar',
  todas: 'Todas',
}

// ── Respuestas guardadas ─────────────────────────────────────────────────────

export interface RespuestaGuardada {
  atajo: string
  contenido: string
}

const RE_ATAJO = /^[a-z0-9_-]{2,30}$/

export function atajoValido(atajo: string): boolean {
  return RE_ATAJO.test(atajo)
}

/**
 * Las respuestas que coinciden con lo que se está escribiendo. Sólo se sugieren
 * si el texto ENTERO es «/algo»: en el medio de una frase una barra es una
 * barra («llegamos 3/12»).
 */
export function sugerirRespuestas(
  texto: string,
  respuestas: readonly RespuestaGuardada[],
  maximo = 5,
): RespuestaGuardada[] {
  const m = /^\/([a-z0-9_-]*)$/.exec(texto.trim().toLowerCase())
  if (!m) return []
  const prefijo = m[1]
  return respuestas.filter((r) => r.atajo.startsWith(prefijo)).slice(0, maximo)
}

// ── Correo: lo citado no es parte del mensaje ────────────────────────────────

/**
 * Corta lo citado de una respuesta por correo. Sin esto, cada mensaje del
 * huésped trae debajo toda la conversación anterior y el hilo se vuelve
 * ilegible (Chatwoot usa `email_reply_trimmer` para lo mismo).
 *
 * Corta en la primera de: «El … escribió:», «On … wrote:», la línea de
 * separación de Outlook o un bloque de líneas que empiezan con «>».
 */
export function sinTextoCitado(texto: string): string {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const corte = lineas.findIndex(
    (l, i) =>
      /^\s*(El|On)\s.+(escribió|wrote)\s*:\s*$/i.test(l) ||
      /^\s*-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/i.test(l) ||
      /^\s*_{10,}\s*$/.test(l) ||
      (/^\s*De:\s/i.test(l) && /^\s*(Enviado|Sent):\s/i.test(lineas[i + 1] ?? '')) ||
      (/^\s*>/.test(l) && lineas.slice(i).every((x) => /^\s*>/.test(x) || x.trim() === '')),
  )
  const cuerpo = (corte === -1 ? lineas : lineas.slice(0, corte)).join('\n').trim()
  // Si cortar dejó vacío (el huésped respondió sólo citando), mejor el original.
  return cuerpo || texto.trim()
}

/** Texto plano de un HTML de correo, sin dependencias: lo justo para mostrarlo. */
export function textoDeHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** «Re: » una sola vez, aunque el asunto ya lo traiga. */
export function asuntoDeRespuesta(asunto: string | null): string {
  const base = (asunto ?? '').trim() || 'Tu consulta en Blanca Patagonia'
  return /^re:/i.test(base) ? base : `Re: ${base}`
}

// ── Adjuntos y vista previa ──────────────────────────────────────────────────

export const TIPOS_ADJUNTO = ['imagen', 'audio', 'video', 'archivo', 'ubicacion', 'sticker', 'contacto'] as const
export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number]

export interface Adjunto {
  tipo: TipoAdjunto
  url?: string
  nombre?: string
  mime?: string
}

const ROTULO_ADJUNTO: Record<TipoAdjunto, string> = {
  imagen: 'Foto',
  audio: 'Audio',
  video: 'Video',
  archivo: 'Archivo',
  ubicacion: 'Ubicación',
  sticker: 'Sticker',
  contacto: 'Contacto',
}

export function rotuloAdjunto(tipo: TipoAdjunto): string {
  return ROTULO_ADJUNTO[tipo]
}

/** El renglón de la lista: el texto, o qué se mandó si no hay texto. */
export function vistaPrevia(contenido: string, adjuntos: readonly Adjunto[] = [], largo = 90): string {
  const texto = contenido.replace(/\s+/g, ' ').trim()
  if (texto) return texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto
  if (adjuntos.length > 0) return `[${ROTULO_ADJUNTO[adjuntos[0].tipo] ?? 'Adjunto'}]`
  return ''
}

/** Normaliza lo que viene de la base (jsonb) a adjuntos válidos. */
export function adjuntosDe(valor: unknown): Adjunto[] {
  if (!Array.isArray(valor)) return []
  return valor.flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const o = a as Record<string, unknown>
    const tipo = (TIPOS_ADJUNTO as readonly string[]).includes(String(o.tipo)) ? (o.tipo as TipoAdjunto) : null
    if (!tipo) return []
    const url = typeof o.url === 'string' && /^https?:\/\//.test(o.url) ? o.url : undefined
    return [{
      tipo,
      url,
      nombre: typeof o.nombre === 'string' ? o.nombre : undefined,
      mime: typeof o.mime === 'string' ? o.mime : undefined,
    }]
  })
}

// ── Tiempo de espera ─────────────────────────────────────────────────────────

/** «12 min», «3 h», «2 d»: cuánto hace que el huésped espera respuesta. */
export function tiempoEsperando(desde: string | null, ahora: Date = new Date()): string | null {
  if (!desde) return null
  const minutos = Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / 60_000))
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return `${horas} h`
  return `${Math.floor(horas / 24)} d`
}

/**
 * ¿Ya es una espera larga? Una hora sin respuesta en un canal de chat es lo que
 * un huésped tolera antes de ir a reservar a otro lado; se marca en la lista.
 */
export function esperaLarga(desde: string | null, ahora: Date = new Date(), minutos = 60): boolean {
  if (!desde) return false
  return ahora.getTime() - new Date(desde).getTime() >= minutos * 60_000
}

// ── Contacto ─────────────────────────────────────────────────────────────────

/** El nombre a mostrar: el que haya, o el dato con que escribió. */
export function nombreDeContacto(c: {
  nombre: string | null
  email?: string | null
  telefono?: string | null
}): string {
  return c.nombre?.trim() || c.telefono?.trim() || c.email?.trim() || 'Sin nombre'
}

/** Iniciales para el avatar. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p))
  if (partes.length === 0) return '?'
  const a = partes[0][0] ?? ''
  const b = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (a + b).toUpperCase()
}

// ── Horario de atención, saludo y mensajes automáticos (ADR 0044) ────────────

export interface HorarioAtencion {
  /** `HH:MM` u `HH:MM:SS`, en la hora DEL HOTEL. */
  desde: string
  hasta: string
  /** ISO: 1 = lunes … 7 = domingo. */
  dias: readonly number[]
}

export const DIAS_SEMANA = [
  { n: 1, corto: 'Lun', largo: 'Lunes' },
  { n: 2, corto: 'Mar', largo: 'Martes' },
  { n: 3, corto: 'Mié', largo: 'Miércoles' },
  { n: 4, corto: 'Jue', largo: 'Jueves' },
  { n: 5, corto: 'Vie', largo: 'Viernes' },
  { n: 6, corto: 'Sáb', largo: 'Sábado' },
  { n: 7, corto: 'Dom', largo: 'Domingo' },
] as const

function minutosDe(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Día ISO y minutos desde medianoche de un instante, EN LA ZONA DEL HOTEL. */
function relojDelHotel(ahora: Date): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HOTEL,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora)
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  const dia = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get('weekday') as 'Mon'] ?? 1
  return { dia, minutos: Number(get('hour')) * 60 + Number(get('minute')) }
}

/**
 * ¿Es horario de atención?
 *
 * Por qué mirar la hora del HOTEL y no la del servidor: Vercel corre en UTC, y
 * «hasta las 21» calculado ahí cortaría a las 18 de El Calafate. Es la misma
 * trampa que `hoyISO()`.
 *
 * Un horario que cruza la medianoche (`desde` > `hasta`, p. ej. 20:00–02:00)
 * cuenta el tramo de después de las 0 como del día ANTERIOR: la guardia del
 * viernes a la noche sigue vigente el sábado a la 1.
 */
export function enHorario(h: HorarioAtencion, ahora: Date = new Date()): boolean {
  const { dia, minutos } = relojDelHotel(ahora)
  const desde = minutosDe(h.desde)
  const hasta = minutosDe(h.hasta)
  if (desde === hasta) return h.dias.includes(dia) // 24 h el día elegido
  if (desde < hasta) return h.dias.includes(dia) && minutos >= desde && minutos < hasta
  if (minutos >= desde) return h.dias.includes(dia)
  if (minutos < hasta) return h.dias.includes(dia === 1 ? 7 : dia - 1)
  return false
}

export interface ConfigAutomatica {
  saludoActivo: boolean
  saludoMensaje: string
  fueraHorarioActivo: boolean
  fueraHorarioMensaje: string
  horario: HorarioAtencion
}

export type MensajeAutomatico = { tipo: 'saludo' | 'fuera_de_horario'; texto: string }

/** Remitentes que son máquinas: contestarles arma un bucle de respuestas automáticas. */
const RE_MAQUINA = /(^|[._-])(no-?reply|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|notifications?)([._-]|@)/i

export function pareceRemitenteAutomatico(email: string | null | undefined): boolean {
  return Boolean(email && RE_MAQUINA.test(email))
}

/**
 * Qué mensaje automático corresponde, si corresponde alguno.
 *
 * · Fuera de horario gana sobre el saludo: «ya te respondemos» es mejor que
 *   «hola» cuando nadie va a mirar en doce horas. Nunca salen los dos juntos.
 * · Fuera de horario sale una vez por CONVERSACIÓN NUEVA; el saludo, una vez por
 *   CONTACTO (la primera vez que escribe). Un huésped que escribe diez mensajes
 *   seguidos recibe uno solo.
 * · Con otra persona ya conversando (conversación ya existente) no se manda nada.
 * · Un correo de una casilla de máquina no recibe nada: un autorresponder
 *   contestándole a otro es un bucle.
 */
export function mensajeAutomatico(p: {
  config: ConfigAutomatica
  esConversacionNueva: boolean
  esPrimeraVez: boolean
  ahora?: Date
  remitenteEmail?: string | null
}): MensajeAutomatico | null {
  if (!p.esConversacionNueva) return null
  if (pareceRemitenteAutomatico(p.remitenteEmail)) return null
  const ahora = p.ahora ?? new Date()
  if (p.config.fueraHorarioActivo && !enHorario(p.config.horario, ahora)) {
    return { tipo: 'fuera_de_horario', texto: p.config.fueraHorarioMensaje }
  }
  if (p.config.saludoActivo && p.esPrimeraVez) return { tipo: 'saludo', texto: p.config.saludoMensaje }
  return null
}

// ── Variables en las respuestas ──────────────────────────────────────────────

export const VARIABLES_RESPUESTA = [
  { nombre: 'nombre', ayuda: 'El primer nombre de quien escribe' },
  { nombre: 'nombre_completo', ayuda: 'El nombre completo de quien escribe' },
  { nombre: 'agente', ayuda: 'Tu nombre' },
] as const

export function primerNombre(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim()
  // Un nombre que es un teléfono, un @usuario o un correo no sirve para saludar.
  if (!limpio || /^[+@\d]/.test(limpio) || limpio.includes('@')) return ''
  return limpio.split(/\s+/)[0]
}

/**
 * Reemplaza `{{variable}}`. Una variable desconocida se deja tal cual, para que
 * quien escribe la vea y la corrija antes de enviar: borrarla en silencio
 * mandaría «Hola , …».
 *
 * Si el nombre no se conoce, se quita junto con su coma y espacio previo: «Hola
 * {{nombre}}, ¿cómo estás?» queda «Hola, ¿cómo estás?» y no «Hola , ¿cómo estás?».
 */
export function aplicarVariables(texto: string, valores: Record<string, string>): string {
  return texto
    .replace(/\s*\{\{\s*(nombre|nombre_completo)\s*\}\}/g, (_, v: string) => {
      const x = valores[v]?.trim()
      return x ? ` ${x}` : ''
    })
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (todo, v: string) => (v in valores ? valores[v] : todo))
    .replace(/^ +/, '')
}

// ── Separadores por día en el hilo ───────────────────────────────────────────

/** «Hoy», «Ayer» o la fecha, en el día DEL HOTEL. Recibe las dos fechas ya como `AAAA-MM-DD`. */
export function rotuloDeDia(dia: string, hoy: string, ayer: string): string {
  if (dia === hoy) return 'Hoy'
  if (dia === ayer) return 'Ayer'
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

/** Una burbuja y la anterior son del mismo autor y cercanas: se agrupan. */
export function seAgrupa(
  a: { tipo: string; autor_id: string | null; creado_en: string },
  b: { tipo: string; autor_id: string | null; creado_en: string } | undefined,
  minutos = 5,
): boolean {
  if (!b || a.tipo !== b.tipo || a.autor_id !== b.autor_id) return false
  return Math.abs(new Date(a.creado_en).getTime() - new Date(b.creado_en).getTime()) <= minutos * 60_000
}

// ── Ajustes de una bandeja ───────────────────────────────────────────────────

export interface AjustesBandeja {
  activa: boolean
  saludoActivo: boolean
  saludoMensaje: string
  fueraHorarioActivo: boolean
  fueraHorarioMensaje: string
  horarioDesde: string
  horarioHasta: string
  dias: number[]
  asignacionAutomatica: boolean
}

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Valida lo que llega del formulario de ajustes. Devuelve el error en castellano
 * o los datos ya limpios.
 *
 * Un mensaje automático ACTIVADO y vacío no se acepta: mandaría un saludo en
 * blanco, que para el huésped es un mensaje roto. Y «fuera de horario» sin
 * ningún día de atención significaría estar fuera de horario SIEMPRE.
 */
export function validarAjustes(e: {
  activa: boolean
  saludoActivo: boolean
  saludoMensaje: string
  fueraHorarioActivo: boolean
  fueraHorarioMensaje: string
  horarioDesde: string
  horarioHasta: string
  dias: readonly number[]
  asignacionAutomatica: boolean
}): { error: string } | { datos: AjustesBandeja } {
  const saludo = e.saludoMensaje.trim()
  const fuera = e.fueraHorarioMensaje.trim()
  if (saludo.length > 1000 || fuera.length > 1000) return { error: 'Los mensajes automáticos pueden tener hasta 1000 caracteres.' }
  if (e.saludoActivo && !saludo) return { error: 'Escribí el saludo, o desactivalo.' }
  if (e.fueraHorarioActivo && !fuera) return { error: 'Escribí el mensaje de fuera de horario, o desactivalo.' }
  if (!RE_HORA.test(e.horarioDesde) || !RE_HORA.test(e.horarioHasta)) return { error: 'El horario tiene que ser una hora válida (por ejemplo 09:00).' }
  const dias = [...new Set(e.dias.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
  if (e.fueraHorarioActivo && dias.length === 0) return { error: 'Elegí al menos un día de atención, o desactivá el mensaje de fuera de horario.' }

  return {
    datos: {
      activa: e.activa,
      saludoActivo: e.saludoActivo,
      saludoMensaje: saludo,
      fueraHorarioActivo: e.fueraHorarioActivo,
      fueraHorarioMensaje: fuera,
      horarioDesde: e.horarioDesde,
      horarioHasta: e.horarioHasta,
      dias,
      asignacionAutomatica: e.asignacionAutomatica,
    },
  }
}

/** Resumen de una línea del horario, para la tarjeta del canal. */
export function resumenHorario(h: HorarioAtencion): string {
  const orden = [...h.dias].sort((a, b) => a - b)
  const nombre = (n: number) => DIAS_SEMANA.find((d) => d.n === n)?.corto ?? '?'
  const rango = (hora: string) => hora.slice(0, 5)
  let dias: string
  if (orden.length === 7) dias = 'todos los días'
  else if (orden.length === 0) dias = 'ningún día'
  else {
    // «Lun a Vie» si son consecutivos, o la lista.
    const consecutivos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1)
    dias = consecutivos && orden.length > 2 ? `${nombre(orden[0])} a ${nombre(orden[orden.length - 1])}` : orden.map(nombre).join(', ')
  }
  return `${dias}, de ${rango(h.desde)} a ${rango(h.hasta)}`
}
