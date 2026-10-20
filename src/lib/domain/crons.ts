/**
 * Las tareas programadas y cada cuánto tienen que correr (`vercel.json`).
 *
 * `tolerancia` es cuánto puede pasar sin una corrida correcta antes de avisar:
 * la frecuencia más un margen, para que un reintento o una demora de la
 * plataforma no dispare una alarma falsa.
 */
export const CRONS = {
  notificaciones: { etiqueta: 'Envío de avisos', toleranciaMin: 30 },
  salud: { etiqueta: 'Chequeo de salud', toleranciaMin: 60 },
  mantenimiento: { etiqueta: 'Mantenimiento diario (expirar reservas, purgas)', toleranciaMin: 26 * 60 },
  recordatorios: { etiqueta: 'Recordatorios a huéspedes', toleranciaMin: 26 * 60 },
  canales: { etiqueta: 'Sincronización con canales', toleranciaMin: 26 * 60 },
  ari: { etiqueta: 'Publicación de disponibilidad', toleranciaMin: 26 * 60 },
} as const

export type NombreCron = keyof typeof CRONS

/**
 * Las tareas que llevan demasiado sin una corrida correcta.
 *
 * Una tarea que nunca corrió (sin fila) también cuenta: es justo el caso de un
 * cron que no se configuró. `ahora` es un parámetro para poder fijarlo en los tests.
 */
export function cronsAtrasados(
  corridas: readonly { nombre: string; ultima_ok: string | null }[],
  ahora: Date,
): { nombre: NombreCron; etiqueta: string; ultimaOk: string | null }[] {
  const porNombre = new Map(corridas.map((c) => [c.nombre, c.ultima_ok]))
  return (Object.keys(CRONS) as NombreCron[])
    .filter((n) => {
      const ultima = porNombre.get(n)
      if (!ultima) return true
      return ahora.getTime() - Date.parse(ultima) > CRONS[n].toleranciaMin * 60_000
    })
    .map((n) => ({ nombre: n, etiqueta: CRONS[n].etiqueta, ultimaOk: porNombre.get(n) ?? null }))
}
