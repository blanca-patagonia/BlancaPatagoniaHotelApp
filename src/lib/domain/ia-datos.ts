/**
 * Lo que las herramientas del asistente le devuelven al modelo, ya armado y
 * sin datos personales: el resumen del día, los movimientos de varios días, el
 * código de reserva normalizado y el enmascarado del texto libre.
 *
 * Todo lo de acá viaja a un tercero (el proveedor de IA): por eso vive junto,
 * en un módulo puro y con tests, y no repartido por las herramientas.
 */

import { parsearPeriodo } from '@/lib/fechas'

/* ──────────────────────────────────────────────────── operación del día ── */


export interface EstadiaDelDia {
  periodo: string
  unidad: { nombre: string } | null
  reserva: { codigo: string } | null
}

/** Tope de nombres por lista: lo que viaja al modelo no tiene que crecer sin techo. */
const TOPE_LISTA = 30

/**
 * ⚠️ **Sin datos personales.** Lo que devuelven las herramientas viaja al
 * proveedor de IA, un tercero. En el plan gratuito de Gemini, Google puede usar
 * lo que recibe para mejorar sus modelos. El sistema decidió que los datos de
 * huéspedes no salgan (ADR 0029), así que el asistente trabaja con el código de
 * reserva y la unidad: con eso quien pregunta abre la ficha en el panel.
 *
 * Resumen del día para el asistente, con la MISMA regla que el tablero
 * (`panel/page.tsx`): llega quien empieza ese día, se va quien termina ese día,
 * y ocupa la unidad quien tiene la noche de ese día (`[desde, hasta)`).
 */
export function resumirDia(estadias: readonly EstadiaDelDia[], dia: string, unidadesActivas: number) {
  const persona = (e: EstadiaDelDia) => ({
    reserva: e.reserva?.codigo ?? '',
    unidad: e.unidad?.nombre ?? '',
  })
  const llegadas = []
  const salidas = []
  let ocupadas = 0
  for (const e of estadias) {
    const p = parsearPeriodo(e.periodo)
    if (dia >= p.desde && dia < p.hasta) ocupadas++
    if (p.desde === dia) llegadas.push(persona(e))
    if (p.hasta === dia) salidas.push(persona(e))
  }
  return {
    fecha: dia,
    llegadas: llegadas.slice(0, TOPE_LISTA),
    cantidadLlegadas: llegadas.length,
    salidas: salidas.slice(0, TOPE_LISTA),
    cantidadSalidas: salidas.length,
    unidadesOcupadas: ocupadas,
    unidadesLibres: Math.max(0, unidadesActivas - ocupadas),
    unidadesActivas,
    ocupacionPct: unidadesActivas ? Math.round((ocupadas / unidadesActivas) * 100) : null,
  }
}

/* ───────────────────────────────── datos personales en el texto libre ── */

const EMAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi
/** CUIT/CUIL completo (`20-30123456-7` o `20301234567`). */
const CUIT = /(?<![\w-])\d{2}-?\d{8}-?\d(?![\w-])/g
/** `+54 9 2902 12-3456` y parecidos: el `+` inicial es lo que lo distingue de una fecha. */
const TELEFONO_INTERNACIONAL = /\+\d[\d\s-]{7,}\d/g
/**
 * Siete o más dígitos seguidos, con o sin puntos o espacios de miles: DNI
 * (`30.123.456`), CUIT/CUIL (el tramo central), teléfono local, tarjeta.
 * NO toca códigos de reserva (`BP-260910-9078`: tramos de 6 y 4 cifras),
 * fechas (`2026-10-19`) ni importes normales.
 */
const NUMERO_LARGO = /(?<![\w-])\d(?:[.\s]?\d){6,}(?![\w-])/g

