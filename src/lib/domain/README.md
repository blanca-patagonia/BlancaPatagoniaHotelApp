# `lib/domain/` — las reglas del negocio

Lógica **pura**: ni base de datos, ni React, ni Next, ni zod. Cada módulo recibe
datos y devuelve una decisión, así que se prueba sin levantar nada
(`tests/dominio/`, un archivo por módulo).

- Sólo importa de sí mismo y de `lib/fechas` — lo vigila
  `tests/contratos/capas.test.ts`.
- Los archivos están **todos al mismo nivel, a propósito**: la bitácora, los ADR y
  los comentarios del código los citan por ruta (`lib/domain/precios.ts`), y
  moverlos a subcarpetas dejaría cientos de referencias apuntando a la nada. El
  orden por tema vive en este índice.
- **Un módulo nuevo se suma a esta lista**: `tests/contratos/indices.test.ts`
  falla si hay un archivo sin listar o una entrada que ya no existe.

## Reservas y ocupación

| Módulo | Qué decide |
|---|---|
| `reservas.ts` | Máquina de estados de la reserva y validación de fechas |
| `reserva-publica.ts` | Qué puede mandar un visitante anónimo al reservar desde la web |
| `borrador-reserva.ts` | Borrador del alta de mostrador (se guarda en la pestaña) |
| `cancelacion.ts` | Política de cancelación del tarifario (>14, 14–7, <7 días, no-show) |
| `mudanzas.ts` | Cambio de unidad de una reserva |
| `arrastre-grilla.ts` | Arrastrar una reserva en la grilla para cambiarla de habitación (ADR 0033) |
| `grilla.ts` | Reglas de la grilla de ocupación |
| `ocupantes.ts` | Desglose de adultos, menores y bebés |
| `vistas-reservas.ts` | Las vistas operativas del listado de reservas |
| `temporadas.ts` | Calendario de temporadas (`[desde, hasta)`) |
| `unidades.ts` | Tipos del inventario de habitaciones y cabañas |
| `recordatorios.ts` | Cuándo sale cada recordatorio y `DIAS_EXPIRACION` |

## Precios, cobros y cuenta del huésped

| Módulo | Qué decide |
|---|---|
| `precios.ts` | Motor de precios: noches, neto/rack, IVA discriminado (ADR 0004) |
| `moneda.ts` | Formato de importes en pantalla |
| `divisas.ts` | Cotización de monedas extranjeras (ADR 0020) |
| `cobro.ts` | Cobro en línea: conversión y medios de pago |
| `pagos.ts` | Resumen de pagos y estado según lo cobrado |
| `garantia-tarjeta.ts` | Si una garantía de tarjeta sirve para cobrar (ADR 0025) |
| `consumos.ts` | Consumos y cuenta consolidada |
| `folios.ts` | Folios A/B de la cuenta del huésped |
| `departamentos.ts` | Jerarquía de departamentos de la cuenta |
| `punto-venta.ts` | Punto de venta y comandas |

## Facturación, contabilidad y conciliación

| Módulo | Qué decide |
|---|---|
| `facturacion.ts` | Tipo de comprobante y totales de la factura argentina (ADR 0012) |
| `wsfev1.ts` | Traducción del comprobante al formato WSFEv1 de ARCA |
| `exencion-iva.ts` | Exención de IVA al turista del exterior — se deriva, no se tilda (ADR 0024) |
| `libro-ventas.ts` | Libro de ventas del mes: facturas y notas de crédito (en negativo), neto gravado y exento |
| `comprobante-qr.ts` | Lectura del QR de una factura recibida (ADR 0031) |
| `cuentas.ts` | Cuentas corrientes de agencias y empresas |
| `antiguedad.ts` | Antigüedad de saldos |
| `conciliacion.ts` | Conciliación bancaria y de pasarelas (ADR 0030) |
| `gastos.ts` | Gastos operativos sin factura de proveedor |

## Canales de venta (Booking y otros)

| Módulo | Qué decide |
|---|---|
| `canales.ts` | Reservas que llegan de un canal externo |
| `canales-cobro.ts` | Quién cobra una reserva del canal y si ya se cobró |
| `canales-costos.ts` | Lo que le cuesta al hotel vender por un canal (ADR 0023) |
| `canal-externo.ts` | Payload del webhook de un channel manager (ADR 0035) |
| `ari.ts` | Disponibilidad y tarifas que se publican al canal (ADR 0032) |
| `resenas-canal.ts` | Ligar una reseña del canal con su reserva |
| `mapeo-columnas.ts` | Mapeo manual de columnas de un informe importado |

