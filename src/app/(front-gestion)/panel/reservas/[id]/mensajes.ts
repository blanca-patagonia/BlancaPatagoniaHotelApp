import { MENSAJES_RECHAZO_MUDANZA } from '@/lib/domain/mudanzas'
import { MENSAJES_NO_FACTURABLE } from '@/lib/domain/facturacion'
import { MENSAJES_NO_CARGABLE } from '@/lib/domain/servicio'

/**
 * Los motivos que la ficha de reserva muestra desde `?error=`.
 *
 * Viven fuera de `page.tsx` (que sólo puede exportar lo que Next espera de una
 * página) porque también los usa el asistente de IA: una acción preparada por
 * el chat que falla muestra en la tarjeta el MISMO texto que la ficha.
 */
export const MENSAJES_FICHA_RESERVA: Record<string, string> = {
  transicion: 'Esa transición de estado no es válida.',
  overlap: 'No se pudo reprogramar: la unidad ya está ocupada en esas fechas.',
  tarifa: 'No hay tarifa cargada para esas fechas.',
  fechas: 'Revisá las fechas de reprogramación.',
  sin_consumir: MENSAJES_NO_FACTURABLE.sin_consumir,
  anulada: MENSAJES_NO_FACTURABLE.anulada,
  ya_facturada: MENSAJES_NO_FACTURABLE.ya_facturada,
  cuit: 'Para emitir una factura A hace falta un CUIT válido del receptor. Cargalo en la ficha del huésped o de la agencia.',
  cae:
    'El proveedor de facturación rechazó el comprobante. Revisá los importes y volvé a facturar: el número de comprobante ya reservado es el mismo —no se gasta uno nuevo— así que reintentar es seguro.',
  // Escrituras que la base puede rechazar. Antes fallaban en silencio: la
  // pantalla recargaba igual y no había forma de saber que no se había guardado.
  estado: 'No se pudo guardar el estado nuevo. La reserva quedó como estaba.',
  /*
    El slug `agencia` se quitó con la migración 0084.

    Existía para el caso «la reserva se creó pero no se pudo vincular con la
    agencia», que era posible porque el vínculo se guardaba en un `update`
    aparte. Ahora viaja dentro de `crear_reserva`, así que o se crean las dos
    cosas o no se crea ninguna: el mensaje ya no puede ocurrir (P1-7).
  */
  puntos: 'Se registró el check-out, pero no se pudieron acreditar los puntos de fidelidad. Cargalos a mano desde la ficha del huésped.',
  checkin_inmediato: 'La reserva se creó, pero no se pudo marcar el check-in. Hacelo a mano cambiando el estado a "In house" acá abajo.',
  saldada: 'Se registró el pago, pero la reserva no quedó marcada como pagada. Revisá el estado antes de seguir.',
  consumo: 'No se pudo cargar el consumo. No se cobró ni se descontó del stock.',
  consumo_verificar:
    'No se pudo verificar si esta reserva admite un cargo nuevo. No se cargó nada — probá de nuevo.',
  quitar_consumo: 'No se pudo quitar el consumo. Sigue cargado a la cuenta.',
  estado_cambiado:
    'La reserva cambió de estado mientras tanto (otra persona la actualizó). Revisá cómo quedó antes de volver a intentarlo.',
  quitar_consumo_facturado:
    'La cuenta ya se facturó: ese consumo está en el comprobante emitido y no se puede quitar. Si hay que devolverlo, va con una nota de crédito.',
  factura:
    'Se pidió el CAE y se consumió el número de comprobante, pero la factura NO quedó guardada. Avisá antes de volver a emitir: el número ya se usó.',
  // Lecturas previas a la emisión. Cortan a propósito: una factura sale con CAE y
  // es inmutable, así que es preferible no emitirla a emitirla con un dato de menos.
  lectura_factura:
    'No se pudo verificar si esta reserva ya estaba facturada, así que no se emitió nada. Probá de nuevo.',
  lectura_reserva: 'No se pudieron leer los datos de la reserva. No se emitió ninguna factura.',
  lectura_consumos:
    'No se pudieron leer los consumos, así que no se emitió la factura: habría salido por menos de lo que se consumió, y una vez emitida no se corrige.',
  lectura_agencia_fiscal:
    'No se pudieron leer los datos fiscales de la agencia, así que no se emitió la factura: habría salido con la condición y el CUIT equivocados.',
  total: 'El cambio se hizo, pero no se pudo recalcular el precio. La reserva quedó con el total anterior.',
  repro: 'No se pudo reprogramar la estadía.',
  repro_lectura: 'No se pudieron leer los datos para reprogramar. No se cambió nada — probá de nuevo.',
  // Cobro (Fase 23).
  monto: 'El importe tiene que ser mayor que cero.',
  pago: 'No se pudo registrar el pago. No quedó nada cobrado.',
  moneda: 'Esa moneda no está entre las que el sistema sabe convertir.',
  sin_cotizacion:
    'No hay cotización vigente para esa moneda, así que no se puede pasar el importe a dólares. Cargá una en Configuración o registrá el pago en dólares.',
  ultimos4: 'Los últimos cuatro dígitos tienen que ser exactamente cuatro números.',
  link_sin_datos: 'No se pudo calcular el saldo para generar el link. Probá de nuevo.',
  link_no_cobrable: 'Esta reserva no tiene un saldo que se pueda cobrar en línea.',
  link_pago: 'No se pudo leer la reserva para generar el link de pago.',
  link_pasarela:
    'La pasarela no pudo crear el link. Probá con otro medio o cobrá desde el mostrador.',
  // Cambio de unidad.
  ...MENSAJES_RECHAZO_MUDANZA,
  ocupada: 'Esa unidad ya está ocupada en las fechas de la reserva.',
  sin_destino: 'Elegí la unidad de destino.',
  sin_estadia: 'La reserva no tiene una estadía asociada.',
  lectura_estadia: 'No se pudo leer la estadía para mudarla. No se cambió nada — probá de nuevo.',
  destino_inexistente: 'La unidad de destino no existe.',
  destino_inactivo: 'La unidad de destino está dada de baja.',
  repro_estado:
    'Esta reserva ya no se puede reprogramar: está cancelada, marcada como no-show o terminada.',
  repro_facturada:
    'La reserva ya está facturada: cambiar las fechas cambiaría el total contra un comprobante emitido. Si hay que hacerlo, primero va una nota de crédito.',
  recotizar_facturada:
    'El huésped quedó mudado, pero el precio no se recotizó: la reserva ya está facturada y el total no puede cambiar contra el comprobante emitido.',
  tarifa_destino:
    'La mudanza se hizo, pero no hay tarifa cargada para el tipo de destino: el total quedó sin recotizar.',
  tarifa_tipo_verificar:
    'La mudanza se hizo, pero no se pudo verificar si esta reserva es neta o rack: el total quedó sin recotizar. Revisalo a mano antes de facturar.',
  mudanza: 'No se pudo cambiar la unidad.',
  origen_pago:
    'No se pudo guardar el origen del pago. La exención de IVA quedó como estaba: revisala antes de facturar.',
  // Cargos que la cuenta ya no admite (P3).
  ...MENSAJES_NO_CARGABLE,
  // Garantía de tarjeta (P2, ADR 0025).
  tarjeta_incompleta: 'Faltan el número y el vencimiento de la tarjeta.',
  tarjeta_sin_proveedor:
    'No hay una pasarela configurada para verificar tarjetas. Avisá antes de confiar en esta garantía.',
  tarjeta:
    'No se pudo guardar el resultado de la verificación. La garantía quedó como estaba: revisala antes del check-in.',
  // Edición de ficha: plan, segmento, voucher, notas, cunas, no mover, composición.
  ficha_plan: 'Elegí un plan válido.',
  ficha_segmento: 'Elegí un segmento válido.',
  ficha_leer: 'No se pudo leer la estadía para editar la ficha. No se cambió nada.',
  ficha_ocupantes:
    'Revisá la composición: tiene que haber al menos un adulto, entrar en la capacidad de la unidad, y no puede haber cunas sin bebés.',
  ficha_guardar: 'No se pudieron guardar los cambios. La ficha quedó entera como estaba.',
}
