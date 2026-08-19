/**
 * Ligar una reseña del canal con la reserva que la generó.
 *
 * ── Por qué hace falta y por qué es difícil ─────────────────────────────────
 *
 * Una reseña suelta sirve para leerla. Ligada a su reserva sirve para bastante más:
 * saber qué unidad la produjo, cruzarla con el NPS propio, ver si el huésped que se
 * queja es el mismo que ya se había quejado, y medir la satisfacción por tipo de
 * alojamiento.
 *
 * El problema es que el export de reseñas del extranet **no siempre trae el número de
 * reserva**. Lo que trae seguro es el nombre de quien la escribió y la fecha en que se
 * publicó, y eso no identifica una reserva de forma única: dos huéspedes con el mismo
 * apellido en la misma semana existen.
 *
 * ── El criterio que decide todo el módulo ───────────────────────────────────
 *
 * **Una reseña mal ligada es peor que una sin ligar.**
 *
 * Sin ligar es un dato incompleto que alguien puede completar en un clic. Mal ligada
 * ensucia el historial de un huésped que no dijo eso, y contamina el reporte de
 * satisfacción de una unidad que no tuvo ese problema. Y nadie lo detecta, porque no
 * hay nada que se vea roto.
 *
 * Por eso ante cualquier ambigüedad **no se liga**: se propone y decide una persona.
 */

/** Cómo quedó ligada una reseña. */
export const VINCULOS_RESENA = ['automatico', 'manual', 'sin_vincular'] as const
export type VinculoResena = (typeof VINCULOS_RESENA)[number]

export const ETIQUETAS_VINCULO: Record<VinculoResena, string> = {
  automatico: 'Ligada automáticamente',
  manual: 'Ligada a mano',
  sin_vincular: 'Sin ligar',
}

/** Una reserva candidata a ser la de esta reseña. */
export interface CandidataResena {
  /** Id de la reserva propia. */
  reservaId: string
  /** Id de la fila de staging del canal, si vino de ahí. */
  canalReservaId?: string | null
  /** Número de reserva en el canal. */
  externalId: string
  apellido: string
  checkIn: string
  checkOut: string
}

export interface ResenaAEmparejar {
  /** Número de reserva del canal, si el export lo trae. */
  reservaExternalId?: string | null
  autor: string
  /** Fecha de publicación de la reseña, en ISO. */
  publicadaEn?: string | null
}

export interface Emparejamiento {
  reservaId: string | null
  vinculo: VinculoResena
  /** Por qué no se ligó, para mostrarlo. Vacío si se ligó. */
  motivo: string
  /** Candidatas que el usuario puede elegir a mano. */
  candidatas: CandidataResena[]
}

/** Normaliza un apellido para comparar: sin acentos, sin espacios de más. */
function normalizarApellido(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Días entre dos fechas ISO. Positivo si `b` es posterior.
 *
 * Sin `Date` para no arrastrar zonas horarias a una comparación de calendario.
 */
function diasEntreISO(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86400000)
}

/**
 * Ventana en la que una reseña puede referirse a una estadía.
 *
 * Booking le pide la reseña al huésped **después** del check-out, y el huésped puede
 * tardar. Catorce días cubre el caso normal sin abrir tanto la ventana como para que
 * dos estadías distintas del mismo apellido entren las dos.
 *
 * Que sea generosa no relaja el criterio: si entran dos candidatas, no se liga
 * ninguna.
 */
export const DIAS_VENTANA_RESENA = 14

/**
 * Decide con qué reserva se liga una reseña.
 *
 * Tres criterios, y **solo los dos primeros ligan solos**:
 *
 * 1. **Por número de reserva.** Si el export lo trae y coincide con una entrante, es
 *    exacto: no hay nada que interpretar.
 * 2. **Apellido + ventana de fechas, con coincidencia ÚNICA.** La reseña se publica
 *    después del check-out; si en esa ventana hay exactamente una reserva de ese
 *    apellido, es esa.
 * 3. **Cualquier ambigüedad.** Dos candidatas, ninguna, o falta la fecha de
 *    publicación: **no se liga**. Se devuelven las candidatas para que alguien elija,
 *    y el motivo escrito para que se entienda por qué se pregunta.
 */
