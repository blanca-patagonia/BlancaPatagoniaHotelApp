/**
 * Acciones que el asistente de IA puede PROPONER (ADR 0041).
 *
 * ── El asistente propone, una persona confirma ──────────────────────────────
 *
 * El modelo nunca escribe en la base. Cuando la conversación pide un proceso
 * («abrí una orden porque la ducha de la 12 pierde»), una herramienta arma una
 * **propuesta**: datos ya validados y resueltos contra el sistema, que vuelven
 * a la pantalla como una tarjeta con un botón «Confirmar». Recién ese clic
 * ejecuta, y lo hace llamando a la MISMA Server Action que usa la pantalla del
 * módulo, con la sesión de quien confirma: mismos permisos (`requerirAcceso`),
 * mismas validaciones, mismos avisos a la cartelera.
 *
 * Por qué así y no dejar que el modelo ejecute:
 *  · Un modelo se equivoca con confianza. Un cargo en la reserva equivocada o
 *    un aviso con un dato inventado son errores que alguien tiene que ver
 *    ANTES de que existan, no después.
 *  · La propuesta vuelve del navegador al confirmarse, así que se la valida
 *    de nuevo acá (`validarPropuesta`): lo que llega no se da por bueno por
 *    haberlo armado el servidor un rato antes.
 *
 * Lógica pura: valida y describe. La ejecución vive en `panel/ia/acciones.ts`.
 */

import type { Area } from './permisos'
import { formatearUSD } from './moneda'

export const PRIORIDADES_ORDEN = ['baja', 'media', 'alta'] as const
export type PrioridadOrden = (typeof PRIORIDADES_ORDEN)[number]

/**
 * Los estados de limpieza que el asistente puede proponer. `bloqueada` queda
 * afuera a propósito: sacar una unidad de la venta toca el inventario y la
 * disponibilidad, y eso se decide en la pantalla, no en una frase.
 */
export const ESTADOS_LIMPIEZA_IA = ['limpia', 'sucia', 'inspeccionada'] as const
export type EstadoLimpiezaIa = (typeof ESTADOS_LIMPIEZA_IA)[number]

/** Los cambios de estado de una reserva que el asistente puede preparar. */
export const ESTADOS_RESERVA_IA = [
  'confirmada',
  'in_house',
  'checkout',
  'no_show',
  'cancelada',
] as const
export type EstadoReservaIa = (typeof ESTADOS_RESERVA_IA)[number]

const VERBO_ESTADO: Record<EstadoReservaIa, string> = {
  confirmada: 'Confirmar',
  in_house: 'Hacer el check-in de',
  checkout: 'Hacer el check-out de',
  no_show: 'Marcar como no-show',
  cancelada: 'Cancelar',
}

/** Los estados de una orden de mantenimiento (enum `estado_mant`, migración 0014). */
export const ESTADOS_ORDEN_IA = ['pendiente', 'en_proceso', 'resuelta'] as const
export type EstadoOrdenIa = (typeof ESTADOS_ORDEN_IA)[number]

const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrdenIa, string> = {
  pendiente: 'pendiente',
  en_proceso: 'en proceso',
  resuelta: 'resuelta',
}

export const POLITICAS_PRECIO = ['mantener', 'recotizar'] as const
export type PoliticaPrecio = (typeof POLITICAS_PRECIO)[number]

/**
 * Los datos de contacto de un huésped NO pasan por la IA: la herramienta propone
 * el nombre y lo demás se completa en la tarjeta (ver `CAMPOS_EN_TARJETA`). El
 * texto que se manda al proveedor se enmascara (`enmascararDatosPersonales`),
 * así que un email o un DNI escrito en el chat ni siquiera le llegaría bien.
 */
export interface ContactoHuesped {
  email: string
  telefono: string
  docNumero: string
  nacionalidad: string
}

