/**
 * Reglas de la cuenta propia (lógica pura).
 *
 * Vive acá y no en la Server Action para poder probar los casos de borde sin
 * base ni sesión, que es la convención del proyecto: las acciones orquestan, el
 * dominio decide.
 */

/**
 * Largo mínimo de una contraseña.
 *
 * Es el mínimo que impone Supabase Auth por defecto. Se declara acá para que el
 * mensaje que ve el usuario y la regla que aplica la plataforma no se separen:
 * si el formulario aceptara 5 caracteres, el error llegaría recién del servidor
 * y en inglés.
 */
export const LARGO_MINIMO_PASSWORD = 6

export interface CambioPassword {
  actual: string
  nueva: string
  repetida: string
}

/**
 * Devuelve el problema encontrado, o `null` si el cambio es válido.
 *
 * Un solo mensaje por vez y en español: enumerar tres errores juntos obliga a
 * leer una lista para entender qué hay que corregir.
 */
export function validarCambioPassword({ actual, nueva, repetida }: CambioPassword): string | null {
  if (!actual) return 'Escribí tu contraseña actual.'
  if (!nueva) return 'Escribí la contraseña nueva.'

  if (nueva.length < LARGO_MINIMO_PASSWORD) {
    return `La contraseña nueva tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`
  }

  if (nueva !== repetida) return 'La contraseña nueva y su repetición no coinciden.'

  // Cambiar por la misma no falla en Supabase, pero deja a quien lo hizo
  // creyendo que rotó la clave cuando no cambió nada. Es peor que un error.
  if (nueva === actual) return 'La contraseña nueva tiene que ser distinta de la actual.'

  return null
}

/* ─────────────────────────── datos propios del staff ─────────────────────── */

export const LARGO_MAXIMO_NOMBRE = 80
export const LARGO_MAXIMO_TELEFONO = 40

/**
 * Valida los datos que cada uno puede cambiar de su propio perfil.
 *
 * Devuelve el motivo del rechazo, o `null` si están bien.
 *
 * El nombre es obligatorio porque se usa en todos lados —quién firmó un cambio,
 * quién dejó un aviso, quién hizo el check-in—: un perfil sin nombre convierte
 * el rastro de auditoría en una lista de identificadores. El teléfono es
 * opcional y no se valida el formato: los internos, los celulares con
 * característica y los números del exterior se escriben distinto, y un patrón
 * estricto solo logra que la gente no lo cargue.
 */
export function validarMisDatos(nombre: string, telefono: string): string | null {
  const n = nombre.trim()
  if (!n) return 'Escribí tu nombre.'
  if (n.length > LARGO_MAXIMO_NOMBRE) {
    return `El nombre no puede tener más de ${LARGO_MAXIMO_NOMBRE} caracteres.`
  }
  if (telefono.trim().length > LARGO_MAXIMO_TELEFONO) {
    return `El teléfono no puede tener más de ${LARGO_MAXIMO_TELEFONO} caracteres.`
  }
  return null
}
