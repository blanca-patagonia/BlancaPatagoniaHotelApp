/**
 * Los motivos de rechazo de una promoción, en un solo lugar: los usa la
 * edición (que vuelve por `?error=` al listado) y el alta (que devuelve el
 * texto en el estado de la acción, en su propia pantalla).
 */
export const MENSAJES_PROMOCION: Record<string, string> = {
  promo_codigo: 'El código solo puede tener mayúsculas, números y guiones (por ejemplo VERANO2026).',
  promo_codigo_repetido: 'Ya existe una promoción con ese código.',
  promo_nombre: 'Ingresá un nombre.',
  promo_tipo: 'Elegí porcentaje o monto fijo.',
  promo_valor: 'El valor tiene que ser mayor que cero (y 100 o menos, si es porcentaje).',
  promo_vigencia: 'La fecha "hasta" no puede ser anterior a la fecha "desde".',
  promo_guardar: 'No se pudo guardar. Probá de nuevo.',
}