export type Propuesta =
  | { tipo: 'estado_unidad'; unidadId: string; unidadNombre: string; estado: EstadoLimpiezaIa }
  | {
      tipo: 'estado_reserva'
      reservaId: string
      codigoReserva: string
      estado: EstadoReservaIa
      /** Lo que se le cobraría al cancelar o por no-show, para mostrarlo ANTES de confirmar. */
      cargo: string
    }
  | {
      tipo: 'mudanza'
      reservaId: string
      codigoReserva: string
      unidadDestinoId: string
      unidadDestinoNombre: string
      politica: PoliticaPrecio
    }
  | {
      tipo: 'reprogramar'
      reservaId: string
      codigoReserva: string
      checkIn: string
      checkOut: string
      politica: PoliticaPrecio
    }
  | { tipo: 'factura'; reservaId: string; codigoReserva: string }
  | {
      tipo: 'nota_credito'
      reservaId: string
      codigoReserva: string
      monto: number
      motivo: string
    }
  | {
      tipo: 'nueva_reserva'
      tipoUnidadId: string
      tipoNombre: string
      checkIn: string
      checkOut: string
      adultos: number
      menores: number
      apellido: string
      nombre: string
      /** Precio de mostrador estimado al preparar la tarjeta (rack con IVA). */
      totalEstimado: number | null
      email: string
      docNumero: string
    }
  | {
      tipo: 'mensaje_huesped'
      reservaId: string
      codigoReserva: string
      /** Lo redacta la IA y la persona lo corrige en la tarjeta antes de enviar. */
      mensaje: string
    }
  | ({ tipo: 'huesped_nuevo'; apellido: string; nombre: string } & ContactoHuesped)
  | ({ tipo: 'huesped_editar'; huespedId: string; nombreVisible: string } & ContactoHuesped)
  | { tipo: 'aviso'; mensaje: string }
  | {
      tipo: 'orden_mantenimiento'
      titulo: string
      descripcion: string
      prioridad: PrioridadOrden
      unidadId: string | null
      unidadNombre: string | null
    }
  | { tipo: 'objeto_perdido'; descripcion: string; ubicacion: string }
  | { tipo: 'estado_orden'; ordenId: string; titulo: string; estado: EstadoOrdenIa }
  | { tipo: 'objeto_devuelto'; objetoId: string; descripcion: string }
  | {
      tipo: 'consumo'
      reservaId: string
      codigoReserva: string
      productoId: string
      producto: string
      cantidad: number
      precioUnitario: number
    }

export type TipoPropuesta = Propuesta['tipo']

/** El área del panel de cada acción: la que tiene que poder usar quien confirma. */
export const AREA_DE_PROPUESTA: Record<TipoPropuesta, Area> = {
  aviso: 'avisos',
  orden_mantenimiento: 'mantenimiento',
  objeto_perdido: 'objetos_perdidos',
  estado_orden: 'mantenimiento',
  objeto_devuelto: 'objetos_perdidos',
  consumo: 'reservas',
  estado_unidad: 'housekeeping',
  estado_reserva: 'reservas',
  mudanza: 'reservas',
  reprogramar: 'reservas',
  factura: 'reservas',
  nota_credito: 'reservas',
  nueva_reserva: 'reservas',
  huesped_nuevo: 'huespedes',
  huesped_editar: 'huespedes',
  mensaje_huesped: 'reservas',
}

/** Un campo que la persona completa en la tarjeta (nunca pasa por la IA). */
export interface CampoEnTarjeta {
  clave: 'email' | 'telefono' | 'docNumero' | 'nacionalidad' | 'mensaje'
  etiqueta: string
  /** Texto de varias líneas (el cuerpo de un mensaje). */
  largo?: boolean
}

const CONTACTO: readonly CampoEnTarjeta[] = [
  { clave: 'email', etiqueta: 'Email' },
  { clave: 'telefono', etiqueta: 'Teléfono' },
  { clave: 'docNumero', etiqueta: 'Documento' },
  { clave: 'nacionalidad', etiqueta: 'Nacionalidad' },
]

export const CAMPOS_EN_TARJETA: Partial<Record<TipoPropuesta, readonly CampoEnTarjeta[]>> = {
  nueva_reserva: [
    { clave: 'email', etiqueta: 'Email del huésped (opcional)' },
    { clave: 'docNumero', etiqueta: 'Documento (opcional)' },
  ],
  huesped_nuevo: CONTACTO,
  huesped_editar: CONTACTO,
  // Viene redactado por la IA: la tarjeta lo muestra para revisarlo y corregirlo.
  mensaje_huesped: [{ clave: 'mensaje', etiqueta: 'Mensaje (podés corregirlo)', largo: true }],
}

