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

export const INTENCIONES = [
  'check_in_out',
  'cancelacion',
  'disponibilidad',
  'tarifas',
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

/** Datos reales del hotel con los que el asistente arma sus respuestas. */
export interface DatosHotel {
  horaCheckIn: string
  horaCheckOut: string
  reglasCancelacion: ReglaCancelacion[]
  servicios: string[]
  direccion: string
  admiteMascotas: boolean
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

    case 'tarifas':
    case 'disponibilidad':
      return {
        intencion,
        derivar: false,
        texto:
          'Las tarifas dependen de las fechas y del tipo de unidad. Buscá tus fechas y te muestro ' +
          'la disponibilidad real con el precio final.',
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

/** Atajo: detecta la intención y arma la respuesta en un paso. */
export function responder(pregunta: string, datos: DatosHotel): RespuestaAsistente {
  return componerRespuesta(detectarIntencion(pregunta), datos)
}
