# Diccionario de datos

Generado del esquema real de la base con `figuras/fuentes/generar-diccionario.py`. Se detallan las tablas que intervienen en los casos de uso principales; las demás se describen al final.

Referencias: **PK** clave primaria · **FK** clave foránea · **Obl.** dato obligatorio.

## huespedes

Personas que se alojan o reservan. Una ficha por huésped.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador del huésped. |
| `nombre` | texto |  | Sí | Nombre de pila. |
| `apellido` | texto |  | Sí | Apellido. Único dato obligatorio para reservar en el mostrador. |
| `doc_tipo` | texto |  | Sí | Tipo de documento (DNI, pasaporte, etc.). |
| `doc_numero` | texto |  | Sí | Número de documento. |
| `email` | texto |  | No | Correo al que se envían la confirmación y los avisos. |
| `telefono` | texto |  | No | Teléfono de contacto. |
| `nacionalidad` | texto |  | No | Nacionalidad declarada. |
| `notas` | texto |  | Sí | Observaciones internas de recepción. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora de alta de la ficha. |
| `puntos` | entero |  | Sí | Puntos de fidelidad acumulados. |
| `condicion_iva` | condicion iva |  | Sí | Condición frente al IVA; define la letra de la factura. Por defecto, consumidor final. |
| `vip` | sí / no |  | Sí | Marca de huésped VIP. |
| `residente_exterior` | sí / no |  | Sí | Indica si reside en el exterior; es una de las dos condiciones de la exención de IVA. |
| `acepta_avisos` | sí / no |  | Sí | Acepta avisos sobre su reserva (confirmación, recordatorio, factura). |
| `acepta_promociones` | sí / no |  | Sí | Acepta recibir promociones; requiere consentimiento explícito. |
| `anonimizado` | sí / no |  | Sí | Indica que sus datos personales fueron suprimidos a pedido del titular. |

## reservas

Cabecera de cada reserva: quién reserva, por qué canal, en qué estado y por cuánto.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la reserva. |
| `codigo` | texto |  | Sí | Código legible que se le da al huésped (por ejemplo, BP-261112-E07B). |
| `huesped_id` | identificador | FK → huespedes | No | Huésped titular. |
| `estado` | estado reserva |  | Sí | Estado del ciclo de vida: pendiente, confirmada, pagada, in_house, checkout, cancelada o no_show. |
| `canal` | texto |  | Sí | Canal de origen: directo, web, booking o expedia. |
| `tarifa_tipo` | texto |  | Sí | Tarifa aplicada: rack (mostrador y web) o neto (agencias en línea). |
| `promocion_id` | identificador | FK → promociones | No | Promoción aplicada, si la hay. |
| `politica_id` | identificador | FK → politicas_cancelacion | No | Política de cancelación vigente al reservar. |
| `moneda` | character |  | Sí | Moneda de los importes (USD). |
| `total` | decimal |  | Sí | Importe final de la estadía, con IVA. |
| `notas` | texto |  | Sí | Pedido especial del huésped u observaciones. |
| `creada_por` | identificador | FK → perfiles | No | Usuario que cargó la reserva; vacío si la hizo el huésped en el portal. |
| `creada_en` | fecha y hora |  | Sí | Fecha y hora de alta. |
| `token` | identificador |  | Sí | Clave opaca del enlace público de confirmación, pago y factura. |
| `grupo_id` | identificador |  | No | Agrupa las reservas de un mismo grupo. |
| `plan` | texto |  | Sí | Plan de comidas; el desayuno está siempre incluido. |
| `garantia` | texto |  | Sí | Cómo está garantizada la reserva. |
| `segmento` | texto |  | Sí | Segmento comercial, para los reportes. |
| `voucher` | texto |  | Sí | Número de comprobante del canal, si lo hay. |
| `descuento_pct` | decimal |  | Sí | Descuento adicional, en porcentaje. |
| `subtotal` | decimal |  | Sí | Importe sin IVA antes del descuento. |
| `total_neto` | decimal |  | Sí | Importe sin IVA después del descuento. |
| `iva` | decimal |  | Sí | IVA de la estadía. |
| `folio_alojamiento` | character |  | Sí | Folio (A o B) que paga el alojamiento. |
| `folio_b_titular` | texto |  | Sí | A nombre de quién se factura el folio B. |
| `pago_desde_exterior` | sí / no |  | No | Indica si el pago proviene del exterior; segunda condición de la exención de IVA. |
| `tarjeta_token` | texto |  | No | Referencia que devuelve la pasarela por la tarjeta de garantía; no permite reconstruir el número. |
| `tarjeta_ultimos4` | character |  | No | Últimos cuatro dígitos de la tarjeta de garantía. |
| `tarjeta_marca` | texto |  | No | Marca de la tarjeta de garantía. |
| `tarjeta_vencimiento` | character |  | No | Vencimiento de la tarjeta de garantía (MM/AA). |
| `tarjeta_verificacion` | estado verificacion tarjeta |  | Sí | Resultado de la verificación de la tarjeta. |
| `tarjeta_verificada_en` | fecha y hora |  | No | Fecha y hora de la verificación. |
| `tarjeta_detalle` | texto |  | No | Motivo del rechazo o de la imposibilidad de verificar. |
| `cancelada_en` | fecha y hora |  | No | Fecha y hora de la cancelación, si se canceló. |

