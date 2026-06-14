# Modelo de datos

El modelo se construye de forma incremental mediante migraciones SQL versionadas
en `supabase/migrations/`. Este documento describe las entidades; el diagrama
entidad-relación completo se incorpora a medida que avanzan las fases.

## Entidades (objetivo del sistema)

| Entidad | Descripción | Fase |
|---|---|---|
| `perfiles` | Usuario del staff ↔ rol (admin, gerencia, recepción, housekeeping). | 0 ✅ |
| `tipos_unidad` | Tipos de alojamiento: Single, Doble Std, Doble Sup, Triple, Suite, Cabaña 1/2/3 dorm. | 1 |
| `unidades` | Unidad física (habitación o cabaña) con su estado. | 1 |
| `temporadas` | Baja / Media / Alta con rangos de fecha (Anexo A). | 1 |
| `tarifas` | Precio por (tipo de unidad × temporada), en USD. | 1 |
| `promociones` | Reglas de descuento configurables. | 1 |
| `politicas_cancelacion` | Umbrales en días → cargo aplicable. | 1 |
| `huespedes` | Datos del huésped (documento, email, nacionalidad). | 1 |
| `reservas` | Reserva con estado y canal (directo / booking / expedia). | 2 |
| `reserva_unidad` / `estadias` | Vínculo reserva ↔ unidad + período (`daterange`). | 2 |
| `pagos` | Pagos por reserva, con proveedor (mercadopago / stripe). | 3 |
| `productos_servicios` | Catálogo de consumos (frigobar, restaurante, etc.). | 5 |
| `consumos` | Consumos vinculados a una estadía. | 5 |
| `facturas` | Comprobante interno; columnas AFIP preparadas para fase posterior. | 5 / 8 |
| `bitacora_auditoria` | Trazabilidad de acciones sensibles. | 7 |

## Decisión clave: integridad anti-overbooking

La tabla de ocupación usa una **restricción de exclusión** de PostgreSQL para
impedir que dos reservas activas se solapen sobre la misma unidad. Ver
[ADR 0002](decisiones/0002-motor-de-disponibilidad.md).

## Estado actual (Fase 0)

Solo existe `perfiles` (migración 0001). El resto se agrega en la Fase 1.
