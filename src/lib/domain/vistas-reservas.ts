/**
 * Vistas operativas del listado de reservas (lógica pura).
 *
 * ── Qué resuelve ────────────────────────────────────────────────────────────
 *
 * WinPAX tenía, arriba del listado, una fila de filtros que son el día a día de
 * recepción: **en el hotel · llegadas hoy · salidas hoy · pendientes · no-show ·
 * canceladas · check-out · grupos · particulares**. Este sistema tenía chips por
 * estado, que cubren cinco de los nueve. Los cuatro que faltaban son justamente
 * los que más se usan, y ninguno es un estado:
 *
 * · «llegadas hoy» y «salidas hoy» son consultas **por fecha**.
 * · «grupos» y «particulares» son consultas **por agrupación comercial**.
 *
 * ── Por qué acá y no en la consulta ─────────────────────────────────────────
 *
 * Cada vista es una definición de negocio con decisiones discutibles —¿una
 * cancelada aparece en las llegadas de hoy?— y ninguna necesita base para
 * probarse. La consulta traduce esto a filtros de PostgREST; qué significa cada
 * vista se decide acá.
 */

import { ESTADOS_RESERVA, type EstadoReserva } from './reservas'
import { resumenDeCuenta, type Pago } from './pagos'

export const VISTAS_RESERVAS = [
  'en_casa',
  'llegadas',
  'salidas',
  'por_cobrar',
  'sin_facturar',
  'pendientes',
  'confirmadas',
  'checkout',
  'no_show',
  'canceladas',
  'grupos',
  'particulares',
] as const

export type VistaReservas = (typeof VISTAS_RESERVAS)[number]

/** Cómo se filtra por fecha, relativo al día de referencia. */
export type FiltroFecha = 'llega' | 'sale'

/** Cómo se filtra por agrupación comercial. */
export type FiltroAgrupacion = 'grupo' | 'particular'

/**
 * Vistas que no salen de una columna sino de una CUENTA: el saldo se calcula
 * (alojamiento + consumos − pagos) y «sin facturar» es la ausencia de una fila en
 * `facturas`. Son las dos que el tablero de Inicio anuncia en «Requiere
 * atención», y por eso existen: el aviso decía «7 reservas con saldo pendiente»
 * y el enlace abría el listado entero.
 */
export type FiltroCalculado = 'saldo_vencido' | 'sin_facturar'

export interface DefinicionVista {
  etiqueta: string
  /** Texto del estado vacío: dice qué se estaba buscando, no «no hay nada». */
  vacio: string
  /** Estados incluidos. Ausente = cualquiera. */
  estados?: readonly EstadoReserva[]
  fecha?: FiltroFecha
  agrupacion?: FiltroAgrupacion
  calculada?: FiltroCalculado
}

/**
 * Estados de una reserva que todavía puede llegar o está en el hotel.
 *
 * No se reusa `ESTADOS_ACTIVOS` de `reservas.ts` porque ése incluye `in_house` y
 * se usa para la ocupación: acá hacen falta subconjuntos distintos según la vista.
 */
const POR_LLEGAR: readonly EstadoReserva[] = ['pendiente', 'confirmada', 'pagada']

/**
 * Cuántos días hacia atrás (por la fecha de salida) se mira para «consumos sin
 * facturar». `checkout` es un estado terminal: sin ventana la cuenta sumaría
 * toda la historia del hotel, y una cuenta sin facturar hace más de dos meses ya
 * no es «atender hoy» sino un tema de auditoría.
 */
export const VENTANA_SIN_FACTURAR_DIAS = 60

/**
 * Estados facturables (`ESTADOS_FACTURABLES` de `facturacion.ts`). Se repite la
 * lista en vez de importarla para que este módulo no dependa del de facturación;
 * `tests/dominio/vistas-reservas.test.ts` verifica que sean la misma.
 */
const FACTURABLES: readonly EstadoReserva[] = ['pagada', 'in_house', 'checkout']

