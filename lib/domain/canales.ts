/**
 * Reglas de las reservas que llegan de un canal externo (OTA).
 *
 * Lógica pura: no conoce a Booking ni a la base. Traduce y valida lo que un
 * canal informa antes de que nada se escriba, que es el único momento en que
 * todavía se puede rechazar sin ensuciar datos.
 *
 * Ver `lib/canales/index.ts` para el contrato del adaptador.
 */

import type { TarifaTipo } from './precios'

export type CanalVenta = 'booking' | 'expedia'

/**
 * Tarifa que corresponde a cada canal.
 *
 * Una venta por OTA es **venta de agencia**: va a tarifa `neto`, con la comisión
 * del canal descontada (ADR 0004). Cobrarle rack a una OTA es facturar de más y
 * después tener que emitir una nota de crédito.
 */
const TARIFA_POR_CANAL: Record<CanalVenta, TarifaTipo> = {
  booking: 'neto',
  expedia: 'neto',
}

export function tarifaDeCanal(canal: CanalVenta): TarifaTipo {
  // Hoy los dos van a neto, pero se expresa como tabla y no como constante: la
  // regla es «según el canal». Si mañana entra uno con tarifa rack, el cambio
  // queda contenido acá y el compilador exige completar la fila nueva.
  return TARIFA_POR_CANAL[canal]
}