## Operación del hotel

| Módulo | Qué decide |
|---|---|
| `housekeeping.ts` | Prioridad de limpieza de las unidades |
| `preventivo.ts` | Mantenimiento preventivo |
| `inventario.ts` | Stock y reposición |
| `lista-compras.ts` | Lista de compras de cocina |
| `servicio.ts` | Servicio de cocina: quiénes desayunan |
| `cierre-diario.ts` | Cierre del día (*night audit*) |
| `hotel.ts` | Datos operativos del hotel que todavía no están en la base |
| `respaldos.ts` | Exportación de datos operativos (no es un backup de Postgres) |
| `crons.ts` | Tareas programadas y su tolerancia de atraso |

## Huéspedes, socios y comunicación

| Módulo | Qué decide |
|---|---|
| `huespedes.ts` | Formato del nombre del huésped |
| `fidelidad.ts` | Programa de puntos |
| `encuestas.ts` | Encuestas y NPS |
| `plantillas.ts` | Plantillas de mensajes al huésped |
| `notificaciones.ts` | Bandeja de salida de avisos |
| `entregas.ts` | Estados de entrega de un correo (`enviada` ≠ `entregada`) |
| `whatsapp.ts` | Plantillas de WhatsApp y orden de sus parámetros |
| `conversaciones.ts` | Chat interno del staff |
| `contratos.ts` | Ciclo de vida y firma de contratos (ADR 0010) |
| `comercial.ts` | Pipeline comercial de agencias y empresas |

## Informes

| Módulo | Qué decide |
|---|---|
| `metricas.ts` | Ocupación, ADR y RevPAR por mes — la única definición del sistema |
| `metricas-categoria.ts` | Venta por categoría de alojamiento |
| `metricas-canal.ts` | Rentabilidad por canal |
| `metricas-facturacion.ts` | Facturación por período |
| `informes.ts` | Catálogo de informes de gestión |

## Portal público

| Módulo | Qué decide |
|---|---|
| `catalogo.ts` | Catálogo de alojamientos y precio con IVA (`conIva`) |
| `comodidades.ts` | Reconocimiento de comodidades |
| `senales.ts` | Señales de escasez («quedan pocas») |
| `clima.ts` | Clima y pronóstico de El Calafate para el asistente, con el aviso de viento fuerte |
| `asistente.ts` | Asistente del portal, por reglas y sin IA (ADR 0011) |
| `destino-seguro.ts` | A dónde se puede volver después de un pago (evita redirects abiertos) |

## Panel: acceso y navegación

| Módulo | Qué decide |
|---|---|
| `roles.ts` | Los roles del staff |
| `permisos.ts` | Qué áreas ve cada rol (`puedeAcceder`) |
| `navegacion.ts` | Grupos del menú lateral |
| `nav-plegado.ts` | Grupos del menú plegados por la persona |
| `nav-colapso.ts` | Menú colapsado a sólo íconos |
| `lateral.ts` | Ancho ajustable del menú |
| `busqueda.ts` | Búsqueda global por rol |
| `ayuda.ts` | Contenido de la sección de Ayuda |
| `cuenta.ts` | «Mi cuenta» y el mínimo de contraseña |
| `pwa.ts` | Qué cachea la app instalable — lista blanca (ADR 0028) |
| `ia-acciones.ts` | Acciones que el asistente propone y una persona confirma (ADR 0041) |
| `ia-herramientas.ts` | Catálogo de herramientas del asistente de IA y cuáles mandar en cada consulta (ADR 0039) |
| `ia-prompt.ts` | Instrucciones fijas del asistente, la pantalla de origen y las preguntas de ejemplo por rol |
| `ia-respuesta.ts` | La respuesta del asistente partida en párrafos, listas y enlaces internos (datos, no HTML) |
| `ia-datos.ts` | Lo que las herramientas le devuelven al modelo, sin datos personales (resumen del día, enmascarado) |
| `conexiones.ts` | Conexiones con proveedores externos |

## Utilidades transversales

| Módulo | Qué decide |
|---|---|
| `formularios.ts` | `falloConValores()`: devolver lo escrito cuando una acción falla (sin campos sensibles) |
| `limites.ts` | Límites de intentos de las entradas públicas |
| `listas.ts` | `deLista()`: validar un valor contra una lista blanca |