export const VISTAS: Record<VistaReservas, DefinicionVista> = {
  en_casa: {
    etiqueta: 'En el hotel',
    vacio: 'No hay nadie alojado en este momento.',
    // Se define por ESTADO y no por fecha a propósito: «en el hotel» significa
    // que recepción hizo el check-in. Una reserva cuyas fechas incluyen hoy pero
    // que nadie registró no está en el hotel — está sin aparecer, que es
    // justamente lo que recepción necesita distinguir.
    estados: ['in_house'],
  },

  llegadas: {
    etiqueta: 'Llegadas hoy',
    vacio: 'No hay llegadas previstas para hoy.',
    fecha: 'llega',
    // Incluye `in_house`: es la planilla de llegadas del día, y quien ya se
    // registró tiene que seguir figurando en ella. Lo que se excluye es lo que no
    // va a llegar (cancelada, no-show): mostrarlas obligaría a leer la columna de
    // estado para saber a quién esperar.
    estados: [...POR_LLEGAR, 'in_house'],
  },

  salidas: {
    etiqueta: 'Salidas hoy',
    vacio: 'No hay salidas previstas para hoy.',
    fecha: 'sale',
    // Incluye `checkout`: quien ya se fue tiene que seguir en la planilla del día,
    // o recepción no puede distinguir «ya salió» de «se fue sin avisar».
    estados: ['confirmada', 'pagada', 'in_house', 'checkout'],
  },

  por_cobrar: {
    etiqueta: 'Saldo pendiente',
    vacio: 'No hay reservas que ya deberían estar cobradas y tengan saldo.',
    // Sólo las que YA deberían estar cobradas (ver `saldoVencido`): una
    // confirmada para dentro de un mes con la seña pagada es el curso normal.
    estados: ['confirmada', 'in_house'],
    calculada: 'saldo_vencido',
  },

  sin_facturar: {
    etiqueta: 'Consumos sin facturar',
    vacio: 'No hay cuentas con consumos pendientes de facturar.',
    estados: FACTURABLES,
    calculada: 'sin_facturar',
  },

  pendientes: {
    etiqueta: 'Pendientes',
    vacio: 'No hay reservas pendientes de confirmación.',
    estados: ['pendiente'],
  },

  confirmadas: {
    etiqueta: 'Confirmadas',
    vacio: 'No hay reservas confirmadas.',
    estados: ['confirmada', 'pagada'],
  },

  checkout: {
    etiqueta: 'Check-out',
    vacio: 'Todavía no hubo check-outs.',
    estados: ['checkout'],
  },

  no_show: {
    etiqueta: 'No-show',
    vacio: 'No hay no-shows registrados.',
    estados: ['no_show'],
  },

  canceladas: {
    etiqueta: 'Canceladas',
    vacio: 'No hay reservas canceladas.',
    estados: ['cancelada'],
  },

  grupos: {
    etiqueta: 'Grupos',
    vacio: 'No hay reservas grupales.',
    agrupacion: 'grupo',
  },

  particulares: {
    etiqueta: 'Particulares',
    vacio: 'No hay reservas particulares.',
    // Sin grupo Y sin agencia. Un «particular» en la jerga del hotel es quien
    // reservó por sí mismo: si vino por agencia no es particular, aunque haya
    // venido solo.
    agrupacion: 'particular',
  },
}

export function esVista(v: string | undefined): v is VistaReservas {
  return !!v && (VISTAS_RESERVAS as readonly string[]).includes(v)
}

export function definicionDe(v: VistaReservas): DefinicionVista {
  return VISTAS[v]
}

/**
 * Las vistas que se muestran como chips, en el orden de la barra.
 *
 * El orden sigue el recorrido del día de recepción, no el alfabético: primero lo
 * que está pasando ahora (en el hotel, llegadas, salidas), después lo que hay que
 * gestionar (pendientes, confirmadas), después lo cerrado (check-out, no-show,
 * canceladas) y al final los cortes comerciales (grupos, particulares).
 */
export const ORDEN_CHIPS: readonly VistaReservas[] = [
  'en_casa',
  'llegadas',
  'salidas',
  'por_cobrar',
  'sin_facturar',
  'pendientes',
  'confirmadas',
  'checkout',
  'no_show',
  'canceladas',
  'grupos',
  'particulares',
]

/**
 * Comprobación de cobertura: toda vista declarada tiene que estar en los chips.
 *
 * Es el mismo criterio que `areasSinGrupo()` en `navegacion.ts`: una vista que se
 * define y no se muestra es código muerto que nadie descubre, porque no falla.
 */
