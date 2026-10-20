'use server'

import { requerirAcceso } from '@/lib/auth/session'
import { puedeAcceder } from '@/lib/domain/permisos'
import {
  AREA_DE_PROPUESTA,
  describirPropuesta,
  destinoDeRedireccion,
  interpretarDestino,
  validarPropuesta,
  type Propuesta,
  type ResultadoDeAccion,
} from '@/lib/domain/ia-acciones'
import { registrarAviso, registrarInfo } from '@/lib/registro'
import { registrarFalla } from '@/lib/acciones'
import { encolar } from '@/lib/notificaciones'
import { publicarAviso } from '../avisos/actions'
import { cambiarEstadoOrden, crearOrden } from '../mantenimiento/actions'
import { crearObjeto, marcarDevuelto } from '../objetos-perdidos/actions'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cargarConsumo } from '@/lib/reservas/consumos'
import { fijarEstadoUnidad } from '@/lib/housekeeping/estado'
import { cambiarEstadoReserva, crearReservaAction } from '../reservas/actions'
import { cambiarUnidadReserva, reprogramarReserva } from '../reservas/cambios.actions'
import { emitirFactura, emitirNotaCredito } from '../reservas/factura.actions'
import { actualizarHuesped, crearHuesped } from '../huespedes/actions'
import { MENSAJES_FICHA_RESERVA } from '../reservas/[id]/mensajes'
import { MENSAJES_FACTURA } from '../reservas/[id]/factura/mensajes'

export type EstadoPropuesta = ResultadoDeAccion

/**
 * Corre una Server Action de pantalla y traduce cómo terminó.
 *
 * Las acciones de las pantallas terminan en `redirect()` (que lanza) o
 * devuelven un estado `{ error }`. Acá se atrapa el redirect —sólo ése: otro
 * error se relanza— y se lee su destino (`destinoDeRedireccion`), así la
 * persona no sale del chat y la tarjeta dice qué pasó con el mismo texto que
 * mostraría la pantalla.
 */
async function reusar(
  accion: () => Promise<unknown>,
  mensajes: Readonly<Record<string, string>>,
  ok: string,
): Promise<EstadoPropuesta> {
  try {
    const r = (await accion()) as { error?: unknown; ok?: unknown } | void
    if (r && typeof r === 'object' && r.error) return { error: String(r.error) }
    return { ok: r && typeof r === 'object' && typeof r.ok === 'string' ? r.ok : ok }
  } catch (e) {
    const destino = destinoDeRedireccion(e)
    if (destino === null) throw e
    return interpretarDestino(destino, mensajes, ok)
  }
}

const MENSAJES_RESERVA = { ...MENSAJES_FICHA_RESERVA, ...MENSAJES_FACTURA }
const MENSAJES_MANTENIMIENTO = { estado_orden: 'No se pudo cambiar el estado de la orden.' }
const MENSAJES_OBJETOS = { devuelto: 'No se pudo marcar el objeto como devuelto.' }

/** Etiquetas del cambio de estado, para el mensaje de éxito. */
const HECHO: Record<string, string> = {
  confirmada: 'Reserva confirmada.',
  in_house: 'Check-in hecho.',
  checkout: 'Check-out hecho.',
  no_show: 'Marcada como no-show.',
  cancelada: 'Reserva cancelada.',
}

function formulario(campos: Record<string, string | number>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, String(v))
  return fd
}

/**
 * Ejecuta una acción que preparó el asistente y la persona confirmó (ADR 0041).
 *
 * No hay lógica propia acá, a propósito: cada caso llama a la MISMA Server
 * Action que usa la pantalla del módulo, con la sesión de quien confirma. Así
 * los permisos (`requerirAcceso`), las validaciones, los avisos a la cartelera
 * y la regla de «cuenta cerrada con la factura» son exactamente los de siempre,
 * y no pueden divergir.
 *
 * La propuesta vuelve del navegador: se valida de nuevo y se exige que el rol
 * pueda usar el área, igual que si hubiera llenado el formulario a mano.
 */
