/**
 * Catálogo de herramientas del asistente de IA (lógica pura: nombres,
 * descripciones y esquema JSON de cada una, sin acceso a datos).
 *
 * ── Por qué el modelo no contesta con lo que "sabe" ─────────────────────────
 *
 * Un modelo de lenguaje no tiene la ocupación de hoy ni la tarifa cargada:
 * si se le pregunta y contesta igual, inventa un número con la forma de uno
 * real, que es el error más caro que puede cometer este sistema (ver el
 * "USD 0" de la Fase 18, o el `precio_neto` del ADR 0016 — acá el riesgo es
 * el inverso, un dato de más y falso en vez de uno de menos). Por eso el
 * asistente no contesta preguntas de datos directamente: el system prompt le
 * exige llamar a una herramienta, y la ejecución real (`app/panel/ia/herramientas.ts`,
 * capa de aplicación porque lee la base) le devuelve el número exacto que hay
 * hoy en el sistema. Este módulo sólo declara el contrato — nombre, para qué
 * sirve cada una y qué parámetros acepta — así se puede testear sin red ni base.
 *
 * Los nombres van en `snake_case` sin tilde: es el identificador que el
 * proveedor de IA valida como nombre de función, y varios rechazan acentos.
 */

export interface DefinicionHerramienta {
  nombre: string
  descripcion: string
  /** JSON Schema de los parámetros, formato "function calling" de OpenAI. */
  parametros: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

const PARAM_MES = {
  type: 'string',
  description:
    'Mes en formato AAAA-MM (por ejemplo "2026-09"). Si no se indica, se usa el mes actual del hotel.',
}

export const HERRAMIENTAS_IA: DefinicionHerramienta[] = [
  {
    nombre: 'metricas_periodo',
    descripcion:
      'Ocupación, ADR (tarifa promedio) y RevPAR de un mes del hotel, con noches vendidas, disponibles e ingreso de alojamiento.',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
  {
    nombre: 'venta_por_categoria',
    descripcion:
      'Cuánto vendió cada tipo de habitación o cabaña en un mes: noches, ingreso, ADR, ocupación y qué porcentaje del ingreso total explica cada tipo. Sirve para saber cuál conviene empujar.',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
  {
    nombre: 'facturacion_mes',
    descripcion: 'Total facturado en un mes y lo cobrado, desglosado por medio de pago (efectivo, tarjeta, transferencia, etc).',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
  {
    nombre: 'resumen_reservas',
    descripcion:
      'Estado actual de las reservas del hotel: cuántas hay en cada estado (pendiente, confirmada, cancelada, etc) y por qué canal entraron (directo, Booking, agencia).',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'satisfaccion_huespedes',
    descripcion:
      'Puntaje promedio de las encuestas de satisfacción respondidas por los huéspedes, y cuántas se respondieron sobre el total enviadas, opcionalmente acotado a un mes.',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
]

/**
 * Instrucciones fijas del asistente.
 *
 * El nombre del hotel y el criterio "nunca inventar" van acá para no
 * repetirlos en cada llamada; lo único que varía entre pedidos es la
 * conversación misma, que arma `app/panel/ia/consulta/route.ts`.
 */
export function promptSistemaIA(): string {
  return `Sos el asistente interno del panel de gestión del Hotel Blanca Patagonia (El Calafate, Santa Cruz).
Hablás con personal del hotel (administración o gerencia), nunca con huéspedes.

Reglas fijas:
- Nunca inventes un número de ocupación, tarifa, facturación o cualquier dato del hotel. Si te preguntan algo así, LLAMÁ a la herramienta correspondiente y contestá con lo que te devuelva. Si ninguna herramienta cubre lo que piden, decilo — no lo aproximes de memoria.
- Los importes de las herramientas están en dólares (USD), la moneda base del sistema.
- "ADR" es Average Daily Rate (tarifa promedio por noche vendida), no confundir con otros usos de la sigla.
- Podés sugerir mejoras de gestión (ocupación floja en un mes, un canal que rinde poco, una categoría que no vende) pero aclarando que es una sugerencia a evaluar por el equipo, no una decisión tomada.
- Sos de solo lectura: no podés cargar, modificar ni cancelar nada. Si te piden una acción, explicá que hay que hacerla desde el módulo correspondiente del panel.
- Respondé en español, corto y concreto. Si el dato no existe (por ejemplo un mes sin reservas), decilo tal cual — no lo redondees a cero sin aclararlo.`
}
