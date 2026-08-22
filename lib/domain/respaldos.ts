/**
 * Reglas de los respaldos de datos (lógica pura).
 *
 * ── La aclaración que este módulo existe para no dejar implícita ─────────────
 *
 * **Esta aplicación no puede hacer un backup de Postgres.** Los backups de la base
 * los hace la plataforma (Supabase): copias diarias y, según el plan,
 * point-in-time recovery. Nada de eso se dispara desde acá, y no hay una API que
 * permita hacerlo desde la aplicación.
 *
 * Un botón que dijera «Hacer backup» y en realidad no hiciera un backup sería la
 * peor función del sistema: alguien lo apretaría, vería «listo», y descubriría la
 * verdad el día que necesite restaurar.
 *
 * ── Qué sí se puede hacer, y por qué vale ───────────────────────────────────
 *
 * Una **exportación completa de los datos operativos**, que el hotel se baja y
 * guarda donde quiera. Es distinto de un backup de la base —no incluye usuarios de
 * auth, ni políticas, ni funciones— pero responde la pregunta que de verdad le
 * importa al hotel: *«si esto se cae, ¿tengo mis reservas?»*. Y a diferencia del
 * backup de la plataforma, es verificable: es un archivo que se puede abrir.
 *
 * Así que la pantalla hace tres cosas honestas: exporta, registra cuándo fue la
 * última vez, y **explica quién es responsable de qué**.
 */

/** Una tabla que entra en la exportación, con el motivo. */
export interface TablaRespaldo {
  tabla: string
  /** Qué se pierde si no está. Se muestra en pantalla. */
  porQue: string
  /** Contiene datos personales: obliga a tratar el archivo con cuidado. */
  datosPersonales: boolean
}

/**
 * Qué se exporta y por qué.
 *
 * El orden es el de dependencia: los catálogos primero y los movimientos después,
 * de modo que quien tenga que reconstruir la base pueda insertar en este orden sin
 * chocar con claves foráneas.
 *
 * **No se exporta todo.** Queda afuera lo que se puede regenerar
 * (`intentos_limitados`, `cotizaciones` automáticas) y lo que no es del hotel
 * (`auditoria`, que crece sin techo y no sirve para reconstruir la operación).
 * Exportar de más hace el archivo más grande y más peligroso, no más útil.
 */
export const TABLAS_RESPALDO: readonly TablaRespaldo[] = [
  // ── Catálogo ──
  {
    tabla: 'tipos_unidad',
    porQue: 'Sin los tipos no se puede reconstruir el inventario ni las tarifas.',
    datosPersonales: false,
  },
  {
    tabla: 'unidades',
    porQue: 'Las habitaciones y cabañas del hotel, con su ubicación.',
    datosPersonales: false,
  },
  {
    tabla: 'temporadas',
    porQue: 'Definen qué tarifa aplica en cada fecha.',
    datosPersonales: false,
  },
  {
    tabla: 'temporada_rangos',
    porQue: 'Las fechas de cada temporada. Sin esto no se puede cotizar nada.',
    datosPersonales: false,
  },
  {
    tabla: 'tarifas',
    porQue: 'El tarifario completo: es el dato comercial más difícil de recuperar.',
    datosPersonales: false,
  },
  {
    tabla: 'departamentos',
    porQue: 'La estructura de la cuenta del huésped.',
    datosPersonales: false,
  },
  {
    tabla: 'productos_servicios',
    porQue: 'El catálogo de consumos con sus precios.',
    datosPersonales: false,
  },
  {
    tabla: 'politicas_cancelacion',
    porQue: 'Las condiciones pactadas con cada huésped.',
    datosPersonales: false,
  },
  {
    tabla: 'promociones',
    porQue: 'Descuentos vigentes y su vigencia.',
    datosPersonales: false,
  },
  {
    tabla: 'agencias',
    porQue: 'Los convenios comerciales y sus descuentos.',
    datosPersonales: true,
  },
  {
    tabla: 'proveedores',
    porQue: 'A quién le debe el hotel.',
    datosPersonales: true,
  },

  // ── Operación ──
  {
    tabla: 'huespedes',
    porQue: 'El historial de clientes. Es irrecuperable: no está en ningún otro lado.',
    datosPersonales: true,
  },
  {
    tabla: 'reservas',
    porQue: 'Las reservas con sus totales y condiciones. El dato central del sistema.',
    datosPersonales: true,
  },
  {
    tabla: 'estadias',
    porQue: 'Qué unidad ocupó cada reserva y cuándo. Sin esto no hay ocupación ni historia.',
    datosPersonales: false,
  },
  {
    tabla: 'reserva_huespedes',
    porQue: 'Los acompañantes de cada reserva.',
    datosPersonales: true,
  },
  {
    tabla: 'pagos',
    porQue: 'Todo lo cobrado. Perderlo significa no saber quién pagó qué.',
    datosPersonales: false,
  },
  {
    tabla: 'consumos',
    porQue: 'Las líneas de la cuenta de cada huésped.',
    datosPersonales: false,
  },
  {
    tabla: 'facturas',
    porQue: 'Los comprobantes emitidos, con su CAE. Tienen valor fiscal.',
    datosPersonales: false,
  },
  {
    tabla: 'movimientos_cuenta',
    porQue: 'La cuenta corriente de las agencias.',
    datosPersonales: false,
  },
  {
    tabla: 'movimientos_proveedor',
    porQue: 'Las cuentas por pagar.',
    datosPersonales: false,
  },
  {
    tabla: 'contratos',
    porQue: 'Los contratos y su estado de firma.',
    datosPersonales: true,
  },
  {
    tabla: 'canal_reservas',
    porQue: 'Lo que llegó de Booking, incluido lo que todavía no se importó.',
    datosPersonales: true,
  },
]

