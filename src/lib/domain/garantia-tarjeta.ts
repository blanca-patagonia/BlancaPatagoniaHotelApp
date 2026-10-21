/**
 * Garantía de tarjeta: si sirve o no para cobrar (lógica pura).
 *
 * ── El pedido, y por qué se resuelve al revés de como lo pidieron ───────────
 *
 * Franco, en el relevamiento del 15/08/2026: «que el sistema pruebe si la
 * tarjeta es válida o no, porque hay veces que ponen una tarjeta cualquiera y
 * después cuando la querés ir a cobrar porque no aparecieron o porque te dejaron
 * una cena sin pagar, ya no es válida».
 *
 * En WinPAX eso eran cuatro campos: número, vencimiento, autorización y **PIN**.
 * Este sistema no guarda nada de eso y no se agregó — guardar un PAN sacaría al
 * hotel del alcance SAQ-A de PCI-DSS, que es el único sostenible para un hotel
 * de 15 unidades.
 *
 * La necesidad real no es *tener el número*: es **saber si la tarjeta sirve para
 * cobrar**. Eso se resuelve con una preautorización tokenizada, y este módulo
 * decide qué significa el resultado.
 *
 * Ver ADR 0025.
 */

/** Estados posibles, en el mismo orden que el enum de la migración 0059. */
export const ESTADOS_VERIFICACION = [
  'sin_verificar',
  'verificada',
  'rechazada',
  'no_soportado',
] as const

export type EstadoVerificacionTarjeta = (typeof ESTADOS_VERIFICACION)[number]

export const ETIQUETAS_VERIFICACION: Record<EstadoVerificacionTarjeta, string> = {
  sin_verificar: 'Sin verificar',
  verificada: 'Verificada',
  rechazada: 'Rechazada por el emisor',
  no_soportado: 'No se pudo verificar',
}

/**
 * Días que una verificación sigue diciendo algo.
 *
 * ── Por qué 30 y no «para siempre» ──────────────────────────────────────────
 *
 * Una preautorización dice que la tarjeta servía **en ese momento**. El emisor
 * puede bloquearla, el titular puede denunciarla y el límite puede agotarse
 * cualquier día después. Una verificación de junio no dice nada en septiembre, y
 * mostrarla como válida sería peor que no tenerla: recepción dejaría pasar un
 * check-in confiando en una garantía que ya no existe.
 *
 * Treinta días porque cubre la ventana en que se hacen la mayoría de las
 * reservas —se reserva dentro del mes previo a la llegada— y porque volver a
 * verificar es barato. Es un número elegido, no una constante de la industria:
 * si el hotel prefiere otro, se cambia acá y se recalcula todo.
 */
export const DIAS_VIGENCIA_VERIFICACION = 30

export interface GarantiaTarjeta {
  estado: EstadoVerificacionTarjeta
  /** ISO `yyyy-mm-dd` o timestamp. `null` si nunca se verificó. */
  verificadaEn: string | null
  /** `MM/AA` tal como lo devolvió la pasarela. `null` si no hay tarjeta. */
  vencimiento: string | null
}

export type MotivoGarantiaNoSirve =
  | 'sin_tarjeta'
  | 'no_verificada'
  | 'rechazada'
  | 'sin_pasarela'
  | 'verificacion_vencida'
  | 'tarjeta_vencida'

export const MENSAJES_GARANTIA: Record<MotivoGarantiaNoSirve, string> = {
  sin_tarjeta:
    'No hay ninguna tarjeta cargada como garantía. Un no-show no se podría cobrar.',
  no_verificada:
    'La tarjeta está cargada pero nadie la verificó. Verificala antes de la llegada: puede no servir.',
  rechazada:
    'El emisor rechazó la tarjeta. NO sirve para cobrar: pedile otra al huésped antes del check-in.',
  sin_pasarela:
    'No hay pasarela de pagos configurada, así que el sistema no puede probar la tarjeta contra el emisor. Los datos quedan registrados, pero nadie garantiza que se pueda cobrar.',
  verificacion_vencida: `La verificación tiene más de ${DIAS_VIGENCIA_VERIFICACION} días y ya no dice nada. Volvé a verificarla.`,
  tarjeta_vencida:
    'La tarjeta está vencida a la fecha de la estadía. Pedile una vigente al huésped.',
}

