/**
 * Señales de escasez para el portal público.
 *
 * Patrón de Booking: el «Solo queda 1 habitación en nuestro sitio» que aparece
 * junto a la opción. Funciona porque le da al huésped un dato que de verdad
 * cambia su decisión —si se lo piensa dos días, no está— y porque llega en el
 * momento en que está comparando.
 *
 * Acá se copia el patrón, **no** la práctica de fabricarlo. La diferencia es
 * concreta y es toda la razón de que este módulo exista:
 *
 *  · El número sale de `disponibilidadPorTipo`, que lo calcula contra las
 *    estadías reales de esas fechas. Ya venía en la consulta y el portal lo
 *    estaba tirando: solo miraba `disponibles > 0`.
 *  · Solo se anuncia cuando la escasez es cierta. Con 4 unidades libres no se
 *    dice nada, porque no hay nada que avisar.
 *
 * Un aviso de urgencia inventado es una mentira que el huésped puede verificar
 * volviendo al día siguiente, y este proyecto ya tiene dos antecedentes de
 * afirmar de más en la cara al huésped: el «USD 0» de la Fase 18 y el asistente
 * que decía «con IVA» sobre precios sin IVA (Fase 22). Es el mismo error.
 */

/*
  ── Por qué la regla es «solo la última», y no «quedan pocas» ────────────────

  La primera versión de este módulo avisaba con 3 o menos unidades libres:
  «Quedan 2 habitaciones», «Queda 1 cabaña». Al verlo renderizado contra el
  inventario real apareció el problema: **la señal salía en las nueve opciones,
  siempre**. El inventario del hotel es de 15 unidades repartidas en 10 tipos, y
  seis de esos tipos —las cinco cabañas y la Suite Principal— tienen **una sola
  unidad**. El máximo es 3.

  Así que «Queda 1 cabaña» no informaba de escasez: informaba del inventario, y
  lo iba a mostrar todos los días del año aunque no hubiera ni una reserva. Cada
  palabra era cierta y el conjunto daba a entender algo falso —que se están
  agotando por demanda—, que es justo la práctica que este portal no copia.

  Y una alerta que aparece en el 100 % de los resultados deja de ser una alerta:
  el lector la filtra y de paso desconfía del resto de la página.

  Lo que queda es lo único que es a la vez cierto y útil: cuando queda **una**
  unidad libre para esas fechas, tomarla o no cambia el resultado. Se dice como
  un hecho sobre la disponibilidad —«Última libre en estas fechas»— y no como
  una cuenta regresiva. Con 2 o 3 libres no se dice nada: no hay urgencia real
  que comunicar.

  Para el patrón completo de Booking —«quedan pocas» comparando contra el total
  del tipo— haría falta que `disponibilidadPorTipo` devuelva también cuántas
  unidades tiene el tipo, y eso es una migración: `unidades` no es legible por
  el rol público (su política exige `rol_actual() is not null`). Queda anotado
  como trabajo futuro, no resuelto de contrabando con `service_role` en una
  pantalla pública.
*/

export type NivelEscasez = 'ultima'

export interface SenalEscasez {
  nivel: NivelEscasez
  /** Texto listo para mostrar, en español y sin signos de admiración. */
  texto: string
}

/**
 * Señal de disponibilidad para una cantidad de unidades libres, o `null` si no
 * corresponde anunciar nada.
 *
 * Solo habla cuando queda exactamente una libre. Ver el bloque de arriba: es
 * una decisión deliberada y no una regla a la que le falte un caso.
 */
export function senalEscasez(disponibles: number): SenalEscasez | null {
  if (!Number.isFinite(disponibles) || disponibles !== 1) return null
  return { nivel: 'ultima', texto: 'Última libre en estas fechas' }
}
