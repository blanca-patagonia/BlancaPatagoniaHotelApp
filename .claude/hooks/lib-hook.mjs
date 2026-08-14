/**
 * Utilidades compartidas por los hooks.
 *
 * Por qué los hooks están en Node y no en bash: se ejecutan con un PATH mínimo,
 * sin el perfil del shell interactivo. Herramientas instaladas por Homebrew
 * —`rg`, `fd`— NO están disponibles ahí. Un `rg ... && bloquear` con `rg`
 * ausente falla en silencio y el hook deja pasar todo creyéndose activo, que es
 * la peor falla posible en una guarda: aparenta protección donde no hay.
 *
 * Node sí está garantizado: es el runtime del proyecto.
 */

/** Lee el JSON del evento desde stdin. Devuelve {} si no se puede parsear. */
export async function leerEvento() {
  const trozos = []
  for await (const t of process.stdin) trozos.push(t)
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8')) ?? {}
  } catch {
    return {}
  }
}

/**
 * Bloquea la llamada a la herramienta.
 *
 * El código 2 es el que Claude Code interpreta como «no ejecutes esto». El
 * mensaje va a stderr y siempre dice qué se bloqueó y cómo seguir: una guarda
 * que solo dice «no» entrena al equipo a desactivarla.
 */
export function bloquear({ que, detalle, comoSeguir }) {
  console.error(`BLOQUEADO: ${que}`)
  if (detalle) console.error(detalle)
  if (comoSeguir) console.error(`Cómo seguir: ${comoSeguir}`)
  process.exit(2)
}

/** Deja pasar. */
export function permitir() {
  process.exit(0)
}
