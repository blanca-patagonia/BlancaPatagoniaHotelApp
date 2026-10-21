import { diasEntre, listaDias } from '@/lib/fechas'

/**
 * Feed iCal de **salida**: el calendario de ocupación que el hotel publica para que
 * Booking, Airbnb o Expedia cierren fechas solos.
 *
 * Es el complemento del de entrada (`ical.ts` lo lee, `booking-ical.ts` lo sondea).
 * Hoy, cuando el hotel se queda sin lugar, alguien tiene que entrar al extranet y
 * cerrar las fechas a mano — justo el día de mucho trabajo, que es cuando no se hace.
 *
 * ── Lo que este feed NO resuelve, y va escrito acá y en el ADR 0022 ──────────
 *
 * **Angosta la ventana del overbooking; no la cierra.** Tres razones concretas:
 *
 *  1. **Latencia.** El otro lado relee el calendario cuando quiere —Booking habla de
 *     «varias horas» y no promete un intervalo—. Entre que se vende la última unidad
 *     y que el canal se entera hay un hueco, y en ese hueco puede vender.
 *  2. **No hay acuse.** Nadie avisa que leyó, ni que dejó de leer. Por eso el handler
 *     registra cada lectura: la pantalla puede decir «lo leyeron hace 3 h» o «hace 6
 *     días», que es información que hoy no existe.
 *  3. **Granularidad.** El iCal expresa «ocupado», no «me quedan 2». Ver abajo.
 *
 * Por eso `capacidades().publicaDisponibilidad` **sigue en `false`**: esto es un
 * empujón en una dirección que el otro lado puede ignorar. La solución real es un
 * channel manager, y es una contratación del hotel (ADR 0021).
 *
 * ── La decisión que importa: cuándo se marca ocupado ─────────────────────────
 *
 * Un calendario dice «ocupado» o «libre», sin cantidades. El tipo `HOST-DBL-STD`
 * tiene 3 unidades: si se marca ocupado en cuanto se vende **una**, se cierran ventas
 * de las otras dos y el feed le cuesta plata al hotel — lo contrario de lo que se
 * busca.
 *
 * Entonces una noche se publica como ocupada **sólo cuando no queda ninguna unidad
 * activa del tipo libre**. Nunca cierra una venta que el hotel podía tomar.
 *
 * La contracara es que con varias unidades por tipo el feed sirve poco: recién avisa
 * cuando ya está todo vendido. Rinde de verdad cuando **cada unidad es una
 * habitación separada en el extranet** —ahí se pide un feed por unidad—, y eso es
 * configuración del extranet, no algo que se arregle con código.
 */

/** Un rango de noches ocupadas, `[desde, hasta)` con el fin excluido, como `daterange`. */
export interface BloqueOcupado {
  desde: string
  hasta: string
}

/** Una estadía, reducida a lo único que el cálculo necesita. */
export interface EstadiaOcupada {
  unidadId: string
  checkIn: string
  checkOut: string
}

/**
 * Las noches en que **no queda nada libre**, agrupadas en rangos contiguos.
 *
 * `unidadesActivas` es cuántas unidades del tipo se pueden vender hoy. Para un feed
 * por unidad se pasa `1` y las estadías ya filtradas: sale el mismo cálculo.
 *
 * Las estadías pueden empezar antes o terminar después de la ventana; se recortan.
 */
export function calcularBloquesOcupados(
  estadias: readonly EstadiaOcupada[],
  unidadesActivas: number,
  desde: string,
  hasta: string,
): BloqueOcupado[] {
  const noches = diasEntre(desde, hasta)
  if (noches <= 0) return []

  // Qué unidades distintas están ocupadas cada noche. Un `Set` porque dos estadías de
  // la misma unidad en la misma noche no pueden pasar —lo impide la exclusión GiST—
  // pero contarlas dos veces daría el tipo por lleno sin estarlo.
  const porNoche = new Map<string, Set<string>>()

  for (const e of estadias) {
    const inicio = e.checkIn < desde ? desde : e.checkIn
    const fin = e.checkOut > hasta ? hasta : e.checkOut
    const cantidad = diasEntre(inicio, fin)
    if (cantidad <= 0) continue

    for (const noche of listaDias(inicio, cantidad)) {
      const enEsaNoche = porNoche.get(noche) ?? new Set<string>()
      enEsaNoche.add(e.unidadId)
      porNoche.set(noche, enEsaNoche)
    }
  }

  const bloques: BloqueOcupado[] = []
  let arranque: string | null = null

  for (const noche of listaDias(desde, noches)) {
    /*
      Con `unidadesActivas` en cero esto da verdadero siempre, y la ventana entera
      sale ocupada. Es lo correcto y no un accidente: pasa cuando se dan de baja
      todas las unidades de un tipo por refacción, y es justo cuando más importa que
      el canal se entere. Estaba escrito como una guarda aparte antes del bucle,
      hasta que una prueba de mutación mostró que borrarla no cambiaba ni un
      resultado: era código muerto explicando algo que este renglón ya hacía.
    */
    const llena = (porNoche.get(noche)?.size ?? 0) >= unidadesActivas

    if (llena && arranque === null) arranque = noche
    if (!llena && arranque !== null) {
      // La primera noche libre es el fin excluido del bloque.
      bloques.push({ desde: arranque, hasta: noche })
      arranque = null
    }
  }

  if (arranque !== null) bloques.push({ desde: arranque, hasta })

  return bloques
}

