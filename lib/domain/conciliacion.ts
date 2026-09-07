/**
 * Conciliación bancaria y de pasarelas (lógica pura).
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * El sistema sabe lo que **debería** haber cobrado. No tenía forma de contrastarlo
 * contra lo que de verdad entró a la cuenta. Las tres consecuencias, todas de
 * plata:
 *
 *  · Una liquidación de MercadoPago que descuenta comisiones distintas de las
 *    pactadas no se detecta.
 *  · Un cobro que la pasarela informó y el webhook perdió queda invisible: el
 *    sistema dice impago y el dinero está en la cuenta.
 *  · Los gastos del mes no existen: se cargan de a uno a mano, o no se cargan.
 *
 * Este módulo es la mitad pura del arreglo (migración 0077). No conoce la base ni
 * la red: recibe movimientos y pagos y decide qué se parece a qué.
 *
 * ── La regla que gobierna todo ──────────────────────────────────────────────
 *
 * **La conciliación propone; no concilia sola.** Un emparejamiento automático que
 * se equivoca es peor que ninguno: marca como cobrada una reserva que no se cobró
 * y nadie vuelve a mirarla. Por eso `emparejar` devuelve candidatos con su motivo
 * y la confianza que merecen, y quien decide es una persona — salvo en el único
 * caso que no admite ambigüedad, que es el identificador de la pasarela.
 */

/* ─────────────────────────────────────────────────────────── el modelo ──── */

/** De dónde salió la fila. Coincide con el `check` de `movimientos_externos`. */
export const ORIGENES_MOVIMIENTO = ['banco', 'mercadopago', 'stripe'] as const
export type OrigenMovimiento = (typeof ORIGENES_MOVIMIENTO)[number]

export const ETIQUETAS_ORIGEN_MOVIMIENTO: Record<OrigenMovimiento, string> = {
  banco: 'Extracto bancario',
  mercadopago: 'Liquidación de MercadoPago',
  stripe: 'Liquidación de Stripe',
}

export const ESTADOS_MOVIMIENTO = ['sin_conciliar', 'conciliado', 'ignorado'] as const
export type EstadoMovimiento = (typeof ESTADOS_MOVIMIENTO)[number]

export const ETIQUETAS_ESTADO_MOVIMIENTO: Record<EstadoMovimiento, string> = {
  sin_conciliar: 'Sin conciliar',
  conciliado: 'Conciliado',
  ignorado: 'Ignorado',
}

export const DESCRIPCION_ESTADO_MOVIMIENTO: Record<EstadoMovimiento, string> = {
  sin_conciliar: 'Entró a la cuenta y todavía no se sabe contra qué del sistema se corresponde.',
  conciliado: 'Casado contra un pago del sistema: el dinero y el registro coinciden.',
  ignorado:
    'Revisado y sin contrapartida en el sistema a propósito (un gasto, una transferencia interna). No vuelve a aparecer como pendiente.',
}

/**
 * Un movimiento tal como lo trae la fuente, antes de guardarse.
 *
 * ⚠️ `monto` va **con signo**: positivo lo que entró, negativo lo que salió. No
 * hay un campo `tipo` a propósito — obligaría a recordar el signo en cada suma, y
 * ése es el error que aparece después como un total que no cierra.
 */
export interface MovimientoExterno {
  origen: OrigenMovimiento
  /** Cuenta o punto de venta concreto: el hotel puede tener más de uno. */
  cuenta?: string | null
  /** Id en la fuente. Ver `claveDeMovimiento` cuando la fuente no trae uno. */
  externalId: string
  /** `YYYY-MM-DD`. */
  fecha: string
  descripcion: string
  /** Con signo. */
  monto: number
  moneda: string
}

/** Un pago del sistema, reducido a lo que hace falta para emparejarlo. */
export interface PagoConciliable {
  id: string
  /** Referencia de la pasarela, cuando el pago nació de una. */
  externalId: string | null
  /** `YYYY-MM-DD` en que se registró. */
  fecha: string
  /** Importe realmente movido, en `moneda`. */
  monto: number
  moneda: string
}

/* ──────────────────────────────────────────── clave de idempotencia ──── */

/**
 * Arma un identificador determinístico para una fuente que no trae uno.
 *
 * Los extractos de banco a veces no traen número de operación. Sin un id, volver
 * a importar el mismo archivo —cosa que pasa, porque nadie se acuerda de si ya lo
 * subió— duplicaría todos los movimientos y el mes cerraría al doble.
 *
 * ⚠️ **`ordinal` no es decoración.** Dos movimientos idénticos el mismo día son
 * legítimos: dos cafés de $3.500, dos transferencias iguales a la misma persona.
 * Si la clave fuera sólo fecha+importe+descripción, el segundo chocaría con el
 * primero y **se perdería en silencio**, que es exactamente el fallo que la
 * idempotencia venía a evitar. Con el ordinal, la segunda ocurrencia dentro del
 * mismo archivo tiene su propia clave, y reimportar el archivo entero sigue dando
 * las mismas dos.
 *
 * Esto obliga a que el importador numere las repeticiones **en el orden del
 * archivo**, que es estable porque el archivo es el mismo.
 */
