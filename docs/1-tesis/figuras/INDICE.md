# Índice de figuras de la tesis

Material visual producido en la Fase 1. El número definitivo de cada figura se asigna al armar el documento; el epígrafe lleva número, descripción, año y fuente.

- **Diagramas** (`diagramas/`): se generan con PlantUML desde `fuentes/*.puml` (estilo común en `fuentes/_estilo.iuml`). Los DER salen del esquema real con `fuentes/generar-der.py`.
- **Capturas** (`capturas/`): tomadas del sistema en funcionamiento con datos de demostración ficticios; ningún huésped es real.
- **Anexos** (`anexos/`): capturas de los sistemas que el hotel usa hoy, provistas por el comitente; los nombres de personas están difuminados.

## Parte 1 — Relevamiento y propuesta

| Archivo | Descripción | Año | Fuente |
|---|---|---|---|
| `diagramas/pp2-organigrama.png` | Organigrama funcional del Hotel Blanca Patagonia | 2026 | Elaboración propia |
| `diagramas/pp2-cursograma-reserva.png` | Cursograma del proceso de reserva actual | 2026 | Elaboración propia |
| `diagramas/pp2-cursograma-checkin.png` | Cursograma del proceso de check-in actual | 2026 | Elaboración propia |
| `diagramas/pp2-cursograma-checkout.png` | Cursograma del proceso de check-out y facturación actual | 2026 | Elaboración propia |
| `diagramas/pp2-cursograma-limpieza.png` | Cursograma del proceso de limpieza de habitaciones actual | 2026 | Elaboración propia |
| `anexos/winpax-01-menu.png` | WinPAX 9: menú principal | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/winpax-02-grilla-ocupacion.png` | WinPAX 9: grilla de ocupación | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/winpax-03-busqueda-huespedes.png` | WinPAX 9: búsqueda de huéspedes | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/winpax-04-cuenta-huesped.png` | WinPAX 9: cuenta del huésped con folios A y B | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/winpax-05-frigobar.png` | WinPAX 9: carga de consumos de frigobar | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/winpax-06-alta-reserva.png` | WinPAX 9: alta de reserva | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/winpax-07-situacion-gobernanta.png` | WinPAX 9: situación del hotel y tablero de gobernanta | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/booking-01-inicio.png` | Extranet de Booking.com: inicio | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |
| `anexos/booking-02-reservas.png` | Extranet de Booking.com: reservas | 2026 | Hotel Blanca Patagonia (captura provista por el comitente) |

## Parte 2 — Análisis y diseño

| Archivo | Descripción | Año | Fuente |
|---|---|---|---|
| `diagramas/pp3-contexto.png` | Diagrama de contexto del sistema | 2026 | Elaboración propia |
| `diagramas/pp3-paquetes.png` | Diagrama de paquetes: módulos y casos de uso | 2026 | Elaboración propia |
| `diagramas/pp3-casos-de-uso.png` | Diagrama general de los casos de uso principales | 2026 | Elaboración propia |
| `diagramas/pp3-estados-reserva.png` | Ciclo de vida de la reserva (diagrama de estados) | 2026 | Elaboración propia |
| `diagramas/pp3-der-general.png` | Diagrama entidad-relación: vista general de las 30 tablas | 2026 | Elaboración propia |
| `diagramas/pp3-der-reservas.png` | Diagrama entidad-relación: reservas, estadías y huéspedes | 2026 | Elaboración propia |
| `diagramas/pp3-der-cuenta.png` | Diagrama entidad-relación: consumos, pagos y facturación | 2026 | Elaboración propia |
| `diagramas/pp3-der-administracion.png` | Diagrama entidad-relación: tarifario, seguridad y operación | 2026 | Elaboración propia |
| `diagramas/pp3-arquitectura.png` | Arquitectura en capas del sistema | 2026 | Elaboración propia |
| `diagramas/pp3-despliegue.png` | Diagrama de despliegue | 2026 | Elaboración propia |
| `diagramas/cu01-asociaciones.png` | CU-01 Reservar desde el portal público: diagrama de asociaciones | 2026 | Elaboración propia |
| `diagramas/cu01-clases.png` | CU-01 Reservar desde el portal público: vista estática (diagrama de clases) | 2026 | Elaboración propia |
| `diagramas/cu01-secuencia.png` | CU-01 Reservar desde el portal público: vista dinámica (diagrama de secuencia) | 2026 | Elaboración propia |
| `diagramas/cu02-asociaciones.png` | CU-02 Hacer el check-in: diagrama de asociaciones | 2026 | Elaboración propia |
| `diagramas/cu02-clases.png` | CU-02 Hacer el check-in: vista estática (diagrama de clases) | 2026 | Elaboración propia |
| `diagramas/cu02-secuencia.png` | CU-02 Hacer el check-in: vista dinámica (diagrama de secuencia) | 2026 | Elaboración propia |
| `diagramas/cu03-asociaciones.png` | CU-03 Cargar un consumo: diagrama de asociaciones | 2026 | Elaboración propia |
| `diagramas/cu03-clases.png` | CU-03 Cargar un consumo: vista estática (diagrama de clases) | 2026 | Elaboración propia |
| `diagramas/cu03-secuencia.png` | CU-03 Cargar un consumo: vista dinámica (diagrama de secuencia) | 2026 | Elaboración propia |
| `diagramas/cu04-asociaciones.png` | CU-04 Hacer el check-out y emitir la factura: diagrama de asociaciones | 2026 | Elaboración propia |
| `diagramas/cu04-clases.png` | CU-04 Hacer el check-out y emitir la factura: vista estática (diagrama de clases) | 2026 | Elaboración propia |
| `diagramas/cu04-secuencia.png` | CU-04 Hacer el check-out y emitir la factura: vista dinámica (diagrama de secuencia) | 2026 | Elaboración propia |
| `diagramas/cu05-asociaciones.png` | CU-05 Consultar los indicadores de gestión: diagrama de asociaciones | 2026 | Elaboración propia |
| `diagramas/cu05-clases.png` | CU-05 Consultar los indicadores de gestión: vista estática (diagrama de clases) | 2026 | Elaboración propia |
| `diagramas/cu05-secuencia.png` | CU-05 Consultar los indicadores de gestión: vista dinámica (diagrama de secuencia) | 2026 | Elaboración propia |

## Capturas del sistema

| Archivo | Descripción | Año | Fuente |
|---|---|---|---|
| `capturas/panel-01-inicio.png` | Panel de gestión: tablero de inicio | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-02-ocupacion.png` | Grilla de ocupación | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-03-reservas.png` | Listado de reservas | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-04-reserva-nueva.png` | Alta de reserva de mostrador | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-05-ficha-confirmada.png` | Ficha de una reserva confirmada, antes del check-in | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-06-ficha-in-house.png` | Ficha de una reserva alojada (in house) | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-07-cuenta.png` | Cuenta detallada del huésped | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-08-ficha-checkout.png` | Ficha de una reserva con check-out | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-09-factura.png` | Factura emitida | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-10-punto-venta.png` | Punto de venta | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-11-huespedes.png` | Listado de huéspedes | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-12-housekeeping.png` | Tablero de housekeeping | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-13-reportes.png` | Índice de reportes | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-14-reporte-ocupacion.png` | Reporte de ocupación, ADR y RevPAR | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-15-reporte-categorias.png` | Reporte de venta por categoría | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-16-reporte-facturacion.png` | Reporte de facturación y medios de cobro | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-17-reporte-estados.png` | Reporte de reservas por estado | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-18-usuarios.png` | Gestión de usuarios y roles | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-19-configuracion.png` | Configuración | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-20-tarifario.png` | Tarifario | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-21-auditoria.png` | Auditoría | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-22-ayuda.png` | Ayuda | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-23-divisas.png` | Cotización de divisas | 2026 | Elaboración propia (captura del sistema) |
| `capturas/panel-24-mi-trabajo-movil.png` | Housekeeping en el teléfono: trabajo de limpieza | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-01-portada.jpg` | Portal público: portada | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-02-alojamientos.jpg` | Portal público: catálogo de alojamientos | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-03-detalle.jpg` | Portal público: detalle de un alojamiento | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-04-disponibilidad.jpg` | Portal público: disponibilidad y precios para las fechas elegidas | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-05-checkout.jpg` | Portal público: datos del huésped y forma de pago | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-06-pagar-sena.png` | Portal público: pago de la seña | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-07-pago-simulado.png` | Pasarela de pago de demostración | 2026 | Elaboración propia (captura del sistema) |
| `capturas/portal-08-confirmacion.png` | Portal público: confirmación de la reserva | 2026 | Elaboración propia (captura del sistema) |
