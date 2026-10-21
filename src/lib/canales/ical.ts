/**
 * Lector del feed iCal que Booking.com expone por habitación en el extranet.
 *
 * Lógica **pura**, igual que `csv.ts`: recibe el texto del feed y devuelve
 * reservas normalizadas.
 *
 * ── Qué trae y qué NO trae ──────────────────────────────────────────────────
 *
 * El iCal es el camino más barato: es una URL, no hace falta bajar nada a mano y
 * se puede consultar cada hora. Pero trae **muy poco**:
 *
 *   ✓ fechas de entrada y salida
 *   ✓ un identificador de la reserva (`UID`)
 *   ✓ a veces el apellido del huésped, dentro del `SUMMARY`
 *   ✗ tarifas, importes, comisión
 *   ✗ email, teléfono, país
 *   ✗ cantidad de huéspedes
 *   ✗ nada de tarjeta (y eso está bien: no queremos ese dato)
 *
 * Sirve para **reflejar la ocupación** en la grilla: saber que esa habitación
 * está vendida esas noches. No sirve para facturar ni para contactar al huésped.
 * Para eso está el informe CSV.
 *
 * ⚠️ Igual que el CSV, es de **solo lectura**: no le empuja cupo a Booking, así
 * que **no evita el overbooking**. Ver el ADR 0021.
 *
 * ── Los tres detalles del formato que importan ──────────────────────────────
 *
 * 1. **Desdoblado de líneas.** RFC 5545 corta las líneas largas a 75 octetos y
 *    continúa en la siguiente empezando con un espacio o tabulación. Sin
 *    desdoblar, un `SUMMARY` largo queda partido y el apellido se pierde.
 * 2. **`DTEND` es exclusivo.** Cuando el valor es una fecha (`VALUE=DATE`), el
 *    día de `DTEND` **no** está ocupado. Coincide exactamente con nuestro
 *    `daterange [desde, hasta)`, así que no hay que ajustar nada — pero si
 *    alguien "corrigiera" restando un día, todas las estadías quedarían una
 *    noche cortas.
 * 3. **El feed marca bloqueos, no sólo reservas.** Booking usa el mismo
 *    calendario para fechas cerradas a mano. Un `SUMMARY` de «CLOSED» sin nombre
 *    puede ser cualquiera de las dos cosas, y no hay forma de distinguirlas: se
 *    importan igual, porque en ambos casos la habitación no se puede vender.
 */

import type { CanalVenta, ReservaDeCanal } from '.'

/* ────────────────────────────────────────────────────────── desdoblado ──── */

/**
 * Deshace el plegado de líneas de RFC 5545.
 *
 * Una línea que empieza con espacio o tabulación es continuación de la anterior;
 * el separador y el espacio inicial se descartan.
 */
export function desdoblar(texto: string): string[] {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const salida: string[] = []

  for (const linea of lineas) {
    if ((linea.startsWith(' ') || linea.startsWith('\t')) && salida.length > 0) {
      salida[salida.length - 1] += linea.slice(1)
    } else {
      salida.push(linea)
    }
  }

  return salida
}

/* ─────────────────────────────────────────────────────────── propiedades ──── */

export interface PropiedadIcal {
  nombre: string
  /** Parámetros de la propiedad, p. ej. `VALUE=DATE`. */
  parametros: Record<string, string>
  valor: string
}

/**
 * Parte una línea `NOMBRE;PARAM=VAL:valor`.
 *
 * Hay que respetar las comillas de los parámetros: un `;` o un `:` dentro de un
 * parámetro entrecomillado no separa nada. Pasa poco en los feeds de Booking,
 * pero cuando pasa, un parseo ingenuo corta el valor a la mitad.
 */
