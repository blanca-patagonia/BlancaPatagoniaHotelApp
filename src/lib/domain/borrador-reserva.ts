/**
 * Borrador del alta de reserva de mostrador (auditoría de calidad 2026-09-09).
 *
 * `app/panel/reservas/nueva` son 6 pasos en una sola pantalla. Antes, volver
 * atrás por error —o cambiar la fecha del paso 1, que recarga la página
 * entera con un GET— perdía todo lo cargado en los pasos 2 a 6, sin aviso.
 *
 * Este módulo es la única lógica pura: la clave de `sessionStorage` con la
 * que se guarda el borrador. `sessionStorage` y no `localStorage` a
 * propósito: en una recepción con la computadora compartida entre turnos, un
 * borrador con el nombre de un huésped no debería sobrevivir a que alguien
 * cierre la pestaña, ni verse desde otra pestaña abierta al mismo tiempo.
 *
 * La lectura/escritura real vive en el componente cliente (`formulario.tsx`),
 * porque `sessionStorage` no existe fuera del navegador.
 */

/** Un borrador es scoped a la búsqueda exacta: otras fechas, otro borrador. */
export function claveBorradorReserva(
  checkIn: string,
  checkOut: string,
  huespedes: number,
): string {
  return `borrador-reserva-nueva:${checkIn}:${checkOut}:${huespedes}`
}
