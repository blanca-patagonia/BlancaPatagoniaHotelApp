/**
 * Reglas de la cotización de monedas extranjeras (lógica pura).
 *
 * ── Por qué existe este módulo ──────────────────────────────────────────────
 *
 * El ADR 0003 decidió en julio que todos los importes se guardan en **USD** y
 * que el peso es una capa de presentación con «cotización configurable». Cerró
 * con una tarea pendiente: *«Hace falta un mecanismo para cargar/actualizar la
 * cotización»*. Nunca se hizo, así que hasta hoy el sistema no sabía convertir
 * nada: el Tarifario dice que se cobra a *«la cotización oficial de venta
 * billete del Banco Nación del día de pago»* y ese número no existía en ninguna
 * parte del código.
 *
 * ── Qué NO es ───────────────────────────────────────────────────────────────
 *
 * Cuidado con dos nombres muy parecidos que ya están tomados:
 *
 *  · `lib/domain/moneda.ts` **formatea** importes (`USD 145,20`). No convierte.
 *  · `lib/pricing/cotizar.ts` y la migración `0008_cotizacion.sql` cotizan una
 *    **estadía** (o sea, calculan un precio). No tienen nada que ver con el tipo
 *    de cambio.
 *
 * Este módulo es lo tercero: el valor de una divisa frente al dólar.
 *
 * ── Las tres decisiones que fija ────────────────────────────────────────────
 *
 * 1. **Se cobra al valor de VENTA, no al de compra.** Es lo que dice el
 *    Tarifario y además es lo correcto: el hotel tiene que comprar los dólares
 *    que va a rendir, y los compra al precio de venta del banco. Usar el de
 *    compra le regala el spread a cada huésped que pague en pesos.
 * 2. **El USD no se convierte nunca.** Es la moneda base del dominio (ADR 0003);
 *    convertirlo a sí mismo con una cotización cualquiera sería introducir un
 *    error de redondeo sobre la fuente de verdad.
 * 3. **Una cotización vencida se usa igual, pero avisando.** Es la regla más
 *    importante de todas y está explicada abajo, en `resolverVigente`.
 */

/* ─────────────────────────────────────────────────── monedas soportadas ──── */

/**
 * Monedas que el sistema sabe convertir.
 *
 * El real y el euro entran porque El Calafate recibe turismo brasileño y
 * europeo, y en temporada alta el mostrador cobra en las tres. No se agregan
 * más de las que el hotel usa: cada moneda es una fila más que alguien tiene
 * que mantener actualizada a mano el día que la API externa no responda.
 */
export const MONEDAS_EXTRANJERAS = ['ARS', 'BRL', 'EUR'] as const
export type MonedaExtranjera = (typeof MONEDAS_EXTRANJERAS)[number]

/** Moneda base del dominio. Nunca se convierte (ADR 0003). */
export const MONEDA_BASE = 'USD' as const

export const ETIQUETAS_MONEDA: Record<MonedaExtranjera, string> = {
  ARS: 'Peso argentino',
  BRL: 'Real brasileño',
  EUR: 'Euro',
}

/** Símbolo para mostrar al lado del número. */
export const SIMBOLOS_MONEDA: Record<MonedaExtranjera, string> = {
  ARS: '$',
  BRL: 'R$',
  EUR: '€',
}

export function esMonedaExtranjera(v: string): v is MonedaExtranjera {
  return (MONEDAS_EXTRANJERAS as readonly string[]).includes(v)
}

/* ─────────────────────────────────────────────────────────── frescura ──── */

/**
 * Minutos que una cotización se considera fresca.
 *
 * Treinta es el techo de lo que pide el usuario (15–30) y el elegido a
 * propósito: el dólar oficial lo mueve el BCRA, no el mercado minuto a minuto,
 * así que refrescarlo cada 15 gastaría el doble de llamadas para el mismo
 * número. En una jornada de mostrador son ~16 consultas a la API externa.
 */
export const MINUTOS_FRESCURA = 30

