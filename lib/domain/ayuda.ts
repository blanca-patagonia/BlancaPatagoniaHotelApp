import { puedeAcceder, ETIQUETAS_AREA, type Area } from './permisos'
import type { Rol } from './roles'

/**
 * Contenido de la guía de uso del sistema.
 *
 * Vive en el dominio y no dentro de la pantalla por dos razones. La primera es
 * la de siempre en este proyecto: se puede testear. La segunda es más concreta
 * —**una guía que miente es peor que no tener guía**—: si a alguien de
 * housekeeping se le explica cómo facturar, va a buscar un botón que no existe
 * y va a concluir que el sistema está roto. Por eso cada capítulo declara a qué
 * área pertenece y `guiaPara()` filtra con los **mismos permisos** que arman el
 * menú, en lugar de mantener dos listas que se desincronizan.
 */

export interface Paso {
  titulo: string
  detalle: string
}

export interface Capitulo {
  /** Área del panel que explica. Determina quién lo ve. */
  area: Area
  resumen: string
  pasos: Paso[]
}

export interface Termino {
  termino: string
  definicion: string
}

/** Lo primero que conviene saber, sin importar el rol. */
export const PRIMEROS_PASOS: Paso[] = [
  {
    titulo: 'Todo se guarda al instante',
    detalle:
      'No hay un botón de "guardar todo" al final del día. Cada vez que apretás un botón verde o turquesa, el cambio queda registrado.',
  },
  {
    titulo: 'Si un botón no está, es porque no corresponde',
    detalle:
      'El sistema esconde las acciones que no se pueden hacer en ese momento. Por ejemplo, "Facturar" no aparece hasta que el huésped se haya ido: no es un error, es para que no se emita un comprobante de algo que todavía no pasó.',
  },
  {
    titulo: 'Los avisos en rojo explican qué pasó',
    detalle:
      'Cuando algo no se puede hacer, aparece un cartel rojo arriba con el motivo. Leerlo suele decir exactamente qué corregir.',
  },
  {
    titulo: 'Desde el celular se ve distinto',
    detalle:
      'En pantallas chicas algunas columnas de las tablas se ocultan para que se pueda leer sin mover la pantalla de costado. Los datos completos están siempre tocando la fila.',
  },
]

