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
        titulo: 'Cobrar la seña en el mostrador',
        detalle:
          'En la reserva, el bloque Pagos propone una seña sugerida. Se puede cargar efectivo, transferencia o tarjeta, y elegir en qué moneda entró la plata: si el huésped paga en pesos, poné el importe en pesos y el sistema lo pasa a dólares con la cotización del día. Así la caja cierra contra el sistema.',
      },
      {
        titulo: 'Si cobrás con el posnet',
        detalle:
          'Cargá el número de cupón y los últimos cuatro dígitos. Es lo que sirve para conciliar cuando la liquidación de la terminal no coincide con el sistema. El número completo de la tarjeta no se pide nunca y no se puede guardar.',
      },
      {
        titulo: 'Mandarle un link de pago al huésped',
        detalle:
          'Es para el que reservó por teléfono o WhatsApp y no está para dar la tarjeta. En el bloque "Link de pago" elegís el medio y si cobrás la seña o el saldo, y el sistema arma un enlace para mandarle. Paga desde su celular y la reserva se marca sola, sin que nadie toque nada.',
      },
      {
        titulo: 'Por qué a veces no deja generar otro link',
        detalle:
          'Si ya hay un enlace activo por ese saldo, el sistema muestra ése en vez de crear uno nuevo. Es a propósito: con dos enlaces vivos el huésped puede pagar dos veces, y devolver esa plata es un trámite con la pasarela. Los enlaces vencen a las 48 horas.',
      },
      {
        titulo: 'El huésped también puede pagar desde la web',
        detalle:
          'En el correo de confirmación tiene un botón para pagar. Puede elegir tarjeta internacional en dólares o pagar en pesos con MercadoPago, débito, cuotas o efectivo en Rapipago. Cuando la plata entra, la reserva pasa a confirmada sola.',
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
        titulo: 'Corregir un dato de la ficha',
        detalle:
          'En "Editar ficha" se cambia el plan, el segmento, el voucher, las notas, las cunas, "no mover" y cuántos adultos/menores/bebés hay. No toca el precio ni el estado — si entran más personas de las que la habitación admite, lo avisa y no guarda nada.',
      },
      {
        titulo: 'Check-out y factura',
        detalle:
          'Al irse, apretá "Check-out": se suman los puntos de fidelidad y se le manda la encuesta. Recién ahí aparece el botón para facturar.',
      },
      {
        titulo: 'Corregir o anular una factura: nota de crédito',
        detalle:
          'Una factura emitida no se edita ni se borra. Para corregirla o anularla, abrí la reserva, tocá "Ver factura" y bajá hasta "Notas de crédito". Poné el importe a acreditar (todo, para anularla, o una parte) y el motivo, y apretá "Emitir nota de crédito". Sale con CAE y no se puede deshacer. En el libro de ventas aparece en negativo.',
      },
      {
        titulo: 'Turistas del exterior: cuándo NO se cobra IVA',
        detalle:
          'La exención pide DOS cosas juntas: que el huésped resida en el exterior (se marca en su ficha) y que pague desde el exterior, con tarjeta emitida afuera o transferencia. Un extranjero que paga en efectivo en pesos SÍ paga IVA. Cargá de dónde sale el pago en el bloque "Exención de IVA" de la reserva: el sistema decide solo y te muestra cuánto sale con y sin impuesto. El frigobar y las excursiones siguen con IVA siempre.',
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
      {
        titulo: 'Cambiar a alguien de habitación',
        detalle:
          'Con el mouse, arrastrá el bloque de la reserva hasta la fila de la habitación nueva y soltalo: se abre una ventanita que dice qué va a pasar antes de hacerlo. Las fechas no se tocan, sólo la habitación. Si la fila se pone roja es porque esa habitación ya está ocupada esas noches. Desde una tablet o el celular no se puede arrastrar: ahí se hace abriendo la reserva y usando "Cambiar unidad", que es el camino de siempre.',
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
      {
        titulo: 'Unir dos fichas de la misma persona',
        detalle:
          'Pasa seguido con el huésped que se cargó una vez sin documento y después vuelve a reservar. Desde "Fusionar con otra ficha" buscás la otra y se unen: el historial y los puntos pasan a la que estás mirando, y la otra desaparece. No se puede deshacer.',
      },
      {
        titulo: 'Si alguien pide que se borren sus datos',
        detalle:
          '"Derecho de supresión" borra el nombre, el documento, el contacto y las notas, pero conserva las reservas y las facturas (hay que guardarlas por ley). No se puede hacer si tiene una reserva pendiente, confirmada, pagada o en curso: esperá al check-out o cancelala primero.',
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
      {
        titulo: 'Desde el celular: "Mi trabajo"',
        detalle:
          'El botón "Vista para el celular" abre una pantalla pensada para usar de pie, en el pasillo: tus habitaciones ordenadas por urgencia, una tarjeta por habitación y un solo botón grande para marcarla limpia. No hay filtros ni tablas.',
      },
      {
        titulo: 'Por qué una habitación aparece primero',
        detalle:
          'La lista se ordena por urgencia y dice el motivo al lado. "Urgente" significa que llega alguien hoy y la habitación todavía no está lista. "Prioridad alta" es que se desocupó hoy y hay que prepararla. Si dice "Normal", se puede dejar para después.',
      },
      {
        titulo: 'La inspección no la hace la mucama',
        detalle:
          'Desde el celular sólo se puede marcar "limpia". Pasar a "inspeccionada" lo hace la gobernanta o gerencia desde el tablero: es el control de calidad, y no lo puede firmar quien hizo el trabajo.',
      },
      {
        titulo: 'El avance del turno',
        detalle:
          'Arriba se ve el porcentaje y cuántas faltan. Las habitaciones bloqueadas no se cuentan, así que el 100% significa de verdad que terminaste.',
      },
    ],
  },
  {
    area: 'punto_venta',
    resumen: 'Cargar frigobar, room service y extras a la habitación.',
    pasos: [
      {
        titulo: 'Se carga todo junto, no de a uno',
        detalle:
          'Elegís la habitación, escribís las cantidades en la grilla y apretás "Cerrar comanda" una sola vez. El total se va sumando abajo mientras escribís, así lo podés decir en voz alta antes de guardar.',
      },
      {
        titulo: 'Buscar sin acentos',
        detalle:
          'El buscador encuentra "cafe" y te muestra "Café". También funciona con el código del producto, por ejemplo FRI- para ver todo el frigobar.',
      },
      {
        titulo: 'Sólo aparecen los que están alojados hoy',
        detalle:
          'La lista de habitaciones muestra únicamente las reservas en curso. No se le puede cargar un frigobar a alguien que llega el mes que viene, y eso evita elegir la habitación equivocada.',
      },
      {
        titulo: 'El número de comanda sirve para corregir',
        detalle:
          'Cada carga recibe un número. Si te equivocaste de habitación, buscás la comanda en la lista de abajo y la anulás completa: se quitan todas sus líneas de la cuenta de una vez, sin tener que borrarlas una por una.',
      },
      {
        titulo: 'Anular no repone el stock',
        detalle:
          'A propósito: la botella igual salió del frigobar. Lo que se corrige al anular es a quién se le cobra. Si además hay que ajustar el inventario, se hace desde Configuración.',
      },
      {
        titulo: 'El stock avisa antes de cobrar',
        detalle:
          'Si un producto lleva control de stock, se muestra cuántos quedan y no deja cargar más. Cuando llega a cero, el campo queda deshabilitado.',
      },
    ],
  },
  {
    area: 'errores',
    resumen: 'Qué falló, cuándo y en qué pantalla. Sirve para pedir ayuda con datos.',
    pasos: [
      {
        titulo: 'Para qué es esta pantalla',
        detalle:
          'Cuando algo del sistema falla —no carga una pantalla, no se guarda un cobro, el correo no sale— acá queda anotado. Antes eso solo se veía abriendo los registros técnicos del servidor, que nadie del hotel mira. La idea es simple: que una falla de la madrugada no se entere primero el huésped.',
      },
      {
        titulo: 'El código de ocho caracteres',
        detalle:
          'Cuando a alguien le aparece la pantalla de "algo salió mal", abajo hay un código. Ese mismo código está en esta lista. Es lo que permite pasar de "no me anduvo" a saber exactamente qué pasó: si te lo pasan, buscalo acá.',
      },
      {
        titulo: 'Que aparezcan errores no es alarma',
        detalle:
          'Un sistema en uso siempre registra algo: alguien que perdió la conexión, un archivo mal cargado. Lo que hay que mirar es si el mismo error se repite muchas veces o si aparece uno relacionado con cobros o facturas.',
      },
      {
        titulo: 'No tiene datos de tarjetas ni contraseñas',
        detalle:
          'El sistema borra esos datos antes de anotar nada, incluso si vinieran dentro del mensaje de error. Aun así la lista puede tener nombres o números de reserva, así que la ven solo administración y gerencia.',
      },
      {
        titulo: 'Se limpia sola',
        detalle:
          'Los errores de más de 90 días se borran automáticamente. Un error de hace tres meses ya no le sirve a nadie y la lista se volvería imposible de leer.',
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
        titulo: 'Venta por categoría',
        detalle:
          'Muestra qué vendió cada tipo de habitación y de cabaña en el mes: noches, plata, tarifa promedio y qué parte del ingreso explica cada uno. Sirve para saber cuál conviene empujar. Un guion en vez de un número quiere decir que ese dato no existe, no que sea cero.',
      },
      {
        titulo: 'Ver dos informes a la vez',
        detalle:
          'Cada informe tiene su propia pantalla y su propio mes. Con el botón "Abrir aparte" se abre en otra pestaña, así se puede comparar un mes contra otro, o la venta por categoría contra los canales, sin cerrar ninguno.',
      },
      {
        titulo: 'Bajar los datos',
        detalle:
          'Casi todos los listados tienen "Exportar CSV" para abrirlos en Excel. El archivo trae lo mismo que se ve en pantalla: si buscaste o filtraste, baja sólo eso. Los importes vienen con coma decimal, listos para sumar.',
      },
      {
        titulo: 'Libro de ventas para el contador',
        detalle:
          'En Reportes → Facturación, elegí el mes y apretá "Descargar libro de ventas". Trae todas las facturas y notas de crédito del mes con CAE, cliente, CUIT, neto gravado, exento e IVA. Las notas de crédito van en negativo, así que la suma de la columna Total es lo que se vendió de verdad.',
      },
      {
        titulo: 'Cierre del día',
        detalle:
          'Repasa un día puntual: cuántos llegaron de los que tenían que llegar, quién no apareció, quién se fue y cuánto entró y por qué medio. Es de solo lectura — no marca no-shows ni cierra nada por su cuenta, eso lo decide una persona.',
      },
    ],
  },
  {
    area: 'config',
    resumen: 'Tarifas, temporadas, productos, cotización del dólar y ubicación de las unidades.',
    pasos: [
      {
        titulo: 'Antes de tocar una tarifa',
        detalle:
          'Cambiar un precio afecta todas las cotizaciones nuevas, no las reservas ya cargadas. Queda registrado quién lo cambió.',
      },
      {
        titulo: 'Cargar la cotización del dólar',
        detalle:
          'El sistema trabaja en dólares y muestra el equivalente en pesos con la cotización que haya cargada. Si no hay ninguna, los importes se muestran solo en USD: no inventa un tipo de cambio. En pantalla se aclara de dónde salió el valor y de cuándo es.',
      },
      {
        titulo: 'Temporadas',
        detalle:
          'Cada rango de fechas tiene su precio. Si una fecha no cae en ninguna temporada cargada, la reserva sale en cero: es el error más común y se arregla completando el calendario.',
      },
      {
        titulo: 'Productos e inventario',
        detalle:
          'Lo que se le puede cargar a la cuenta de un huésped: frigobar, excursiones, lavandería. Los que llevan control de stock avisan cuando quedan pocos.',
      },
      {
        titulo: 'Piso y bloque de cada unidad',
        detalle:
          'Sirve para que housekeeping recorra en orden y para filtrar la grilla de ocupación por sector. Desde la misma pantalla se da de alta una unidad nueva, se le cambia el nombre o se la da de baja (no se puede si tiene una estadía pendiente, confirmada, pagada o en curso).',
      },
      {
        titulo: 'Tipos de alojamiento',
        detalle:
          'Hostería o Cabaña, con su capacidad y descripción. El código (el que usan las fotos y el catálogo público) no se puede cambiar una vez creado.',
      },
      {
        titulo: 'Promociones',
        detalle:
          'Descuento por porcentaje o monto fijo, con noches mínimas y anticipación opcionales. Se elige en el paso de condiciones comerciales al crear una reserva; si no cumple sus propias condiciones, se cotiza sin descuento en vez de rechazar el alta.',
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
          'Recepción no ve facturación ni configuración; housekeeping ve solo su trabajo. Dar de más es el error más caro de deshacer.',
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
      'El precio sin el margen del mostrador. El sistema guarda dos precios por noche, el neto y el rack; el que se le muestra al huésped es el rack, con el IVA discriminado.',
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
