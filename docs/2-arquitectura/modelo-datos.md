# Modelo de datos

El modelo se construye de forma incremental mediante migraciones SQL versionadas
en `supabase/migrations/`. Este documento describe las entidades y su estado.

> **Rama `tesis-a-presentar` (versión reducida, [ADR 0045](../decisiones/0045-version-reducida-para-la-tesis.md)).**
> **La base de datos no se achicó.** Las 127 migraciones crean 69 tablas, y de
> esas, 30 las usa el sistema reducido (las dos primeras secciones). Las otras 39
> pertenecen a módulos que se quitaron del código: siguen en la base, con su RLS
> y sus tests de políticas, **pero sin pantalla ni código que las lea o escriba**
> (última sección). Una migración aplicada no se edita, y borrar tablas con
> claves foráneas y funciones que las referencian no se puede verificar sin una
> base real: la limpieza queda como paso aparte, contra la base de tests aislada.
>
> Cómo se contaron: las 30 son las que el código toca con `.from('…')` más las
> que alcanza por funciones SQL (`registrar_intento`, `reservar_numero_factura`).
> Se verifica con `rg "\.from\('" src` contra
> `grep -hoiE 'create table[^(]*' supabase/migrations/*.sql`.

## Entidades del sistema reducido

### Inventario, catálogo y reservas

| Entidad | Descripción |
|---|---|
| `perfiles` | Usuario del staff ↔ rol (admin, gerencia, recepción, housekeeping). El alta nace **sin privilegios** (ADR 0017). |
| `tipos_unidad` | Tipos de alojamiento: Single, Doble Std, Doble Sup, Triple, Suite y las cabañas. |
| `unidades` | Unidad física (habitación o cabaña) con su estado de housekeeping, piso, bloque y orden. |
| `temporadas` + `temporada_rangos` | Baja / Media / Alta con sus rangos de fecha (Anexo A), sin solape entre temporadas. |
| `tarifas` | Precio por (tipo × temporada): neto y rack, en USD, sin IVA (ADR 0004). |
| `promociones` | Reglas de descuento / paquetes configurables. |
| `politicas_cancelacion` | Umbrales en días → cargo aplicable. |
| `huespedes` | Datos del huésped (documento, email, nacionalidad, residencia en el exterior, VIP, puntos de fidelidad). |
| `reservas` | Reserva con estado, canal y totales; ficha completa (plan, garantía, segmento, voucher, ocupantes). |
| `estadias` | Ocupación reserva ↔ unidad + período (`daterange`); lleva la exclusión anti-overbooking. |

### Dinero y operación

| Entidad | Descripción |
|---|---|
| `pagos` | Pagos por reserva, con su medio (efectivo, transferencia, tarjeta, mercadopago, stripe, payway). `monto` siempre en USD (ADR 0027). |
| `productos_servicios` | Catálogo de consumos (frigobar, restaurante, excursiones). |
| `departamentos` | Jerarquía de **dos niveles** (con trigger que rechaza el tercero) para los folios. |
| `consumos` | Consumos vinculados a una estadía, con folio, departamento y número de comanda. |
| `facturas` | Comprobante; una por reserva, inmutable una vez emitido; columnas del CAE. |
| `notas_credito` | El único camino de corrección de una factura emitida (migración 0076). |
| `facturas_numeracion` · `puntos_venta` | Numeración correlativa sin huecos (exigencia fiscal): el número se reserva antes de pedir el CAE (migración 0069). |
| `datos_fiscales` | Datos del hotel como **emisor**; una sola fila impuesta por la base y no sembrada a propósito (migración 0082). |
| `cotizaciones` | Tipo de cambio por moneda y fuente, con override manual del gerente (ADR 0020). |
| `housekeeping_registros` | Historial de limpieza por unidad: comentario y fotos. |
| `encuestas_satisfaccion` | NPS por token. |
| `notificaciones` | Bandeja de salida de correos al huésped, con reintentos e idempotencia (migración 0075). |
| `consultas_bot` | Preguntas al asistente del portal (ADR 0011). |

### Sistema

| Entidad | Descripción |
|---|---|
| `auditoria` | Trazabilidad *append-only* de operaciones sensibles: guarda actor, rol y la fila completa previa en `datos_previos`. |
| `auditoria_accesos` | Quién abrió la ficha de un huésped y cuándo (la auditoría de lectura; `auditoria` cubre sólo escrituras). |
| `errores` | Errores del servidor, visibles en `/panel/errores` (ADR 0029). |
| `cron_corridas` | Última corrida correcta y última fallida de cada tarea programada. |
| `intentos_limitados` | Límite de tasa de las entradas públicas (migración 0029). Sin políticas RLS a propósito: la maneja solo `registrar_intento()`. |