/**
 * Minutos a partir de los cuales la cotización ya no se muestra como referencia
 * de cobro sin una advertencia fuerte.
 *
 * Doce horas: cubre un turno completo más el cambio de guardia. Si el mostrador
 * abre a la mañana y la API estuvo caída toda la noche, el valor de ayer a la
 * tarde sigue siendo mejor que ninguno, pero quien cobre tiene que saberlo.
 */
export const MINUTOS_ADVERTENCIA = 12 * 60

/* ───────────────────────────────────────────────────────────── modelo ──── */

/** De dónde salió el número. */
export const FUENTES = ['dolarapi', 'argentinadatos', 'manual'] as const
export type Fuente = (typeof FUENTES)[number]

export const ETIQUETAS_FUENTE: Record<Fuente, string> = {
  dolarapi: 'DolarAPI',
  argentinadatos: 'ArgentinaDatos',
  manual: 'Carga manual',
}

/**
 * Qué es cada fuente, en una línea, para mostrar donde alguien decide cobrar.
 *
 * ── Por qué esto existe ─────────────────────────────────────────────────────
 *
 * El pedido del cliente fue «que se conecte al Banco Nación». **El BNA no publica
 * un servicio para consultar su cotización**, así que se usa un tercero que
 * replica ese valor. El ADR 0020 lo dice desde el primer día, pero la pantalla
 * decía «DolarAPI (oficial)» y nada más: quien la lee concluye, razonablemente,
 * que el número viene del Banco Nación.
 *
 * No es una diferencia académica. Si el tercero se atrasa o publica otro valor,
 * el hotel cobra con un dólar que no es el que cree estar usando, y nadie tiene
 * cómo enterarse. Declarar la fuente es lo que permite dudar de ella.
 */
export const DESCRIPCION_FUENTE: Record<Fuente, string> = {
  dolarapi:
    'Servicio público que replica el dólar oficial. No es el Banco Nación: el BNA no publica un servicio para consultarlo.',
  argentinadatos:
    'Servicio público que replica el dólar oficial. No es el Banco Nación: el BNA no publica un servicio para consultarlo.',
  manual: 'Valor cargado a mano desde Configuración. Le gana al automático mientras esté vigente.',
}

export interface Cotizacion {
  moneda: MonedaExtranjera
  /** Cuántas unidades de `moneda` paga el banco por un USD. */
  compra: number
  /** Cuántas unidades de `moneda` cuesta comprar un USD. Es la que se cobra. */
  venta: number
  fuente: Fuente
  /** Momento en que la fuente publicó el valor, en ISO. */
  obtenidaEn: string
}

/** Cómo llegó a nosotros la cotización que estamos usando. */
export type Origen = 'vivo' | 'almacenada' | 'manual'

export const ETIQUETAS_ORIGEN: Record<Origen, string> = {
  vivo: 'En vivo',
  almacenada: 'Última guardada',
  manual: 'Valor manual',
}

export interface CotizacionVigente extends Cotizacion {
  origen: Origen
  /** Minutos transcurridos desde `obtenidaEn`. */
  antiguedadMinutos: number
  /** Pasó `MINUTOS_FRESCURA`: hay que intentar refrescarla. */
  vencida: boolean
  /** Pasó `MINUTOS_ADVERTENCIA`: hay que avisarle a quien cobra. */
  requiereAdvertencia: boolean
}

/* ────────────────────────────────────────────────────────── validación ──── */

/**
 * Devuelve los motivos por los que una cotización NO se puede usar.
 *
 * Vacío = sirve. Se valida todo junto y no se corta en el primero, igual que
 * `validarReservaEntrante` en `lib/domain/canales.ts`: un valor que llega mal
 * suele llegar mal de varias formas y quien tenga que corregirlo necesita la
 * lista completa.
 *
 * Esto no es paranoia: la entrada viene de una **API pública de terceros**. Un
 * `null`, un cero o un string donde iba un número llegan cada tanto, y un cero
 * que se cuela hasta el cobro convierte una cuenta de USD 400 en «$ 0».
 */
