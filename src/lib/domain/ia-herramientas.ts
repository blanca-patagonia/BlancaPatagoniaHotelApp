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
 * exige llamar a una herramienta, y la ejecución real (`app/panel/ia/herramientas/`,
 * capa de aplicación porque lee la base) le devuelve el número exacto que hay
 * hoy en el sistema. Este módulo sólo declara el contrato — nombre, para qué
 * sirve cada una y qué parámetros acepta — así se puede testear sin red ni base.
 *
 * Los nombres van en `snake_case` sin tilde: es el identificador que el
 * proveedor de IA valida como nombre de función, y varios rechazan acentos.
 */

import { esDireccion, puedeAcceder, type Area } from './permisos'
import type { Rol } from './roles'

export interface DefinicionHerramienta {
  nombre: string
  /**
   * El área del panel que hace falta para usarla. El asistente sólo le ofrece
   * al modelo las herramientas de las áreas del rol (`herramientasPara`): a
   * housekeeping no le llega ni la existencia de la facturación.
   */
  area: Area
  /** Más estrecha que el área: sólo admin y gerencia (ver `SOLO_DIRECCION`). */
  soloDireccion?: boolean
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
    area: 'reportes',
    descripcion:
      'Ocupación, ADR (tarifa promedio) y RevPAR de un mes del hotel, con noches vendidas, disponibles e ingreso de alojamiento.',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
  {
    nombre: 'venta_por_categoria',
    area: 'reportes',
    descripcion:
      'Cuánto vendió cada tipo de habitación o cabaña en un mes: noches, ingreso, ADR, ocupación y qué porcentaje del ingreso total explica cada tipo. Sirve para saber cuál conviene empujar.',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
  {
    nombre: 'facturacion_mes',
    area: 'reportes',
    descripcion: 'Total facturado en un mes y lo cobrado, desglosado por medio de pago (efectivo, tarjeta, transferencia, etc).',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },
  {
    nombre: 'resumen_reservas',
    area: 'reportes',
    descripcion:
      'Estado actual de las reservas del hotel: cuántas hay en cada estado (pendiente, confirmada, cancelada, etc) y por qué canal entraron (directo, Booking, agencia).',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'operacion_del_dia',
    area: 'ocupacion',
    descripcion:
      'La operación de un día: quiénes llegan, quiénes se van, cuántas unidades quedan ocupadas y cuántas libres. Sirve para «¿quién llega hoy?», «¿cuántas habitaciones libres hay mañana?».',
    parametros: {
      type: 'object',
      properties: {
        fecha: {
          type: 'string',
          description: 'Día en formato AAAA-MM-DD. Si no se indica, es hoy en el hotel.',
        },
      },
    },
  },
  {
    nombre: 'buscar_reserva',
    area: 'reservas',
    descripcion:
      'Estado de una reserva por su código (por ejemplo «BP-0123»): estado, canal, fechas, unidad, total, cuánto se pagó y cuánto falta cobrar (alojamiento más consumos). No incluye datos personales del huésped.',
    parametros: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Código de la reserva, tal como aparece en el panel.' },
      },
      required: ['codigo'],
    },
  },
  {
    nombre: 'buscar_por_huesped',
    area: 'reservas',
    descripcion:
      'Busca las reservas de un huésped por su nombre o apellido (por ejemplo «almiron» o «juan almiron»). Devuelve código, estado, fechas, unidad y el enlace a la ficha de cada reserva; no devuelve datos personales.',
    parametros: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre y/o apellido, como lo dijo la persona.' } },
      required: ['nombre'],
    },
  },
  {
    nombre: 'saldos_pendientes',
    area: 'reservas',
    descripcion:
      'Reservas que ya deberían estar cobradas y tienen saldo: confirmadas con el check-in ya pasado y alojadas con el check-out ya pasado. Es la misma lista que «Requiere atención» del tablero. Devuelve código, estado, fecha y saldo, de mayor a menor.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'disponibilidad',
    area: 'reservas',
    descripcion:
      'Cuántas unidades libres hay de cada tipo de habitación o cabaña entre dos fechas. Sirve para «¿hay lugar del 10 al 15?» o «¿qué puedo ofrecerle a una familia de 4?».',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha de llegada, AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Fecha de salida, AAAA-MM-DD (la última noche es la anterior).' },
      },
      required: ['desde', 'hasta'],
    },
  },
  {
    nombre: 'cotizar_estadia',
    area: 'reservas',
    descripcion:
      'Cuánto sale una estadía de un tipo de habitación o cabaña entre dos fechas, a tarifa de mostrador (rack), con el IVA discriminado, y cuántas unidades de ese tipo quedan libres. Sirve para «¿cuánto sale una doble del 10 al 14?».',
    parametros: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Nombre o código del tipo de unidad (por ejemplo «Superior» o «Cabaña»).' },
        desde: { type: 'string', description: 'Fecha de llegada, AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Fecha de salida, AAAA-MM-DD.' },
      },
      required: ['tipo', 'desde', 'hasta'],
    },
  },
  {
    nombre: 'movimientos_proximos',
    area: 'ocupacion',
    descripcion:
      'Llegadas y salidas día por día durante varios días (hasta 14), con el código de reserva y la unidad. Sirve para «¿qué movimientos hay esta semana?».',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Primer día, AAAA-MM-DD. Si no se indica, hoy.' },
        dias: { type: 'number', description: 'Cuántos días (1 a 14). Por omisión 7.' },
      },
    },
  },
  {
    nombre: 'estado_limpieza',
    area: 'housekeeping',
    descripcion:
      'Estado de limpieza de las unidades ahora: cuántas están limpias, sucias, inspeccionadas o bloqueadas, y cuáles están sucias.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'proponer_estado_limpieza',
    area: 'housekeeping',
    descripcion:
      'Prepara el cambio de estado de limpieza de una unidad («la Agassiz ya está limpia»). Estados: limpia, sucia o inspeccionada (inspeccionada avisa a recepción que está lista). No lo cambia: la persona lo confirma con un botón.',
    parametros: {
      type: 'object',
      properties: {
        unidad: { type: 'string', description: 'Nombre de la habitación o cabaña.' },
        estado: { type: 'string', description: '«limpia», «sucia» o «inspeccionada».' },
      },
      required: ['unidad', 'estado'],
    },
  },
  /* Información de AFUERA del sistema (`lib/ia/externo.ts`). */
  {
    nombre: 'clima',
    area: 'ia',
    descripcion:
      'Clima actual y pronóstico de El Calafate (hasta 7 días): temperatura, lluvia y ráfagas de viento, con aviso cuando el viento puede suspender excursiones. Fuente: Open-Meteo.',
    parametros: {
      type: 'object',
      properties: { dias: { type: 'number', description: 'Cuántos días de pronóstico (1 a 7). Por omisión 3.' } },
    },
  },
  {
    nombre: 'cotizacion_monedas',
    area: 'reservas',
    descripcion:
      'Cotización vigente del dólar en pesos argentinos, reales y euros: la misma que usa el sistema para cobrar, con su fuente y su antigüedad.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'informacion_general',
    area: 'ia',
    descripcion:
      'Busca información general en Wikipedia en español: lugares y excursiones de la zona (Perito Moreno, Upsala, El Chaltén), historia, datos para recomendarle a un huésped. Devuelve un resumen y el enlace. No sirve para datos del hotel.',
    parametros: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Qué buscar, en pocas palabras (por ejemplo «glaciar Upsala»).' } },
      required: ['consulta'],
    },
  },
  {
    nombre: 'consultar_ayuda',
    area: 'ayuda',
    descripcion:
      'Busca en la guía de uso del sistema cómo se hace algo (cargar una reserva, facturar, cobrar, exportar, etc.). Usala SIEMPRE para dudas de uso del panel, en vez de imaginar pasos o botones.',
    parametros: {
      type: 'object',
      properties: {
        pregunta: { type: 'string', description: 'La duda de uso, con las palabras clave (por ejemplo «emitir nota de crédito»).' },
      },
      required: ['pregunta'],
    },
  },
  /*
    Herramientas que PREPARAN una acción (ADR 0041). No escriben nada: devuelven
    una propuesta que la persona confirma con un botón en el chat.
  */
  {
    nombre: 'proponer_aviso',
    area: 'avisos',
    descripcion:
      'Prepara un aviso para la cartelera interna del equipo (por ejemplo «corte de agua a las 15»). No lo publica: la persona lo confirma con un botón.',
    parametros: {
      type: 'object',
      properties: { mensaje: { type: 'string', description: 'El texto del aviso, tal como lo va a leer el equipo.' } },
      required: ['mensaje'],
    },
  },
  {
    nombre: 'proponer_orden_mantenimiento',
    area: 'mantenimiento',
    descripcion:
      'Prepara una orden de mantenimiento (algo roto o para arreglar). No la crea: la persona la confirma con un botón. Prioridad alta sólo si deja una unidad fuera de servicio.',
    parametros: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Qué hay que arreglar, en pocas palabras.' },
        descripcion: { type: 'string', description: 'Detalle opcional.' },
        prioridad: { type: 'string', description: '«baja», «media» o «alta».' },
        unidad: { type: 'string', description: 'Nombre de la habitación o cabaña, si es de una unidad. Vacío si es del edificio.' },
      },
      required: ['titulo', 'prioridad'],
    },
  },
  {
    nombre: 'proponer_objeto_perdido',
    area: 'objetos_perdidos',
    descripcion: 'Prepara el registro de un objeto encontrado. No lo registra: la persona lo confirma con un botón.',
    parametros: {
      type: 'object',
      properties: {
        descripcion: { type: 'string', description: 'Qué se encontró.' },
        ubicacion: { type: 'string', description: 'Dónde se encontró.' },
      },
      required: ['descripcion'],
    },
  },
  {
    nombre: 'proponer_consumo',
    area: 'reservas',
    descripcion:
      'Prepara un cargo en la cuenta de una reserva (desayuno, frigobar, lavandería…), con el precio del catálogo. No lo carga: la persona lo confirma con un botón. Si la reserva ya está facturada o anulada, avisa que no se puede.',
    parametros: {
      type: 'object',
      properties: {
        codigo_reserva: { type: 'string', description: 'Código de la reserva.' },
        producto: { type: 'string', description: 'Nombre del producto o servicio del catálogo.' },
        cantidad: { type: 'number', description: 'Cantidad, entera (por omisión 1).' },
      },
      required: ['codigo_reserva', 'producto'],
    },
  },
  {
    nombre: 'proponer_cambio_estado',
    area: 'reservas',
    descripcion:
      'Prepara un cambio de estado de una reserva: confirmar, hacer el check-in, hacer el check-out, marcar no-show o cancelar. Para cancelar y no-show calcula el cargo de la política del hotel y lo muestra en la tarjeta. No lo hace: la persona confirma con un botón.',
    parametros: {
      type: 'object',
      properties: {
        codigo_reserva: { type: 'string', description: 'Código de la reserva.' },
        accion: { type: 'string', description: '«confirmar», «check_in», «check_out», «no_show» o «cancelar».' },
      },
      required: ['codigo_reserva', 'accion'],
    },
  },
  {
    nombre: 'proponer_mudanza',
    area: 'reservas',
    descripcion:
      'Prepara el cambio de habitación de una reserva (mudanza) a una unidad libre en esas fechas. Por omisión mantiene el precio; con politica «recotizar» lo recalcula con la tarifa de la nueva unidad.',
    parametros: {
      type: 'object',
      properties: {
        codigo_reserva: { type: 'string', description: 'Código de la reserva.' },
        unidad: { type: 'string', description: 'Nombre de la habitación o cabaña de destino.' },
        politica: { type: 'string', description: '«mantener» (por omisión) o «recotizar».' },
      },
      required: ['codigo_reserva', 'unidad'],
    },
  },
  {
    nombre: 'proponer_reprogramacion',
    area: 'reservas',
    descripcion:
      'Prepara el cambio de fechas de una reserva. Por omisión recotiza el precio para las fechas nuevas; con politica «mantener» conserva el total.',
    parametros: {
      type: 'object',
      properties: {
        codigo_reserva: { type: 'string', description: 'Código de la reserva.' },
        desde: { type: 'string', description: 'Nueva llegada, AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Nueva salida, AAAA-MM-DD.' },
        politica: { type: 'string', description: '«recotizar» (por omisión) o «mantener».' },
      },
      required: ['codigo_reserva', 'desde', 'hasta'],
    },
  },
  {
    nombre: 'proponer_factura',
    area: 'reservas',
    descripcion:
      'Prepara la emisión de la factura (con CAE) de una reserva. Cierra la cuenta. No la emite: la persona confirma con un botón.',
    parametros: {
      type: 'object',
      properties: { codigo_reserva: { type: 'string', description: 'Código de la reserva.' } },
      required: ['codigo_reserva'],
    },
  },
  {
    nombre: 'proponer_nota_credito',
    area: 'reservas',
    soloDireccion: true,
    descripcion:
      'Prepara una nota de crédito (con CAE) sobre la factura de una reserva, para anularla total o parcialmente.',
    parametros: {
      type: 'object',
      properties: {
        codigo_reserva: { type: 'string', description: 'Código de la reserva.' },
        monto: { type: 'number', description: 'Importe en USD a acreditar.' },
        motivo: { type: 'string', description: 'Por qué se acredita (queda en el comprobante).' },
      },
      required: ['codigo_reserva', 'monto', 'motivo'],
    },
  },
  {
    nombre: 'proponer_reserva',
    area: 'reservas',
    descripcion:
      'Prepara una reserva nueva de mostrador: tipo de unidad, fechas, ocupantes y apellido y nombre del huésped. Verifica que haya lugar y estima el precio. El email y el documento los completa la persona en la tarjeta (no los pidas por el chat).',
    parametros: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Nombre o código del tipo de unidad.' },
        desde: { type: 'string', description: 'Llegada, AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Salida, AAAA-MM-DD.' },
        adultos: { type: 'number', description: 'Cantidad de adultos (por omisión 2).' },
        menores: { type: 'number', description: 'Cantidad de menores (por omisión 0).' },
        apellido: { type: 'string', description: 'Apellido del huésped.' },
        nombre: { type: 'string', description: 'Nombre del huésped.' },
      },
      required: ['tipo', 'desde', 'hasta', 'apellido'],
    },
  },
  {
    nombre: 'proponer_mensaje_huesped',
    area: 'reservas',
    descripcion:
      'Redacta un correo para el huésped de una reserva (un aviso, una respuesta, un recordatorio). Escribí sólo el cuerpo: el saludo con su nombre y la firma del hotel los agrega el sistema. La persona lo revisa y lo corrige en la tarjeta antes de enviarlo.',
    parametros: {
      type: 'object',
      properties: {
        codigo_reserva: { type: 'string', description: 'Código de la reserva.' },
        mensaje: { type: 'string', description: 'El cuerpo del correo, en castellano, cordial y breve. Sin saludo ni firma.' },
      },
      required: ['codigo_reserva', 'mensaje'],
    },
  },
  {
    nombre: 'proponer_huesped',
    area: 'huespedes',
    descripcion:
      'Prepara el alta de un huésped con apellido y nombre. Email, teléfono, documento y nacionalidad los completa la persona en la tarjeta (no los pidas por el chat).',
    parametros: {
      type: 'object',
      properties: {
        apellido: { type: 'string', description: 'Apellido.' },
        nombre: { type: 'string', description: 'Nombre.' },
      },
      required: ['apellido', 'nombre'],
    },
  },
  {
    nombre: 'proponer_editar_huesped',
    area: 'huespedes',
    descripcion:
      'Prepara el cambio de los datos de contacto (email, teléfono, documento, nacionalidad) de un huésped, buscado por su nombre o por el código de una reserva suya. Los datos nuevos los completa la persona en la tarjeta.',
    parametros: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre y/o apellido del huésped.' },
        codigo_reserva: { type: 'string', description: 'O el código de una reserva suya.' },
      },
    },
  },
  {
    nombre: 'satisfaccion_huespedes',
    area: 'reportes',
    descripcion:
      'Puntaje promedio de las encuestas de satisfacción respondidas por los huéspedes, y cuántas se respondieron sobre el total enviadas, opcionalmente acotado a un mes.',
    parametros: { type: 'object', properties: { mes: PARAM_MES } },
  },

  /* ── búsqueda y consulta de los demás módulos ─────────────────────────── */
  {
    nombre: 'buscar_en_sistema',
    area: 'ia',
    descripcion:
      'Busca una palabra en todo el sistema: habitaciones y cabañas, tipos de unidad, productos y servicios del catálogo (con su precio), promociones, agencias, proveedores, las pantallas del panel donde se hace algo y códigos de reserva. Usala cuando no sepas dónde está algo («¿cuánto sale el desayuno?», «¿tenemos convenio con tal agencia?», «¿dónde cargo un gasto?»). No devuelve datos de huéspedes: para eso está buscar_por_huesped.',
    parametros: {
      type: 'object',
      properties: { termino: { type: 'string', description: 'La palabra o frase a buscar (mínimo 2 letras).' } },
      required: ['termino'],
    },
  },
  {
    nombre: 'cuenta_de_reserva',
    area: 'reservas',
    descripcion:
      'La cuenta DETALLADA de una reserva por su código: el alojamiento, cada consumo cargado (producto, cantidad, importe, fecha), cada pago con su estado, el total, lo pagado, el saldo y si ya tiene factura. Para «¿qué consumió?», «¿cuánto pagó?» o «¿por qué debe eso?».',
    parametros: {
      type: 'object',
      properties: { codigo_reserva: { type: 'string', description: 'Código de la reserva (por ejemplo BP-0123).' } },
      required: ['codigo_reserva'],
    },
  },
  {
    nombre: 'ordenes_mantenimiento',
    area: 'mantenimiento',
    descripcion:
      'Las órdenes de mantenimiento: por omisión las abiertas (pendientes y en proceso), con prioridad, unidad y hace cuántos días están abiertas. Se puede filtrar por unidad o pedir las resueltas.',
    parametros: {
      type: 'object',
      properties: {
        estado: { type: 'string', description: '"abiertas" (por omisión), "resueltas" o "todas".' },
        unidad: { type: 'string', description: 'Nombre de la habitación o cabaña, para ver sólo las de esa unidad (opcional).' },
      },
    },
  },
  {
    nombre: 'objetos_perdidos',
    area: 'objetos_perdidos',
    descripcion:
      'Los objetos perdidos registrados: por omisión los que siguen guardados, con descripción, dónde se encontraron, la fecha y la reserva si se vinculó. Se puede buscar por palabra («campera», «cargador»).',
    parametros: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Palabra para buscar en la descripción o el lugar (opcional).' },
        estado: { type: 'string', description: '"guardados" (por omisión), "devueltos" o "todos".' },
      },
    },
  },
  {
    nombre: 'avisos_internos',
    area: 'avisos',
    descripcion: 'Los avisos de la cartelera interna del personal: los fijados y los más recientes, con su fecha.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'cuentas_agencias',
    area: 'agencias',
    descripcion:
      'El saldo de la cuenta corriente de cada agencia (lo que le debe al hotel) y el total a cobrar. Son empresas, no huéspedes.',
    parametros: {
      type: 'object',
      properties: { solo_con_saldo: { type: 'boolean', description: 'Sólo las que deben algo (por omisión, sí).' } },
    },
  },
  {
    nombre: 'cuentas_proveedores',
    area: 'proveedores',
    descripcion: 'El saldo con cada proveedor (lo que el hotel le debe) y el total a pagar.',
    parametros: {
      type: 'object',
      properties: { solo_con_saldo: { type: 'boolean', description: 'Sólo los que tienen saldo (por omisión, sí).' } },
    },
  },
  {
    nombre: 'salud_del_sistema',
    area: 'errores',
    descripcion:
      'Cómo viene funcionando el sistema: errores registrados hoy, los más repetidos de las últimas 24 horas, avisos a huéspedes que no se pudieron enviar y tareas programadas atrasadas.',
    parametros: { type: 'object', properties: {} },
  },
  {
    nombre: 'proponer_estado_orden',
    area: 'mantenimiento',
    descripcion:
      'Prepara el cambio de estado de una orden de mantenimiento: "en_proceso", "resuelta" o "pendiente" (reabrir). La persona la confirma. Pasá el título de la orden (o una parte) y, si hay varias parecidas, la unidad.',
    parametros: {
      type: 'object',
      properties: {
        orden: { type: 'string', description: 'Título de la orden, o una palabra de él («ducha»).' },
        unidad: { type: 'string', description: 'La habitación o cabaña de la orden, para desempatar (opcional).' },
        estado: { type: 'string', description: '"en_proceso", "resuelta" o "pendiente".' },
      },
      required: ['orden', 'estado'],
    },
  },
  {
    nombre: 'proponer_objeto_devuelto',
    area: 'objetos_perdidos',
    descripcion:
      'Prepara marcar como devuelto un objeto perdido que está guardado. La persona lo confirma. Pasá una palabra que lo identifique («campera azul»).',
    parametros: {
      type: 'object',
      properties: { objeto: { type: 'string', description: 'Descripción o palabra del objeto.' } },
      required: ['objeto'],
    },
  },
]

