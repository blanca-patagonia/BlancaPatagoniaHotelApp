import { comisionEfectivaPct, netoDeComision } from './canales-costos'

/**
 * Rentabilidad por canal de venta (lógica pura).
 *
 * ── La pregunta que responde ────────────────────────────────────────────────
 *
 * *Cuánto me dejó Booking neto de comisión, y cuánto me cuesta cada venta.* Hasta acá
 * el «ranking de canales» de reportes sumaba `reservas.total` —bruto y con IVA— como si
 * fuera lo que le queda al hotel, y la comisión no entraba en ningún cálculo.
 *
 * ── ⚠️ El error que este módulo existe para evitar ──────────────────────────
 *
 * `reservas.tarifa_tipo = 'neto'` es un **tipo de tarifa** —la de agencia, contra la
 * `rack` de mostrador— y **no** significa «importe al que ya se le descontó la
 * comisión». Son dos cosas distintas que comparten una palabra:
 *
 *     total de la reserva  = lo que paga el huésped   (con IVA, ADR 0004)
 *     comisión             = lo que se queda el canal (gasto del hotel)
 *     neto de comisión     = total − comisión
 *
 * Restarle la comisión a un total que alguien creyó «ya neto» da un número más bajo que
 * el real, y **no falla**: se publica como si estuviera bien. La frase va en la pantalla
 * además de acá.
 *
 * ── Las dos honestidades que el módulo impone ───────────────────────────────
 *
 * 1. **Una reserva sin comisión informada no cuenta como comisión cero.** Se cuenta
 *    aparte, y el reporte dice «el neto es *al menos* esto». El feed iCal nunca informa
 *    comisión, así que este caso es normal, no una excepción.
 * 2. **Un canal sin gasto de adquisición registrado no vale `USD 0`.** Para `directo` y
 *    `web` hay Google Ads y tiempo de mostrador, pero el sistema no los conoce.
 *    `costoAdquisicion` devuelve `null`, y la pantalla muestra `—`. Es la misma mentira
 *    que el «USD 0» del iCal que la pantalla ya se cuida de no mostrar.
 */

/** Una reserva, con lo mínimo para medir su rentabilidad. */
export interface ReservaDeMetrica {
  canal: string
  /** Lo que paga el huésped, con IVA. */
  total: number
  /** Comisión informada por el canal. `null` = no informó, que NO es cero. */
  comision: number | null
  /** Noches de la estadía, para ADR. */
  noches: number
}