export function vistasSinChip(): VistaReservas[] {
  return VISTAS_RESERVAS.filter((v) => !ORDEN_CHIPS.includes(v))
}

/**
 * Comprobación de coherencia: los estados que nombra cada vista tienen que
 * existir.
 *
 * Un estado mal escrito en una definición no rompe nada visible: el filtro
 * devuelve cero filas y la pantalla dice «no hay reservas», que es exactamente
 * lo que diría si de verdad no hubiera ninguna.
 */
export function estadosDesconocidos(): string[] {
  const validos = new Set<string>(ESTADOS_RESERVA)
  const malos: string[] = []
  for (const v of VISTAS_RESERVAS) {
    for (const e of VISTAS[v].estados ?? []) {
      if (!validos.has(e)) malos.push(`${v}: ${e}`)
    }
  }
  return malos
}

/**
 * Estados que NO tienen ya una vista propia.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * La pantalla mostraba dos filas de chips: las diez vistas operativas arriba y
 * los siete estados abajo. **Cinco de los siete estados hacían exactamente lo
 * mismo que una vista**: «Pendiente» = la vista Pendientes, «In house» = En el
 * hotel, y lo mismo con Check-out, Cancelada y No-show.
 *
 * Dos caminos idénticos para el mismo resultado no son una comodidad: obligan a
 * pararse a decidir cuál usar, y hacen sospechar que dan resultados distintos.
 * Encima son excluyentes —elegir uno borra el otro de la URL—, así que la
 * pantalla ofrecía diecisiete chips para once cortes reales.
 *
 * Quedan los dos que sí agregan algo: «Confirmada» y «Pagada» por separado,
 * porque la vista «Confirmadas» las junta y a veces hace falta distinguirlas —
 * saber quién todavía debe la seña no es lo mismo que saber quién ya pagó.
 *
 * Se calcula en vez de escribirse a mano: si mañana se agrega una vista para un
 * estado, su chip duplicado desaparece solo. Una lista fija habría vuelto a
 * divergir en cuanto alguien tocara `VISTAS`.
 */
export function estadosSinVistaPropia(): EstadoReserva[] {
  const conVistaPropia = new Set<EstadoReserva>()
  for (const vista of VISTAS_RESERVAS) {
    const def = VISTAS[vista]
    // Solo cuenta como «vista propia» si la vista aísla ESE estado y nada más.
    // «Confirmadas» agrupa dos, así que no deja sin sentido a ninguno de los dos.
    if (def.estados?.length === 1 && !def.fecha && !def.agrupacion && !def.calculada) {
      conVistaPropia.add(def.estados[0])
    }
  }
  return ESTADOS_RESERVA.filter((e) => !conVistaPropia.has(e))
}

/* ─────────────────────────────── saldo vencido ──── */

/** Lo que hace falta de una reserva para decidir si su saldo ya está vencido. */
export interface ReservaConCuenta {
  estado: string
  /** Total del alojamiento, con IVA. */
  total: number
  pagos: Pago[]
  consumos: { cantidad: number; precioUnitario: number }[]
  estadias: { check_in: string; check_out: string }[]
}

/**
 * ¿La reserva tiene saldo y ya debería estar cobrada?
 *
 * El saldo se mide contra la cuenta CONSOLIDADA (alojamiento + consumos), con el
 * mismo `resumenDeCuenta` que usan el listado, la ficha y el cobro: no hay una
 * segunda noción de «pendiente» que con el tiempo diverja.
 *
 * «Ya debería» depende del estado: una `confirmada` cuyo check-in ya pasó (tendría
 * que estar alojada y pagando) o una `in_house` cuyo check-out es hoy o ya pasó
 * (se está yendo). Cualquier otra con saldo es el curso normal de una reserva y
 * contarla inundaría «Requiere atención».
 */
export function saldoVencido(r: ReservaConCuenta, hoy: string): boolean {
  if (r.estado !== 'confirmada' && r.estado !== 'in_house') return false
  const { saldo } = resumenDeCuenta(r.total, r.consumos, r.pagos)
  if (saldo <= 0) return false
  const fechas = r.estadias.map((e) => (r.estado === 'in_house' ? e.check_out : e.check_in))
  return fechas.some((f) => f <= hoy)
}
