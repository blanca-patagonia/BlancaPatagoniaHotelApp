/**
 * Cómo se le explica a una persona cada evento de «Errores del sistema».
 *
 * La tabla `errores` (ADR 0029) guarda un nombre corto y estable por evento
 * —`escritura_accesoria_fallida`, `webhook_pago_firma_invalida`…— que sirve para
 * agrupar y buscar, pero que en pantalla no le dice nada a quien administra el
 * hotel. Al probar la demo, el docente se encontró con siete filas de
 * `escritura_accesoria_fallida` y ninguna pista de qué significaban.
 *
 * Se describe por familia (el prefijo) y no evento por evento: hay unos
 * cuarenta, aparecen nuevos con cada integración, y un evento nuevo tiene que
 * caer en una explicación razonable sin que nadie se acuerde de sumarlo acá.
 */

export interface DescripcionEvento {
  /** De qué parte del sistema viene, en palabras del hotel. */
  area: string
  /** Qué significa, en una oración. */
  explicacion: string
}

/** Eventos con explicación propia (los más frecuentes o los más delicados). */
const EXACTOS: Record<string, DescripcionEvento> = {
  escritura_fallida: {
    area: 'Guardar datos',
    explicacion: 'La base rechazó un cambio y la operación no se hizo. Quien la intentó vio un mensaje de error.',
  },
  escritura_accesoria_fallida: {
    area: 'Paso secundario',
    explicacion:
      'La operación principal se completó, pero un paso que la acompaña no. El detalle dice cuál.',
  },
  excepcion_no_manejada: {
    area: 'Pantalla',
    explicacion: 'Una pantalla falló al cargarse. El código de referencia es el que vio la persona.',
  },
}

/** Familias por prefijo. El orden importa: gana el primer prefijo que coincide. */
const FAMILIAS: [string, DescripcionEvento][] = [
  ['webhook_pago', { area: 'Pagos en línea', explicacion: 'Un aviso de la pasarela de pago no se pudo procesar.' }],
  ['pasarela', { area: 'Pagos en línea', explicacion: 'La pasarela de pago no respondió o respondió con error.' }],
  ['payway', { area: 'Pagos en línea', explicacion: 'Un cobro de Payway necesita revisión.' }],
  ['pago', { area: 'Pagos', explicacion: 'Un pago necesita revisión.' }],
  ['cobro', { area: 'Cobros', explicacion: 'Un cobro o un link de pago no se pudo completar.' }],
  ['factura', { area: 'Facturación', explicacion: 'La emisión de una factura necesita revisión.' }],
  ['datos_fiscales', { area: 'Facturación', explicacion: 'No se pudieron leer los datos fiscales del hotel.' }],
  ['reportes', { area: 'Informes', explicacion: 'Un informe no pudo leer sus datos y puede verse incompleto.' }],
  ['exportacion', { area: 'Exportar', explicacion: 'Una descarga de planilla falló o salió recortada.' }],
  ['cron', { area: 'Tareas automáticas', explicacion: 'Una tarea programada no pudo correr o anotar su resultado.' }],
  ['mantenimiento', { area: 'Tareas automáticas', explicacion: 'El mantenimiento diario no completó una tarea.' }],
  ['despacho_avisos', { area: 'Correos', explicacion: 'No se pudieron enviar avisos por correo; se reintentan solos.' }],
  ['divisas', { area: 'Cotización', explicacion: 'La fuente de cotización respondió algo inválido; se usa el último valor bueno.' }],
  ['salud', { area: 'Disponibilidad', explicacion: 'El chequeo automático no pudo contactar a la base.' }],
  ['recuperacion', { area: 'Acceso', explicacion: 'Falló la recuperación de una contraseña.' }],
  ['login', { area: 'Acceso', explicacion: 'Falló un ingreso al panel.' }],
  ['google', { area: 'Acceso', explicacion: 'Falló un ingreso con Google.' }],
  ['cuenta', { area: 'Mi cuenta', explicacion: 'No se pudieron guardar los datos de una cuenta del personal.' }],
  ['foto', { area: 'Fotos', explicacion: 'Una foto adjunta no se pudo mostrar.' }],
  ['sitemap', { area: 'Portal público', explicacion: 'El portal no pudo armar su mapa de páginas.' }],
]

const OTRO: DescripcionEvento = {
  area: 'Otro',
  explicacion: 'Evento técnico sin explicación propia. El detalle de abajo dice qué pasó.',
}

export function describirEvento(evento: string): DescripcionEvento {
  if (EXACTOS[evento]) return EXACTOS[evento]
  for (const [prefijo, descripcion] of FAMILIAS) {
    if (evento === prefijo || evento.startsWith(`${prefijo}_`)) return descripcion
  }
  return OTRO
}