/** Guía por módulo. El orden es el del menú lateral. */
export const CAPITULOS: Capitulo[] = [
  {
    area: 'reservas',
    resumen: 'Dar de alta una estadía y acompañarla hasta que el huésped se va.',
    pasos: [
      {
        titulo: 'Crear la reserva',
        detalle:
          'Entrá a Reservas y apretá "Nueva reserva". Elegí las fechas y el tipo de habitación: el sistema muestra solo lo que está libre, así que no se puede vender dos veces la misma noche.',
      },
      {
        titulo: 'Cobrar la seña',
        detalle:
          'En la reserva, el bloque Pagos propone una seña sugerida. Se puede cargar efectivo, transferencia o tarjeta. El saldo queda a la vista.',
      },
      {
        titulo: 'Check-in',
        detalle:
          'El día que llega, abrí la reserva y apretá "Check-in". La habitación pasa a estar ocupada y ya se le pueden cargar consumos.',
      },
      {
        titulo: 'Cambiar de habitación',
        detalle:
          'Si hay que mudar al huésped —una avería, un pedido suyo—, usá "Cambiar de unidad". Solo aparecen las que están libres esas noches, y la que se libera queda marcada para limpieza.',
      },
      {
        titulo: 'Check-out y factura',
        detalle:
          'Al irse, apretá "Check-out": se suman los puntos de fidelidad y se le manda la encuesta. Recién ahí aparece el botón para facturar.',
      },
    ],
  },
  {
    area: 'ocupacion',
    resumen: 'Ver de un vistazo qué habitaciones están ocupadas y cuáles libres.',
    pasos: [
      {
        titulo: 'Leer la grilla',
        detalle:
          'Cada fila es una habitación y cada columna un día. Los bloques de color son estadías: el nombre que aparece es el del huésped.',
      },
      {
        titulo: 'Moverse en el tiempo',
        detalle:
          'Las flechas de arriba corren la ventana de días. Sirve para ver si conviene aceptar una reserva larga.',
      },
    ],
  },
  {
    area: 'huespedes',
    resumen: 'La ficha de cada persona que se alojó, con su historial.',
    pasos: [
      {
        titulo: 'Buscar a alguien',
        detalle:
          'El buscador encuentra por apellido, nombre, documento o email. No hace falta escribir el nombre completo.',
      },
      {
        titulo: 'La condición frente al IVA',
        detalle:
          'Es el dato más importante de la ficha porque define la letra de la factura. Si es una empresa, cargá el CUIT: sin eso no se puede emitir factura A.',
      },
    ],
  },
  {
    area: 'housekeeping',
    resumen: 'El estado de limpieza de cada habitación y quién la tiene asignada.',
    pasos: [
      {
        titulo: 'Marcar una habitación',
        detalle:
          'Tocá el estado que corresponde: limpia, sucia, inspeccionada o bloqueada. El cambio se ve al instante en el resto del sistema.',
      },
      {
        titulo: 'Bloqueada',
        detalle:
          'Usalo cuando la habitación no se puede vender —una avería seria, una refacción—. Deja de ofrecerse al cargar reservas.',
      },
    ],
  },
  {
    area: 'mantenimiento',
    resumen: 'Órdenes de trabajo: lo que hay que arreglar y en qué anda.',
    pasos: [
      {
        titulo: 'Cargar un desperfecto',
        detalle:
          'Apretá "Crear orden", contá qué pasa y elegí la habitación. Poné prioridad alta solo si impide usarla.',
      },
      {
        titulo: 'Mantenimiento preventivo',
        detalle:
          'Los planes generan órdenes solas cada tanto (por ejemplo, revisar calefactores cada 6 meses), para no acordarse cuando ya se rompió.',
      },
    ],
  },
  {
    area: 'objetos_perdidos',
    resumen: 'Lo que los huéspedes se olvidan, hasta que lo reclaman.',
    pasos: [
      {
        titulo: 'Registrar y devolver',
        detalle:
          'Cargá qué es y dónde apareció. Cuando alguien lo reclama, apretá "Marcar devuelto" y queda el registro de la entrega.',
      },
    ],
  },
  {
    area: 'agencias',
    resumen: 'Agencias y empresas con convenio, y lo que nos deben.',
    pasos: [
      {
        titulo: 'El descuento del convenio',
        detalle:
          'Lo que cargues como descuento se aplica solo a las reservas de esa cuenta: pagan tarifa neta en lugar de la de mostrador.',
      },
      {
        titulo: 'Cargos y pagos',
        detalle:
          'Un cargo es lo que la agencia nos debe; un pago es lo que nos deposita. El saldo lo calcula el sistema, no hace falta llevarlo aparte.',
      },
    ],
  },
  {
    area: 'proveedores',
    resumen: 'A quiénes les compramos y cuánto les debemos.',
    pasos: [
      {
        titulo: 'Cargar una factura',
        detalle:
          'Registrá el comprobante con su vencimiento. De esa fecha sale el informe de qué hay que pagar primero.',
      },
    ],
  },
  {
    area: 'contratos',
    resumen: 'Convenios con firma electrónica.',
    pasos: [
      {
        titulo: 'Redactar y enviar',
        detalle:
          'Primero se guarda como borrador y se puede corregir. Al enviarlo a firmar, el texto queda congelado: desde ese momento no se puede cambiar sin invalidar la firma.',
      },
      {
        titulo: 'Cómo firma la otra parte',
        detalle:
          'Recibe un enlace propio. No necesita usuario ni contraseña: entra, lee y acepta. Queda registrado cuándo lo hizo.',
      },
    ],
  },
  {
    area: 'avisos',
    resumen: 'La cartelera interna del hotel.',
    pasos: [
      {
        titulo: 'Avisos y conversaciones no son lo mismo',
        detalle:
          'Un aviso es un anuncio para todos, como el pizarrón de la cocina. Conversaciones es para hablar entre ustedes.',
      },
    ],
  },
  {
    area: 'reportes',
    resumen: 'Cómo viene el negocio.',
    pasos: [
      {
        titulo: 'Qué miran los números',
        detalle:
          'La ocupación es cuántas habitaciones se vendieron; el ADR, a qué precio promedio; el RevPAR combina las dos y es el que mejor resume el mes.',
      },
      {
        titulo: 'Bajar los datos',
        detalle:
          'Casi todos los listados tienen "Exportar CSV" para abrirlos en Excel.',
      },
    ],
  },
  {
    area: 'config',
    resumen: 'Tarifas, temporadas y productos.',
    pasos: [
      {
        titulo: 'Antes de tocar una tarifa',
        detalle:
          'Cambiar un precio afecta todas las cotizaciones nuevas, no las reservas ya cargadas. Queda registrado quién lo cambió.',
      },
    ],
  },
  {
    area: 'usuarios',
    resumen: 'Quién entra al sistema y qué puede ver.',
    pasos: [
      {
        titulo: 'Elegir el rol',
        detalle:
          'Recepción no ve facturación ni proveedores; housekeeping ve solo su trabajo. Dar de más es el error más caro de deshacer.',
      },
    ],
  },
]

/** Palabras del sistema que no son obvias para quien recién empieza. */
export const GLOSARIO: Termino[] = [
  {
    termino: 'Tarifa rack',
    definicion: 'El precio de mostrador, el que paga quien reserva directo.',
  },
  {
    termino: 'Tarifa neta',
    definicion:
      'El precio con el descuento del convenio. Es lo que paga una agencia; la diferencia es su comisión.',
  },
  { termino: 'In house', definicion: 'El huésped ya hizo el check-in y está alojado ahora.' },
  {
    termino: 'No-show',
    definicion: 'Reservó, no avisó y no vino. Según la política se le cobra la estadía completa.',
  },
  {
    termino: 'Seña',
    definicion: 'El adelanto que se cobra para confirmar. El resto es el saldo.',
  },
  {
    termino: 'CAE',
    definicion:
      'El número que AFIP le da a una factura para validarla. Sin CAE, el comprobante no tiene valor fiscal.',
  },
  {
    termino: 'Ocupación',
    definicion: 'Qué porcentaje de las habitaciones disponibles se vendió.',
  },
  {
    termino: 'ADR',
    definicion: 'El precio promedio al que se vendió cada habitación ocupada.',
  },
  {
    termino: 'RevPAR',
    definicion:
      'Lo que rindió en promedio cada habitación del hotel, ocupada o no. Resume ocupación y precio en un solo número.',
  },
  {
    termino: 'Overbooking',
    definicion:
      'Vender la misma habitación dos veces para las mismas noches. Este sistema no lo permite: lo bloquea la base de datos.',
  },
]

/**
 * Capítulos que le corresponden a un rol.
 *
 * Se apoya en `puedeAcceder` en lugar de repetir la lista: así la guía y el
 * menú lateral no pueden decir cosas distintas.
 */
export function guiaPara(rol: Rol): Capitulo[] {
  return CAPITULOS.filter((c) => puedeAcceder(rol, c.area))
}

/** Título legible de un capítulo, tomado de la etiqueta del menú. */
export function tituloCapitulo(c: Capitulo): string {
  return ETIQUETAS_AREA[c.area]
}
