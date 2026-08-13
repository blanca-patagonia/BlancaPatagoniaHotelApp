import 'server-only'
import { redirect } from 'next/navigation'

/**
 * Utilidades para las Server Actions que terminan en `redirect()`.
 *
 * Por qué existe: las acciones que devuelven estado (`Promise<EstadoX>`) pueden
 * informar un fallo con `return { error: … }`, pero las que redirigen no tienen
 * valor de retorno. En la práctica eso derivó en escrituras cuyo resultado se
 * descartaba:
 *
 *     await supabase.from('avisos').delete().eq('id', id)
 *     redirect('/panel/avisos')
 *
 * Si la base rechaza —por RLS, por un trigger, por un corte—, la pantalla
 * recarga sin cambios y **sin un solo mensaje**. Quien lo usa no puede
 * distinguir «no se pudo» de «no pasó nada», que es justo lo que el proyecto
 * decidió no hacer: nada oculto.
 */

/** Lo mínimo que se necesita de un error de PostgREST. */
interface ErrorDeBase {
  message: string
}

/**
 * Corta la acción con un mensaje si la escritura falló.
 *
 * Si `error` es nulo no hace nada y la acción sigue. Si no, **lanza** (vía
 * `redirect`) y manda a `destino` con `?error=<motivo>`, que es la convención
 * que ya usa el panel para estos avisos.
 *
 * El mensaje real de la base va al log del servidor y **no** a la URL: al
 * usuario le sirve saber qué operación falló, no leer «duplicate key value
 * violates unique constraint». Sin el log, en cambio, la causa se perdería y el
 * fallo sería imposible de diagnosticar.
 *
 * @param motivo slug corto para el mapa `MENSAJES_ERROR` de la pantalla
 *   destino. Si la pantalla no lo tiene mapeado, su fallback ya muestra un
 *   mensaje genérico, así que agregar un motivo nuevo nunca deja al usuario sin
 *   respuesta.
 */
export function cortarSiFalla(
  error: ErrorDeBase | null | undefined,
  destino: string,
  motivo = 'guardar',
): void {
  if (!error) return
  console.error(`No se pudo completar «${motivo}» en ${destino}:`, error.message)
  redirect(`${destino}?error=${motivo}`)
}
