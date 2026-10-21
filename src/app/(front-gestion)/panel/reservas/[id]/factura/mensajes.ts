import { MENSAJES_NO_ACREDITAR } from '@/lib/domain/facturacion'

/** Los motivos que la pantalla de factura muestra desde `?error=` (también los usa el asistente de IA). */
export const MENSAJES_FACTURA: Record<string, string> = {
  ...MENSAJES_NO_ACREDITAR,
  cae: 'El proveedor de facturación rechazó la nota de crédito. Revisá el importe.',
  numeracion_nc: 'No se pudo asignar el número de la nota de crédito. Probá de nuevo.',
  nota_credito:
    'Se pidió el CAE y se consumió el número, pero la nota NO quedó guardada. Avisá antes de volver a emitir: el número ya se usó.',
  lectura_factura: 'No se pudo leer la factura. No se emitió nada.',
  lectura_notas: 'No se pudieron leer las notas de crédito anteriores. No se emitió nada.',
}
