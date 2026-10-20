/**
 * Asistente del portal público (lógica pura).
 *
 * Es un motor **basado en reglas**, no un modelo de lenguaje: detecta la
 * intención por palabras clave y arma la respuesta con datos reales del dominio
 * (política de cancelación cargada en la base, horarios y servicios del hotel).
 * La decisión y sus motivos están en el ADR 0011.
 *
 * Todo lo que hay acá es determinista y testeable; la parte que toca la base
 * vive en `lib/asistente/index.ts`.
 */

import type { ReglaCancelacion } from './cancelacion'
import { sumarDias } from '@/lib/fechas'

export const INTENCIONES = [
  'check_in_out',
  'cancelacion',
  'disponibilidad',
  'tarifas',
  'temporadas',
  'servicios',
  'ubicacion',
  'mascotas',
  'desconocida',
] as const

export type Intencion = (typeof INTENCIONES)[number]

/**
 * Normaliza el texto para comparar: minúsculas, sin tildes y sin espacios de
 * más. Así «¿A qué hora es el CHECK-IN?» y «a que hora es el check in» matchean
 * la misma regla.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    // Quita los diacríticos que dejó la descomposición NFD.
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reglas de intención, evaluadas en orden.
 *
 * El orden importa: «cancelar una reserva» debe caer en `cancelacion` aunque
 * contenga la palabra «reserva», que también aparece en `disponibilidad`.
 */
const REGLAS: { intencion: Intencion; palabras: string[] }[] = [
  {
    intencion: 'cancelacion',
    palabras: [
      'cancelar', 'cancelacion', 'anular', 'reembolso',
      'devolucion', 'devolver', 'devuelv', 'reintegro', 'no show',
    ],
  },
  {
    intencion: 'mascotas',
    palabras: ['mascota', 'perro', 'gato', 'pet friendly'],
  },
  // Servicios va ANTES que horarios: «¿a qué hora abre el desayuno?» es una
  // consulta de servicios, no del horario de check-in.
  {
    intencion: 'servicios',
    palabras: [
      'servicio', 'desayuno', 'wifi', 'wi fi', 'estacionamiento', 'cochera',
      'hidromasaje', 'parrilla', 'calefaccion', 'incluye', 'incluido',
    ],
  },
  {
    intencion: 'ubicacion',
    palabras: ['donde', 'ubicacion', 'direccion', 'como llego', 'aeropuerto', 'glaciar', 'perito moreno'],
  },
  {
    intencion: 'check_in_out',
    palabras: [
      'check in', 'checkin', 'check out', 'checkout', 'horario', 'que hora',
      'ingreso', 'entrada', 'entrar', 'salida', 'salir', 'llegada', 'llegar',
    ],
  },
  // Va antes que tarifas: «¿cuándo es temporada alta?» pregunta por el
  // calendario, no por el precio.
  {
    intencion: 'temporadas',
    palabras: ['temporada', 'temporada alta', 'temporada baja', 'epoca', 'cuando conviene'],
  },
  {
    intencion: 'tarifas',
    palabras: ['precio', 'tarifa', 'cuanto sale', 'cuanto cuesta', 'valor', 'costo'],
  },
  {
    intencion: 'disponibilidad',
    palabras: ['disponible', 'disponibilidad', 'lugar', 'habitacion', 'cabana', 'reservar', 'reserva'],
  },
]

/** Detecta la intención de una pregunta libre. */
export function detectarIntencion(pregunta: string): Intencion {
  const texto = normalizar(pregunta)
  if (!texto) return 'desconocida'
  for (const regla of REGLAS) {
    if (regla.palabras.some((p) => texto.includes(p))) return regla.intencion
  }
  return 'desconocida'
}

/* ─────────────────────────────────────────── extracción de fechas ──────── */

const RE_DDMM = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g
const RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g

function aISO(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  // Rechaza fechas imposibles (31 de febrero se normalizaría a marzo).
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return d.toISOString().slice(0, 10)
}

export interface RangoFechas {
  desde: string
  hasta: string
}

/**
 * Busca un rango de fechas en una pregunta libre.
 *
 * Reconoce `10/09`, `10/09/2026` y `2026-09-10`. Necesita **dos** fechas para
 * devolver un rango: con una sola no se puede consultar disponibilidad.
 * `anioPorDefecto` completa el año cuando el huésped no lo escribe.
 */
