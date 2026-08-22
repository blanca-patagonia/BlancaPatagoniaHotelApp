/**
 * Quién cobra una reserva del canal, y si ya se cobró.
 *
 * ── Por qué esto es un módulo aparte ────────────────────────────────────────
 *
 * Booking cobra de dos formas, y en este hotel **conviven las dos según la
 * reserva**:
 *
 * · **El huésped paga en el hotel.** Booking sólo cobra su comisión, por factura
 *   mensual. La plata la cobra el mostrador.
 * · **Booking le cobra al huésped y le transfiere al hotel** («Payments by
 *   Booking.com»). Acá el mostrador no cobra nada, y lo que hay que verificar es que
 *   la transferencia efectivamente llegó.
 *
 * Confundirlas cuesta plata en las dos direcciones: se le cobra dos veces a un
 * huésped que ya pagó, o se lo deja irse sin cobrarle porque alguien supuso que
 * Booking se encargaba.
 *
 * ── Sobre las «notificaciones de pago» ──────────────────────────────────────
 *
 * Sin ser Connectivity Partner **no existe** un aviso de «Booking te pagó»: no hay
 * webhook ni push. Lo que sí se puede construir es la conciliación —comparar lo que
 * el canal dice contra lo que hay registrado en `pagos`— y eso es lo que
 * `clasificarCobro` decide, fila por fila.
 *
 * No es una notificación: es una lista que alguien mira. Y decirlo así es parte del
 * diseño, porque prometer una notificación que no llega es peor que no prometerla.
 */

/** Quién cobra la reserva. */
export const MODALIDADES_COBRO = ['hotel', 'canal', 'desconocida'] as const
export type ModalidadCobro = (typeof MODALIDADES_COBRO)[number]

export const ETIQUETAS_MODALIDAD: Record<ModalidadCobro, string> = {
  hotel: 'Cobra el hotel',
  canal: 'Cobra el canal',
  desconocida: 'Sin determinar',
}

/**
 * Lo que hay que hacer con esta reserva, desde el punto de vista del cobro.
 *
 * Cinco valores y no un booleano: «no hay nada que hacer» y «no sabemos qué hacer»
 * son estados distintos, y el segundo es el que hay que ir a resolver.
 */
export const SITUACIONES_COBRO = [
  'al_dia',
  'falta_transferencia',
  'salio_sin_cobrar',
  'sin_determinar',
  'pendiente_de_estadia',
] as const
export type SituacionCobro = (typeof SITUACIONES_COBRO)[number]

export const ETIQUETAS_SITUACION: Record<SituacionCobro, string> = {
  al_dia: 'Al día',
  falta_transferencia: 'Falta la transferencia del canal',
  salio_sin_cobrar: 'Salió sin cobrar',
  sin_determinar: 'No sabemos quién cobra',
  pendiente_de_estadia: 'Todavía no se consumió',
}

/**
 * Cuáles piden acción de alguien. Las otras dos son informativas.
 *
 * `pendiente_de_estadia` **no** está acá a propósito: una reserva que todavía no
 * llegó y no está pagada es lo normal, no un problema.
 */
export const SITUACIONES_QUE_PIDEN_ACCION: readonly SituacionCobro[] = [
  'falta_transferencia',
  'salio_sin_cobrar',
  'sin_determinar',
]

/**
 * Interpreta la columna de forma de pago del informe del extranet.
 *
 * ⚠️ **Conservador a propósito: lo que no reconoce cae en `'desconocida'`, nunca en
 * una suposición.** Adivinar mal significa una de dos cosas, y las dos son caras:
 * ir a reclamarle una transferencia a Booking por plata que el huésped ya pagó en el
 * mostrador, o dejar salir a alguien sin cobrarle porque el sistema dijo que el canal
 * se encargaba.
 *
 * Es el mismo criterio de `interpretarOperacion` en el lector de CSV: ante lo
 * desconocido, el caso que no rompe nada.
 *
 * Los términos vienen del extranet en español y en inglés, porque el informe sale en
 * el idioma de la cuenta.
 */
