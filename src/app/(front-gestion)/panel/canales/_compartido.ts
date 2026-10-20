/**
 * Constantes, tipos y ayudas de la pantalla de canales, compartidos por la
 * carga de datos (`_datos.ts`), la página y sus vistas (`_vistas/`).
 */

import { MENSAJES_NO_CONCILIAR } from '@/lib/domain/canales-costos'

/** Horas transcurridas desde un timestamp ISO. */
export function horasDesde(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 3600000
}

export const VISTAS = [
  'entrantes',
  'cobros',
  'costos',
  'publicacion',
  'mensajes',
  'resenas',
  'calendario',
] as const
export type Vista = (typeof VISTAS)[number]

export const ETIQUETAS_VISTA: Record<Vista, string> = {
  entrantes: 'Reservas entrantes',
  cobros: 'Cobros y conciliación',
  costos: 'Costos y comisión',
  publicacion: 'Publicación al canal',
  mensajes: 'Mensajes y peticiones',
  resenas: 'Reseñas',
  calendario: 'Calendario para el canal',
}

export const ESTADOS_ENTRANTE = ['pendiente', 'importada', 'error', 'ignorada'] as const
export type EstadoEntrante = (typeof ESTADOS_ENTRANTE)[number]

export const ETIQUETAS_ESTADO: Record<EstadoEntrante, string> = {
  pendiente: 'Sin importar',
  importada: 'Importada',
  error: 'Con problema',
  ignorada: 'Descartada',
}

export const TONO_ESTADO: Record<
  EstadoEntrante,
  'neutro' | 'lago' | 'exito' | 'alerta' | 'peligro'
> = {
  pendiente: 'alerta',
  importada: 'exito',
  error: 'peligro',
  ignorada: 'neutro',
}

export const MENSAJES_ERROR: Record<string, string> = {
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
  restriccion_rol:
    'Cerrar fechas en un canal es de administración o gerencia: decide cuánto inventario se le deja a la OTA.',
  restriccion_fechas:
    'Revisá las fechas: el "hasta" queda AFUERA del bloqueo, así que tiene que ser posterior al "desde".',
  restriccion_minimo: 'El mínimo de noches tiene que ser un número entero de 1 o más.',
  restriccion_vacia:
    'Esa restricción no restringe nada. Poné un mínimo de noches, o tildá cerrado, sin llegadas o sin salidas.',
  restriccion: 'No se pudo guardar la restricción. Probá de nuevo.',
  restriccion_borrar: 'No se pudo levantar la restricción. Quedó como estaba.',
  factura_rol:
    'Registrar la factura del canal es de administración o gerencia: mueve la cuenta corriente del proveedor.',
  factura_comprobante:
    'Poné el número de la factura: es con lo que después se coteja contra el papel.',
  factura_monto: 'El importe de la factura tiene que ser mayor que cero.',
  factura_moneda: 'Esa moneda no está entre las que el sistema sabe convertir.',
  factura_sin_cotizacion:
    'No hay cotización para esa moneda, así que la deuda en dólares sería inventada. Cargá una a mano en Configuración o registrá la factura en USD.',
  factura_periodo: 'Elegí el mes que factura el canal.',
  factura_config:
    'No se pudo leer la configuración del canal. Probá de nuevo; si sigue, avisá a administración.',
  factura_sin_proveedor:
    'Falta decir con qué proveedor se contabiliza Booking. Creá el proveedor en el módulo Proveedores y vinculalo en la configuración del canal.',
  factura_movimiento: 'No se pudo registrar la deuda con el proveedor. No se guardó nada.',
  factura_cargo:
    'La deuda con el proveedor SÍ se registró, pero no se pudo guardar la línea comparable contra lo devengado. Revisá el movimiento en Proveedores.',
  factura_repetida: 'Ya hay una factura cargada con ese número de comprobante.',
  conciliar_rol:
    'Cerrar la conciliación es de administración o gerencia: aceptar una diferencia es aceptar un costo.',
  conciliar_lectura: 'No se pudo leer el cargo. Probá de nuevo.',
  conciliar_inexistente: 'Ese cargo ya no existe. Recargá la pantalla.',
  conciliar_estado: MENSAJES_NO_CONCILIAR.estado,
  conciliar_sin_cambio: MENSAJES_NO_CONCILIAR.sin_cambio,
  conciliar_motivo_corto: MENSAJES_NO_CONCILIAR.motivo_corto,
  conciliar: 'No se pudo guardar el estado de conciliación. El cargo quedó como estaba.',
  mapeo_rol:
    'Configurar la publicación al canal es de administración o gerencia: define cuánto inventario se le entrega a la OTA.',
  mapeo_codigo: 'Escribí con qué código conoce el canal a ese tipo de unidad.',
  mapeo_codigo_repetido:
    'Ese código del canal ya está asignado a otro tipo de unidad. Si estuvieran repetidos, una reserva entrante caería en el tipo equivocado.',
  mapeo_tope: 'El tope de cupo tiene que ser un número entero de cero o más.',
  mapeo_minimo: 'El mínimo de noches tiene que ser un número entero de uno o más.',
  mapeo: 'No se pudo guardar el mapeo. Quedó como estaba.',
  transf_referencia:
    'Poné la referencia de la liquidación: es lo que evita registrar dos veces la misma transferencia.',
  transf_monto: 'El importe de la transferencia tiene que ser mayor que cero.',
  transf_lectura: 'No se pudo leer la reserva. Probá de nuevo.',
  transf_no_existe: 'Esa reserva entrante ya no existe.',
  transf_sin_reserva:
    'Primero hay que importar la reserva: sin reserva propia no hay a qué imputarle el pago.',
  transf_pago: 'No se pudo registrar la transferencia. No se guardó nada.',
  modalidad: 'No se pudo guardar quién cobra. Quedó como estaba.',
  vincular: 'No se pudo ligar la reseña a la reserva. Quedó como estaba.',
  autor: 'Elegí si el mensaje lo escribió el huésped o el hotel.',
  modalidad_invalida: 'Esa forma de cobro no existe.',
}

export interface EntranteRow {
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
  modalidad_cobro: string | null
  liquidado_en: string | null
  conflicto: boolean
  notas: string
  /** Qué cambió el canal después de importarla, en palabras (migración 0088). */
  divergencia: string
  divergencia_desde: string | null
  reserva_id: string | null
  reserva: { codigo: string; agencia: { nombre: string } | null } | null
}

export interface SincroRow {
  proveedor: string
  origen: string
  leidas: number
  nuevas: number
  actualizadas: number
  rechazadas: number
  corrida_en: string
}

export interface MensajeRow {
  id: string
  cuerpo: string
  autor: string
  atendido: boolean
  recibido_en: string
  entrante: { huesped_apellido: string; check_in: string } | null
}

export interface ResenaRow {
  id: string
  autor: string
  puntaje: number | string | null
  positivo: string
  negativo: string
  publicada_en: string | null
  respondida: boolean
  respuesta: string
  pais: string | null
  titulo: string
  vinculo: string
  motivo_sin_vinculo: string
  reserva: { id: string; codigo: string } | null
}

export interface CargoRow {
  id: string
  concepto: string
  origen: string
  monto: number | string
  moneda: string
  monto_usd: number | string | null
  imputado_el: string | null
  estado_conciliacion: string
  /** Por qué se disputó, o qué se anotó al cerrar la revisión (migración 0079). */
  nota_conciliacion: string | null
  detalle: string
  /** Nulo cuando el cargo no se pudo atribuir a ninguna reserva del canal. */
  entrante: { huesped_apellido: string; external_id: string } | null
  reserva: { codigo: string } | null
}