/** Las acciones que no tienen vuelta atrás: la tarjeta lo dice antes del botón. */
export function esIrreversible(p: Propuesta): boolean {
  return (
    p.tipo === 'factura' ||
    p.tipo === 'nota_credito' ||
    (p.tipo === 'estado_reserva' &&
      (p.estado === 'cancelada' || p.estado === 'no_show' || p.estado === 'checkout'))
  )
}

/** Topes de texto: lo mismo que aceptaría un formulario razonable, no un documento. */
const MAX_TEXTO = 1000
const MAX_TITULO = 120
const MAX_CANTIDAD = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function uuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null
}

/** Texto opcional (puede venir vacío) con tope. */
function opcional(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length <= max ? t : null
}

/** Los datos de contacto, validados; `null` si alguno es inválido. */
function contacto(p: Record<string, unknown>): ContactoHuesped | null {
  const email = opcional(p.email, 120)
  const telefono = opcional(p.telefono, 40)
  const docNumero = opcional(p.docNumero, 20)
  const nacionalidad = opcional(p.nacionalidad, 60)
  if (email === null || telefono === null || docNumero === null || nacionalidad === null)
    return null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (docNumero && !/^[A-Za-z0-9.\-]+$/.test(docNumero)) return null
  return { email, telefono, docNumero, nacionalidad }
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t.length <= max ? t : null
}

/**
 * Una propuesta válida, o `null`.
 *
 * Se usa dos veces: al armarla (lo que pidió el modelo) y al confirmarla (lo
 * que vuelve del navegador). En las dos se exige lo mismo.
 */