export async function ejecutarPropuesta(valor: unknown): Promise<EstadoPropuesta> {
  const sesion = await requerirAcceso('ia')
  const propuesta = validarPropuesta(valor)
  if (!propuesta) return { error: 'La acción no tiene un formato válido. Pedísela de nuevo al asistente.' }
  if (!puedeAcceder(sesion.rol, AREA_DE_PROPUESTA[propuesta.tipo])) {
    return { error: 'Tu rol no puede hacer esta acción.' }
  }

  /*
    Constancia DESPUÉS de ejecutar, con qué se hizo y cómo terminó. Registrar
    antes y sin detalle no servía para lo único que importa: ante «esto lo cargó
    la IA», poder ver qué decía la tarjeta y si salió bien.
  */
  const constancia = {
    tipo: propuesta.tipo,
    usuarioId: sesion.userId,
    rol: sesion.rol,
    // Sin el detalle cuando lleva datos de un huésped: la constancia va a la
    // tabla de errores, que lee la dirección, y alcanza con el tipo y los ids.
    detalle: ['nueva_reserva', 'huesped_nuevo', 'huesped_editar'].includes(propuesta.tipo)
      ? describirPropuesta(propuesta).titulo.split(' ').slice(0, 4).join(' ')
      : describirPropuesta(propuesta).detalle.join(' · ').slice(0, 300),
    ...idsDe(propuesta),
  }
  const resultado = await ejecutar(propuesta)
  if (resultado.error) {
    await registrarAviso('ia_accion_fallida', { ...constancia, error: resultado.error })
  } else {
    await registrarInfo('ia_accion_confirmada', { ...constancia, resultado: 'ok' })
  }
  return resultado
}

/** Los ids que identifican sobre qué actuó, para poder rastrearlo. */
function idsDe(p: Propuesta): Record<string, string | number> {
  switch (p.tipo) {
    case 'consumo':
      return { reservaId: p.reservaId, productoId: p.productoId, cantidad: p.cantidad }
    case 'orden_mantenimiento':
      return p.unidadId ? { unidadId: p.unidadId } : {}
    case 'estado_unidad':
      return { unidadId: p.unidadId, estado: p.estado }
    case 'estado_orden':
      return { ordenId: p.ordenId, estado: p.estado }
    case 'objeto_devuelto':
      return { objetoId: p.objetoId }
    case 'estado_reserva':
      return { reservaId: p.reservaId, estado: p.estado }
    case 'mudanza':
      return { reservaId: p.reservaId, unidadDestinoId: p.unidadDestinoId }
    case 'reprogramar':
    case 'factura':
      return { reservaId: p.reservaId }
    case 'nota_credito':
      return { reservaId: p.reservaId, monto: p.monto }
    case 'huesped_editar':
      return { huespedId: p.huespedId }
    default:
      return {}
  }
}