export interface ReservaEntrante {
  externalId: string
  canal: CanalVenta
  tipoUnidadCodigo: string
  checkIn: string
  checkOut: string
  huespedes: number
  apellido: string
  email: string | null
  importeCanal: number
  monedaCanal: string
  operacion: 'nueva' | 'modificada' | 'cancelada'
  emitidaEn: string
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Valida una reserva entrante antes de tocar la base.
 *
 * Devuelve la lista de motivos por los que NO se puede procesar. Vacía = se
 * puede seguir.
 *
 * Se valida todo junto y no se corta en el primero a propósito: una reserva que
 * llega mal suele llegar mal de varias formas, y quien tenga que reclamarle al
 * canal necesita el detalle completo, no el primer síntoma.
 */
export function validarReservaEntrante(r: ReservaEntrante): string[] {
  const motivos: string[] = []

  if (!r.externalId?.trim()) {
    // Sin identificador del canal no hay idempotencia posible: un reenvío
    // duplicaría la reserva y bloquearía una unidad de más.
    motivos.push('Falta el identificador del canal (externalId).')
  }
  if (!RE_FECHA.test(r.checkIn)) motivos.push('La fecha de entrada no es válida.')
  if (!RE_FECHA.test(r.checkOut)) motivos.push('La fecha de salida no es válida.')
  if (RE_FECHA.test(r.checkIn) && RE_FECHA.test(r.checkOut) && r.checkOut <= r.checkIn) {
    motivos.push('La salida no puede ser anterior o igual a la entrada.')
  }
  if (!Number.isInteger(r.huespedes) || r.huespedes < 1) {
    motivos.push('La cantidad de huéspedes no es válida.')
  }
  if (!r.apellido?.trim()) motivos.push('Falta el apellido del huésped.')
  if (!r.tipoUnidadCodigo?.trim()) motivos.push('Falta el tipo de alojamiento.')
  if (!(r.importeCanal >= 0)) motivos.push('El importe informado por el canal no es válido.')
  if (!r.monedaCanal?.trim()) motivos.push('Falta la moneda del importe.')

  return motivos
}

/**
 * ¿Corresponde aplicar este evento sobre el que ya teníamos?
 *
 * Los canales **no garantizan el orden de entrega**: una modificación vieja
 * puede llegar después de una nueva. Sin esta comprobación, un reenvío tardío
 * pisaría el estado correcto con uno anterior.
 *
 * Misma familia de problema que `puedeAvanzarEstadoPago` en el webhook de pagos.
 */
export function esEventoMasReciente(
  emitidaEnEntrante: string,
  emitidaEnGuardada: string | null,
): boolean {
  if (!emitidaEnGuardada) return true
  return emitidaEnEntrante > emitidaEnGuardada
}

export interface Discrepancia {
  hay: boolean
  diferencia: number
  /** Texto para el aviso al equipo. Vacío si no hay discrepancia. */
  detalle: string
}

/**
 * Compara lo que el canal dice haber cobrado contra lo que calcula nuestro
 * dominio.
 *
 * Nunca se ajusta el total nuestro al del canal: el precio lo fija el hotel
 * (ADR 0004). Lo que se hace es **avisar**, porque una diferencia significa una
 * de tres cosas, y las tres importan: la tarifa cargada no coincide con la
 * publicada, la comisión no es la pactada, o el canal vendió a un precio viejo.
 *
 * La tolerancia absorbe el redondeo de conversión de moneda; por debajo de eso
 * no vale la pena molestar a nadie.
 */
export function detectarDiscrepancia(
  totalPropio: number,
  importeCanal: number,
  tolerancia = 0.5,
): Discrepancia {
  const diferencia = Math.round((importeCanal - totalPropio + Number.EPSILON) * 100) / 100
  if (Math.abs(diferencia) <= tolerancia) {
    return { hay: false, diferencia: 0, detalle: '' }
  }
  const signo = diferencia > 0 ? 'más' : 'menos'
  return {
    hay: true,
    diferencia,
    detalle:
      `El canal informa ${Math.abs(diferencia).toFixed(2)} ${signo} que la cuenta del hotel ` +
      `(canal ${importeCanal.toFixed(2)} · propio ${totalPropio.toFixed(2)}). ` +
      `Revisá la tarifa publicada y la comisión pactada.`,
  }
}

/**
 * Estado de reserva que corresponde a cada operación del canal.
 *
 * Una reserva de OTA entra como `confirmada` y no como `pendiente`: el canal ya
 * la cerró con el huésped y garantiza el pago. Tratarla como pendiente la
 * expondría a la expiración automática y liberaría una unidad ya vendida.
 */
export function estadoSegunOperacion(
  operacion: ReservaEntrante['operacion'],
): 'confirmada' | 'cancelada' {
  return operacion === 'cancelada' ? 'cancelada' : 'confirmada'
}

/* ─────────────────────────────────────────── conflicto de cupo ──────────── */

/** Una noche ya ocupada de un tipo de unidad. */
export interface OcupacionNoche {
  tipoUnidadCodigo: string
  /** Fecha de la noche, en ISO. */
  fecha: string
  /** Cuántas unidades de ese tipo ya están vendidas esa noche. */
  ocupadas: number
}

export interface EntranteParaCupo {
  externalId: string
  tipoUnidadCodigo: string
  checkIn: string
  checkOut: string
  operacion: 'nueva' | 'modificada' | 'cancelada'
  /** `true` si ya se convirtió en reserva propia: su cupo ya está contado. */
  yaImportada?: boolean
}

/**
 * ¿El canal vendió más unidades de las que hay libres?
 *
 * ── Qué resuelve y qué no ───────────────────────────────────────────────────
 *
 * **No evita el overbooking.** No se puede: para eso habría que publicarle
 * disponibilidad a Booking, y eso exige un channel manager (ADR 0021). Lo que hace es
 * detectarlo **el día en que el informe entra**, en vez de cuando alguien aprieta
 * «Importar» —que pueden ser días— o, en el peor caso, en el check-in con el huésped
 * en la puerta.
 *
 * La diferencia es entre reacomodar con tiempo y no tener nada que ofrecer.
 *
 * ── Por qué es pura y recibe la ocupación ya calculada ──────────────────────
 *
 * El llamador trae en **una** consulta las noches ocupadas del rango completo del
 * informe, y esta función resuelve todo en memoria. La alternativa —una consulta de
 * disponibilidad por cada entrante— serían 40 viajes a la base por importación, y
 * además no se podría testear sin Postgres.
 *
 * ── La parte que no es obvia ────────────────────────────────────────────────
 *
 * Dos entrantes del mismo tipo y las mismas fechas pueden **caber por separado y no
 * juntas**. Si queda una unidad libre y llegan dos reservas, cada una mirada sola
 * «cabe», y una comprobación fila por fila no detectaría nada.
 *
 * Por eso las entrantes se acumulan sobre la ocupación a medida que se recorren: la
 * segunda ve el cupo que consumió la primera. Y **las dos** quedan marcadas, no solo
 * la segunda: cuál de las dos se acomoda es una decisión de quien atiende, no del
 * orden en que el archivo las traía.
 */
export function detectarConflictoDeCupo(
  entrantes: readonly EntranteParaCupo[],
  ocupacion: readonly OcupacionNoche[],
  /** Cuántas unidades activas hay de cada tipo. */
  cupoPorTipo: Readonly<Record<string, number>>,
): Set<string> {
  const conflicto = new Set<string>()

  // `tipo|fecha` → unidades ya comprometidas esa noche.
  const usado = new Map<string, number>()
  for (const o of ocupacion) {
    usado.set(`${o.tipoUnidadCodigo}|${o.fecha}`, o.ocupadas)
  }

  /** Noches de una estadía: `[checkIn, checkOut)`, el fin excluido. */
  const nochesDe = (desde: string, hasta: string): string[] => {
    const noches: string[] = []
    // Se itera con Date en UTC para no depender de la zona de quien corre esto.
    for (let d = new Date(`${desde}T00:00:00Z`); ; d = new Date(d.getTime() + 86400000)) {
      const iso = d.toISOString().slice(0, 10)
      if (iso >= hasta) break
      noches.push(iso)
      // Guarda contra una fecha invertida o un rango absurdo: sin esto, un
      // `checkOut` anterior al `checkIn` colgaría el bucle. La validación ya lo
      // rechaza antes, pero esta función es pública y no puede confiar en eso.
      if (noches.length > 370) break
    }
    return noches
  }

  for (const e of entrantes) {
    // Una cancelada no ocupa nada. Una ya importada tampoco suma: su cupo ya está
    // contado en `ocupacion`, y contarlo dos veces marcaría un conflicto inexistente.
    if (e.operacion === 'cancelada' || e.yaImportada) continue

    const cupo = cupoPorTipo[e.tipoUnidadCodigo]

    // Tipo desconocido: no se marca conflicto. La importación ya va a fallar con un
    // motivo mejor («ese código de tipo no existe»), y marcar además un conflicto de
    // cupo sería un segundo mensaje que no ayuda a nadie.
    if (cupo === undefined) continue

    let choca = false
    const noches = nochesDe(e.checkIn, e.checkOut)

    for (const noche of noches) {
      const clave = `${e.tipoUnidadCodigo}|${noche}`
      const ya = usado.get(clave) ?? 0
      if (ya + 1 > cupo) choca = true
      // Se acumula SIEMPRE, incluso si ya chocó: la entrante siguiente tiene que ver
      // este cupo consumido.
      usado.set(clave, ya + 1)
    }

    if (choca) conflicto.add(e.externalId)
  }

  return conflicto
}