## estadias

Ocupación de una unidad durante un período. Es la tabla que impide la sobreventa.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la estadía. |
| `reserva_id` | identificador | FK → reservas | Sí | Reserva a la que pertenece. |
| `unidad_id` | identificador | FK → unidades | Sí | Unidad física que ocupa. |
| `tipo_unidad_id` | identificador | FK → tipos_unidad | Sí | Tipo de alojamiento con el que se vendió. |
| `periodo` | rango de fechas |  | Sí | Rango de fechas de la estadía; el día de salida no se cuenta como ocupado. |
| `estado` | estado reserva |  | Sí | Estado, sincronizado con el de la reserva. |
| `precio_noche` | decimal |  | Sí | Precio por noche sin IVA. |
| `huespedes` | entero |  | Sí | Plazas ocupadas (adultos más menores). |
| `check_in` | fecha |  | No | Fecha de entrada, calculada a partir del período. |
| `check_out` | fecha |  | No | Fecha de salida, calculada a partir del período. |
| `adultos` | entero |  | Sí | Cantidad de adultos. |
| `menores` | entero |  | Sí | Cantidad de menores. |
| `bebes` | entero |  | Sí | Cantidad de bebés en cuna; no ocupan plaza. |
| `camas_extra` | entero |  | Sí | Camas extra solicitadas. |
| `cunas` | entero |  | Sí | Cunas solicitadas. |
| `no_mover` | sí / no |  | Sí | El huésped pidió esta unidad en particular. |

## unidades

Habitaciones y cabañas físicas del hotel.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la unidad. |
| `tipo_unidad_id` | identificador | FK → tipos_unidad | Sí | Tipo de alojamiento al que pertenece. |
| `nombre` | texto |  | Sí | Nombre de la habitación o cabaña. |
| `estado` | estado hk |  | Sí | Estado de limpieza: limpia, sucia, inspeccionada o bloqueada. |
| `activo` | sí / no |  | Sí | Indica si la unidad está en uso. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora de alta. |
| `asignada_a` | identificador | FK → perfiles | No | Mucama asignada a la unidad. |
| `piso` | texto |  | Sí | Planta en la que está. |
| `bloque` | texto |  | Sí | Sector o edificio. |
| `orden` | entero |  | Sí | Orden dentro del piso, para el recorrido de limpieza. |

## tipos_unidad

Tipos de alojamiento que se venden (Standard, Superior, Suite, cabañas…).

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador del tipo. |
| `codigo` | texto |  | Sí | Código corto (por ejemplo, HOST-SUP). |
| `nombre` | texto |  | Sí | Nombre comercial. |
| `categoria` | categoria unidad |  | Sí | Hostería o cabaña. |
| `capacidad_max` | entero |  | Sí | Cantidad máxima de plazas. |
| `descripcion` | texto |  | Sí | Texto que se muestra en el portal. |
| `amenities` | estructura |  | Sí | Comodidades incluidas. |
| `activo` | sí / no |  | Sí | Indica si se ofrece a la venta. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora de alta. |

## tarifas

Precio por noche de cada tipo de alojamiento en cada temporada.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la tarifa. |
| `tipo_unidad_id` | identificador | FK → tipos_unidad | Sí | Tipo de alojamiento. |
| `temporada_id` | identificador | FK → temporadas | Sí | Temporada. |
| `precio_neto` | decimal |  | Sí | Precio para agencias, sin IVA. No es visible para el público. |
| `precio_rack` | decimal |  | Sí | Precio de mostrador, sin IVA. |
| `moneda` | character |  | Sí | Moneda de la tarifa (USD). |
| `iva_pct` | decimal |  | Sí | Porcentaje de IVA. |
| `vigente` | sí / no |  | Sí | Indica si la tarifa está en vigencia. |

## consumos