/** Cuántas tablas del respaldo contienen datos personales. */
export function tablasConDatosPersonales(): string[] {
  return TABLAS_RESPALDO.filter((t) => t.datosPersonales).map((t) => t.tabla)
}

/* ───────────────────────────────────────────────────────────── frescura ──── */

/**
 * Cada cuántos días conviene exportar.
 *
 * Siete: es lo que el hotel puede rehacer de memoria si algo se pierde. Con un mes
 * de hueco, reconstruir las reservas de las últimas cuatro semanas es imposible.
 */
export const DIAS_RECOMENDADOS = 7

/**
 * Días a partir de los cuales el respaldo es claramente viejo.
 *
 * Treinta. Entre 7 y 30 la pantalla sugiere; a partir de 30 avisa fuerte.
 */
export const DIAS_CRITICOS = 30

export type EstadoRespaldo = 'nunca' | 'al_dia' | 'conviene' | 'vencido'

export const ETIQUETAS_ESTADO_RESPALDO: Record<EstadoRespaldo, string> = {
  nunca: 'Nunca se exportó',
  al_dia: 'Al día',
  conviene: 'Conviene exportar',
  vencido: 'Hace demasiado',
}

/**
 * Estado del respaldo según cuándo fue el último.
 *
 * `null` significa que nunca se hizo, y se distingue de «viejo» a propósito: son
 * dos situaciones distintas y la primera merece un mensaje distinto —nadie configuró
 * esto todavía— que la segunda —alguien lo hacía y dejó de hacerlo—.
 */
export function estadoRespaldo(ultimoISO: string | null, ahora: Date): EstadoRespaldo {
  if (!ultimoISO) return 'nunca'

  const t = Date.parse(ultimoISO)
  if (Number.isNaN(t)) return 'nunca'

  const dias = Math.floor((ahora.getTime() - t) / 86_400_000)
  if (dias >= DIAS_CRITICOS) return 'vencido'
  if (dias >= DIAS_RECOMENDADOS) return 'conviene'
  return 'al_dia'
}

/** Días transcurridos desde el último respaldo, o `null` si nunca hubo. */
export function diasDesde(ultimoISO: string | null, ahora: Date): number | null {
  if (!ultimoISO) return null
  const t = Date.parse(ultimoISO)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000))
}

/**
 * Nombre del archivo de exportación.
 *
 * Lleva la fecha en formato ISO al principio para que los archivos se ordenen
 * cronológicamente solos en cualquier carpeta.
 */
export function nombreArchivo(ahora: Date): string {
  const iso = ahora.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `blanca-patagonia-respaldo-${iso}.json`
}

/** Tamaño legible, para que «12345678» no sea el dato que se muestra. */
export function tamanioLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