/**
 * Las herramientas que el modelo puede usar con este rol.
 *
 * Es la primera barrera, no la única: la ruta del chat rechaza además cualquier
 * llamada a una herramienta fuera de esta lista (un modelo puede «inventar» el
 * nombre de una que vio en otra conversación), y cada consulta corre con el
 * cliente del usuario, así que RLS sigue aplicando.
 */
export function herramientasPara(rol: Rol): DefinicionHerramienta[] {
  return HERRAMIENTAS_IA.filter((h) => puedeAcceder(rol, h.area) && (!h.soloDireccion || esDireccion(rol)))
}

/* ────────────────────────────── herramientas relevantes por consulta ── */

/**
 * Qué palabras hacen relevante a cada herramienta (sobre texto sin acentos y
 * en minúsculas).
 *
 * ── Por qué no se mandan todas ──────────────────────────────────────────────
 *
 * Las más de cuarenta definiciones pesan más de 5.000 tokens, y van en CADA llamada al
 * proveedor (una consulta hace dos o tres). Con el plan gratuito de Groq, una
 * sola consulta superaba el límite de tokens por minuto. Mandando sólo las que
 * tienen que ver con la conversación, una consulta típica pesa la mitad, y el
 * modelo además elige mejor con menos opciones.
 */
const PALABRAS: Record<string, RegExp> = {
  metricas_periodo: /ocupaci|\badr\b|revpar|rendimiento|como viene|analiz|comparad|mes pasado|este mes/,
  venta_por_categoria: /categor|que tipo|vendio|vendi|empujar|rinde/,
  facturacion_mes: /factur|cobrad|medio|ingreso|plata|recaud/,
  resumen_reservas: /por estado|por canal|resumen|cuantas reservas|booking|canal/,
  satisfaccion_huespedes: /encuest|satisf|\bnps\b|opinion|resen|puntaje/,
  operacion_del_dia: /\bhoy\b|llega|\bsale|salida|alojad|ocupad|libre|manana/,
  movimientos_proximos: /semana|proxim|movimient|manana|pasado manana/,
  buscar_reserva: /codigo|\bbp-?|reserva/,
  buscar_por_huesped: /nombre|a nombre|apellido|huesped|cliente/,
  saldos_pendientes: /saldo|deuda|\bdebe|pendiente|cobrar|impag/,
  disponibilidad: /lugar|disponib|libre|\bhay\b|capacidad/,
  cotizar_estadia: /cuanto (sale|cuesta|vale)|precio|cotiz|tarifa|cuesta|presupuest/,
  estado_limpieza: /limpi|sucia|housekeeping|mucama|inspecc/,
  proponer_aviso: /avis|cartelera|equipo|comunic|recorda/,
  proponer_orden_mantenimiento: /\brot[oa]|arregl|mantenim|pierde|no funciona|falla|repar|gotea|no anda/,
  proponer_consumo: /cargale|cargar|consum|desayun|frigobar|lavander|bebida|minibar/,
  proponer_estado_limpieza: /limpi|sucia|inspecc/,
  proponer_cambio_estado: /check|confirm|cancel|no.?show|ingres|llego|se fue|se va|salio/,
  proponer_mudanza: /mud|cambi\w* de (habitaci|unidad|cabana)|pasar(lo|la)? a|otra habitaci/,
  proponer_reprogramacion: /fecha|reprogram|correr|mover|posterg|adelant|extend|alarg/,
  proponer_factura: /factur/,
  proponer_nota_credito: /nota de credito|anul|acredit|devol|reembols/,
  proponer_reserva: /reserv[aá]\w* (una|un|para|la)|nueva reserva|reservame|alojamiento para|quiero reservar/,
  proponer_huesped: /(alta|registr|cargar|crear|nuevo)\w* (de |un |una )?(huesped|cliente)/,
  proponer_editar_huesped: /(cambi|actualiz|correg|modific)\w*.*(tel|mail|correo|document|dni|nacional|dato)/,
  proponer_objeto_perdido: /perdid|olvid|encontr/,
  proponer_mensaje_huesped: /escrib|mail|correo|mensaje|avisa(le|rle)|respond|contesta|recordale|manda(le|rle)/,
  clima: /clima|tiempo|llov|lluvia|viento|temperatura|pronostic|frio|calor|nieve|nevar/,
  cotizacion_monedas: /dolar|cotizac|cambio|pesos|euro|real(es)?\b|moneda|blue/,
  buscar_en_sistema: /donde|buscar|busca|encontr|cuanto (sale|cuesta)|precio|producto|servicio|promoc|convenio|agencia|proveedor|pantalla|seccion/,
  cuenta_de_reserva: /cuenta|consum|gast|pag[oó]|pagos|debe|saldo|detalle|factur/,
  ordenes_mantenimiento: /mantenim|orden|arregl|repar|rot[oa]|pendiente|tecnico/,
  objetos_perdidos: /perdid|olvid|objeto|encontr|campera|cargador|celular|anteojo|billetera/,
  avisos_internos: /avis|cartelera|novedad|comunicad/,
  cuentas_agencias: /agencia|cuenta corriente|operador|mayorista/,
  cuentas_proveedores: /proveedor|pagarle|le debemos|deuda con|factura de compra/,
  salud_del_sistema: /error|falla|anda mal|funciona|sistema|cron|tarea|rebot|no (le )?lleg/,
  proponer_estado_orden: /resuelt|arreglad|termin|cerr|en proceso|reabr|ya (esta|quedo)/,
  proponer_objeto_devuelto: /devol|devuelt|retir|se lo llev|vino a buscar|entreg/,
  informacion_general: /glaciar|perito|moreno|upsala|chalten|excursion|turis|que (hay|hacer|visitar)|historia|que es|quien|donde queda|recomend|lago argentino|fitz roy|museo|parque nacional/,
}