export function validarPropuesta(valor: unknown): Propuesta | null {
  if (!valor || typeof valor !== 'object') return null
  const p = valor as Record<string, unknown>
  switch (p.tipo) {
    case 'aviso': {
      const mensaje = texto(p.mensaje, MAX_TEXTO)
      return mensaje ? { tipo: 'aviso', mensaje } : null
    }
    case 'orden_mantenimiento': {
      const titulo = texto(p.titulo, MAX_TITULO)
      const prioridad = PRIORIDADES_ORDEN.find((x) => x === p.prioridad)
      const unidadId =
        p.unidadId === null
          ? null
          : typeof p.unidadId === 'string' && UUID.test(p.unidadId)
            ? p.unidadId
            : undefined
      if (!titulo || !prioridad || unidadId === undefined) return null
      return {
        tipo: 'orden_mantenimiento',
        titulo,
        descripcion:
          typeof p.descripcion === 'string' ? p.descripcion.trim().slice(0, MAX_TEXTO) : '',
        prioridad,
        unidadId,
        unidadNombre: unidadId ? texto(p.unidadNombre, MAX_TITULO) : null,
      }
    }
    case 'objeto_perdido': {
      const descripcion = texto(p.descripcion, MAX_TEXTO)
      if (!descripcion) return null
      return {
        tipo: 'objeto_perdido',
        descripcion,
        ubicacion: typeof p.ubicacion === 'string' ? p.ubicacion.trim().slice(0, MAX_TITULO) : '',
      }
    }
    case 'estado_orden': {
      const ordenId = uuid(p.ordenId)
      const titulo = texto(p.titulo, MAX_TITULO)
      const estado = ESTADOS_ORDEN_IA.find((e) => e === p.estado)
      if (!ordenId || !titulo || !estado) return null
      return { tipo: 'estado_orden', ordenId, titulo, estado }
    }
    case 'objeto_devuelto': {
      const objetoId = uuid(p.objetoId)
      const descripcion = texto(p.descripcion, MAX_TEXTO)
      if (!objetoId || !descripcion) return null
      return { tipo: 'objeto_devuelto', objetoId, descripcion }
    }
    case 'estado_reserva': {
      const reservaId = uuid(p.reservaId)
      const codigo = texto(p.codigoReserva, 40)
      const estado = ESTADOS_RESERVA_IA.find((e) => e === p.estado)
      const cargo = opcional(p.cargo, 300)
      if (!reservaId || !codigo || !estado || cargo === null) return null
      return { tipo: 'estado_reserva', reservaId, codigoReserva: codigo, estado, cargo }
    }
    case 'mudanza': {
      const reservaId = uuid(p.reservaId)
      const destino = uuid(p.unidadDestinoId)
      const codigo = texto(p.codigoReserva, 40)
      const nombre = texto(p.unidadDestinoNombre, MAX_TITULO)
      const politica = POLITICAS_PRECIO.find((x) => x === p.politica)
      if (!reservaId || !destino || !codigo || !nombre || !politica) return null
      return {
        tipo: 'mudanza',
        reservaId,
        codigoReserva: codigo,
        unidadDestinoId: destino,
        unidadDestinoNombre: nombre,
        politica,
      }
    }
    case 'reprogramar': {
      const reservaId = uuid(p.reservaId)
      const codigo = texto(p.codigoReserva, 40)
      const politica = POLITICAS_PRECIO.find((x) => x === p.politica)
      const checkIn = typeof p.checkIn === 'string' && FECHA.test(p.checkIn) ? p.checkIn : null
      const checkOut = typeof p.checkOut === 'string' && FECHA.test(p.checkOut) ? p.checkOut : null
      if (!reservaId || !codigo || !politica || !checkIn || !checkOut || checkOut <= checkIn)
        return null
      return { tipo: 'reprogramar', reservaId, codigoReserva: codigo, checkIn, checkOut, politica }
    }
    case 'factura': {
      const reservaId = uuid(p.reservaId)
      const codigo = texto(p.codigoReserva, 40)
      return reservaId && codigo ? { tipo: 'factura', reservaId, codigoReserva: codigo } : null
    }
    case 'nota_credito': {
      const reservaId = uuid(p.reservaId)
      const codigo = texto(p.codigoReserva, 40)
      const monto = Math.round(Number(p.monto) * 100) / 100
      const motivo = texto(p.motivo, 300)
      if (
        !reservaId ||
        !codigo ||
        !motivo ||
        motivo.length < 5 ||
        !Number.isFinite(monto) ||
        monto <= 0
      )
        return null
      return { tipo: 'nota_credito', reservaId, codigoReserva: codigo, monto, motivo }
    }
    case 'nueva_reserva': {
      const tipoUnidadId = uuid(p.tipoUnidadId)
      const tipoNombre = texto(p.tipoNombre, MAX_TITULO)
      const checkIn = typeof p.checkIn === 'string' && FECHA.test(p.checkIn) ? p.checkIn : null
      const checkOut = typeof p.checkOut === 'string' && FECHA.test(p.checkOut) ? p.checkOut : null
      const adultos = Number(p.adultos)
      const menores = Number(p.menores ?? 0)
      const apellido = texto(p.apellido, 80)
      const nombre = opcional(p.nombre, 80)
      const email = opcional(p.email, 120)
      const docNumero = opcional(p.docNumero, 20)
      const total =
        p.totalEstimado === null || p.totalEstimado === undefined ? null : Number(p.totalEstimado)
      if (
        !tipoUnidadId ||
        !tipoNombre ||
        !checkIn ||
        !checkOut ||
        checkOut <= checkIn ||
        !apellido ||
        nombre === null ||
        email === null ||
        docNumero === null ||
        !Number.isInteger(adultos) ||
        adultos < 1 ||
        adultos > 20 ||
        !Number.isInteger(menores) ||
        menores < 0 ||
        menores > 20 ||
        (total !== null && !Number.isFinite(total)) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      ) {
        return null
      }
      return {
        tipo: 'nueva_reserva',
        tipoUnidadId,
        tipoNombre,
        checkIn,
        checkOut,
        adultos,
        menores,
        apellido,
        nombre,
        totalEstimado: total,
        email,
        docNumero,
      }
    }
    case 'mensaje_huesped': {
      const reservaId = uuid(p.reservaId)
      const codigo = texto(p.codigoReserva, 40)
      const mensaje = texto(p.mensaje, 1500)
      if (!reservaId || !codigo || !mensaje || mensaje.length < 10) return null
      return { tipo: 'mensaje_huesped', reservaId, codigoReserva: codigo, mensaje }
    }
    case 'huesped_nuevo': {
      const apellido = texto(p.apellido, 80)
      const nombre = opcional(p.nombre, 80)
      const c = contacto(p)
      if (!apellido || nombre === null || !c) return null
      return { tipo: 'huesped_nuevo', apellido, nombre, ...c }
    }
    case 'huesped_editar': {
      const huespedId = uuid(p.huespedId)
      const nombreVisible = texto(p.nombreVisible, 120)
      const c = contacto(p)
      if (!huespedId || !nombreVisible || !c) return null
      return { tipo: 'huesped_editar', huespedId, nombreVisible, ...c }
    }
    case 'estado_unidad': {
      const estado = ESTADOS_LIMPIEZA_IA.find((e) => e === p.estado)
      const nombre = texto(p.unidadNombre, MAX_TITULO)
      if (typeof p.unidadId !== 'string' || !UUID.test(p.unidadId) || !estado || !nombre)
        return null
      return { tipo: 'estado_unidad', unidadId: p.unidadId, unidadNombre: nombre, estado }
    }
    case 'consumo': {
      const cantidad = Number(p.cantidad)
      const precio = Number(p.precioUnitario)
      const codigo = texto(p.codigoReserva, 40)
      const producto = texto(p.producto, MAX_TITULO)
      if (
        typeof p.reservaId !== 'string' ||
        !UUID.test(p.reservaId) ||
        typeof p.productoId !== 'string' ||
        !UUID.test(p.productoId) ||
        !codigo ||
        !producto ||
        !Number.isInteger(cantidad) ||
        cantidad < 1 ||
        cantidad > MAX_CANTIDAD ||
        !Number.isFinite(precio) ||
        precio < 0
      ) {
        return null
      }
      return {
        tipo: 'consumo',
        reservaId: p.reservaId,
        codigoReserva: codigo,
        productoId: p.productoId,
        producto,
        cantidad,
        precioUnitario: precio,
      }
    }
    default:
      return null
  }
}