async function ejecutar(propuesta: Propuesta): Promise<EstadoPropuesta> {
  switch (propuesta.tipo) {
    case 'aviso':
      return publicarAviso({}, formulario({ mensaje: propuesta.mensaje }))
    case 'orden_mantenimiento':
      return crearOrden(
        {},
        formulario({
          titulo: propuesta.titulo,
          descripcion: propuesta.descripcion,
          prioridad: propuesta.prioridad,
          unidad_id: propuesta.unidadId ?? '',
        }),
      )
    case 'objeto_perdido':
      return crearObjeto(
        {},
        formulario({ descripcion: propuesta.descripcion, ubicacion: propuesta.ubicacion }),
      )
    case 'estado_orden':
      // `cambiarEstadoOrden` es la del listado de mantenimiento: anota la fecha
      // de resolución y termina con un redirect, que `reusar` traduce.
      return reusar(
        () => cambiarEstadoOrden(formulario({ id: propuesta.ordenId, estado: propuesta.estado, origen: 'detalle' })),
        MENSAJES_MANTENIMIENTO,
        `La orden «${propuesta.titulo}» quedó ${propuesta.estado === 'en_proceso' ? 'en proceso' : propuesta.estado}.`,
      )
    case 'objeto_devuelto':
      return reusar(
        () => marcarDevuelto(formulario({ id: propuesta.objetoId })),
        MENSAJES_OBJETOS,
        'El objeto quedó marcado como devuelto.',
      )
    case 'estado_unidad': {
      // La misma regla de la pantalla de housekeeping, incluido el aviso a
      // recepción cuando queda inspeccionada (`fijarEstadoUnidad`).
      const r = await fijarEstadoUnidad(await crearClienteServidor(), propuesta.unidadId, propuesta.estado)
      if (!r.ok) return { error: r.mensaje }
      revalidatePath('/panel/housekeeping')
      return { ok: `${propuesta.unidadNombre} quedó ${propuesta.estado}.` }
    }
    case 'estado_reserva':
      // La máquina de estados de siempre (`cambiarEstadoReserva`): check-out
      // suma puntos y manda la encuesta; cancelar y no-show avisan al huésped.
      return reusar(
        () => cambiarEstadoReserva(formulario({ reserva_id: propuesta.reservaId, nuevo_estado: propuesta.estado })),
        MENSAJES_RESERVA,
        HECHO[propuesta.estado],
      )
    case 'mudanza':
      return reusar(
        () =>
          cambiarUnidadReserva(
            formulario({
              reserva_id: propuesta.reservaId,
              unidad_destino: propuesta.unidadDestinoId,
              politica_tarifa: propuesta.politica,
              motivo: 'Pedido desde el asistente',
            }),
          ),
        MENSAJES_RESERVA,
        `Reserva mudada a ${propuesta.unidadDestinoNombre}.`,
      )
    case 'reprogramar':
      return reusar(
        () =>
          reprogramarReserva(
            formulario({
              reserva_id: propuesta.reservaId,
              check_in: propuesta.checkIn,
              check_out: propuesta.checkOut,
              politica_tarifa: propuesta.politica,
              motivo: 'Pedido desde el asistente',
            }),
          ),
        MENSAJES_RESERVA,
        'Fechas cambiadas.',
      )
    case 'factura':
      return reusar(
        () => emitirFactura(formulario({ reserva_id: propuesta.reservaId })),
        MENSAJES_RESERVA,
        'Factura emitida.',
      )
    case 'nota_credito':
      return reusar(
        () =>
          emitirNotaCredito(
            formulario({ reserva_id: propuesta.reservaId, monto: propuesta.monto, motivo: propuesta.motivo }),
          ),
        MENSAJES_RESERVA,
        'Nota de crédito emitida.',
      )
    case 'nueva_reserva':
      return reusar(
        () =>
          crearReservaAction(
            {},
            formulario({
              tipo_unidad_id: propuesta.tipoUnidadId,
              check_in: propuesta.checkIn,
              check_out: propuesta.checkOut,
              huespedes: propuesta.adultos + propuesta.menores,
              adultos: propuesta.adultos,
              menores: propuesta.menores,
              apellido: propuesta.apellido,
              nombre: propuesta.nombre,
              email: propuesta.email,
              doc_numero: propuesta.docNumero,
              canal: 'directo',
            }),
          ),
        MENSAJES_RESERVA,
        'Reserva creada.',
      )
    case 'huesped_nuevo':
      return reusar(
        () =>
          crearHuesped(
            {},
            formulario({
              apellido: propuesta.apellido,
              nombre: propuesta.nombre,
              doc_numero: propuesta.docNumero,
              email: propuesta.email,
              telefono: propuesta.telefono,
              nacionalidad: propuesta.nacionalidad,
            }),
          ),
        {},
        'Huésped registrado.',
      )
    case 'huesped_editar':
      return editarHuesped(propuesta)
    case 'mensaje_huesped':
      return enviarMensaje(propuesta)
    case 'consumo': {
      // La misma regla de la ficha (`cargarConsumo`), pero devolviendo el
      // resultado: con el `redirect` de `agregarConsumo` la persona salía del
      // chat y perdía la conversación, saliera bien o mal.
      const r = await cargarConsumo(
        await crearClienteServidor(),
        propuesta.reservaId,
        propuesta.productoId,
        propuesta.cantidad,
      )
      if (!r.ok) return { error: r.mensaje }
      revalidatePath(`/panel/reservas/${propuesta.reservaId}`)
      return { ok: `Consumo cargado en la reserva ${propuesta.codigoReserva}.` }
    }
  }
}

/**
 * Actualiza el contacto de un huésped SIN pisar el resto de su ficha.
 *
 * `actualizarHuesped` reescribe todos los campos con lo que trae el formulario
 * (es el de la pantalla de edición, que los manda todos). Se lee la ficha
 * actual acá —en el servidor, al confirmar— y se cambian sólo los campos que la
 * persona completó en la tarjeta: uno vacío significa «no cambia». Así la
 * herramienta que preparó la tarjeta nunca necesitó leer el email ni el
 * teléfono, y nada de eso pasó por la IA.
 */