/** Siempre van: responder dudas y ubicar una reserva sirven en cualquier conversación. */
const SIEMPRE = ['consultar_ayuda', 'buscar_reserva']

/** Si la conversación no da pistas, un conjunto chico de consulta. */
const POR_OMISION = ['operacion_del_dia', 'disponibilidad', 'buscar_por_huesped', 'metricas_periodo']

/** Tope de herramientas por llamada. */
const MAXIMO_HERRAMIENTAS = 12

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Las herramientas del rol que tienen que ver con la conversación.
 *
 * `contexto` son los últimos mensajes (no sólo el último): «sí, confirmalo»
 * no nombra nada, pero el mensaje anterior sí. Nunca devuelve una herramienta
 * fuera de las del rol (`herramientasPara`): esto achica, no amplía.
 */
export function herramientasRelevantes(rol: Rol, contexto: string): DefinicionHerramienta[] {
  const delRol = herramientasPara(rol)
  const texto = sinAcentos(contexto)
  const elegidas = new Set(SIEMPRE)
  for (const h of delRol) if (PALABRAS[h.nombre]?.test(texto)) elegidas.add(h.nombre)
  if (elegidas.size === SIEMPRE.length) for (const n of POR_OMISION) elegidas.add(n)
  return delRol.filter((h) => elegidas.has(h.nombre)).slice(0, MAXIMO_HERRAMIENTAS)
}