/** Cómo se muestra la propuesta en la tarjeta que hay que confirmar. */
export function describirPropuesta(p: Propuesta): { titulo: string; detalle: string[] } {
  switch (p.tipo) {
    case 'aviso':
      return { titulo: 'Publicar un aviso para el equipo', detalle: [p.mensaje] }
    case 'orden_mantenimiento':
      return {
        titulo: 'Abrir una orden de mantenimiento',
        detalle: [
          p.titulo,
          ...(p.descripcion ? [p.descripcion] : []),
          `Unidad: ${p.unidadNombre ?? 'sin unidad (algo del edificio)'}`,
          `Prioridad: ${p.prioridad}${p.prioridad === 'alta' ? ' — avisa a la cartelera' : ''}`,
        ],
      }
    case 'objeto_perdido':
      return {
        titulo: 'Registrar un objeto perdido',
        detalle: [p.descripcion, ...(p.ubicacion ? [`Encontrado en: ${p.ubicacion}`] : [])],
      }
    case 'estado_orden':
      return {
        titulo: `Marcar la orden «${p.titulo}» como ${ETIQUETA_ESTADO_ORDEN[p.estado]}`,
        detalle: [
          p.estado === 'resuelta'
            ? 'Queda con la fecha de hoy como resuelta.'
            : p.estado === 'pendiente'
              ? 'Se reabre: vuelve a la lista de pendientes.'
              : 'Queda en la lista como «en proceso».',
        ],
      }
    case 'objeto_devuelto':
      return {
        titulo: 'Marcar un objeto perdido como devuelto',
        detalle: [p.descripcion],
      }
    case 'estado_reserva':
      return {
        titulo: `${VERBO_ESTADO[p.estado]} la reserva ${p.codigoReserva}`,
        detalle: [
          ...(p.cargo ? [p.cargo] : []),
          ...(p.estado === 'checkout'
            ? ['Se suman los puntos de fidelidad y se le envía la encuesta.']
            : []),
          ...(p.estado === 'cancelada' || p.estado === 'no_show'
            ? ['Se le avisa al huésped.']
            : []),
        ],
      }
    case 'mudanza':
      return {
        titulo: `Mudar la reserva ${p.codigoReserva} a ${p.unidadDestinoNombre}`,
        detalle: [
          p.politica === 'recotizar'
            ? 'Se recotiza el precio con la tarifa de la nueva unidad.'
            : 'Se mantiene el precio actual de la reserva.',
        ],
      }
    case 'reprogramar':
      return {
        titulo: `Cambiar las fechas de la reserva ${p.codigoReserva}`,
        detalle: [
          `Nuevas fechas: ${p.checkIn} → ${p.checkOut}`,
          p.politica === 'recotizar'
            ? 'Se recotiza el precio para las fechas nuevas.'
            : 'Se mantiene el precio actual.',
        ],
      }
    case 'factura':
      return {
        titulo: `Emitir la factura de la reserva ${p.codigoReserva}`,
        detalle: ['Sale con CAE y cierra la cuenta: después no se pueden cargar consumos.'],
      }
    case 'nota_credito':
      return {
        titulo: `Emitir una nota de crédito a la reserva ${p.codigoReserva}`,
        detalle: [`Importe: ${formatearUSD(p.monto)}`, `Motivo: ${p.motivo}`, 'Sale con CAE.'],
      }
    case 'nueva_reserva':
      return {
        titulo: `Crear una reserva ${p.tipoNombre}`,
        detalle: [
          `${p.checkIn} → ${p.checkOut} · ${p.adultos} adulto(s)${p.menores ? ` y ${p.menores} menor(es)` : ''}`,
          `A nombre de ${[p.apellido, p.nombre].filter(Boolean).join(', ')}`,
          p.totalEstimado === null
            ? 'Sin precio estimado: se cotiza al crearla.'
            : `Precio de mostrador estimado: ${formatearUSD(p.totalEstimado)} con IVA`,
        ],
      }
    case 'mensaje_huesped':
      return {
        titulo: `Enviarle un correo al huésped de la reserva ${p.codigoReserva}`,
        detalle: [
          'Sale con el saludo y la firma del hotel. Si el huésped pidió no recibir avisos, no se envía.',
        ],
      }
    case 'huesped_nuevo':
      return {
        titulo: 'Registrar un huésped',
        detalle: [[p.apellido, p.nombre].filter(Boolean).join(', ')],
      }
    case 'huesped_editar':
      return {
        titulo: `Actualizar los datos de contacto de ${p.nombreVisible}`,
        detalle: ['Completá sólo lo que cambia: un campo vacío queda como está.'],
      }
    case 'estado_unidad':
      return {
        titulo: `Marcar ${p.unidadNombre} como ${p.estado}`,
        detalle: [
          p.estado === 'inspeccionada'
            ? 'Queda lista para entregar: se le avisa a recepción.'
            : `Estado de limpieza: ${p.estado}.`,
        ],
      }
    case 'consumo': {
      return {
        titulo: `Cargar un consumo a la reserva ${p.codigoReserva}`,
        detalle: [`${p.cantidad} × ${p.producto}`, formatearUSD(p.cantidad * p.precioUnitario)],
      }
    }
  }
}

