/**
 * Ciclo de vida de un contrato y reglas de firma (lógica pura).
 *
 * Ciclo:
 *   borrador → enviado → firmado
 *                  ↘ rechazado → (se corrige y vuelve a borrador)
 *                  ↘ vencido
 *
 * Debe mantenerse en sincronía con los enums `estado_contrato` y `tipo_contrato`
 * de la base (ver `supabase/migrations/0018_contratos_firmas.sql`).
 */

export const ESTADOS_CONTRATO = [
  'borrador',
  'enviado',
  'firmado',
  'rechazado',
  'vencido',
] as const

export type EstadoContrato = (typeof ESTADOS_CONTRATO)[number]

export const ETIQUETAS_ESTADO_CONTRATO: Record<EstadoContrato, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado a firmar',
  firmado: 'Firmado',
  rechazado: 'Rechazado',
  vencido: 'Vencido',
}

export const TIPOS_CONTRATO = ['agencia', 'proveedor', 'empleado'] as const
export type TipoContrato = (typeof TIPOS_CONTRATO)[number]

export const ETIQUETAS_TIPO_CONTRATO: Record<TipoContrato, string> = {
  agencia: 'Agencia',
  proveedor: 'Proveedor',
  empleado: 'Empleado',
}

/**
 * Transiciones válidas desde cada estado.
 *
 * `firmado` y `vencido` son terminales: un contrato firmado no se reenvía (habría
 * que emitir uno nuevo) y uno vencido no revive. Un contrato rechazado sí puede
 * volver a borrador para corregirlo y mandarlo otra vez.
 */
export const TRANSICIONES_CONTRATO: Record<EstadoContrato, readonly EstadoContrato[]> = {
  borrador: ['enviado'],
  enviado: ['firmado', 'rechazado', 'vencido'],
  firmado: [],
  rechazado: ['borrador'],
  vencido: [],
}

export function transicionesPosibles(estado: EstadoContrato): readonly EstadoContrato[] {
  return TRANSICIONES_CONTRATO[estado]
}

export function puedeTransicionar(desde: EstadoContrato, hasta: EstadoContrato): boolean {
  return TRANSICIONES_CONTRATO[desde].includes(hasta)
}

/** Estados en los que el contrato ya no admite ninguna acción. */
export function esEstadoFinal(estado: EstadoContrato): boolean {
  return TRANSICIONES_CONTRATO[estado].length === 0
}

/** Datos mínimos del contrato para evaluar las reglas de firma. */
export interface ContratoParaFirma {
  estado: EstadoContrato
  vigencia_hasta?: string | null
}

/**
 * Un contrato está vencido por calendario cuando su vigencia terminó.
 *
 * La comparación es de strings ISO (`YYYY-MM-DD`), que ordenan igual que las
 * fechas; el último día de vigencia se considera todavía válido.
 */
export function vencidoPorFecha(vigenciaHasta: string | null | undefined, hoy: string): boolean {
  if (!vigenciaHasta) return false
  return vigenciaHasta < hoy
}

/** Motivo por el que un contrato no se puede firmar; `null` si sí se puede. */
export type MotivoNoFirmable =
  | 'no_enviado'
  | 'ya_firmado'
  | 'rechazado'
  | 'vencido'

export const MENSAJES_NO_FIRMABLE: Record<MotivoNoFirmable, string> = {
  no_enviado: 'Este contrato todavía no fue enviado a firmar.',
  ya_firmado: 'Este contrato ya fue firmado.',
  rechazado: 'Este contrato fue rechazado.',
  vencido: 'Este contrato está vencido y ya no puede firmarse.',
}

/**
 * Determina si un contrato admite la firma en la fecha dada.
 *
 * Devuelve `null` cuando se puede firmar, o el motivo del rechazo. Se resuelve
 * acá (y no en la pantalla) para que la regla sea única y testeable: la usan
 * tanto la vista pública como la acción que registra la firma.
 */
export function motivoNoFirmable(
  contrato: ContratoParaFirma,
  hoy: string,
): MotivoNoFirmable | null {
  if (contrato.estado === 'firmado') return 'ya_firmado'
  if (contrato.estado === 'rechazado') return 'rechazado'
  if (contrato.estado === 'vencido') return 'vencido'
  if (contrato.estado !== 'enviado') return 'no_enviado'
  // Un contrato enviado pero cuya vigencia ya pasó tampoco se puede firmar,
  // aunque nadie haya corrido todavía el proceso que lo marca como vencido.
  if (vencidoPorFecha(contrato.vigencia_hasta, hoy)) return 'vencido'
  return null
}

export function puedeFirmar(contrato: ContratoParaFirma, hoy: string): boolean {
  return motivoNoFirmable(contrato, hoy) === null
}

/**
 * Un contrato se puede enviar a firmar solo desde borrador.
 *
 * Cubre explícitamente el caso «no se puede reenviar uno ya firmado».
 */
export function puedeEnviar(estado: EstadoContrato): boolean {
  return puedeTransicionar(estado, 'enviado')
}

/**
 * Contratos que le pertenecen a una entidad (agencia, proveedor o empleado).
 *
 * Es la regla de aislamiento del portal: un socio solo puede ver **sus** propios
 * contratos. Se resuelve en el dominio, y no con un `.eq()` suelto en la
 * pantalla, para que quede testeada y no se pueda olvidar en otra consulta.
 *
 * Además se ocultan los borradores: un contrato que el hotel todavía está
 * redactando no debe aparecerle a la contraparte.
 */
export function contratosDeEntidad<
  T extends { tipo: TipoContrato; entidad_id: string; estado: EstadoContrato },
>(tipo: TipoContrato, entidadId: string, contratos: readonly T[]): T[] {
  return contratos.filter(
    (c) => c.tipo === tipo && c.entidad_id === entidadId && c.estado !== 'borrador',
  )
}

/**
 * Contratos vigentes hoy: firmados y dentro de su ventana de vigencia.
 *
 * Es lo que necesita recepción para saber si una agencia tiene convenio activo.
 */
export function estaVigente(
  contrato: { estado: EstadoContrato; vigencia_desde?: string | null; vigencia_hasta?: string | null },
  hoy: string,
): boolean {
  if (contrato.estado !== 'firmado') return false
  if (contrato.vigencia_desde && hoy < contrato.vigencia_desde) return false
  if (vencidoPorFecha(contrato.vigencia_hasta, hoy)) return false
  return true
}