/**
 * Cómo contarle a quien mira la pantalla si el canal está leyendo el feed.
 *
 * Es la única señal disponible: el iCal no tiene acuse de recibo, así que lo más que
 * se puede afirmar es «pasaron a buscarlo», nunca «lo aplicaron». El texto lo dice
 * con esas palabras a propósito — «sincronizado» daría una garantía que no existe.
 *
 * Un feed que nadie leyó **nunca** y uno que dejaron de leer hace una semana son los
 * dos casos que importan, y son los que hoy no se ven en ningún lado.
 */
export function describirUltimaLectura(iso: string | null, ahora: Date): string {
  if (!iso) return 'Todavía nadie pasó a buscarlo'

  const horas = Math.floor((ahora.getTime() - new Date(iso).getTime()) / 3_600_000)

  if (horas < 1) return 'Lo leyeron hace menos de una hora'
  if (horas < 24) return `Lo leyeron hace ${horas} h`

  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'Lo leyeron ayer'

  // A partir de acá el dato deja de ser tranquilizador y pasa a ser un aviso: si el
  // canal dejó de leer, el hotel cree que publica bloqueos y no publica nada.
  return `Hace ${dias} días que no lo leen`
}

/* ──────────────────────────────────────────────── generación del archivo ──── */

/** `2026-09-01` → `20260901`, que es como el RFC 5545 escribe una fecha. */
function fechaIcal(iso: string): string {
  return iso.replaceAll('-', '')
}

/** Marca de generación en UTC: `20260822T143000Z`. */
function selloIcal(momento: Date): string {
  return `${momento.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

/**
 * Escapa un texto para un valor iCal.
 *
 * En el RFC la coma y el punto y coma **separan valores**: un nombre de tipo como
 * «Doble, vista al lago» partiría el campo en dos y el parser del otro lado leería
 * cualquier cosa. Es la misma clase de problema que los filtros `or` de PostgREST.
 */
function escaparTexto(valor: string): string {
  return valor
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n')
}

/**
 * Pliega una línea a 75 octetos, como exige el RFC 5545.
 *
 * Se cuentan **octetos y no caracteres**: «Cabaña» ocupa 7 bytes en UTF-8 y no 6.
 * Y se recorre por punto de código para no partir un carácter multibyte al medio,
 * que dejaría el archivo con basura justo en los nombres con acento — o sea, en
 * casi todos los de este hotel.
 */
function plegar(linea: string): string {
  const codificador = new TextEncoder()
  if (codificador.encode(linea).length <= 75) return linea

  const partes: string[] = []
  let actual = ''
  let octetos = 0

  for (const caracter of linea) {
    const suma = codificador.encode(caracter).length
    // 75 la primera línea; 74 las siguientes, porque la continuación gasta un
    // octeto en el espacio con el que arranca.
    const techo = partes.length === 0 ? 75 : 74

    if (octetos + suma > techo) {
      partes.push(actual)
      actual = ''
      octetos = 0
    }

    actual += caracter
    octetos += suma
  }

  partes.push(actual)
  return partes.join('\r\n ')
}

export interface OpcionesIcal {
  /** Lo que va a ver quien abra el calendario. Nombre del tipo o de la unidad. */
  nombre: string
  /** Identificador estable y **sin datos personales**, para armar los `UID`. */
  calendarioId: string
  bloques: readonly BloqueOcupado[]
  /** Momento de generación. Entra por parámetro para que la función sea testeable. */
  generadoEn: Date
}

/**
 * Arma el archivo `.ics`.
 *
 * ⚠️ **El cuerpo no lleva un solo dato personal.** Ni apellido, ni correo, ni código
 * de reserva, ni precio (ADR 0016). La URL es un token al portador: quien la tenga
 * —o la encuentre en el historial de alguien— ve exactamente esto y nada más. El
 * `SUMMARY` es la constante «Ocupado» a propósito, y hay un test que lo verifica
 * contra datos sembrados en vez de creerle a este comentario.
 *
 * Los `UID` son estables entre generaciones: el mismo bloque devuelve el mismo
 * identificador, así el cliente de calendario actualiza el evento en lugar de
 * acumular duplicados en cada lectura.
 */
export function generarIcal({ nombre, calendarioId, bloques, generadoEn }: OpcionesIcal): string {
  const sello = selloIcal(generadoEn)

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blanca Patagonia//PMS//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaparTexto(nombre)}`,
  ]

  for (const bloque of bloques) {
    lineas.push(
      'BEGIN:VEVENT',
      `UID:${calendarioId}-${fechaIcal(bloque.desde)}-${fechaIcal(bloque.hasta)}@blancapatagonia`,
      `DTSTAMP:${sello}`,
      `DTSTART;VALUE=DATE:${fechaIcal(bloque.desde)}`,
      `DTEND;VALUE=DATE:${fechaIcal(bloque.hasta)}`,
      'SUMMARY:Ocupado',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    )
  }

  lineas.push('END:VCALENDAR')

  // CRLF y salto final: lo pide el RFC y hay parsers estrictos que rechazan el
  // archivo sin él.
  return lineas.map(plegar).join('\r\n') + '\r\n'
}