export function validarCotizacion(c: {
  compra?: unknown
  venta?: unknown
  obtenidaEn?: unknown
}): string[] {
  const motivos: string[] = []

  const compra = Number(c.compra)
  const venta = Number(c.venta)

  if (!Number.isFinite(compra) || compra <= 0) {
    motivos.push('El valor de compra no es un número positivo.')
  }
  if (!Number.isFinite(venta) || venta <= 0) {
    motivos.push('El valor de venta no es un número positivo.')
  }
  // Un banco nunca vende más barato de lo que compra. Si llega invertido, la
  // fuente cambió el orden de los campos y hay que mirarla antes de cobrar con
  // eso: aplicar el de compra como venta le regala el spread al huésped.
  if (Number.isFinite(compra) && Number.isFinite(venta) && compra > 0 && venta > 0) {
    if (venta < compra) motivos.push('La venta no puede ser menor que la compra.')
  }
  if (typeof c.obtenidaEn !== 'string' || Number.isNaN(Date.parse(c.obtenidaEn))) {
    motivos.push('La fecha de la cotización no es válida.')
  }

  return motivos
}

/**
 * Valida lo que un administrador carga a mano.
 *
 * Se separa de `validarCotizacion` porque el mensaje tiene otro destinatario: acá
 * hay una persona mirando un formulario, no un log de servidor. Devuelve un solo
 * problema por vez y en el orden en que están los campos en pantalla, que es la
 * convención de `lib/domain/cuenta.ts`.
 */
export function validarCotizacionManual(compra: unknown, venta: unknown): string | null {
  const c = Number(compra)
  const v = Number(venta)

  if (!Number.isFinite(c) || c <= 0) return 'Escribí un valor de compra mayor que cero.'
  if (!Number.isFinite(v) || v <= 0) return 'Escribí un valor de venta mayor que cero.'
  if (v < c) return 'El valor de venta no puede ser menor que el de compra.'

  return null
}

/* ────────────────────────────────────────────────────────── antigüedad ──── */

/**
 * Minutos entre `obtenidaEn` y `ahora`.
 *
 * Una fecha futura devuelve 0 en lugar de un negativo: puede pasar por desfase
 * de reloj entre el servidor de la API y el nuestro, y un «hace -3 minutos» en
 * pantalla es un error visible sin ser un problema real.
 */
export function antiguedadEnMinutos(obtenidaEn: string, ahora: Date): number {
  const t = Date.parse(obtenidaEn)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((ahora.getTime() - t) / 60_000))
}

/** Texto para mostrar la antigüedad sin hacer cuentas mentales. */
export function textoAntiguedad(minutos: number): string {
  if (!Number.isFinite(minutos)) return 'sin fecha'
  if (minutos < 1) return 'hace menos de un minuto'
  if (minutos === 1) return 'hace 1 minuto'
  if (minutos < 60) return `hace ${minutos} minutos`

  const horas = Math.floor(minutos / 60)
  if (horas === 1) return 'hace 1 hora'
  if (horas < 24) return `hace ${horas} horas`

  const dias = Math.floor(horas / 24)
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}

/* ──────────────────────────────────────────────────────────── conversión ──── */

function redondear(n: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round((n + Number.EPSILON) * f) / f
}

/**
 * Convierte un importe en USD a moneda local, al valor de **venta**.
 *
 * Ver la decisión 1 del encabezado: es lo que fija el Tarifario y lo que evita
 * regalar el spread. Un importe no finito devuelve 0 en lugar de propagar `NaN`
 * a la pantalla, mismo criterio que `importe()` en `lib/domain/moneda.ts`.
 */
export function convertirDesdeUSD(montoUSD: number, cotizacion: Pick<Cotizacion, 'venta'>): number {
  if (!Number.isFinite(montoUSD)) return 0
  if (!Number.isFinite(cotizacion.venta) || cotizacion.venta <= 0) return 0
  return redondear(montoUSD * cotizacion.venta)
}