Cada línea cargada a la cuenta de una reserva: productos y servicios adicionales.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la línea. |
| `reserva_id` | identificador | FK → reservas | Sí | Reserva a la que se carga. |
| `producto_id` | identificador | FK → productos_servicios | Sí | Producto o servicio consumido. |
| `cantidad` | entero |  | Sí | Cantidad. |
| `precio_unitario` | decimal |  | Sí | Precio unitario en USD, congelado al momento de la carga. |
| `fecha` | fecha |  | Sí | Día del consumo, según la fecha del hotel. |
| `cargado_por` | identificador | FK → perfiles | No | Usuario que lo cargó. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora de carga. |
| `comanda` | entero |  | No | Número que agrupa las líneas cargadas juntas en el punto de venta. |
| `nota` | texto |  | Sí | Aclaración de la línea. |
| `folio` | character |  | Sí | Folio al que se carga: A (titular) o B (tercero). |
| `comprobante` | texto |  | Sí | Comprobante interno asociado. |
| `departamento_id` | identificador | FK → departamentos | No | Departamento que lo vendió, copiado al momento de la venta. |
| `moneda_origen` | character |  | No | Moneda en que se cobró, si no fue en dólares. |
| `importe_origen` | decimal |  | No | Importe en la moneda de origen. |
| `cotizacion_usada` | decimal |  | No | Cotización aplicada para convertir a dólares. |

## productos_servicios

Catálogo de lo que se puede cargar a una cuenta: frigobar, restaurante, excursiones, traslados.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador del producto. |
| `codigo` | texto |  | Sí | Código corto. |
| `nombre` | texto |  | Sí | Nombre que se muestra al cargar. |
| `categoria` | categoria producto |  | Sí | Categoría: desayuno, frigobar, excursión, traslado u otro. |
| `precio` | decimal |  | Sí | Precio vigente. |
| `moneda` | character |  | Sí | Moneda del precio (USD). |
| `activo` | sí / no |  | Sí | Indica si se puede vender. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora de alta. |
| `stock` | entero |  | No | Unidades disponibles; vacío en los servicios, que no llevan stock. |
| `stock_minimo` | entero |  | Sí | Cantidad por debajo de la cual se avisa que hay que reponer. |
| `departamento_id` | identificador | FK → departamentos | No | Departamento que lo vende. |

## departamentos

Sectores que venden (frigobar, restaurante, excursiones…), en dos niveles.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador del departamento. |
| `codigo` | texto |  | Sí | Código corto. |
| `nombre` | texto |  | Sí | Nombre. |
| `padre_id` | identificador | FK → departamentos | No | Departamento del que depende; vacío si es de primer nivel. |
| `orden` | entero |  | Sí | Orden en que se muestra. |
| `activo` | sí / no |  | Sí | Indica si está en uso. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora de alta. |

## pagos

Cobros y devoluciones de una reserva, en efectivo, por transferencia, con tarjeta o en línea.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador del pago. |
| `reserva_id` | identificador | FK → reservas | Sí | Reserva que se cobra. |
| `medio` | medio pago |  | Sí | Medio: efectivo, transferencia, tarjeta, Mercado Pago, Stripe o Payway. |
| `tipo` | tipo pago |  | Sí | Seña, saldo o reembolso. |
| `monto` | decimal |  | Sí | Importe en dólares; es el que salda la reserva. |
| `moneda` | character |  | Sí | Moneda en que efectivamente se cobró. |
| `estado` | estado pago |  | Sí | Pendiente, aprobado, rechazado o reembolsado. |
| `external_id` | texto |  | No | Referencia del cobro en la pasarela; evita registrar dos veces el mismo aviso. |
| `nota` | texto |  | Sí | Observación. |
| `creado_por` | identificador | FK → perfiles | No | Usuario que lo registró; vacío si lo informó la pasarela. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora del registro. |
| `monto_cobrado` | decimal |  | No | Importe cobrado en la moneda del pago. |
| `cotizacion` | decimal |  | No | Tipo de cambio aplicado, congelado al generar el cobro. |
| `cupon` | texto |  | No | Número de cupón o de autorización de la terminal. |
| `ultimos4` | character |  | No | Últimos cuatro dígitos de la tarjeta. |
| `tarjeta_marca` | texto |  | No | Marca de la tarjeta. |
| `url_pago` | texto |  | No | Enlace de pago generado en la pasarela. |
| `vence_en` | fecha y hora |  | No | Fecha y hora hasta la que sirve el enlace. |

## facturas

