/**
 * Catálogo de informes de gestión.
 *
 * Existe porque el hotel pidió «poder usar múltiples informes sin tener que
 * cerrar las ventanas». En WinPAX eso era una limitación real —Oracle Forms
 * abre ventanas modales y hay que cerrar una para abrir otra—; acá no hay
 * ventanas, pero el problema equivalente sí estaba: los seis informes vivían en
 * **una sola pantalla con un solo filtro de mes**, así que no se podía tener la
 * venta por categoría de agosto al lado de la rentabilidad por canal de
 * septiembre.
 *
 * La solución es que cada informe tenga su propia dirección y sus propios
 * filtros. Este módulo es la lista, y está en el dominio —y no dentro de la
 * pantalla— por dos razones: la usa el índice para dibujar las tarjetas y la
 * usa el capítulo de Ayuda, y con dos listas separadas un informe nuevo aparece
 * en una y falta en la otra.
 */

export type IdInforme = 'ocupacion' | 'categorias' | 'canales' | 'satisfaccion' | 'estados'

export interface Informe {
  id: IdInforme
  titulo: string
  /** Qué muestra. */
  descripcion: string
  /** La pregunta que contesta, en el idioma del hotel. */
  pregunta: string
  /**
   * Si depende del mes elegido.
   *
   * Los históricos (`false`) no llevan el selector: ponerles uno que no cambia
   * nada haría creer que el número mostrado es el de ese mes.
   */
  porMes: boolean
}

export const INFORMES: readonly Informe[] = [
  {
    id: 'ocupacion',
    titulo: 'Ocupación, ADR y RevPAR',
    descripcion: 'Los tres indicadores del mes, con su variación y la evolución de seis meses.',
    pregunta: '¿Cómo venimos contra el mes pasado?',
    porMes: true,
  },
  {
    id: 'categorias',
    titulo: 'Venta por categoría',
    descripcion: 'Noches, ingreso, ADR y ocupación de cada tipo de habitación y cabaña.',
    pregunta: '¿Qué tipo de alojamiento nos deja más plata?',
    porMes: true,
  },
  {
    id: 'canales',
    titulo: 'Rentabilidad por canal',
    descripcion: 'Bruto, comisión y neto de cada canal, más el ranking histórico por origen.',
    pregunta: '¿Qué nos deja cada canal después de su comisión?',
    porMes: true,
  },
  {
    id: 'satisfaccion',
    titulo: 'Satisfacción del huésped',
    descripcion: 'NPS de las encuestas posteriores al check-out y tasa de respuesta.',
    pregunta: '¿Qué opinan los que ya se fueron?',
    porMes: false,
  },
  {
    id: 'estados',
    titulo: 'Reservas por estado',
    descripcion: 'Distribución histórica entre pendientes, confirmadas, canceladas y no-show.',
    pregunta: '¿Cuántas reservas se nos caen?',
    porMes: false,
  },
]

/** La ruta de un informe, con el mes cuando corresponde. */
export function rutaDeInforme(informe: Informe, mes?: string): string {
  const base = `/panel/reportes/${informe.id}`
  return informe.porMes && mes ? `${base}?mes=${mes}` : base
}

/** Busca un informe por su id. */
export function informePorId(id: string): Informe | undefined {
  return INFORMES.find((i) => i.id === id)
}

const RE_MES = /^\d{4}-\d{2}$/

/**
 * Valida el mes que llega por la URL.
 *
 * Va acá y no en cada pantalla porque son cinco informes leyendo el mismo
 * parámetro: con la expresión copiada cinco veces, la que se olvide de validar
 * le pasa a la base lo que venga escrito en la barra de direcciones.
 */
export function mesValido(crudo: string | undefined, porDefecto: string): string {
  return RE_MES.test(crudo ?? '') ? (crudo as string) : porDefecto
}
