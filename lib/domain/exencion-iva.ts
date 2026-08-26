/**
 * Exención de IVA al turista del exterior (lógica pura).
 *
 * Marco legal: RG 3971/2016 (AFIP) y Decreto 1043/2016. El alojamiento prestado
 * a turistas del exterior está exento de IVA, y el hotel lo factura como
 * operación exenta.
 *
 * ── La regla que más se equivoca a mano ─────────────────────────────────────
 *
 * La exención **no depende de la nacionalidad ni del pasaporte**. Exige las dos
 * condiciones juntas:
 *
 *   (a) el huésped es residente en el exterior, y
 *   (b) el pago se hace DESDE el exterior — tarjeta emitida fuera del país o
 *       transferencia del exterior.
 *
 * Un extranjero que paga en efectivo en pesos **no está exento**. Es el error
 * más común y el más caro: una factura exenta que no correspondía es IVA que el
 * hotel no ingresó.
 *
 * Por eso en este módulo **no hay ninguna función que reciba «exento» como
 * parámetro y lo aplique**. La exención se *deriva* de los dos hechos, y no hay
 * forma de forzarla desde la pantalla. Impedir el error, no advertirlo.
 *
 * ── Alcance ─────────────────────────────────────────────────────────────────
 *
 * Alcanza al **alojamiento y al desayuno incluido en la tarifa** (van juntos en
 * el precio de la noche). **No** alcanza al frigobar, las excursiones, los
 * traslados ni a un desayuno vendido suelto a quien todavía no hizo el check-in:
 * ésos son servicios aparte y siguen gravados aunque el alojamiento esté exento.
 *
 * Ver ADR 0024.
 */

/** Fundamento legal que se imprime en el comprobante. */
export const FUNDAMENTO_EXENCION =
  'Operación exenta — RG 3971/2016 y Decreto 1043/2016 (alojamiento a turista del exterior)'

/** Los dos hechos de los que depende la exención. */
export interface CondicionExencion {
  /** `huespedes.residente_exterior` */
  residenteExterior: boolean
  /** `reservas.pago_desde_exterior`. `null` = todavía no se sabe. */
  pagoDesdeExterior: boolean | null
}

export type MotivoSinExencion = 'no_residente' | 'pago_sin_confirmar' | 'pago_local'

/**
 * Mensajes para la pantalla. Dicen qué falta, no solo que no se puede: quien
 * atiende el mostrador tiene que poder resolverlo sin preguntar.
 */
export const MENSAJES_SIN_EXENCION: Record<MotivoSinExencion, string> = {
  no_residente:
    'El huésped no está marcado como residente en el exterior. Si lo es, cargalo en su ficha: la exención lo exige.',
  pago_sin_confirmar:
    'Falta confirmar de dónde sale el pago. La exención solo corresponde si paga con tarjeta emitida en el exterior o transferencia del exterior.',
  pago_local:
    'El pago es local (efectivo, tarjeta o transferencia del país), así que corresponde cobrar el IVA aunque el huésped resida en el exterior.',
}

/**
 * Por qué NO corresponde la exención, o `null` si sí corresponde.
 *
 * El orden importa: primero la residencia, que es el dato durable del huésped, y
 * después el pago, que cambia en cada estadía. Así el mensaje señala lo que hay
 * que corregir primero.
 */
export function motivoSinExencion(c: CondicionExencion): MotivoSinExencion | null {
  if (!c.residenteExterior) return 'no_residente'
  if (c.pagoDesdeExterior === null || c.pagoDesdeExterior === undefined) {
    return 'pago_sin_confirmar'
  }
  if (!c.pagoDesdeExterior) return 'pago_local'
  return null
}

/** ¿Corresponde la exención? Las dos condiciones, sin atajos. */
export function exentoDeIva(c: CondicionExencion): boolean {
  return motivoSinExencion(c) === null
}

/* ────────────────────────────────────── desglose fiscal del comprobante ── */

