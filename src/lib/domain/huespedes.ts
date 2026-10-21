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