## Tablas que quedaron en la base sin pantalla ni código (39)

Son de los módulos quitados. Siguen creadas por las migraciones y con RLS activo;
nada en `src/` las lee ni las escribe (verificado con `rg` el 2026-11-10).

| Módulo quitado | Tablas |
|---|---|
| Agencias y portal del socio | `agencias`, `movimientos_cuenta` |
| Proveedores y comprobantes | `proveedores`, `movimientos_proveedor`, `comprobantes_recibidos` |
| Contratos y firma | `contratos`, `firmas` |
| Canales de venta | `canal_cargos`, `canal_config`, `canal_externo_tipos`, `canal_mapeos_columnas`, `canal_mensajes`, `canal_resenas`, `canal_reservas`, `canal_restricciones`, `canal_sincronizaciones`, `canal_tipos`, `canales_externos` |
| Conciliación y gastos | `movimientos_externos`, `gastos_operativos` |
| Bandeja de mensajes (CRM) | `crm_bandejas`, `crm_contactos`, `crm_conversacion_etiquetas`, `crm_conversaciones`, `crm_etiquetas`, `crm_identidades`, `crm_mensajes`, `crm_respuestas` |
| Chat interno | `canales`, `mensajes` |
| Mantenimiento, objetos perdidos y avisos | `ordenes_mantenimiento`, `planes_mantenimiento`, `objetos_perdidos`, `avisos` |
| Configuración avanzada | `plantillas_email`, `conexiones_proveedores` |
| Respaldos | `respaldos` |
| Servicio de cocina | `lista_compras_cocina` |
| Acompañantes de una reserva | `reserva_huespedes` (sólo la toca la función `fusionar_huespedes`) |

También quedan las columnas `reservas.agencia_id` y `reservas.contrato_id`. **La
reserva ya no se vincula a una agencia**: la tarifa sale del canal (rack para
mostrador y web, neto para Booking y Expedia) y la factura toma siempre al
huésped como receptor (ADR 0045).

### Vistas

Las cuatro vistas de la base (`saldos_agencias`, `saldos_proveedores`,
`conciliacion_comision_canal` y `resumen_canal_mes`) son de módulos quitados:
**el sistema reducido no usa ninguna**. Son `security_invoker = true` y están
fuera del alcance público desde la migración 0057.

## Diagrama entidad-relación (núcleo)

```mermaid
erDiagram
    tipos_unidad ||--o{ unidades : clasifica
    tipos_unidad ||--o{ tarifas : "precio_por_tipo"
    temporadas   ||--o{ temporada_rangos : "abarca"
    temporadas   ||--o{ tarifas : "precio_por_temporada"
    huespedes ||--o{ reservas : titular
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
[ADR 0002](../decisiones/0002-motor-de-disponibilidad.md). Verificado por
`tests/base-de-datos/overbooking.test.ts`.

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
- **Dinero sin coma flotante**: las columnas de importe son `numeric` con escala
  fija — `(12,2)` totales, `(10,2)` precios unitarios, `(5,2)` porcentajes,
  `(14,4)` tipos de cambio. Ninguna columna de ninguna tabla es `float`.
- **Auditoría *append-only***: el staff lee, no escribe (`0020`).
- **RLS activado en las 69 tablas** que crean las migraciones, incluidas las 39 sin código.

## Convenciones

- Migraciones **numeradas** y **forward-only**: ninguna tiene bloque de rollback.
  Es deliberado; para revertir se escribe la migración siguiente.
- ⚠️ `alter type ... add value` y el primer uso de ese valor **no pueden ir en el
  mismo archivo**: el CLI envuelve cada migración en una transacción y Postgres
  corta con SQLSTATE 55P04. Es lo que le pasó a la `0032` y por eso existe la `0035`.

## Estado actual

**127 migraciones** (hasta `0127_bandeja_saludo_horario_y_asignacion.sql`),
**69 tablas** (30 del sistema reducido, 39 sin código) y **4 vistas** (ninguna
usada), con **148 sentencias `create policy`** en las migraciones (algunas las
reemplaza una migración posterior, así que no es el recuento de políticas
vigentes). La aplicación de las 127 contra una base levantada desde cero se
verifica con `npm run test:aislado` y `npm run esquema:comparar`; **no se corrió
desde esta rama** (sin Docker, ADR 0045).
