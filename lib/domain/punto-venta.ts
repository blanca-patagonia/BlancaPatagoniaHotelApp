/**
 * Reglas del punto de venta (lógica pura).
 *
 * ── Qué resuelve ────────────────────────────────────────────────────────────
 *
 * Hasta ahora un consumo se cargaba de a uno desde el detalle de la reserva.
 * Cerrar un frigobar de cinco artículos eran cinco operaciones, y las cinco líneas
 * quedaban sueltas: no había forma de saber que fueron el mismo recuento ni de
 * anular el recuento entero si se cargó en la habitación equivocada.
 *
 * Este módulo modela la **comanda**: un conjunto de líneas que se cargan juntas,
 * con su total, sus validaciones y su número.
 */

/* ──────────────────────────────────────────────────── departamentos ──── */

/**
 * NOTA HISTÓRICA — por qué acá ya no hay una lista de puntos de venta.
 *
 * El paso 7 declaró acá una constante `PUNTOS_VENTA` con cinco valores fijos
 * (recepción, frigobar, room service, restaurante, excursiones) y una columna
 * `consumos.punto` para guardarla. El paso 8 creó la tabla `departamentos`, con
 * jerarquía de dos niveles y editable por el hotel, y agregó
 * `consumos.departamento_id`.
 *
 * Quedaron **dos clasificaciones para el mismo dato**, y nada impedía que se
 * contradijeran: una línea con `punto = 'frigobar'` y el departamento apuntando a
 * «Restaurante» era posible, y los reportes por sector habrían dado dos números
 * distintos según cuál columna mirara quien los escribiera.
 *
 * La migración 0044 eliminó `punto`. Gana `departamentos` porque tiene jerarquía,
 * la puede editar el hotel sin una migración por sector nuevo, y es lo que ya usa
 * la cuenta del huésped para agrupar — o sea, el consumidor real del dato.
 *
 * El departamento de cada línea sale del **producto**
 * (`productos_servicios.departamento_id`) y se copia al consumo, así que la grilla
 * no necesita preguntarlo.
 */

/* ────────────────────────────────────────────────────────── comanda ──── */

/** Una línea de la comanda, tal como la arma la pantalla. */
export interface LineaComanda {
  productoId: string
  nombre: string
  cantidad: number
  precioUnitario: number
  /** Stock disponible, si el producto lo controla. `null` = no lleva control. */
  stock?: number | null
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function subtotalLinea(l: Pick<LineaComanda, 'cantidad' | 'precioUnitario'>): number {
  if (!Number.isFinite(l.cantidad) || !Number.isFinite(l.precioUnitario)) return 0
  return redondear(Math.max(0, l.cantidad) * Math.max(0, l.precioUnitario))
}

export function totalComanda(lineas: readonly LineaComanda[]): number {
  return redondear(lineas.reduce((acc, l) => acc + subtotalLinea(l), 0))
}

/** Sólo las líneas con cantidad: la grilla muestra todo el catálogo en cero. */
export function lineasCargadas(lineas: readonly LineaComanda[]): LineaComanda[] {
  return lineas.filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0)
}

/**
 * Devuelve los motivos por los que la comanda NO se puede cerrar.
 *
 * Vacío = se puede. Se valida antes de escribir nada: una comanda a medias en la
 * cuenta del huésped es peor que una comanda rechazada, porque hay que descubrirla
 * para poder corregirla.
 */
export function validarComanda(lineas: readonly LineaComanda[]): string[] {
  const motivos: string[] = []
  const cargadas = lineasCargadas(lineas)

  if (cargadas.length === 0) {
    motivos.push('Cargá al menos un producto con cantidad mayor que cero.')
    return motivos
  }

  for (const l of cargadas) {
    if (!Number.isInteger(l.cantidad)) {
      motivos.push(`La cantidad de «${l.nombre}» tiene que ser un número entero.`)
    }
    // El stock se comprueba acá y no sólo en la base: el mensaje puede decir
    // cuánto hay, que es lo que quien está en el mostrador necesita saber para
    // resolverlo con el huésped enfrente.
    if (l.stock != null && l.cantidad > l.stock) {
      motivos.push(`De «${l.nombre}» quedan ${l.stock} y se cargaron ${l.cantidad}.`)
    }
  }

  return motivos
}

/**
 * Filtra el catálogo por el término del buscador.
 *
 * Compara sin acentos y sin distinguir mayúsculas: quien busca «cafe» tiene que
 * encontrar «Café». Es la misma normalización que usa el lector de CSV de canales,
 * y por el mismo motivo — nadie escribe los acentos cuando busca rápido.
 */
export function filtrarCatalogo<T extends { nombre: string; codigo?: string }>(
  productos: readonly T[],
  termino: string,
): T[] {
  const t = normalizar(termino)
  if (!t) return [...productos]
  return productos.filter(
    (p) => normalizar(p.nombre).includes(t) || normalizar(p.codigo ?? '').includes(t),
  )
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
