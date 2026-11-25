/**
 * Formato de nombre de huésped, común a todo el panel.
 *
 * `huespedes.nombre` es `not null` (migración 0004), pero la reserva rápida
 * de mostrador —«Solo el apellido es obligatorio», `app/panel/reservas/
 * actions.ts`— deja `nombre` vacío y lo completa con el apellido para poder
 * insertar igual. El dato en la base es correcto; lo que no servía era
 * repetirlo al mostrarlo: «ZZZ-Promo, ZZZ-Promo» se lee como un bug aunque
 * no lo sea (auditoría QA/UX 2026-10-14). Acá se colapsa a un solo valor.
 */
export function nombreCompleto(h: { apellido?: string; nombre?: string }): string {
  const apellido = (h.apellido ?? '').trim()
  const nombre = (h.nombre ?? '').trim()
  if (!nombre || nombre.toLowerCase() === apellido.toLowerCase()) return apellido
  return `${apellido}, ${nombre}`
}

/**
 * Iniciales del huésped para el círculo del listado de reservas: nombre y
 * apellido («María Pérez» → «MP»). Con el nombre vacío o repetido (la reserva
 * rápida de mostrador, ver arriba) se usan las dos primeras letras del apellido.
 * Considera la primera letra de cada palabra con su acento, en mayúscula.
 */
export function iniciales(h: { apellido?: string; nombre?: string }): string {
  const apellido = (h.apellido ?? '').trim()
  const nombre = (h.nombre ?? '').trim()
  const primera = (t: string) => Array.from(t)[0] ?? ''
  if (!nombre || nombre.toLowerCase() === apellido.toLowerCase()) {
    return Array.from(apellido).slice(0, 2).join('').toLocaleUpperCase('es') || '?'
  }
  return (primera(nombre) + primera(apellido)).toLocaleUpperCase('es') || '?'
}