Comprobantes emitidos. Una reserva tiene como máximo una factura, y no se modifica una vez emitida.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la factura. |
| `reserva_id` | identificador | FK → reservas | Sí | Reserva facturada. |
| `numero` | texto |  | Sí | Número interno del comprobante. |
| `total` | decimal |  | Sí | Importe total. |
| `moneda` | character |  | Sí | Moneda del comprobante. |
| `pdf_url` | texto |  | No | Ubicación del archivo, si se generó. |
| `cae` | texto |  | No | Código de autorización electrónico. |
| `cae_vto` | fecha |  | No | Vencimiento del código de autorización. |
| `punto_venta` | entero |  | No | Punto de venta fiscal. |
| `tipo_comprobante` | tipo comprobante |  | No | Letra del comprobante: A, B o C. |
| `emitida_por` | identificador | FK → perfiles | No | Usuario que la emitió. |
| `emitida_en` | fecha y hora |  | Sí | Fecha y hora de emisión. |
| `neto` | decimal |  | No | Importe sin IVA. |
| `iva` | decimal |  | No | IVA discriminado. |
| `alicuota_iva` | decimal |  | Sí | Alícuota de IVA aplicada. |
| `condicion_iva_receptor` | condicion iva |  | No | Condición frente al IVA del huésped al emitir. |
| `cuit_receptor` | texto |  | No | CUIT del receptor, cuando corresponde factura A. |
| `numero_fiscal` | texto |  | No | Número correlativo dentro del punto de venta. |
| `cae_solicitado_en` | fecha y hora |  | No | Fecha y hora en que se pidió la autorización. |
| `exento` | decimal |  | Sí | Parte del neto que no paga IVA (alojamiento a turistas del exterior). |
| `motivo_exencion` | texto |  | No | Fundamento de la exención, impreso en el comprobante. |

## encuestas_satisfaccion

Encuesta que se genera al hacer el check-out y el huésped responde por un enlace.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador de la encuesta. |
| `reserva_id` | identificador | FK → reservas | Sí | Reserva evaluada. |
| `token` | identificador |  | Sí | Clave opaca del enlace de la encuesta. |
| `puntaje` | entero |  | No | Puntaje de 0 a 10; vacío hasta que se responde. |
| `comentario` | texto |  | No | Comentario libre del huésped. |
| `enviada_en` | fecha y hora |  | Sí | Fecha y hora en que se envió la invitación. |
| `respondida_en` | fecha y hora |  | No | Fecha y hora de la respuesta. |

## notificaciones

Cola de salida de los correos al huésped, con reintentos.

| Campo | Tipo | Clave | Obl. | Descripción |
|---|---|---|---|---|
| `id` | identificador | PK | Sí | Identificador del aviso. |
| `evento` | texto |  | Sí | Qué se avisa: confirmación, pago recibido, cancelación, recordatorio, encuesta, etc. |
| `canal` | texto |  | Sí | Canal de salida (correo electrónico). |
| `clave` | texto |  | Sí | Clave que impide enviar dos veces el mismo aviso. |
| `destinatario` | texto |  | Sí | Dirección de correo del destinatario. |
| `variables` | estructura |  | Sí | Datos con los que se arma el mensaje. |
| `estado` | texto |  | Sí | Pendiente, enviada o fallida. |
| `intentos` | entero |  | Sí | Cantidad de intentos de envío. |
| `proximo_en` | fecha y hora |  | Sí | Fecha y hora del próximo intento. |
| `enviada_en` | fecha y hora |  | No | Fecha y hora de envío. |
| `error` | texto |  | No | Último error informado por el servicio de correo. |
| `huesped_id` | identificador | FK → huespedes | No | Huésped al que se dirige. |
| `reserva_id` | identificador | FK → reservas | No | Reserva relacionada. |
| `creado_en` | fecha y hora |  | Sí | Fecha y hora en que se encoló. |
| `entregada_en` | fecha y hora |  | No | Fecha y hora de entrega, si se informa. |
| `leida_en` | fecha y hora |  | No | Fecha y hora de lectura, si se informa. |
| `proveedor_id` | texto |  | No | Identificador del envío en el servicio de correo. |

## Otras tablas del sistema

| Tabla | Contenido |
|---|---|
| `perfiles` | Usuarios del personal, con su rol (administrador, gerencia, recepción o housekeeping) y si están activos. |
| `temporadas` | Temporadas del tarifario (baja, media y alta). |
| `temporada_rangos` | Rangos de fechas que componen cada temporada. |
| `promociones` | Promociones vigentes, con su descuento y sus condiciones. |
| `politicas_cancelacion` | Plazos y cargos de la política de cancelación. |
| `housekeeping_registros` | Registro de cada limpieza: unidad, mucama, comentario y fotos. |
| `notas_credito` | Notas de crédito emitidas sobre una factura. |
| `puntos_venta` | Puntos de venta fiscales y su último número emitido. |
| `facturas_numeracion` | Reserva del número correlativo de cada factura. |
| `datos_fiscales` | Datos fiscales del hotel como emisor (una sola fila). |
| `cotizaciones` | Cotizaciones de divisas, automáticas y manuales. |
| `auditoria` | Rastro de las operaciones sensibles: quién cambió qué y cuándo. |
| `auditoria_accesos` | Rastro de quién consultó la ficha de un huésped. |
| `errores` | Errores del servidor, para verlos desde el panel. |
| `cron_corridas` | Resultado de cada corrida de las tareas programadas. |
| `consultas_bot` | Consultas hechas al asistente del portal. |
| `intentos_limitados` | Contador del límite de intentos por origen. |