export function claveDeMovimiento(
  m: Pick<MovimientoExterno, 'fecha' | 'monto' | 'descripcion'>,
  ordinal: number,
): string {
  const desc = m.descripcion.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 80)
  const monto = m.monto.toFixed(2)
  return ordinal > 1 ? `${m.fecha}|${monto}|${desc}#${ordinal}` : `${m.fecha}|${monto}|${desc}`
}

/**
 * Numera las repeticiones de una lista de movimientos y les pone la clave.
 *
 * Se hace en un solo lugar para que el ordinal no dependa de que cada llamador se
 * acuerde de llevar la cuenta. Los movimientos que **ya traen** id de la fuente lo
 * conservan: el de la fuente siempre es mejor que uno derivado.
 */
export function conClaves(
  movimientos: readonly Omit<MovimientoExterno, 'externalId'>[],
  idsDeLaFuente: readonly (string | null)[] = [],
): MovimientoExterno[] {
  const vistos = new Map<string, number>()

  return movimientos.map((m, i) => {
    const propio = idsDeLaFuente[i]
    if (propio) return { ...m, externalId: propio }

    const base = claveDeMovimiento(m, 1)
    const veces = (vistos.get(base) ?? 0) + 1
    vistos.set(base, veces)
    return { ...m, externalId: claveDeMovimiento(m, veces) }
  })
}

/* ────────────────────────────────────────────────────── emparejamiento ──── */

/**
 * Días de diferencia tolerados entre el pago y el movimiento.
 *
 * La pasarela acredita en la cuenta con demora —MercadoPago liquida a los 2 días
 * hábiles en su plan estándar, y una transferencia de un viernes aparece el
 * lunes—, así que exigir la misma fecha no encontraría casi nada. Cinco días
 * cubren un fin de semana largo sin llegar a mezclar dos semanas distintas.
 */
export const DIAS_TOLERANCIA = 5

export type MotivoCoincidencia = 'referencia' | 'importe_y_fecha'

/** Qué tan seguro es el emparejamiento. */
export type Confianza = 'exacta' | 'probable'

export interface Candidato {
  pagoId: string
  motivo: MotivoCoincidencia
  confianza: Confianza
  /** Días entre el pago y el movimiento. Se muestra para poder dudar. */
  diasDeDiferencia: number
}

function aDias(fecha: string): number {
  const t = Date.parse(`${fecha}T00:00:00Z`)
  return Number.isNaN(t) ? Number.NaN : Math.floor(t / 86_400_000)
}