/**
 * Convierte de moneda local a USD, también al valor de venta.
 *
 * Se usa para registrar un pago que el huésped hizo en pesos sobre una cuenta
 * que vive en dólares. La simetría con `convertirDesdeUSD` es deliberada: si una
 * usara compra y la otra venta, convertir ida y vuelta no cerraría y aparecerían
 * diferencias de centavos imposibles de explicar en una conciliación.
 */
export function convertirAUSD(montoLocal: number, cotizacion: Pick<Cotizacion, 'venta'>): number {
  if (!Number.isFinite(montoLocal)) return 0
  if (!Number.isFinite(cotizacion.venta) || cotizacion.venta <= 0) return 0
  return redondear(montoLocal / cotizacion.venta)
}

/** Importe en moneda local, ya formateado: `$ 1.234.567,00`. */
export function formatearLocal(monto: number, moneda: MonedaExtranjera): string {
  const n = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(monto) ? monto : 0)
  return `${SIMBOLOS_MONEDA[moneda]} ${n}`
}

/* ──────────────────────────────────────────────── resolución de la vigente ──── */

/**
 * Elige qué cotización usar entre las que se pudieron conseguir.
 *
 * ── La regla que importa ────────────────────────────────────────────────────
 *
 * **Una cotización vieja nunca bloquea una operación.** Es un pedido explícito
 * del usuario y también la decisión correcta: si la API de terceros se cae un
 * sábado a la tarde, la alternativa a cobrar con el valor de la mañana es *no
 * poder cobrar*. Un hotel que no puede tomar una reserva porque un servicio
 * gratuito de un tercero no responde es un sistema peor que uno que cobra con el
 * dólar de hace seis horas y lo dice en pantalla.
 *
 * Por eso acá no hay ningún camino que devuelva «no se puede operar». Devuelve
 * `null` solo si no hay **ninguna** candidata válida, y en ese caso quien llama
 * muestra los importes en USD, que es la moneda real del sistema.
 *
 * ── Cómo elige ─────────────────────────────────────────────────────────────
 *
 * Gana la más reciente, sin privilegiar la fuente. Suena obvio pero tiene una
 * consecuencia buscada: si el administrador cargó un valor a mano hace diez
 * minutos porque la API venía dando cualquier cosa, ese valor **le gana** a uno
 * automático de hace dos horas. La carga manual es una corrección deliberada de
 * una persona que está mirando el pizarrón del banco; tratarla como último
 * recurso incondicional la volvería inútil justo cuando más sirve.
 */
export function resolverVigente(
  candidatas: readonly { cotizacion: Cotizacion; origen: Origen }[],
  ahora: Date,
): CotizacionVigente | null {
  const validas = candidatas.filter((c) => validarCotizacion(c.cotizacion).length === 0)
  if (validas.length === 0) return null

  let mejor = validas[0]
  let mejorAntiguedad = antiguedadEnMinutos(mejor.cotizacion.obtenidaEn, ahora)

  for (const c of validas.slice(1)) {
    const a = antiguedadEnMinutos(c.cotizacion.obtenidaEn, ahora)
    if (a < mejorAntiguedad) {
      mejor = c
      mejorAntiguedad = a
    }
  }

  return {
    ...mejor.cotizacion,
    origen: mejor.origen,
    antiguedadMinutos: mejorAntiguedad,
    vencida: mejorAntiguedad >= MINUTOS_FRESCURA,
    requiereAdvertencia: mejorAntiguedad >= MINUTOS_ADVERTENCIA,
  }
}

/**
 * Texto de estado para mostrar junto al número.
 *
 * Se arma acá y no en la pantalla para que el panel y el portal digan lo mismo.
 * Incluye siempre el origen **y** la antigüedad: «$ 1.480» sin fecha al lado es
 * el tipo de dato que alguien usa para cobrar creyendo que es de hoy.
 */
export function textoEstado(c: CotizacionVigente): string {
  const base = `${ETIQUETAS_ORIGEN[c.origen]} · ${textoAntiguedad(c.antiguedadMinutos)}`
  if (c.requiereAdvertencia) return `${base} · verificá antes de cobrar`
  return base
}
