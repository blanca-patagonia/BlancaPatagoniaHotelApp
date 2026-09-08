import { construirQuery } from './listados'

/**
 * A dónde vuelve una acción que se puede pedir desde más de una pantalla.
 *
 * El caso que lo motivó es la mudanza: se pide desde la ficha de la reserva y
 * —arrastrando el bloque— desde la grilla de ocupación (ADR 0033). Volver
 * siempre a la ficha sacaba a recepción de la grilla en la que estaba
 * trabajando, que es justamente la pantalla donde se ve si la mudanza resolvió
 * el problema.
 *
 * ⚠️ **La ruta NO se toma del formulario.** Un campo con «volvé a esta URL» es
 * un redirect abierto: quien consiga que se envíe ese formulario elige a dónde
 * termina la sesión, y el destino puede ser un sitio que imite al panel para
 * pedir la contraseña de nuevo. Lo que viaja es un **token de una lista
 * blanca**, y la ruta se arma acá.
 *
 * Vive en `lib/` y no en `lib/domain/` porque usa `construirQuery`, y la regla
 * del proyecto es que `lib/domain` no dependa de nada. Vive fuera de
 * `lib/acciones.ts` porque ése es `server-only` y esto se puede testear como
 * función pura, que es lo que se quería: la parte peligrosa de este código es
 * una decisión, no una escritura.
 */

export const ORIGENES_MUDANZA = ['reserva', 'ocupacion'] as const
export type OrigenMudanza = (typeof ORIGENES_MUDANZA)[number]

/**
 * Normaliza el token de origen.
 *
 * Cualquier valor que no esté en la lista blanca —incluidos `null`, una URL
 * completa o un `//otro-sitio.com`— cae en `reserva`, que es el destino de
 * siempre. Nunca lanza: un token raro no puede dejar sin completar una mudanza
 * que la base ya aplicó.
 */
export function origenDeMudanza(crudo: unknown): OrigenMudanza {
  return crudo === 'ocupacion' ? 'ocupacion' : 'reserva'
}

/**
 * Filtros de la grilla que se conservan al volver.
 *
 * Viajan en el formulario con prefijo `g_` para no chocar con los campos de la
 * mudanza (`motivo`, `politica_tarifa`…).
 */
export const FILTROS_GRILLA = ['desde', 'dias', 'cat', 'bloque', 'piso', 'hk'] as const

/**
 * La ruta a la que redirigir, con lo que haya que informar (`error`, `ok`).
 *
 * Los valores se codifican con `URLSearchParams` dentro de `construirQuery`, así
 * que un filtro con caracteres raros termina escapado en la query y **no** puede
 * cambiar la ruta.
 */
export function rutaDeRetorno(
  origen: OrigenMudanza,
  reservaId: string,
  filtros: Record<string, string | undefined> = {},
  extra: Record<string, string> = {},
): string {
  if (origen === 'reserva') {
    return `/panel/reservas/${reservaId}${construirQuery({}, extra)}`
  }
  return `/panel/ocupacion${construirQuery(filtros, extra)}`
}

/** Lee los filtros de la grilla de un `FormData`, descartando los vacíos. */
export function filtrosDeGrilla(leer: (clave: string) => unknown): Record<string, string> {
  const filtros: Record<string, string> = {}
  for (const clave of FILTROS_GRILLA) {
    const valor = String(leer(`g_${clave}`) ?? '').trim()
    if (valor) filtros[clave] = valor
  }
  return filtros
}