/** Compara importes al centavo, sin el error de coma flotante de `toFixed`. */
function mismoImporte(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * Candidatos para un movimiento, del más confiable al menos.
 *
 * ── Los dos caminos, y por qué son distintos ────────────────────────────────
 *
 * 1. **Por referencia** (`exacta`): el movimiento trae el `external_id` con el que
 *    la pasarela identificó el cobro, y hay un pago con esa misma referencia. No
 *    hay ambigüedad posible; es el único caso que un automatismo puede cerrar solo.
 * 2. **Por importe y fecha** (`probable`): coincide el importe en la misma moneda y
 *    la fecha cae dentro de la tolerancia. **Nunca alcanza para conciliar solo.**
 *    Dos huéspedes que pagan la misma seña el mismo día es lo más común del mundo,
 *    y casar el cobro con la reserva equivocada deja a una persona figurando
 *    impaga y a otra pagada sin haber pagado.
 *
 * Los egresos no se emparejan contra nada: un pago del hotel no tiene contrapartida
 * en `pagos`, que es la tabla de lo que el hotel **cobra**. Devolver candidatos ahí
 * sería ofrecer casar un gasto con un cobro.
 */
export function emparejar(
  movimiento: Pick<MovimientoExterno, 'externalId' | 'fecha' | 'monto' | 'moneda'>,
  pagos: readonly PagoConciliable[],
): Candidato[] {
  if (!(movimiento.monto > 0)) return []

  const dia = aDias(movimiento.fecha)
  if (Number.isNaN(dia)) return []

  const candidatos: Candidato[] = []

  for (const p of pagos) {
    const diaPago = aDias(p.fecha)
    const dias = Number.isNaN(diaPago) ? Number.POSITIVE_INFINITY : Math.abs(dia - diaPago)

    if (p.externalId && p.externalId === movimiento.externalId) {
      candidatos.push({
        pagoId: p.id,
        motivo: 'referencia',
        confianza: 'exacta',
        diasDeDiferencia: Number.isFinite(dias) ? dias : 0,
      })
      continue
    }

    if (
      p.moneda === movimiento.moneda &&
      mismoImporte(p.monto, movimiento.monto) &&
      dias <= DIAS_TOLERANCIA
    ) {
      candidatos.push({
        pagoId: p.id,
        motivo: 'importe_y_fecha',
        confianza: 'probable',
        diasDeDiferencia: dias,
      })
    }
  }

  // Primero las exactas; entre las probables, la más cercana en el tiempo.
  return candidatos.sort((a, b) => {
    if (a.confianza !== b.confianza) return a.confianza === 'exacta' ? -1 : 1
    return a.diasDeDiferencia - b.diasDeDiferencia
  })
}

/**
 * El candidato que un automatismo puede cerrar sin preguntar. `null` si ninguno.
 *
 * Sólo la referencia de la pasarela califica, y sólo si es **una sola**: dos pagos
 * con la misma referencia externa significan que algo está mal en los datos, y
 * conciliar contra cualquiera de los dos elegiría al azar.
 */
export function coincidenciaAutomatica(candidatos: readonly Candidato[]): Candidato | null {
  const exactas = candidatos.filter((c) => c.confianza === 'exacta')
  return exactas.length === 1 ? exactas[0] : null
}

/* ────────────────────────────────────────────────── gastos del mes ──── */

export interface GastoMensual {
  /** `YYYY-MM`. */
  mes: string
  /** Suma de los egresos del mes, en positivo para poder leerla. */
  egresos: number
  /** Suma de lo que entró. */
  ingresos: number
  /** Ingresos − egresos. Positivo = el mes cerró a favor. */
  neto: number
  movimientos: number
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Agrupa movimientos por mes.
 *
 * Es el objetivo 10 del pedido —«ver los gastos mensuales»— y por eso los egresos
 * se devuelven **en positivo**: nadie lee «gastos: −1.482.300» sin dudar del signo.
 * El neto conserva el signo, que ahí sí significa algo.
 *
 * ⚠️ Sólo agrupa lo que recibe. Movimientos de monedas distintas **no se suman**:
 * quien llama filtra por moneda antes, o mezcla pesos con dólares en un total que
 * no significa nada. La pantalla lo hace por moneda.
 */
export function gastosPorMes(
  movimientos: readonly Pick<MovimientoExterno, 'fecha' | 'monto'>[],
): GastoMensual[] {
  const porMes = new Map<string, { egresos: number; ingresos: number; movimientos: number }>()

  for (const m of movimientos) {
    if (!/^\d{4}-\d{2}/.test(m.fecha)) continue
    if (!Number.isFinite(m.monto)) continue

    const mes = m.fecha.slice(0, 7)
    const acc = porMes.get(mes) ?? { egresos: 0, ingresos: 0, movimientos: 0 }
    if (m.monto < 0) acc.egresos += -m.monto
    else acc.ingresos += m.monto
    acc.movimientos += 1
    porMes.set(mes, acc)
  }

  return [...porMes.entries()]
    .map(([mes, a]) => ({
      mes,
      egresos: redondear(a.egresos),
      ingresos: redondear(a.ingresos),
      neto: redondear(a.ingresos - a.egresos),
      movimientos: a.movimientos,
    }))
    .sort((a, b) => b.mes.localeCompare(a.mes))
}

/**
 * Agrupa los egresos de un período por concepto.
 *
 * El concepto sale de la descripción del banco, que es texto libre y ruidoso
 * («COMPRA TARJ DEB 1234 SUPERMERCADO LA ANONIMA 05/09»). No se intenta
 * clasificar automáticamente —un clasificador que se equivoca esconde el gasto en
 * la categoría equivocada, que es peor que no tener categorías—: se agrupa por las
 * primeras palabras significativas, que en la práctica alcanzan para ver dónde se
 * va la plata.
 */
export function egresosPorConcepto(
  movimientos: readonly Pick<MovimientoExterno, 'descripcion' | 'monto'>[],
  limite = 10,
): { concepto: string; total: number; movimientos: number }[] {
  const porConcepto = new Map<string, { total: number; movimientos: number }>()

  for (const m of movimientos) {
    if (!Number.isFinite(m.monto) || m.monto >= 0) continue

    const concepto = resumirConcepto(m.descripcion)
    const acc = porConcepto.get(concepto) ?? { total: 0, movimientos: 0 }
    acc.total += -m.monto
    acc.movimientos += 1
    porConcepto.set(concepto, acc)
  }

  return [...porConcepto.entries()]
    .map(([concepto, a]) => ({ concepto, total: redondear(a.total), movimientos: a.movimientos }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limite)
}

/**
 * Reduce una descripción de banco a algo agrupable.
 *
 * Saca los números —importes, cuentas, fechas y cupones, que hacen única cada
 * línea— y se queda con las tres primeras palabras. «COMPRA TARJ DEB 1234
 * ANONIMA 05/09» y «COMPRA TARJ DEB 9876 ANONIMA 12/09» caen juntas.
 */
export function resumirConcepto(descripcion: string): string {
  const limpio = descripcion
    .normalize('NFD')
    // Por punto de código, igual que en `normalizarEncabezado`: así el archivo
    // fuente no depende de cómo se guardó su codificación.
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2)

  const resumen = limpio.slice(0, 3).join(' ')
  return resumen || 'Sin descripción'
}
