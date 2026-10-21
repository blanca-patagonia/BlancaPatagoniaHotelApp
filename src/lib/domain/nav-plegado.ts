/**
 * Plegado de los grupos del menú lateral (lógica pura).
 *
 * El menú se agrupó por momento de uso en la Fase 22 (`navegacion.ts`), pero
 * los cinco grupos quedaban siempre abiertos: alguien que ya sabe dónde está
 * todo seguía viendo las 18 etiquetas enteras, solo que ahora partidas en
 * bloques. Esto guarda **qué grupos están plegados**, por título, para que
 * cada persona pueda dejar cerrado lo que no usa (housekeeping no entra nunca
 * a «Comercial») sin que eso le pase lo mismo a otra sesión en otra máquina.
 *
 * Se guarda la lista de plegados y no la de abiertos porque el estado por
 * omisión es «todo abierto»: un menú nuevo, sin preferencia guardada todavía,
 * tiene que mostrar toda la navegación, no esconderla hasta que alguien la
 * despliegue a mano.
 */

export const CLAVE_PLEGADO = 'bp:nav-plegado'

/** Pliega o despliega un grupo, sin duplicar el título si ya estaba plegado. */
export function alternarGrupo(plegados: readonly string[], titulo: string): string[] {
  return plegados.includes(titulo)
    ? plegados.filter((t) => t !== titulo)
    : [...plegados, titulo]
}

export function estaPlegado(plegados: readonly string[], titulo: string): boolean {
  return plegados.includes(titulo)
}

/**
 * Interpreta lo guardado en el navegador.
 *
 * `localStorage` devuelve texto y puede estar vacío, corrupto, o escrito a
 * mano desde las herramientas del navegador con algo que no es un arreglo de
 * strings. Cualquier cosa que no sea eso vuelve a «todo abierto» en vez de
 * romper el menú.
 */
export function leerPlegadosGuardado(crudo: string | null): string[] {
  if (crudo === null || crudo.trim() === '') return []
  try {
    const valor: unknown = JSON.parse(crudo)
    if (!Array.isArray(valor)) return []
    return valor.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}
