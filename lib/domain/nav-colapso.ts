/**
 * Colapso del menú lateral a solo íconos (lógica pura).
 *
 * Mismo criterio que `nav-plegado.ts` para los grupos, pero acá es la barra
 * entera: alguien que ya conoce las secciones puede angostarla a un ancho
 * fijo de solo íconos para ganar lugar en las pantallas de trabajo —la
 * grilla de ocupación, el listado de reservas— sin perder la navegación (las
 * etiquetas siguen disponibles como `title` al pasar el mouse).
 *
 * El ancho arrastrable (`lateral.ts`) es independiente y no se toca: al
 * volver a expandir, el menú recupera el ancho que tenía, no el de diseño.
 */

export const CLAVE_COLAPSADO = 'bp:nav-colapsado'

/** Ancho fijo en modo colapsado: ícono + relleno, sin lugar para etiqueta. */
export const ANCHO_COLAPSADO = 68

/** Interpreta lo guardado en el navegador. Cualquier cosa que no sea `'1'` es "expandido". */
export function leerColapsadoGuardado(crudo: string | null): boolean {
  return crudo === '1'
}