export function extraerFechas(pregunta: string, anioPorDefecto: number): RangoFechas | null {
  const encontradas: string[] = []

  for (const m of pregunta.matchAll(RE_ISO)) {
    const iso = aISO(Number(m[1]), Number(m[2]), Number(m[3]))
    if (iso) encontradas.push(iso)
  }

  if (encontradas.length < 2) {
    for (const m of pregunta.matchAll(RE_DDMM)) {
      const crudoAnio = m[3]
      const anio = crudoAnio
        ? crudoAnio.length === 2
          ? 2000 + Number(crudoAnio)
          : Number(crudoAnio)
        : anioPorDefecto
      const iso = aISO(anio, Number(m[2]), Number(m[1]))
      if (iso) encontradas.push(iso)
    }
  }

  if (encontradas.length < 2) return null
  const ordenadas = [...new Set(encontradas)].sort()
  if (ordenadas.length < 2) return null
  return { desde: ordenadas[0], hasta: ordenadas[ordenadas.length - 1] }
}

/* ───────────────────────────────────────────────────── datos y respuesta ── */

/** Tipo de unidad con su disponibilidad y precio, tal como lo ve el huésped. */
export interface TipoDisponible {
  nombre: string
  disponibles: number
  capacidadMax: number
}

/** Datos reales del hotel con los que el asistente arma sus respuestas. */
export interface DatosHotel {
  horaCheckIn: string
  horaCheckOut: string
  reglasCancelacion: ReglaCancelacion[]
  servicios: string[]
  direccion: string
  admiteMascotas: boolean
  /** Rango de precios rack vigente, leído del tarifario. */
  rangoTarifas: { min: number; max: number } | null
  /** Temporadas con sus rangos de fecha, leídas de la base. */
  temporadas: TemporadaInfo[]
}

/** Una temporada con los períodos del año en que rige. */
export interface TemporadaInfo {
  nombre: string
  rangos: { desde: string; hasta: string }[]
}

/**
 * Redacta el calendario de temporadas a partir de lo cargado en la base.
 *
 * Igual que la política de cancelación: si el hotel cambia las fechas, el
 * asistente responde las nuevas sin tocar código.
 */
export function describirTemporadas(temporadas: readonly TemporadaInfo[]): string {
  const conRangos = temporadas.filter((t) => t.rangos.length > 0)
  if (conRangos.length === 0) {
    return 'Todavía no tenemos publicado el calendario de temporadas. Escribinos y te contamos.'
  }

  return conRangos
    .map((t) => {
      const periodos = t.rangos.map(
        // ⚠️ `hasta` es el fin EXCLUIDO del `daterange` de Postgres. Decirlo tal
        // cual le anuncia al huésped un día que ya se cobra a la temporada
        // siguiente: con [01/11, 01/12) la última noche a ese precio es el 30/11.
        // No es formato, es una fecha equivocada dicha por el asistente.
        (r) => `del ${formatoDiaMes(r.desde)} al ${formatoDiaMes(sumarDias(r.hasta, -1))}`,
      )
      // «A, B y C» en lugar de «A y B y C».
      const texto =
        periodos.length > 1
          ? `${periodos.slice(0, -1).join(', ')} y ${periodos.at(-1)}`
          : periodos[0]
      // El nombre que viene de la base ya suele decir «Temporada alta»: no se
      // le antepone la palabra de nuevo.
      const nombre = /^temporada/i.test(t.nombre) ? t.nombre : `Temporada ${t.nombre}`
      return `· ${nombre}: ${texto}.`
    })
    .join('\n')
}

