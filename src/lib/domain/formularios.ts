/**
 * Lo que la persona escribió en un formulario, para devolvérselo si la acción
 * falla.
 *
 * Por qué existe: React 19 **resetea** el `<form action={…}>` después de cada
 * envío. Si la Server Action responde `{ error }`, el mensaje aparece arriba
 * de un formulario vacío y hay que volver a tipear todo —en un alta de agencia
 * o de contrato, una docena de campos— por un CUIT mal puesto. Para gente que
 * no usa mucho la computadora (principio de la Fase 15) eso es abandonar la
 * carga. La acción devuelve estos valores y el formulario los usa como
 * `defaultValue`.
 *
 * Nunca se devuelven campos sensibles (contraseñas, tokens): viajan de vuelta
 * al navegador dentro del estado de la acción y quedan en el árbol de React.
 */

/** Valores enviados, por nombre de campo. Siempre texto, como en el formulario. */
export type ValoresFormulario = Partial<Record<string, string>>

/**
 * Nombres que no se reponen nunca, aunque la acción no los excluya. Se compara
 * por inclusión: `password_confirmacion` o `token_portal` también quedan fuera.
 */
const SENSIBLES = ['password', 'contrasena', 'contraseña', 'clave', 'token', 'secret', 'cvv', 'tarjeta']

export function esCampoSensible(nombre: string): boolean {
  const n = nombre.toLowerCase()
  return SENSIBLES.some((s) => n.includes(s))
}

/**
 * Copia los campos de texto de un `FormData`.
 *
 * - Los archivos se omiten: no se pueden reponer en un `<input type="file">`.
 * - Los campos internos de Next (`$ACTION_…`) se omiten.
 * - Un nombre repetido (casillas múltiples) queda con sus valores unidos por
 *   coma; el formulario que lo necesite lo separa.
 */
export function valoresDelFormulario(
  formData: FormData,
  excluir: readonly string[] = [],
): ValoresFormulario {
  const valores: Record<string, string> = {}
  for (const [nombre, valor] of formData.entries()) {
    if (typeof valor !== 'string') continue
    if (nombre.startsWith('$ACTION')) continue
    if (excluir.includes(nombre) || esCampoSensible(nombre)) continue
    valores[nombre] = nombre in valores ? `${valores[nombre]},${valor}` : valor
  }
  return valores
}

/**
 * El estado de error de una acción, con lo que se había escrito.
 *
 * `return fallo('Ingresá el nombre.', formData)` en vez de
 * `return { error: 'Ingresá el nombre.' }`.
 */
export function falloConValores(
  error: string,
  formData: FormData,
  excluir: readonly string[] = [],
): { error: string; valores: ValoresFormulario } {
  return { error, valores: valoresDelFormulario(formData, excluir) }
}
