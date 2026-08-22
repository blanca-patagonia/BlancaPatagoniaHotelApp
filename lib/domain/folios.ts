/**
 * Folios de la cuenta del huésped (lógica pura).
 *
 * ── Qué es un folio y por qué hacen falta dos ────────────────────────────────
 *
 * Un folio es una cuenta dentro de la misma estadía. El caso que los justifica es
 * corriente: el huésped viene por una empresa que paga la habitación, y él paga sus
 * consumos. Con una sola cuenta hay que emitir una factura y después pedirle al
 * huésped que le devuelva la mitad a la empresa.
 *
 *   · **Folio A** — lo que paga el titular de la reserva.
 *   · **Folio B** — lo que paga un tercero (empresa, agencia, acompañante).
 *
 * El **split** es mover cargos de un folio al otro.
 *
 * Dos folios y no cinco: es el caso real del hotel, y cada folio extra multiplica
 * las pantallas, los totales y los caminos de facturación.
 *
 * ── La invariante que este módulo protege ───────────────────────────────────
 *
 * **La suma de los folios es siempre igual al total general.** Un cargo tiene que
 * estar en exactamente un folio: si el split puede perder o duplicar una línea, la
 * cuenta deja de cerrar y nadie sabe dónde está el error. Hay tests que lo fijan.
 */

/** Los folios que existen. */
export const FOLIOS = ['A', 'B'] as const
export type Folio = (typeof FOLIOS)[number]

export const ETIQUETAS_FOLIO: Record<Folio, string> = {
  A: 'Folio A — titular',
  B: 'Folio B — tercero',
}

export function esFolio(v: string): v is Folio {
  return (FOLIOS as readonly string[]).includes(v)
}

/** El folio contrario, para el botón de mover. */
export function folioOpuesto(f: Folio): Folio {
  return f === 'A' ? 'B' : 'A'
}

/* ──────────────────────────────────────────────────── líneas de la cuenta ──── */

/**
 * Una línea de la cuenta.
 *
 * Es deliberadamente uniforme: el alojamiento, los consumos y los anticipos se
 * modelan igual. Así la pantalla los ordena y los suma con el mismo código, y no
 * hay tres formas distintas de calcular un total.
 */