/** Convierte `MM/AA` al último día de ese mes, en ISO. `null` si no parsea. */
export function ultimoDiaDeVigencia(vencimientoMMAA: string | null): string | null {
  if (!vencimientoMMAA) return null
  const m = /^(0[1-9]|1[0-2])\/([0-9]{2})$/.exec(vencimientoMMAA)
  if (!m) return null

  const mes = Number(m[1])
  // Las tarjetas usan dos dígitos de año. Se asume el siglo 21: una tarjeta
  // emitida para «/99» es 2099, no 1999. Es la convención de toda la industria.
  const anio = 2000 + Number(m[2])

  // Una tarjeta vence al FINAL del mes impreso, no al principio: `12/26` sirve
  // todo diciembre de 2026. Redondear para abajo la rechazaría un mes antes.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
}

/** Días transcurridos entre dos fechas ISO. Negativo si `hasta` es anterior. */
function diasEntreISO(desde: string, hasta: string): number {
  const a = Date.parse(desde.slice(0, 10))
  const b = Date.parse(hasta.slice(0, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
  return Math.floor((b - a) / 86_400_000)
}

/**
 * Por qué la garantía NO sirve para cobrar, o `null` si sirve.
 *
 * @param fechaReferencia normalmente la del check-in: la pregunta no es «¿sirve
 *        hoy?» sino «¿va a servir cuando haga falta cobrarla?».
 *
 * El orden de las comprobaciones va de lo más definitivo a lo más recuperable,
 * para que el mensaje señale lo que de verdad hay que resolver: si el emisor la
 * rechazó, no importa que además la verificación esté vieja.
 */
export function motivoGarantiaNoSirve(
  g: GarantiaTarjeta,
  fechaReferencia: string,
): MotivoGarantiaNoSirve | null {
  if (g.estado === 'rechazada') return 'rechazada'
  if (g.estado === 'no_soportado') return 'sin_pasarela'
  if (g.estado === 'sin_verificar') {
    // Sin fecha de verificación y sin vencimiento no hay ni tarjeta cargada.
    return g.vencimiento ? 'no_verificada' : 'sin_tarjeta'
  }

  // A partir de acá el estado es `verificada`.
  const vence = ultimoDiaDeVigencia(g.vencimiento)
  if (vence && vence < fechaReferencia.slice(0, 10)) return 'tarjeta_vencida'

  if (!g.verificadaEn) return 'no_verificada'
  const dias = diasEntreISO(g.verificadaEn, fechaReferencia)
  if (!Number.isFinite(dias) || dias > DIAS_VIGENCIA_VERIFICACION) {
    return 'verificacion_vencida'
  }

  return null
}

/**
 * ¿Se puede contar con esta garantía para cobrar un no-show?
 *
 * Es deliberadamente estricta: ante cualquier duda devuelve `false`. Una
 * garantía que se muestra como buena y después no se puede cobrar es peor que
 * ninguna, porque el hotel deja pasar el check-in confiando en ella.
 */
export function garantiaSirveParaCobrar(
  g: GarantiaTarjeta,
  fechaReferencia: string,
): boolean {
  return motivoGarantiaNoSirve(g, fechaReferencia) === null
}

/** Enmascara para mostrar: `•••• 4242`. Nunca se muestra más que eso. */
export function tarjetaEnmascarada(
  ultimos4: string | null,
  marca: string | null,
): string {
  if (!ultimos4) return 'Sin tarjeta'
  return `${marca ? `${marca} ` : ''}•••• ${ultimos4}`
}
