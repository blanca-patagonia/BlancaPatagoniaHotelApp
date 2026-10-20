/**
 * Desglose de ocupantes de una habitación (lógica pura).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * WinPAX pedía adultos, menores, bebés, camas extra y cunas por habitación. Este
 * sistema tenía un solo `huespedes int`, y esa diferencia no es cosmética:
 * recepción prepara la habitación con estos números. Dos adultos y un bebé no es
 * lo mismo que tres adultos —hace falta una cuna y no una cama— y con un `int`
 * plano no había forma de saberlo hasta que el huésped llegaba.
 *
 * ── La regla que gobierna todo el módulo ────────────────────────────────────
 *
 * **Los bebés no ocupan plaza.** Un bebé en cuna no consume una cama, así que no
 * cuenta contra la capacidad de la unidad. Contarlo tiene una consecuencia
 * concreta y mala: una cabaña para 4 con dos adultos, un menor y un bebé daría
 * «completo» y el sistema rechazaría una reserva perfectamente válida.
 *
 * Por eso `paxQueOcupa` es `adultos + menores`, y es ese número el que va a
 * `estadias.huespedes`, que sigue siendo la columna con la que se razona la
 * capacidad y el anti-overbooking (ADR 0002).
 */

export interface Ocupantes {
  adultos: number
  menores: number
  bebes: number
  camasExtra: number
  cunas: number
}

export const OCUPANTES_VACIO: Ocupantes = {
  adultos: 1,
  menores: 0,
  bebes: 0,
  camasExtra: 0,
  cunas: 0,
}

/**
 * Personas que ocupan plaza: adultos + menores.
 *
 * Es el número que va a `estadias.huespedes`. Los bebés quedan afuera (ver el
 * encabezado). Nunca devuelve menos de 1: una estadía sin nadie no existe, y la
 * columna tiene un `check (huespedes > 0)`.
 */
export function paxQueOcupa(o: Pick<Ocupantes, 'adultos' | 'menores'>): number {
  const adultos = Number.isFinite(o.adultos) ? Math.max(0, Math.trunc(o.adultos)) : 0
  const menores = Number.isFinite(o.menores) ? Math.max(0, Math.trunc(o.menores)) : 0
  return Math.max(1, adultos + menores)
}

/** Total de personas alojadas, bebés incluidos. Para las planillas de cocina. */
export function personasAlojadas(o: Ocupantes): number {
  const bebes = Number.isFinite(o.bebes) ? Math.max(0, Math.trunc(o.bebes)) : 0
  return paxQueOcupa(o) + bebes
}

/**
 * Devuelve los motivos por los que el desglose NO se puede aceptar.
 *
 * Vacío = sirve. Se juntan todos, igual que en el resto del dominio: quien
 * complete un formulario mal suele completarlo mal de varias formas.
 */
export function validarOcupantes(o: Ocupantes, capacidadMax?: number): string[] {
  const motivos: string[] = []

  for (const [campo, etiqueta] of [
    ['adultos', 'adultos'],
    ['menores', 'menores'],
    ['bebes', 'bebés'],
    ['camasExtra', 'camas extra'],
    ['cunas', 'cunas'],
  ] as const) {
    const v = o[campo]
    if (!Number.isInteger(v) || v < 0) {
      motivos.push(`La cantidad de ${etiqueta} tiene que ser un número entero de 0 o más.`)
    }
  }

  if (Number.isInteger(o.adultos) && o.adultos < 1) {
    // Una habitación con cero adultos y dos menores no es un caso real, y si lo
    // fuera hay que cargarlo distinto: el responsable es el titular de la reserva.
    motivos.push('Tiene que haber al menos un adulto.')
  }

  if (capacidadMax != null && Number.isFinite(capacidadMax)) {
    const pax = paxQueOcupa(o)
    // Las camas extra amplían la capacidad: para eso existen. Sin sumarlas, una
    // habitación doble con cama extra rechazaría al tercer huésped, que es
    // precisamente lo que la cama extra viene a resolver.
    const tope = capacidadMax + Math.max(0, o.camasExtra || 0)
    if (pax > tope) {
      motivos.push(
        `Entran ${tope} persona(s) (capacidad ${capacidadMax}` +
          (o.camasExtra > 0 ? ` + ${o.camasExtra} cama(s) extra` : '') +
          `) y se cargaron ${pax}. Los bebés en cuna no cuentan.`,
      )
    }
  }

  if (Number.isInteger(o.cunas) && Number.isInteger(o.bebes) && o.cunas > 0 && o.bebes === 0) {
    // No es un error que impida guardar en la base, pero casi siempre es un
    // tipeo: alguien puso cuna y olvidó el bebé.
    motivos.push('Se pidió una cuna pero no hay bebés cargados. Revisá el desglose.')
  }

  return motivos
}

/**
 * Texto para mostrar el desglose en una línea.
 *
 * Se omite lo que está en cero: «2 adultos» se lee mejor que «2 adultos, 0
 * menores, 0 bebés», y en una tabla la diferencia es entre una columna legible y
 * una ilegible.
 */
export function textoOcupantes(o: Ocupantes): string {
  const partes: string[] = []

  if (o.adultos > 0) partes.push(`${o.adultos} adulto${o.adultos === 1 ? '' : 's'}`)
  if (o.menores > 0) partes.push(`${o.menores} menor${o.menores === 1 ? '' : 'es'}`)
  if (o.bebes > 0) partes.push(`${o.bebes} bebé${o.bebes === 1 ? '' : 's'}`)

  const extras: string[] = []
  if (o.camasExtra > 0) extras.push(`${o.camasExtra} cama${o.camasExtra === 1 ? '' : 's'} extra`)
  if (o.cunas > 0) extras.push(`${o.cunas} cuna${o.cunas === 1 ? '' : 's'}`)

  const base = partes.length > 0 ? partes.join(', ') : 'sin ocupantes'
  return extras.length > 0 ? `${base} · ${extras.join(', ')}` : base
}

/**
 * ¿El desglose coincide con el pax guardado?
 *
 * Existe porque **no hay un `check` en la base** que lo garantice, y la decisión
 * de no ponerlo fue deliberada (ver el encabezado de la migración 0039): un check
 * habría hecho fallar los `update` de mudanza y reprogramación, que tocan la
 * unidad y el período sin mirar el pax.
 *
 * La coherencia se garantiza en `crear_reserva`, que deriva `huespedes` del
 * desglose. Esta función es la red de seguridad: permite detectar en pantalla una
 * fila vieja o escrita por fuera de ese camino, en vez de mostrar dos números que
 * se contradicen sin que nadie lo note.
 */
export function desgloseCoincide(o: Pick<Ocupantes, 'adultos' | 'menores'>, huespedes: number): boolean {
  return paxQueOcupa(o) === huespedes
}