export interface MetricasDeCanal {
  canal: string
  reservas: number
  noches: number
  /** Lo que pagan los huéspedes, con IVA. */
  bruto: number
  /** Comisión sumada, **solo de las que la informaron**. */
  comision: number
  /** `bruto − comision`. Ver la advertencia del encabezado. */
  neto: number
  /**
   * Comisión efectiva sobre el bruto. `null` si el bruto es cero.
   *
   * Es el número que revela si el canal cobra el porcentaje pactado: un 18 % efectivo
   * contra un 15 % acordado son tres puntos que nadie estaba mirando.
   */
  comisionPct: number | null
  /** ADR sobre el bruto: lo que paga el huésped por noche. */
  adrBruto: number | null
  /** ADR sobre el neto: lo que le queda al hotel por noche. La comparación importa. */
  adrNeto: number | null
  /**
   * Cuántas reservas del canal **no informaron** comisión.
   *
   * Mientras sea mayor que cero, `neto` es un piso y no un dato definitivo, y la
   * pantalla tiene que decirlo.
   */
  sinComisionInformada: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Agrupa las reservas por canal y calcula la rentabilidad de cada uno.
 *
 * Se devuelve ordenado por **neto** descendente, no por bruto: la pregunta del hotel es
 * cuál le deja más plata, y ordenar por bruto pondría primero al canal que más factura
 * aunque se lleve la mayor comisión — que es exactamente la confusión que este módulo
 * viene a deshacer.
 */
export function metricasPorCanal(reservas: readonly ReservaDeMetrica[]): MetricasDeCanal[] {
  const porCanal = new Map<string, ReservaDeMetrica[]>()

  for (const r of reservas) {
    const lista = porCanal.get(r.canal) ?? []
    lista.push(r)
    porCanal.set(r.canal, lista)
  }

  const salida: MetricasDeCanal[] = []

  for (const [canal, filas] of porCanal) {
    let bruto = 0
    let comision = 0
    let noches = 0
    let sinComisionInformada = 0

    for (const f of filas) {
      bruto += f.total
      noches += f.noches
      // `null` NO es cero: se cuenta aparte. Sumarlo como cero afirmaría que el canal
      // no cobró nada por esa reserva, que es falso.
      if (f.comision === null) sinComisionInformada++
      else comision += f.comision
    }

    bruto = redondear(bruto)
    comision = redondear(comision)
    const neto = netoDeComision(bruto, comision)

    salida.push({
      canal,
      reservas: filas.length,
      noches,
      bruto,
      comision,
      neto,
      comisionPct: comisionEfectivaPct(bruto, comision),
      // `null` y no cero cuando no hay noches: dividir por cero no da «cero pesos por
      // noche», da un dato que no existe.
      adrBruto: noches > 0 ? redondear(bruto / noches) : null,
      adrNeto: noches > 0 ? redondear(neto / noches) : null,
      sinComisionInformada,
    })
  }

  return salida.sort((a, b) => b.neto - a.neto)
}

/**
 * Costo de adquisición por reserva de un canal.
 *
 * ── Por qué devuelve `null` y no cero ───────────────────────────────────────
 *
 * Para `directo` y `web` el costo **no es cero**: hay Google Ads, hay tiempo de
 * mostrador, hay la web que alguien mantiene. Lo que pasa es que el sistema **no los
 * conoce**, y eso es distinto de que no existan.
 *
 * Mostrar `USD 0` en la columna de un canal haría que la comparación diga «el directo
 * es gratis», que es la conclusión equivocada más cara que este reporte podría inducir:
 * llevaría a bajar la inversión en los canales pagos sin saber qué cuesta el propio.
 *
 * La pantalla muestra `—` y ofrece cargarlo (`canal_cargos` con `concepto = 'marketing'`).
 */
export function costoAdquisicion(m: MetricasDeCanal): number | null {
  if (m.reservas === 0) return null
  // Sin ninguna comisión informada no hay costo conocido, aunque haya reservas.
  if (m.comision <= 0) return null
  return redondear(m.comision / m.reservas)
}

export interface TotalesCanales {
  bruto: number
  comision: number
  neto: number
  reservas: number
  /** Suma de las reservas sin comisión informada, en todos los canales. */
  sinComisionInformada: number
  /**
   * `true` si algún canal tiene reservas sin comisión informada.
   *
   * La pantalla lo usa para decir «al menos» en vez de presentar el neto como
   * definitivo. Un número incompleto presentado como cerrado es peor que uno con la
   * salvedad escrita.
   */
  incompleto: boolean
}

/** Consolida los totales de todos los canales. */
export function totalesDeCanales(metricas: readonly MetricasDeCanal[]): TotalesCanales {
  const t: TotalesCanales = {
    bruto: 0,
    comision: 0,
    neto: 0,
    reservas: 0,
    sinComisionInformada: 0,
    incompleto: false,
  }

  for (const m of metricas) {
    t.bruto += m.bruto
    t.comision += m.comision
    t.reservas += m.reservas
    t.sinComisionInformada += m.sinComisionInformada
  }

  t.bruto = redondear(t.bruto)
  t.comision = redondear(t.comision)
  t.neto = netoDeComision(t.bruto, t.comision)
  t.incompleto = t.sinComisionInformada > 0

  return t
}

/**
 * ¿La comisión efectiva se apartó de la pactada?
 *
 * Devuelve la diferencia en puntos porcentuales, o `null` si falta alguno de los dos
 * datos. Positivo = el canal cobra **más** que lo acordado.
 *
 * La tolerancia existe porque el redondeo por reserva no da nunca el porcentaje exacto:
 * avisar por dos décimas sería ruido, y el ruido hace que nadie mire el aviso.
 */
export function desvioDeComision(
  efectivaPct: number | null,
  pactadaPct: number | null | undefined,
  tolerancia = 0.5,
): number | null {
  if (efectivaPct === null || pactadaPct === null || pactadaPct === undefined) return null
  const diferencia = redondear(efectivaPct - pactadaPct)
  return Math.abs(diferencia) <= tolerancia ? null : diferencia
}