/** `2026-11-15` → `15/11`. Para el huésped el año no aporta. */
function formatoDiaMes(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

export interface AccionSugerida {
  etiqueta: string
  href: string
}

export interface RespuestaAsistente {
  intencion: Intencion
  texto: string
  accion?: AccionSugerida
  /** Cuando es `true`, la consulta se guarda para que la revise el staff. */
  derivar: boolean
}

const ETIQUETA_CARGO: Record<ReglaCancelacion['cargo'], string> = {
  ninguno: 'sin cargo',
  primera_noche: 'se cobra la primera noche',
  total: 'se cobra el 100 % de la estadía',
}

/**
 * Redacta la política de cancelación a partir de las reglas cargadas en la base.
 *
 * No se escribe a mano en ningún texto: si mañana el hotel cambia la política,
 * el asistente responde la nueva sin tocar código.
 */
export function describirPoliticaCancelacion(reglas: ReglaCancelacion[]): string {
  if (reglas.length === 0) return 'Consultá la política de cancelación al confirmar tu reserva.'

  // Cada regla vale desde su umbral hasta el umbral de la regla anterior (la de
  // mayor anticipación), que ya cubre los días por encima.
  const ordenadas = [...reglas].sort((a, b) => b.desde_dias - a.desde_dias)
  const lineas = ordenadas.map((r, i) => {
    const cargo = ETIQUETA_CARGO[r.cargo]
    if (i === 0) return `· Con ${r.desde_dias} días o más de anticipación: ${cargo}.`

    const tope = ordenadas[i - 1].desde_dias
    if (r.desde_dias === 0) return `· Con menos de ${tope} días: ${cargo}.`
    return `· Entre ${r.desde_dias} y ${tope - 1} días antes: ${cargo}.`
  })
  return lineas.join('\n')
}

/** Arma la respuesta para una intención ya detectada. */
export function componerRespuesta(intencion: Intencion, datos: DatosHotel): RespuestaAsistente {
  switch (intencion) {
    case 'check_in_out':
      return {
        intencion,
        derivar: false,
        texto:
          `El check-in es a partir de las ${datos.horaCheckIn} y el check-out hasta las ` +
          `${datos.horaCheckOut}. Si llegás fuera de horario avisanos y lo coordinamos.`,
      }

    case 'cancelacion':
      return {
        intencion,
        derivar: false,
        texto: `Nuestra política de cancelación es:\n${describirPoliticaCancelacion(datos.reglasCancelacion)}`,
      }

    case 'servicios':
      return {
        intencion,
        derivar: false,
        texto: `La hostería incluye: ${datos.servicios.join(', ')}.`,
      }

    case 'ubicacion':
      return {
        intencion,
        derivar: false,
        texto: `Estamos en ${datos.direccion}, frente al Lago Argentino.`,
      }

    case 'mascotas':
      return {
        intencion,
        derivar: false,
        texto: datos.admiteMascotas
          ? 'Sí, aceptamos mascotas. Avisanos al reservar para asignarte una unidad adecuada.'
          : 'Por el momento no podemos recibir mascotas en las habitaciones ni en las cabañas.',
      }

    case 'temporadas':
      return {
        intencion,
        derivar: false,
        texto: `Nuestras temporadas son:\n${describirTemporadas(datos.temporadas)}`,
        accion: { etiqueta: 'Ver precios por fecha', href: '/reservar' },
      }

    case 'tarifas':
      return {
        intencion,
        derivar: false,
        texto: datos.rangoTarifas
          ? `Según la temporada y el tipo de unidad, las tarifas van de USD ` +
            `${datos.rangoTarifas.min} a USD ${datos.rangoTarifas.max} por noche (con IVA). ` +
            `Decime tus fechas y te digo el precio exacto.`
          : 'Las tarifas dependen de las fechas y del tipo de unidad. Decime cuándo venís y te ' +
            'muestro el precio final.',
        accion: { etiqueta: 'Consultar disponibilidad', href: '/reservar' },
      }

    case 'disponibilidad':
      return {
        intencion,
        derivar: false,
        texto:
          'Decime tus fechas (por ejemplo «del 10/09 al 13/09») y consulto la disponibilidad real, ' +
          'o buscá directamente en el buscador.',
        accion: { etiqueta: 'Consultar disponibilidad', href: '/reservar' },
      }

    case 'desconocida':
      return {
        intencion,
        derivar: true,
        texto:
          'Esa no la sé responder todavía. Dejamos tu consulta registrada y el equipo del hotel ' +
          'te va a contactar a la brevedad.',
      }
  }
}

/**
 * Redacta la respuesta de disponibilidad con el resultado REAL de la consulta
 * al motor anti-overbooking.
 *
 * Se mantiene acá (y no en el proveedor) para que el texto sea testeable sin
 * tocar la base.
 */
export function componerDisponibilidad(
  rango: RangoFechas,
  tipos: readonly TipoDisponible[],
): RespuestaAsistente {
  const conLugar = tipos.filter((t) => t.disponibles > 0)
  const enlace = `/reservar?check_in=${rango.desde}&check_out=${rango.hasta}`

  if (conLugar.length === 0) {
    return {
      intencion: 'disponibilidad',
      derivar: false,
      texto:
        `Del ${rango.desde} al ${rango.hasta} no nos queda disponibilidad. ` +
        `Si podés mover las fechas, probá con otras y vemos.`,
      accion: { etiqueta: 'Probar otras fechas', href: '/reservar' },
    }
  }

  const detalle = conLugar
    .map((t) => `· ${t.nombre}: ${t.disponibles} disponible(s), hasta ${t.capacidadMax} personas`)
    .join('\n')

  return {
    intencion: 'disponibilidad',
    derivar: false,
    texto: `Del ${rango.desde} al ${rango.hasta} tenemos:\n${detalle}`,
    accion: { etiqueta: 'Ver precios y reservar', href: enlace },
  }
}

/** Atajo: detecta la intención y arma la respuesta en un paso. */
export function responder(pregunta: string, datos: DatosHotel): RespuestaAsistente {
  return componerRespuesta(detectarIntencion(pregunta), datos)
}