export interface LineaCuenta {
  id: string
  /** Qué tipo de movimiento es. Decide el signo y el orden. */
  clase: 'alojamiento' | 'consumo' | 'anticipo'
  fecha: string
  concepto: string
  /** Comprobante externo, si hay (ticket, voucher). */
  comprobante: string
  /** Departamento, ya resuelto a texto legible. */
  departamento: string
  /** Subdepartamento, o cadena vacía si la línea cuelga del departamento. */
  subdepartamento: string
  folio: Folio
  cantidad: number
  /** Importe unitario en USD. Los anticipos vienen en negativo. */
  importeUnitario: number
  /** Moneda en que se cobró, si no fue USD. */
  monedaOrigen?: string | null
  importeOrigen?: number | null
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function importeLinea(l: Pick<LineaCuenta, 'cantidad' | 'importeUnitario'>): number {
  if (!Number.isFinite(l.cantidad) || !Number.isFinite(l.importeUnitario)) return 0
  return redondear(l.cantidad * l.importeUnitario)
}

/* ───────────────────────────────────────────────────────────── totales ──── */

export interface TotalesFolio {
  folio: Folio
  /** Alojamiento + consumos, sin descontar anticipos. */
  cargos: number
  /** Anticipos y pagos imputados a este folio, en positivo. */
  anticipos: number
  /** Lo que queda por cobrar. Nunca negativo. */
  saldo: number
  /** Cantidad de líneas de cargo. */
  lineas: number
}

/**
 * Totales de un folio.
 *
 * El saldo no baja de cero: si alguien pagó de más, el excedente es un asunto de
 * devolución, no un saldo negativo que después alguien resta del otro folio y
 * descuadra la cuenta.
 */
export function totalesDeFolio(lineas: readonly LineaCuenta[], folio: Folio): TotalesFolio {
  let cargos = 0
  let anticipos = 0
  let cuenta = 0

  for (const l of lineas) {
    if (l.folio !== folio) continue
    const importe = importeLinea(l)

    if (l.clase === 'anticipo') {
      // Los anticipos se guardan en negativo para que sumar la columna dé el saldo,
      // pero se muestran en positivo: «anticipo 200», no «anticipo −200».
      anticipos += Math.abs(importe)
    } else {
      cargos += importe
      cuenta++
    }
  }

  return {
    folio,
    cargos: redondear(cargos),
    anticipos: redondear(anticipos),
    saldo: redondear(Math.max(0, cargos - anticipos)),
    lineas: cuenta,
  }
}

export interface TotalesCuenta {
  porFolio: TotalesFolio[]
  /** Suma de los cargos de TODOS los folios. */
  cargos: number
  anticipos: number
  saldo: number
}

/**
 * Totales de la cuenta completa.
 *
 * ⚠️ `cargos` se calcula sobre **todas** las líneas y no sumando los folios, a
 * propósito: si una línea tuviera un folio inválido quedaría afuera de los folios
 * pero dentro del total general, y la diferencia se vería. Sumar los folios la
 * habría escondido.
 */
export function totalesDeCuenta(lineas: readonly LineaCuenta[]): TotalesCuenta {
  const porFolio = FOLIOS.map((f) => totalesDeFolio(lineas, f))

  let cargos = 0
  let anticipos = 0
  for (const l of lineas) {
    const importe = importeLinea(l)
    if (l.clase === 'anticipo') anticipos += Math.abs(importe)
    else cargos += importe
  }

  return {
    porFolio,
    cargos: redondear(cargos),
    anticipos: redondear(anticipos),
    saldo: redondear(Math.max(0, cargos - anticipos)),
  }
}

/**
 * ¿Los folios cierran contra el total general?
 *
 * Es la comprobación de la invariante del módulo. Se expone para que la pantalla
 * pueda avisar si algo no cuadra, en vez de mostrar números que no suman y dejar
 * que quien cobra los descubra frente al huésped.
 *
 * La tolerancia absorbe el redondeo de dividir importes entre folios.
 */
export function foliosCierran(lineas: readonly LineaCuenta[], tolerancia = 0.01): boolean {
  const t = totalesDeCuenta(lineas)
  const sumaFolios = t.porFolio.reduce((acc, f) => acc + f.cargos, 0)
  return Math.abs(redondear(sumaFolios) - t.cargos) <= tolerancia
}

/* ──────────────────────────────────────────────────── agrupar por depto ──── */

export interface GrupoDepartamento {
  departamento: string
  /** Subgrupos, si el departamento tiene subdepartamentos con movimiento. */
  subgrupos: { subdepartamento: string; lineas: LineaCuenta[]; total: number }[]
  /** Líneas que cuelgan del departamento sin subdepartamento. */
  sueltas: LineaCuenta[]
  total: number
}

/**
 * Agrupa las líneas de un folio por departamento y subdepartamento.
 *
 * Es la vista que tenía WinPAX y sirve para lo que el hotel realmente hace con la
 * cuenta: ver cuánto consumió el huésped en el restaurante contra cuánto en el
 * frigobar. Un listado plano de veinte líneas no responde eso.
 *
 * Un departamento sin movimiento **no aparece**: la cuenta muestra lo que pasó, no
 * el organigrama del hotel.
 */
export function agruparPorDepartamento(
  lineas: readonly LineaCuenta[],
  folio?: Folio,
): GrupoDepartamento[] {
  const delFolio = folio ? lineas.filter((l) => l.folio === folio) : [...lineas]
  const porDepto = new Map<string, LineaCuenta[]>()

  for (const l of delFolio) {
    if (l.clase === 'anticipo') continue
    const clave = l.departamento || 'Otros'
    porDepto.set(clave, [...(porDepto.get(clave) ?? []), l])
  }

  const grupos: GrupoDepartamento[] = []

  for (const [departamento, items] of porDepto) {
    const porSub = new Map<string, LineaCuenta[]>()
    const sueltas: LineaCuenta[] = []

    for (const l of items) {
      if (l.subdepartamento) {
        porSub.set(l.subdepartamento, [...(porSub.get(l.subdepartamento) ?? []), l])
      } else {
        sueltas.push(l)
      }
    }

    grupos.push({
      departamento,
      subgrupos: [...porSub.entries()]
        .map(([subdepartamento, ls]) => ({
          subdepartamento,
          lineas: ls,
          total: redondear(ls.reduce((acc, l) => acc + importeLinea(l), 0)),
        }))
        .sort((a, b) => a.subdepartamento.localeCompare(b.subdepartamento)),
      sueltas,
      total: redondear(items.reduce((acc, l) => acc + importeLinea(l), 0)),
    })
  }

  // Alojamiento primero —es el cargo principal— y el resto alfabético.
  return grupos.sort((a, b) => {
    if (a.departamento === 'Alojamiento') return -1
    if (b.departamento === 'Alojamiento') return 1
    return a.departamento.localeCompare(b.departamento)
  })
}

/* ───────────────────────────────────────────────────────────── split ──── */

/**
 * Devuelve el motivo por el que un cargo NO se puede mover de folio, o `null`.
 *
 * Es corto pero existe por una razón concreta: **el alojamiento y los consumos se
 * mueven de formas distintas**. El alojamiento no es una fila de `consumos` —sale
 * de `reservas.total`— así que moverlo cambia `reservas.folio_alojamiento`, no una
 * línea. Y un anticipo no se mueve: está imputado a un pago concreto.
 */
export function puedeMoverDeFolio(linea: Pick<LineaCuenta, 'clase'>): string | null {
  if (linea.clase === 'anticipo') {
    return 'Un anticipo no se mueve de folio: está imputado al pago con que se cobró.'
  }
  return null
}

/**
 * ¿Tiene sentido mostrar el folio B?
 *
 * Si está vacío, mostrarlo es agregarle una columna de ceros a la pantalla de todas
 * las reservas para el caso minoritario. Se muestra cuando hay algo en él o cuando
 * alguien ya declaró un titular.
 */
export function folioBEnUso(lineas: readonly LineaCuenta[], titularB: string): boolean {
  if (titularB.trim().length > 0) return true
  return lineas.some((l) => l.folio === 'B')
}