/**
 * Tapa los datos personales que alguien escribe en el chat antes de que salgan
 * al proveedor de IA (un tercero: en el plan gratuito de Gemini, Google puede
 * usarlos para entrenar). Las herramientas ya no devuelven datos de huéspedes
 * (ADR 0039); éste es el otro camino: el texto libre de quien pregunta.
 *
 * Los nombres no se pueden detectar de forma confiable y no se intenta: la
 * pantalla del chat pide usar el código de la reserva en lugar del nombre.
 */
export function enmascararDatosPersonales(texto: string): string {
  return texto
    .replace(EMAIL, '[email]')
    .replace(CUIT, '[cuit]')
    .replace(TELEFONO_INTERNACIONAL, '[teléfono]')
    .replace(NUMERO_LARGO, '[número]')
}

/* ───────────────────────────────────────────── códigos de reserva ── */

/**
 * Un código de reserva escrito como venga, llevado a la forma de la base
 * (`BP-261015-9410`).
 *
 * Los modelos no siempre escriben el guion común: algunos (gpt-oss, el respaldo
 * de Groq) usan el guion no separable `‑` (U+2011) u otros guiones Unicode, y
 * una búsqueda exacta respondía «no existe» sobre una reserva que estaba en el
 * listado. También pueden llegar espacios, comillas o minúsculas.
 */
export function normalizarCodigoReserva(crudo: string): string {
  return crudo
    .normalize('NFKC')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[\s​-‍﻿'"«»`]/g, '')
    .toUpperCase()
}

/**
 * Llegadas y salidas de varios días seguidos, con la misma regla que
 * `resumirDia` (llega quien empieza ese día, se va quien termina). Para
 * «¿qué movimientos hay esta semana?» sin llamar una herramienta por día.
 */
export function movimientosPorDia(estadias: readonly EstadiaDelDia[], desde: string, dias: number) {
  const resultado: { fecha: string; llegadas: string[]; salidas: string[] }[] = []
  for (let i = 0; i < dias; i++) {
    const [a, m, d] = desde.split('-').map(Number)
    const fecha = new Date(Date.UTC(a, m - 1, d + i)).toISOString().slice(0, 10)
    const llegadas: string[] = []
    const salidas: string[] = []
    for (const e of estadias) {
      const p = parsearPeriodo(e.periodo)
      const quien = `${e.reserva?.codigo ?? '?'}${e.unidad?.nombre ? ` (${e.unidad.nombre})` : ''}`
      if (p.desde === fecha) llegadas.push(quien)
      if (p.hasta === fecha) salidas.push(quien)
    }
    resultado.push({ fecha, llegadas: llegadas.slice(0, TOPE_LISTA), salidas: salidas.slice(0, TOPE_LISTA) })
  }
  return resultado
}

/* ─────────────────────────────────────── lo que el asistente no supo ── */

/**
 * Frases con las que el asistente dice que NO pudo responder: no tiene la
 * herramienta, no tiene acceso o el dato no está a su alcance.
 *
 * Sirve para medir (`ia_sin_respuesta` en `/panel/errores`): las próximas
 * herramientas se eligen por lo que la gente de verdad preguntó y no se pudo
 * contestar, no a ciegas. Es una heurística sobre texto y se acepta que se le
 * escape alguna; lo que no puede es marcar como «sin respuesta» una respuesta
 * normal, por eso las frases son específicas.
 */
const SIN_RESPUESTA = [
  /no (tengo|cuento con) (una |ninguna |esa )?herramienta/,
  /no (lo |la )?tengo disponible/,
  /no tengo (acceso|forma de (ver|consultar|saber))/,
  /no (puedo|pude) (consultar|acceder|ver|obtener|saber)/,
  /no est[aá] disponible para tu rol/,
  /no (se pudo|pude) consultar/,
  /(fuera|m[aá]s all[aá]) de (lo que puedo|mi alcance)/,
]

export function respuestaSinDato(texto: string): boolean {
  const t = texto.toLowerCase()
  return SIN_RESPUESTA.some((r) => r.test(t))
}
