# Modelo de datos

El modelo se construye de forma incremental mediante migraciones SQL versionadas
en `supabase/migrations/`. Este documento describe las entidades y su estado.

## Entidades

| Entidad | Descripción | Fase |
|---|---|---|
| `perfiles` | Usuario del staff ↔ rol (admin, gerencia, recepción, housekeeping). | 0 ✅ |
| `tipos_unidad` | Tipos de alojamiento: Single, Doble Std, Doble Sup, Triple, Suite, Cabañas 1/2/3 dorm. | 1 ✅ |
| `unidades` | Unidad física (habitación o cabaña) con su estado de housekeeping. | 1 ✅ |
| `temporadas` + `temporada_rangos` | Baja / Media / Alta con sus rangos de fecha (Anexo A). | 1 ✅ |
| `tarifas` | Precio por (tipo × temporada): neto (agencia) y rack (mostrador), en USD. | 1 ✅ |
| `promociones` | Reglas de descuento / paquetes configurables. | 1 ✅ |
| `politicas_cancelacion` | Umbrales en días → cargo aplicable. | 1 ✅ |
| `huespedes` | Datos del huésped (documento, email, nacionalidad). | 1 ✅ |
| `reservas` | Reserva con estado, canal y totales. | 1 ✅ (estructura) · lógica en 2 |
| `estadias` | Ocupación reserva ↔ unidad + período (`daterange`); lleva la exclusión anti-overbooking. | 1 ✅ (estructura) · lógica en 2 |
| `reserva_huespedes` | Acompañantes de una reserva. | 1 ✅ |
| `pagos` | Pagos por reserva, con proveedor (mercadopago / stripe). | 3 |
| `productos_servicios` | Catálogo de consumos (frigobar, restaurante, excursiones). | 5 |
| `consumos` | Consumos vinculados a una estadía. | 5 |
| `facturas` | Comprobante interno; columnas AFIP preparadas para fase posterior. | 5 / 8 |
| `bitacora_auditoria` | Trazabilidad de acciones sensibles. | 7 |

## Diagrama entidad-relación (implementado en Fase 1)

```mermaid
erDiagram
    tipos_unidad ||--o{ unidades : clasifica
    tipos_unidad ||--o{ tarifas : "precio_por_tipo"
    temporadas   ||--o{ temporada_rangos : "abarca"
    temporadas   ||--o{ tarifas : "precio_por_temporada"
    huespedes ||--o{ reservas : titular
    huespedes ||--o{ reserva_huespedes : acompanante
    reservas  ||--o{ reserva_huespedes : incluye
    reservas  ||--o{ estadias : compone
    unidades  ||--o{ estadias : "ocupada_en"
    tipos_unidad ||--o{ estadias : "reservado_como"
    promociones ||--o{ reservas : aplica
    politicas_cancelacion ||--o{ reservas : rige

    tipos_unidad {
      uuid id PK
      text codigo UK
      categoria_unidad categoria "hosteria|cabana"
      int capacidad_max
      jsonb amenities
    }
    unidades {
      uuid id PK
      uuid tipo_unidad_id FK
      estado_hk estado "limpia|sucia|inspeccionada|bloqueada"
    }
    temporadas { uuid id PK; text codigo UK }
    temporada_rangos {
      uuid id PK
      uuid temporada_id FK
      daterange rango "sin solape entre temporadas"
    }
    tarifas {
      uuid id PK
      uuid tipo_unidad_id FK
      uuid temporada_id FK
      numeric precio_neto
      numeric precio_rack
      numeric iva_pct
    }
    reservas {
      uuid id PK
      text codigo UK
      uuid huesped_id FK
      estado_reserva estado
      text canal
      text tarifa_tipo "neto|rack"
    }
    estadias {
      uuid id PK
      uuid reserva_id FK
      uuid unidad_id FK
      daterange periodo "[check_in, check_out)"
      estado_reserva estado "EXCLUDE gist: sin solape"
    }
    huespedes { uuid id PK; text apellido; text email }
    promociones { uuid id PK; text codigo UK; text tipo }
    politicas_cancelacion { uuid id PK; text codigo UK; jsonb reglas }
```

## Decisión clave: integridad anti-overbooking

La tabla `estadias` usa una **restricción de exclusión** de PostgreSQL
(`EXCLUDE USING gist (unidad_id WITH =, periodo WITH &&) WHERE estado activo`)
para impedir que dos reservas activas se solapen sobre la misma unidad. La
garantía vive en el motor de datos, no en la aplicación. Ver
[ADR 0002](decisiones/0002-motor-de-disponibilidad.md). Verificado por
`tests/overbooking.test.ts`.

## Estado actual (Fase 1)

Implementadas las migraciones `0002`–`0006` con su seed real del Tarifario
2025/2026. Las tablas `reservas` / `estadias` existen (para habilitar el motor de
disponibilidad y la restricción de exclusión); su lógica de negocio (máquina de
estados, alta desde UI) se completa en la Fase 2.