export function parsearPropiedad(linea: string): PropiedadIcal | null {
  if (!linea.trim()) return null

  let i = 0
  let enComillas = false
  let corte = -1

  // Se busca el primer `:` fuera de comillas: separa la parte del nombre del valor.
  for (i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (c === '"') enComillas = !enComillas
    else if (c === ':' && !enComillas) {
      corte = i
      break
    }
  }

  if (corte === -1) return null

  const cabecera = linea.slice(0, corte)
  const valor = linea.slice(corte + 1)

  const partes: string[] = []
  let actual = ''
  enComillas = false
  for (const c of cabecera) {
    if (c === '"') {
      enComillas = !enComillas
      continue
    }
    if (c === ';' && !enComillas) {
      partes.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  partes.push(actual)

  const nombre = (partes.shift() ?? '').toUpperCase()
  const parametros: Record<string, string> = {}
  for (const p of partes) {
    const eq = p.indexOf('=')
    if (eq > 0) parametros[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
  }

  return { nombre, parametros, valor }
}

/* ─────────────────────────────────────────────────────────────── fechas ──── */

const RE_FECHA_ICAL = /^(\d{4})(\d{2})(\d{2})/

/**
 * Interpreta una fecha iCal (`20260910` o `20260910T140000Z`) y devuelve ISO.
 *
 * Sólo interesa la parte de fecha: las reservas de alojamiento se cuentan por
 * noches, y la hora del evento en el calendario de Booking no es la del check-in
 * real (el horario lo fija el hotel, `lib/domain/hotel.ts`).
 */
export function interpretarFechaIcal(valor: string): string | null {
  const m = RE_FECHA_ICAL.exec(valor.trim())
  if (!m) return null

  const [, a, mes, d] = m
  const nMes = Number(mes)
  const nDia = Number(d)
  if (nMes < 1 || nMes > 12 || nDia < 1 || nDia > 31) return null

  return `${a}-${mes}-${d}`
}

/* ────────────────────────────────────────────────────────────── SUMMARY ──── */

/**
 * Saca el apellido del `SUMMARY`, si hay alguno.
 *
 * Booking arma cosas como:
 *
 *     CLOSED - Smith
 *     Reserva - Pérez García
 *     CLOSED
 *     Not available
 *
 * Se descartan las palabras de estado (`CLOSED`, `Not available`, `Reserva`,
 * `Booking`) y lo que queda, si queda algo, se toma como nombre. Cuando no queda
 * nada devuelve `null` y quien llama usa un texto genérico: el feed no siempre
 * incluye el nombre, y eso no es motivo para descartar la ocupación.
 */
export function nombreDeSummary(summary: string): string | null {
  const sinEscapar = summary.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ')

  // Se corta por guion o por dos puntos, que es como Booking separa el estado del
  // nombre, y se prueba cada trozo.
  const trozos = sinEscapar.split(/[-–:]/).map((t) => t.trim())

  const RUIDO = /^(closed|not available|blocked|unavailable|reserva|reserved|booking|booked|com)$/i

  for (const t of trozos.reverse()) {
    if (!t) continue
    if (RUIDO.test(t)) continue
    // Un trozo que es sólo números o fechas no es un nombre.
    if (/^[\d\s/.-]+$/.test(t)) continue
    return t
  }

  return null
}

/* ────────────────────────────────────────────────────────────── eventos ──── */

export interface EventoIcal {
  uid: string
  desde: string
  hasta: string
  summary: string
  descripcion: string
}

/**
 * Extrae los `VEVENT` del feed.
 *
 * Se ignora todo lo demás (`VTIMEZONE`, `VALARM`, cabeceras del calendario): sólo
 * interesan los bloques de ocupación.
 */
export function extraerEventos(texto: string): EventoIcal[] {
  const lineas = desdoblar(texto)
  const eventos: EventoIcal[] = []

  let dentro = false
  let actual: Partial<EventoIcal> = {}

  for (const linea of lineas) {
    const p = parsearPropiedad(linea)
    if (!p) continue

    if (p.nombre === 'BEGIN' && p.valor.toUpperCase() === 'VEVENT') {
      dentro = true
      actual = {}
      continue
    }

    if (p.nombre === 'END' && p.valor.toUpperCase() === 'VEVENT') {
      if (dentro && actual.uid && actual.desde && actual.hasta) {
        eventos.push({
          uid: actual.uid,
          desde: actual.desde,
          hasta: actual.hasta,
          summary: actual.summary ?? '',
          descripcion: actual.descripcion ?? '',
        })
      }
      dentro = false
      actual = {}
      continue
    }

    if (!dentro) continue

    switch (p.nombre) {
      case 'UID':
        actual.uid = p.valor.trim()
        break
      case 'DTSTART': {
        const f = interpretarFechaIcal(p.valor)
        if (f) actual.desde = f
        break
      }
      case 'DTEND': {
        const f = interpretarFechaIcal(p.valor)
        if (f) actual.hasta = f
        break
      }
      case 'SUMMARY':
        actual.summary = p.valor.trim()
        break
      case 'DESCRIPTION':
        actual.descripcion = p.valor.trim()
        break
    }
  }

  return eventos
}

/* ────────────────────────────────────────────────────────── resultado ──── */

export interface ResultadoIcal {
  reservas: ReservaDeCanal[]
  /** Eventos que se descartaron, con el motivo. */
  rechazados: { uid: string; motivo: string }[]
  /** Eventos encontrados en el feed, incluidos los rechazados. */
  leidos: number
  /** Cuántos no traían nombre de huésped. */
  sinNombre: number
}

/**
 * Lee el feed completo.
 *
 * `tipoUnidadCodigo` se pasa desde afuera porque **el feed no lo dice**: cada URL
 * del extranet corresponde a una habitación, y qué habitación es lo sabe quien
 * configuró la URL, no el contenido. Es la limitación más incómoda del iCal y la
 * razón por la que hay que dar de alta un feed por tipo de unidad.
 */
export function interpretarIcalBooking(
  texto: string,
  tipoUnidadCodigo: string,
  canal: CanalVenta = 'booking',
): ResultadoIcal {
  const eventos = extraerEventos(texto)
  const reservas: ReservaDeCanal[] = []
  const rechazados: { uid: string; motivo: string }[] = []
  let sinNombre = 0

  for (const e of eventos) {
    if (e.hasta <= e.desde) {
      // Un evento de cero noches no representa ocupación. Pasa con bloqueos mal
      // cargados en el extranet.
      rechazados.push({ uid: e.uid, motivo: 'La salida no es posterior a la entrada.' })
      continue
    }

    const nombre = nombreDeSummary(e.summary)
    if (!nombre) sinNombre++

    reservas.push({
      externalId: e.uid,
      canal,
      tipoUnidadCodigo,
      checkIn: e.desde,
      // `DTEND` ya es exclusivo en iCal: coincide con nuestro `[desde, hasta)`.
      // NO se le resta un día.
      checkOut: e.hasta,
      // El feed no dice cuántas personas. Se pone 1 y no la capacidad del tipo:
      // inventar 4 huéspedes donde puede haber uno ensuciaría el pax de la grilla
      // y los reportes de ocupación.
      huespedes: 1,
      huesped: {
        apellido: nombre ?? 'Reserva Booking',
        nombre: '',
        email: null,
        telefono: null,
        pais: null,
      },
      // El iCal no informa importes. Cero es honesto: significa «el canal no dijo
      // nada», y el total real lo calcula nuestro dominio al importar.
      importeCanal: 0,
      monedaCanal: 'USD',
      comision: null,
      notas: e.descripcion || null,
      // El feed no distingue altas de modificaciones: si el UID ya existe, la
      // lógica de importación resuelve que es una actualización.
      operacion: 'nueva',
      // El iCal no trae momento de emisión. Se usa el de lectura, que es lo único
      // cierto que hay. Consecuencia asumida: entre dos lecturas del mismo feed
      // gana siempre la última, que para un feed de solo lectura es correcto.
      emitidaEn: new Date().toISOString(),
    })
  }

  return { reservas, rechazados, leidos: eventos.length, sinNombre }
}