export function emparejarResenaConReserva(
  resena: ResenaAEmparejar,
  candidatas: readonly CandidataResena[],
): Emparejamiento {
  // ── 1. Por número de reserva ────────────────────────────────────────────────
  const ref = (resena.reservaExternalId ?? '').trim()
  if (ref) {
    const exacta = candidatas.find((c) => c.externalId === ref)
    if (exacta) {
      return { reservaId: exacta.reservaId, vinculo: 'automatico', motivo: '', candidatas: [] }
    }
    // El export trae un número que no tenemos. Es información: significa que esa
    // reserva no se importó, o que es de antes de usar el sistema.
    return {
      reservaId: null,
      vinculo: 'sin_vincular',
      motivo: `La reseña dice ser de la reserva ${ref}, que no está en el sistema.`,
      candidatas: [...candidatas],
    }
  }

  // ── 2. Apellido + ventana ───────────────────────────────────────────────────
  const apellido = normalizarApellido(resena.autor)
  if (!apellido) {
    return {
      reservaId: null,
      vinculo: 'sin_vincular',
      motivo: 'La reseña no trae el nombre de quien la escribió.',
      candidatas: [...candidatas],
    }
  }

  const publicada = resena.publicadaEn
  if (!publicada) {
    return {
      reservaId: null,
      vinculo: 'sin_vincular',
      motivo:
        'La reseña no trae fecha de publicación, así que no se puede saber a qué estadía se refiere.',
      candidatas: [...candidatas],
    }
  }

  /*
    Se comparan apellidos por CONTENCIÓN y no por igualdad, en las dos direcciones.

    Booking publica el nombre como lo puso el huésped: a veces «Pérez», a veces «Ana
    Pérez», a veces «Pérez Gómez». La reserva guarda el apellido solo. Exigir igualdad
    dejaría sin ligar la mayoría de los casos que sí son claros.

    La contención puede traer falsos positivos —«Diaz» dentro de «Diazgranados»— y por
    eso el criterio de unicidad de abajo es lo que protege: con dos candidatas, no se
    liga ninguna.
  */
  const posibles = candidatas.filter((c) => {
    const suyo = normalizarApellido(c.apellido)
    if (!suyo) return false
    if (!(apellido.includes(suyo) || suyo.includes(apellido))) return false

    // La reseña se publica DESPUÉS del check-out, dentro de la ventana.
    const dias = diasEntreISO(c.checkOut, publicada)
    return dias >= 0 && dias <= DIAS_VENTANA_RESENA
  })

  if (posibles.length === 1) {
    return { reservaId: posibles[0].reservaId, vinculo: 'automatico', motivo: '', candidatas: [] }
  }

  // ── 3. Ambigua o sin candidatas ─────────────────────────────────────────────
  if (posibles.length > 1) {
    return {
      reservaId: null,
      vinculo: 'sin_vincular',
      motivo:
        `Hay ${posibles.length} reservas de «${resena.autor}» que terminaron dentro de los ` +
        `${DIAS_VENTANA_RESENA} días previos. Elegí cuál es.`,
      // Solo las que están en la ventana: ofrecerle las 200 del sistema no ayuda.
      candidatas: posibles,
    }
  }

  return {
    reservaId: null,
    vinculo: 'sin_vincular',
    motivo: `No hay ninguna reserva de «${resena.autor}» que termine cerca de esa fecha.`,
    candidatas: [...candidatas],
  }
}

/**
 * Huella de una reseña, para no importar dos veces la misma.
 *
 * ── Por qué hace falta además del número de reseña ──────────────────────────
 *
 * `canal_resenas.external_id` es nullable, porque el export no siempre trae un
 * identificador. Un `unique` sobre una columna nullable no impide duplicados: en
 * Postgres cada `null` es distinto de todos los demás, así que diez reseñas sin id
 * entran diez veces.
 *
 * La huella se construye con lo que identifica una reseña sin ambigüedad razonable:
 * quién la escribió, cuándo, y lo que dijo. Si esos cuatro coinciden, es la misma
 * reseña — no dos huéspedes que escribieron exactamente lo mismo el mismo día.
 *
 * Se normaliza el texto para que un cambio de espacios o de mayúsculas al reexportar
 * no genere un duplicado.
 */
export function huellaResena(r: {
  autor: string
  publicadaEn?: string | null
  positivo?: string | null
  negativo?: string | null
}): string {
  const norm = (s: string | null | undefined) =>
    (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()

  return [norm(r.autor), r.publicadaEn ?? '', norm(r.positivo), norm(r.negativo)].join('|')
}
