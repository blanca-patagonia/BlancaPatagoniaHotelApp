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
| `auditoria` | Trazabilidad *append-only* de operaciones sensibles: guarda actor, rol y la fila completa previa en `datos_previos`. | 7 ✅ |

### Ampliación ERP y operación (fases 8 a 12)

| Entidad | Descripción |
|---|---|
| `agencias` · `movimientos_cuenta` | Cuentas corrientes de agencias y empresas. |
| `proveedores` · `movimientos_proveedor` | Cuentas por pagar. |
| `contratos` · `firmas` | Contratos con firma electrónica por token y hash de integridad. |
| `ordenes_mantenimiento` · `planes_mantenimiento` | Correctivo y preventivo. |
| `objetos_perdidos` | Objetos hallados y su devolución. |
| `encuestas_satisfaccion` | NPS por token. |
| `mensajes` · `avisos` | Conversaciones internas en tiempo real y avisos fijables. |
| `consultas_bot` | Preguntas al asistente del portal (ADR 0011). |
| `intentos_limitados` | Límite de tasa de las entradas públicas (migración 0029). Sin políticas RLS a propósito: la maneja solo `registrar_intento()`. |
| `perfiles` | Staff ↔ rol. El alta nace **sin privilegios** (ADR 0017). |

### Modernización WinPAX (migraciones 0036–0043)

| Entidad | Descripción |
|---|---|
| `cotizaciones` | Tipo de cambio por moneda y fuente, con override manual del gerente (ADR 0020). |
| `canales` · `canal_config` | Canales de venta y su configuración: comisión pactada, moneda de liquidación, modalidad de cobro, `ical_token`. |
| `canal_reservas` | **Zona de recepción**: lo que trae el canal aterriza acá para que alguien lo revise. No crea reservas (ADR 0021). |
| `canal_sincronizaciones` | Registro de cada corrida, con su `origen` (`manual` o `cron`). |
| `canal_cargos` | Comisiones y costos por canal, con su estado de conciliación. |
| `canal_mapeos_columnas` | Mapeo manual de las columnas del informe CSV del extranet. |
| `canal_mensajes` · `canal_resenas` | Mensajes y reseñas del canal. |
| `departamentos` | Jerarquía de **dos niveles** (con trigger que rechaza el tercero) para los folios. |
| `puntos_venta` · `productos_servicios` | Punto de venta y catálogo. |
| `respaldos` | Registro de cada exportación de datos operativos. |

### Vistas

Las cuatro con `security_invoker = true`, y fuera del alcance público desde la
migración 0057:

| Vista | Qué resuelve |
|---|---|
| `saldos_agencias` · `saldos_proveedores` | Saldo por socio, agregado en la base. |
| `conciliacion_comision_canal` | Comisiones por mes y estado de conciliación. |
| `resumen_canal_mes` | Rentabilidad por canal. ⚠️ `tarifa_tipo = 'neto'` es un **tipo de tarifa**, no «importe ya sin comisión». |

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

## Garantías que impone la base, no la aplicación

- **Anti-overbooking**: `estadias` lleva
  `exclude using gist (unidad_id with =, periodo with &&)` sobre los estados
  activos (`0005:46`). Dos reservas no pueden solapar la misma unidad aunque la
  app falle (ADR 0002).
- **`estadias.check_in` / `check_out` son columnas GENERADAS** desde `periodo`
  (`0037:48-49`). No se pueden escribir, y ésa es la garantía de que no se
  desincronizan. Existen porque PostgREST no expone `lower()`.
- **Una factura por reserva**: `facturas_una_por_reserva unique (reserva_id)`
  (`0045:67`).
- **Facturas inmutables** una vez emitidas (`0034`).
- **Dinero sin coma flotante**: las 31 columnas de importe son `numeric` con
  escala fija — `(12,2)` totales, `(10,2)` precios unitarios, `(5,2)`
  porcentajes, `(14,4)` tipos de cambio. Ninguna es `float`.
- **Auditoría *append-only***: el staff lee, no escribe (`0020`).

## Convenciones

- Migraciones **numeradas** y **forward-only**: ninguna tiene bloque de rollback.
  Es deliberado; para revertir se escribe la migración siguiente.
- ⚠️ `alter type ... add value` y el primer uso de ese valor **no pueden ir en el
  mismo archivo**: el CLI envuelve cada migración en una transacción y Postgres
  corta con SQLSTATE 55P04. Es lo que le pasó a la `0032` y por eso existe la `0035`.

## Estado actual

**57 migraciones** (hasta `0057_vistas_de_saldos_fuera_del_alcance_publico.sql`),
**43 tablas**, **90 políticas RLS** y **4 vistas**, todas aplicadas y verificadas
contra una base local levantada desde cero.
