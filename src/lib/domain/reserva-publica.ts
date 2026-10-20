/**
 * Reglas de lo que un visitante anónimo puede mandar al reservar desde la web.
 *
 * La Server Action del checkout es un endpoint HTTP público: el formulario es
 * sólo una de las formas de llamarla. Todo lo que llega se trata como entrada
 * hostil, y estas reglas viven en el dominio para que las páginas (que avisan
 * antes de que la persona cargue sus datos) y la acción (que es la garantía)
 * validen exactamente lo mismo.
 */

/** Estadía máxima que se puede reservar sin pasar por el hotel. */
export const MAX_NOCHES_PUBLICO = 30

/**
 * Largos máximos de los campos libres. Sin tope, un POST directo guardaba un
 * apellido de casi 1 MB que después viajaba a la ficha, los listados, los CSV
 * y la cartelera del staff.
 */
export const LARGO_MAXIMO = {
  nombre: 80,
  apellido: 80,
  // RFC 5321: 254 caracteres es el máximo de una dirección utilizable.
  email: 254,
  telefono: 40,
  pedido: 1000,
} as const

export type CampoInvalido = 'nombre' | 'apellido' | 'email' | 'telefono'

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Dígitos y los símbolos con que se escribe un teléfono en cualquier país.
const RE_TELEFONO = /^[0-9+()\-.\s]*$/
/** Caracteres de control (saltos de línea incluidos) y los que abren markup. */
function tieneProhibidos(valor: string): boolean {
  for (const c of valor) {
    const codigo = c.charCodeAt(0)
    if (codigo < 32 || codigo === 127 || c === '<' || c === '>' || c === '"') return true
  }
  return false
}
const RE_ENLACE = /:\/\/|www\./i

/**
 * ¿Es un nombre o apellido aceptable?
 *
 * Además del largo, rechaza saltos de línea y enlaces. No es un capricho de
 * formato: el nombre viaja al correo de confirmación que el hotel manda desde
 * su dominio verificado, y con saltos de línea y una URL cualquiera podía
 * escribir párrafos propios («tu reserva fue cancelada, pagá acá: …») en un
 * correo oficial dirigido a la dirección que quisiera.
 */
function nombreValido(valor: string, maximo: number): boolean {
  return (
    valor.length <= maximo && !tieneProhibidos(valor) && !RE_ENLACE.test(valor)
  )
}

/**
 * Valida los datos personales del checkout. Devuelve el primer campo inválido
 * o `null`. Espera los valores ya recortados (`trim`). El apellido y el email
 * son obligatorios; nombre y teléfono, no.
 */
export function campoInvalido(datos: {
  nombre: string
  apellido: string
  email: string
  telefono: string
}): CampoInvalido | null {
  if (!datos.apellido || !nombreValido(datos.apellido, LARGO_MAXIMO.apellido)) return 'apellido'
  if (!nombreValido(datos.nombre, LARGO_MAXIMO.nombre)) return 'nombre'
  if (datos.email.length > LARGO_MAXIMO.email || !RE_EMAIL.test(datos.email)) return 'email'
  if (datos.telefono.length > LARGO_MAXIMO.telefono || !RE_TELEFONO.test(datos.telefono)) {
    return 'telefono'
  }
  return null
}

/**
 * ¿Es una fecha `AAAA-MM-DD` que existe en el calendario?
 *
 * El patrón solo no alcanza: `2026-13-45` lo cumple, Postgres la rechaza y la
 * página respondía un error 500 en vez de «búsqueda inválida».
 */
export function esFechaReal(valor: string | undefined | null): valor is string {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ¿Tiene forma de identificador? Se comprueba ANTES de consultar: un `tipo`
 * cualquiera en la URL llegaba a Postgres, que lo rechaza («invalid input
 * syntax for type uuid»), y cada bot que probara direcciones dejaba un error
 * en `/panel/errores` que tapaba los reales.
 */
export function esUuid(valor: string | undefined | null): valor is string {
  return Boolean(valor && RE_UUID.test(valor))
}

export type ProblemaFechas = 'formato' | 'orden' | 'pasado' | 'max_noches'

/**
 * Valida un rango de estadía pedido desde la web.
 *
 * `hoy` es un parámetro (y no `hoyISO()` adentro) para que el dominio siga
 * puro y el test pueda fijar el día. Una llegada anterior a hoy se rechaza:
 * nada en la base lo impedía, y un envío directo creaba una reserva pendiente
 * en el pasado que disparaba el correo, el aviso al staff y ensuciaba las
 * métricas.
 */
export function problemaDeFechas(
  checkIn: string | undefined | null,
  checkOut: string | undefined | null,
  hoy: string,
  noches: (desde: string, hasta: string) => number,
): ProblemaFechas | null {
  if (!esFechaReal(checkIn) || !esFechaReal(checkOut)) return 'formato'
  if (checkOut <= checkIn) return 'orden'
  if (checkIn < hoy) return 'pasado'
  if (noches(checkIn, checkOut) > MAX_NOCHES_PUBLICO) return 'max_noches'
  return null
}

/**
 * ¿Se puede reutilizar la ficha de un huésped que ya existe con ese email?
 *
 * Desde la web no hay forma de probar que el email es de quien escribe. Antes
 * bastaba el email para colgar la reserva de la ficha de otra persona, ver su
 * nombre en la confirmación y activarle las promociones. Ahora se reutiliza
 * sólo si además coincide el apellido —que es lo que distingue al huésped que
 * vuelve de alguien que escribió un email ajeno— y la ficha existente nunca se
 * modifica desde acá. Si no coincide, se crea una ficha nueva y el staff la
 * une con la herramienta de fusión si corresponde.
 */
export function mismoApellido(a: string, b: string): boolean {
  const normalizar = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('es')
  return normalizar(a) === normalizar(b)
}
