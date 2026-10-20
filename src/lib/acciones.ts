import 'server-only'
import { redirect } from 'next/navigation'
import { registrarErrorSync } from '@/lib/registro'

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
  /** Código SQLSTATE de Postgres, cuando lo hay (`23505`, `23503`…). */
  code?: string
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
  // Línea JSON en vez de texto suelto: en el log de una plataforma, con varias
  // peticiones entrelazadas, un mensaje libre no se puede filtrar ni agrupar.
  registrarErrorSync('escritura_fallida', { motivo, destino, detalle: error.message })
  // El destino puede traer su propia query (`?canal=…`, `?vista=…`), y entonces
  // el separador es `&`. Con `?` fijo la URL saldría rota y el parámetro que ya
  // venía se perdería junto con el contexto de la pantalla.
  const separador = destino.includes('?') ? '&' : '?'
  redirect(`${destino}${separador}error=${motivo}`)
}

/**
 * Registra el fallo de una escritura **sin** cortar la acción.
 *
 * Es para las escrituras que no deben decidir el destino de la pantalla:
 *
 * · **Compensaciones.** Cuando un flujo de varios pasos falla y se deshace lo ya
 *   escrito, el error que el usuario tiene que ver es el **original**, no el del
 *   rollback. Si la compensación redirigiera, taparía la causa real.
 * · **Escrituras accesorias**, donde cortar sería peor que seguir: perder un
 *   registro no justifica interrumpirle la operación a quien está trabajando.
 *
 * No es una excusa para tragarse errores: sigue quedando en el log del servidor
 * con su contexto. Lo que cambia es quién decide qué ve el usuario.
 */
export function registrarFalla(error: ErrorDeBase | null | undefined, contexto: string): void {
  if (!error) return
  registrarErrorSync('escritura_accesoria_fallida', { contexto, detalle: error.message })
}

/**
 * El mensaje que ve el usuario cuando una escritura falla, en español.
 *
 * Varias acciones devolvían `No se pudo crear: ${error.message}`, y a la
 * pantalla llegaba Postgres en inglés —«duplicate key value violates unique
 * constraint…»— frente a alguien que no tiene por qué saber qué es una
 * restricción. El detalle técnico va al registro (`/panel/errores`); al
 * usuario, qué pasó y qué puede hacer. Se traducen los casos que tienen
 * arreglo de su lado; el resto es una falla del sistema.
 *
 * `queSeIntento` es la frase sin punto final: «No se pudo crear el huésped».
 */
export function mensajeDeFalla(error: ErrorDeBase, contexto: string, queSeIntento: string): string {
  registrarErrorSync('escritura_fallida', { contexto, codigo: error.code, detalle: error.message })
  switch (error.code) {
    case '23505':
      return `${queSeIntento}: ya existe un registro con esos datos (el mismo código, email o documento).`
    case '23503':
      return `${queSeIntento}: uno de los datos elegidos ya no existe o se está usando en otro lado. Recargá la página y probá de nuevo.`
    case '23502':
    case '23514':
    case '22P02':
    case '22001':
      return `${queSeIntento}: hay un dato que falta o no tiene el formato esperado. Revisá el formulario.`
    case '42501':
      return `${queSeIntento}: tu usuario no tiene permiso para esta operación.`
    default:
      return `${queSeIntento}. Probá de nuevo en un momento; si sigue pasando, avisale a quien administra el sistema.`
  }
}