async function editarHuesped(p: Extract<Propuesta, { tipo: 'huesped_editar' }>): Promise<EstadoPropuesta> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('huespedes')
    .select('apellido, nombre, doc_tipo, doc_numero, email, telefono, nacionalidad, condicion_iva, residente_exterior, notas')
    .eq('id', p.huespedId)
    .maybeSingle()
  if (error) {
    registrarFalla(error, 'ia:editar_huesped_leer')
    return { error: 'No se pudo leer la ficha del huésped. Probá de nuevo.' }
  }
  if (!data) return { error: 'Esa ficha de huésped ya no existe.' }
  const actual = data as {
    apellido: string
    nombre: string
    doc_tipo: string | null
    doc_numero: string | null
    email: string | null
    telefono: string | null
    nacionalidad: string | null
    condicion_iva: string
    residente_exterior: boolean
    notas: string | null
  }
  if (!p.email && !p.telefono && !p.docNumero && !p.nacionalidad) {
    return { error: 'Completá en la tarjeta al menos un dato para cambiar.' }
  }
  return reusar(
    () =>
      actualizarHuesped(
        {},
        formulario({
          huesped_id: p.huespedId,
          apellido: actual.apellido,
          nombre: actual.nombre,
          doc_tipo: actual.doc_tipo ?? 'DNI',
          doc_numero: p.docNumero || (actual.doc_numero ?? ''),
          email: p.email || (actual.email ?? ''),
          telefono: p.telefono || (actual.telefono ?? ''),
          nacionalidad: p.nacionalidad || (actual.nacionalidad ?? ''),
          condicion_iva: actual.condicion_iva,
          residente_exterior: actual.residente_exterior ? '1' : '',
          notas: actual.notas ?? '',
        }),
      ),
    {},
    'Ficha actualizada.',
  )
}

/**
 * Pone el mensaje en la bandeja de envíos (`encolar`), con la plantilla
 * «Mensaje del hotel»: saludo, referencia a la reserva y firma fijos, y en el
 * medio el texto que la persona revisó en la tarjeta.
 *
 * El email y el nombre del huésped se leen ACÁ, en el servidor, al confirmar:
 * la IA redactó el mensaje sin conocerlos. La bandeja respeta el consentimiento
 * (`acepta_avisos`) y deja el envío registrado en «Avisos enviados».
 */
async function enviarMensaje(p: Extract<Propuesta, { tipo: 'mensaje_huesped' }>): Promise<EstadoPropuesta> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('reservas')
    .select('id, codigo, huesped:huespedes!reservas_huesped_id_fkey(id, nombre, apellido, email, telefono)')
    .eq('id', p.reservaId)
    .maybeSingle()
  if (error) {
    registrarFalla(error, 'ia:mensaje_huesped_leer')
    return { error: 'No se pudo leer la reserva. Probá de nuevo.' }
  }
  const r = data as unknown as {
    id: string
    codigo: string
    huesped: { id: string; nombre: string | null; apellido: string; email: string | null; telefono: string | null } | null
  } | null
  if (!r?.huesped) return { error: 'La reserva no tiene huésped asignado.' }
  if (!r.huesped.email) return { error: 'El huésped no tiene email cargado: completalo en su ficha.' }

  const resultado = await encolar(supabase, {
    evento: 'mensaje_del_hotel',
    entidadId: r.id,
    // Cada mensaje es distinto: sin esto, el segundo mensaje a la misma reserva
    // chocaría con la clave de idempotencia del primero y no saldría.
    discriminante: String(Date.now()),
    destinatario: r.huesped.email,
    telefono: r.huesped.telefono,
    huespedId: r.huesped.id,
    reservaId: r.id,
    variables: {
      nombre: r.huesped.nombre || r.huesped.apellido,
      codigo: r.codigo,
      mensaje: p.mensaje,
    },
  })
  if (!resultado.ok) return { error: resultado.motivo ?? 'No se pudo poner el mensaje en la bandeja.' }
  return {
    ok: 'Mensaje en la bandeja: sale en los próximos minutos.',
    enlace: '/panel/notificaciones',
  }
}