export function interpretarModalidadCobro(valor: string | null | undefined): ModalidadCobro {
  if (!valor) return 'desconocida'

  // Se normaliza igual que los encabezados: sin acentos, en minúsculas.
  const v = valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  // El canal cobró. Se evalúa PRIMERO porque «pago online en booking.com» contiene
  // las dos familias de términos, y la que manda es quién tiene la plata.
  if (
    /booking|online|prepag|prepaid|tarjeta virtual|virtual card|payments by|cobrado por el canal|pagado al canal/.test(
      v,
    )
  ) {
    return 'canal'
  }

  // El hotel cobra en el mostrador.
  if (/hotel|propiedad|property|establecimiento|alojamiento|en el lugar|at property|mostrador/.test(v)) {
    return 'hotel'
  }

  return 'desconocida'
}

export interface EntradaClasificacion {
  modalidad: ModalidadCobro
  /** Fecha de salida de la reserva, en ISO. */
  checkOut: string
  /** Lo que falta cobrar según `resumenPagos`. */
  saldo: number
  /** `false` si la entrante todavía no se convirtió en reserva propia. */
  importada: boolean
}

/**
 * Decide en qué situación de cobro está una reserva del canal.
 *
 * El orden de las comprobaciones importa y no es arbitrario:
 *
 * 1. **Sin importar** no se clasifica: sin reserva propia no hay `pagos` contra los
 *    que comparar, y decir «salió sin cobrar» de algo que no existe sería falso.
 * 2. **Saldo cubierto** cierra el caso, sin importar quién cobró. Si la plata está,
 *    está.
 * 3. **`'canal'` con saldo** es la transferencia que falta. No depende de la fecha:
 *    Booking cobra al reservar, así que la plata debería estar mucho antes del
 *    check-in.
 * 4. **`'hotel'` con saldo** sólo es problema **después** del check-out. Antes es lo
 *    normal: el huésped paga cuando llega o cuando se va.
 * 5. **`'desconocida'` con saldo** es lo que hay que resolver, y se reporta como tal
 *    en vez de adivinar a qué grupo pertenece.
 */
export function clasificarCobro(e: EntradaClasificacion, hoy: string): SituacionCobro {
  if (!e.importada) return 'pendiente_de_estadia'
  if (e.saldo <= 0.001) return 'al_dia'

  if (e.modalidad === 'canal') return 'falta_transferencia'
  if (e.modalidad === 'hotel') {
    return e.checkOut <= hoy ? 'salio_sin_cobrar' : 'pendiente_de_estadia'
  }

  return 'sin_determinar'
}

/**
 * Referencia externa de una transferencia del canal, para que registrarla dos veces
 * no cree dos pagos.
 *
 * ── Por qué esta forma ──────────────────────────────────────────────────────
 *
 * `pagos.external_id` ya tiene una restricción única (migración 0009), puesta para
 * la idempotencia de los webhooks de pasarela. Reutilizarla acá da idempotencia
 * **gratis**: reimportar la misma liquidación, o que dos personas registren la misma
 * transferencia, choca con la restricción en vez de duplicar la plata.
 *
 * Y evita tocar el enum `medio_pago` para agregar un valor `'canal'`, que además de
 * ser una migración en dos pasos (SQLSTATE 55P04) no haría falta: una transferencia
 * de Booking **es** una transferencia.
 */
export function referenciaTransferenciaCanal(canal: string, referencia: string): string {
  return `${canal}-payout:${referencia}`
}

export interface ConteoCobros {
  faltaTransferencia: number
  salioSinCobrar: number
  sinDeterminar: number
  alDia: number
  pendienteDeEstadia: number
  /** Importe total en juego de las tres situaciones que piden acción. */
  enRiesgo: number
}

/** Cuenta las situaciones y suma lo que está en riesgo. */
export function contarCobros(
  filas: readonly (EntradaClasificacion & { saldo: number })[],
  hoy: string,
): ConteoCobros {
  const c: ConteoCobros = {
    faltaTransferencia: 0,
    salioSinCobrar: 0,
    sinDeterminar: 0,
    alDia: 0,
    pendienteDeEstadia: 0,
    enRiesgo: 0,
  }

  for (const f of filas) {
    const s = clasificarCobro(f, hoy)
    if (s === 'falta_transferencia') c.faltaTransferencia++
    else if (s === 'salio_sin_cobrar') c.salioSinCobrar++
    else if (s === 'sin_determinar') c.sinDeterminar++
    else if (s === 'al_dia') c.alDia++
    else c.pendienteDeEstadia++

    if (SITUACIONES_QUE_PIDEN_ACCION.includes(s)) c.enRiesgo += f.saldo
  }

  c.enRiesgo = Math.round((c.enRiesgo + Number.EPSILON) * 100) / 100
  return c
}