/* ────────────────────────────── el resultado de una acción reutilizada ── */

/**
 * El destino de un `redirect()` de Next, o `null` si el error es otra cosa.
 *
 * Las acciones de las pantallas terminan en `redirect()`, que LANZA un error
 * marcado con un `digest` (`NEXT_REDIRECT;<tipo>;<url>;<código>;`). Next 16 no
 * expone una función pública para leerlo, así que se lee el `digest`: es el
 * mismo formato que usan `isRedirectError`/`getURLFromRedirectError` por dentro.
 * Así el asistente reusa las acciones TAL CUAL, sin reescribirlas, y la persona
 * no sale del chat.
 */
export function destinoDeRedireccion(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT;')) return null
  return digest.split(';').slice(2, -2).join(';')
}

export interface ResultadoDeAccion {
  ok?: string
  error?: string
  /** La pantalla donde quedó el resultado (la ficha, la factura), para abrirla. */
  enlace?: string
}

/**
 * Qué significa el destino de una acción reutilizada.
 *
 * · `?error=<clave>` → falló; el texto sale del MISMO mapa de mensajes que
 *   muestra esa pantalla.
 * · `/panel` o `/login` a secas → la guarda de rol la rechazó.
 * · cualquier otro destino → salió bien; se ofrece como enlace.
 */
export function interpretarDestino(
  destino: string,
  mensajes: Readonly<Record<string, string>>,
  ok: string,
): ResultadoDeAccion {
  const url = new URL(destino, 'http://panel.local')
  const clave = url.searchParams.get('error')
  if (clave) {
    return {
      error: Object.hasOwn(mensajes, clave)
        ? mensajes[clave]
        : 'No se pudo completar. Abrí la pantalla para ver el motivo.',
      enlace: url.pathname,
    }
  }
  if (url.pathname === '/panel' || url.pathname.startsWith('/login')) {
    return { error: 'Tu rol no puede hacer esta acción.' }
  }
  return { ok, enlace: `${url.pathname}${url.search}` }
}
