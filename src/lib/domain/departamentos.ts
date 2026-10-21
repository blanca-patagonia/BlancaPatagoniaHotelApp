/**
 * Resolución de la jerarquía de departamentos (lógica pura).
 *
 * ── Por qué existe, en vez de resolverla en la consulta ──────────────────────
 *
 * La forma «natural» sería un embed anidado de PostgREST:
 *
 *     departamento:departamentos(nombre, padre:departamentos(nombre))
 *
 * **No funciona.** `departamentos.padre_id` es una clave foránea a la misma tabla,
 * y PostgREST resuelve ese auto-join en la dirección contraria: devuelve los
 * **hijos**, no el padre. Concretamente, `padre` llega como un **array vacío**
 * (`"padre": []`) para cualquier subdepartamento, así que la pantalla mostraba
 * «undefined › Bebidas». Las pistas de FK (`!departamentos_padre_id_fkey`,
 * `!padre_id`) tampoco lo corrigen.
 *
 * Se resuelve en la aplicación, y es la opción correcta además de la que funciona:
 * la tabla completa son ~14 filas, se trae una vez por pantalla, y a partir de ahí
 * cada línea de la cuenta resuelve su departamento y su padre **sin una consulta
 * más**. El embed anidado habría hecho un join por fila.
 */

/** Una fila de `departamentos`, tal como viene de la base. */
export interface DepartamentoFila {
  id: string
  nombre: string
  padre_id: string | null
}

/** El departamento de una línea, ya resuelto a texto. */
export interface DepartamentoResuelto {
  /** Nombre del departamento de primer nivel. */
  departamento: string
  /** Subdepartamento, o cadena vacía si la línea cuelga del departamento. */
  subdepartamento: string
  /** Para mostrar en una sola línea: «Frigobar › Bebidas». */
  etiqueta: string
}

/** Lo que se muestra cuando una línea no tiene departamento cargado. */
export const SIN_CLASIFICAR: DepartamentoResuelto = {
  departamento: 'Otros',
  subdepartamento: '',
  etiqueta: 'Sin clasificar',
}

/**
 * Construye el resolutor a partir de la tabla completa.
 *
 * Devuelve una función para que el llamador la aplique fila por fila sin volver a
 * armar el índice en cada una.
 *
 * Un `padre_id` que apunte a un id inexistente —no debería pasar, hay FK— se trata
 * como si la fila fuera de primer nivel, en vez de propagar `undefined` a la
 * pantalla.
 */
export function resolutorDepartamentos(
  filas: readonly DepartamentoFila[],
): (id: string | null | undefined) => DepartamentoResuelto {
  const porId = new Map(filas.map((d) => [d.id, d]))

  return (id) => {
    if (!id) return SIN_CLASIFICAR

    const propio = porId.get(id)
    if (!propio) return SIN_CLASIFICAR

    const padre = propio.padre_id ? porId.get(propio.padre_id) : undefined

    if (!padre) {
      // Es un departamento de primer nivel: no hay subdepartamento.
      return {
        departamento: propio.nombre,
        subdepartamento: '',
        etiqueta: propio.nombre,
      }
    }

    return {
      departamento: padre.nombre,
      subdepartamento: propio.nombre,
      etiqueta: `${padre.nombre} › ${propio.nombre}`,
    }
  }
}

/**
 * Opciones para un desplegable, ordenadas por jerarquía.
 *
 * Los departamentos van seguidos de sus subdepartamentos, y la etiqueta de éstos
 * lleva el nombre del padre: en una lista plana, «Bebidas» sola no dice si es del
 * frigobar o del restaurante.
 */
export function opcionesDepartamentos(
  filas: readonly DepartamentoFila[],
): { id: string; etiqueta: string }[] {
  const resolver = resolutorDepartamentos(filas)
  const padres = filas.filter((d) => !d.padre_id)
  const opciones: { id: string; etiqueta: string }[] = []

  for (const p of padres) {
    opciones.push({ id: p.id, etiqueta: p.nombre })
    for (const h of filas.filter((d) => d.padre_id === p.id)) {
      opciones.push({ id: h.id, etiqueta: resolver(h.id).etiqueta })
    }
  }

  // Las que quedaron colgando de un padre inexistente, para no perderlas del
  // desplegable si alguna vez pasa.
  for (const d of filas) {
    if (d.padre_id && !padres.some((p) => p.id === d.padre_id)) {
      if (!opciones.some((o) => o.id === d.id)) opciones.push({ id: d.id, etiqueta: d.nombre })
    }
  }

  return opciones
}