export interface DesgloseConExencion {
  /** Todo lo no impositivo: alojamiento sin IVA + consumos sin IVA. */
  neto: number
  /** Parte de `neto` que no tributa. Subconjunto de `neto`, no un sumando. */
  exento: number
  /** Impuesto sobre la parte gravada (`neto - exento`). */
  iva: number
  /** `neto + iva`. La garantía del sistema, que no se rompe con exención. */
  total: number
  /** Alícuota aplicada a la parte gravada. 0 si no quedó nada gravado. */
  alicuota: number
  /** Fundamento legal, o `null` si no hubo exención. */
  motivoExencion: string | null
}

/** Redondeo a dos decimales evitando el error binario de coma flotante. */
function aCentavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Desglose fiscal de una cuenta que puede tener parte exenta.
 *
 * ── Por qué `exento` es un subconjunto de `neto` y no un tercer sumando ─────
 *
 * El sistema garantiza en todos lados que `neto + iva = total`, y hay tests que
 * lo fijan. Sumar el monto exento aparte rompería esa igualdad en todas las
 * pantallas que la asumen. Acá:
 *
 *     neto   = alojamiento sin IVA + consumos sin IVA
 *     exento = la parte de `neto` que no tributa (el alojamiento)
 *     iva    = impuesto sobre (neto - exento)
 *     total  = neto + iva                              ← se mantiene
 *
 * Es además cómo lo modela AFIP: `ImpNeto` (gravado), `ImpOpEx` (exentas) e
 * `ImpIVA` viajan separados y el total es su suma. `neto` los agrupa y `exento`
 * dice cuánto corresponde a `ImpOpEx`.
 *
 * @param alojamientoConIva importe del alojamiento **con** IVA (`reservas.total`)
 * @param consumosConIva    importe de los consumos **con** IVA
 * @param alicuota          alícuota vigente (no se inventa: viene de `tarifas.iva_pct`)
 * @param exento            resultado de `exentoDeIva`, nunca un valor tipeado a mano
 */
export function desglosarConExencion(params: {
  alojamientoConIva: number
  consumosConIva: number
  alicuota: number
  exento: boolean
}): DesgloseConExencion {
  const { alojamientoConIva, consumosConIva, alicuota, exento } = params
  const factor = 1 + alicuota / 100

  if (!exento) {
    // Camino sin exención: idéntico al de siempre, para que nada cambie donde no
    // corresponde. Se calcula acá y no delegando en `desglosarIva` para que el
    // redondeo de los dos caminos sea el mismo y no diverjan con el tiempo.
    const total = aCentavos(alojamientoConIva + consumosConIva)
    const neto = alicuota <= 0 ? total : aCentavos(total / factor)
    return {
      neto,
      exento: 0,
      // Por diferencia, para que `neto + iva = total` cierre aunque el redondeo
      // de cada parte por separado no diera exacto.
      iva: aCentavos(total - neto),
      total,
      alicuota: alicuota <= 0 ? 0 : alicuota,
      motivoExencion: null,
    }
  }

  // Con exención: el alojamiento pierde el IVA, los consumos lo conservan.
  const alojamientoNeto = alicuota <= 0 ? aCentavos(alojamientoConIva) : aCentavos(alojamientoConIva / factor)
  const consumosNeto = alicuota <= 0 ? aCentavos(consumosConIva) : aCentavos(consumosConIva / factor)
  const consumosIva = aCentavos(aCentavos(consumosConIva) - consumosNeto)

  const neto = aCentavos(alojamientoNeto + consumosNeto)

  return {
    neto,
    exento: alojamientoNeto,
    iva: consumosIva,
    total: aCentavos(neto + consumosIva),
    // Si no quedó nada gravado, la alícuota del comprobante es 0: declarar 21 %
    // sobre una base de cero confunde a quien lee la factura y a quien la audita.
    alicuota: consumosNeto > 0 && alicuota > 0 ? alicuota : 0,
    motivoExencion: FUNDAMENTO_EXENCION,
  }
}
