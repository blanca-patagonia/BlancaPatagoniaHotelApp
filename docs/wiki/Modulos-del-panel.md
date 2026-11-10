# Módulos del panel

El panel interno tiene **12 áreas** (`src/lib/domain/permisos.ts`). Cada rol ve sólo
las suyas, y el filtro no es sólo visual: `requerirAcceso(area)` corta también si
alguien escribe la URL a mano, y por debajo está RLS decidiendo qué filas puede
tocar.

> Rama `tesis-a-presentar`: el panel de `main` tiene 26 áreas y este tiene 12. Las
> 14 que faltan se quitaron del código (entre ellas la bandeja de mensajes y el
> chat interno, el asistente de IA, conciliación, contratos, proveedores,
> agencias, canales de venta, mantenimiento, objetos perdidos, avisos, servicio de
> cocina, cierre del día y respaldos); ver el
> [ADR 0045](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/docs/decisiones/0045-version-reducida-para-la-tesis.md).

---

## Quién ve qué

| Área | admin | gerencia | recepción | housekeeping |
|---|:---:|:---:|:---:|:---:|
| **Inicio** (hub) | ✅ | ✅ | ✅ | ✅ |
| **Ocupación** | ✅ | ✅ | ✅ | — |
| **Punto de venta** | ✅ | ✅ | ✅ | — |
| **Reservas** | ✅ | ✅ | ✅ | — |
| **Huéspedes** | ✅ | ✅ | ✅ | — |
| **Housekeeping** | ✅ | ✅ | — | ✅ |
| **Auditoría** | ✅ | — | — | — |
| **Errores del sistema** | ✅ | ✅ | — | — |
| **Reportes** | ✅ | ✅ | — | — |
| **Configuración** | ✅ | ✅ | — | — |
| **Usuarios** | ✅ | — | — | — |
| **Ayuda** | ✅ | ✅ | ✅ | ✅ |

**Tres decisiones que explican la tabla:**

- **Gerencia ve los errores del sistema.** Es quien decide si hay que llamar a
  alguien. La política RLS de `errores` declara los mismos dos roles: si la pantalla
  se abriera a otro, lo vería vacío.
- **Auditoría es sólo de `admin`** (`PERMISOS` en `permisos.ts`). El rastro se
  escribe por trigger y es *append-only*: el staff lo lee, no lo toca.
- **Ayuda la tienen todos.** Quien más la necesita es justamente quien menos
  permisos tiene. La guía se filtra por dentro y le muestra a cada uno sólo lo que
  puede hacer.

---

## Qué hace cada uno

### Ocupación
Grilla de unidades × días con celdas accionables, filtros por categoría, ventana
de 14 o 30 días y los KPIs del período. Es la pantalla que reemplaza al plano de
papel del mostrador.

### Reservas
El corazón del sistema. Alta con cotización automática por temporada e IVA,
**máquina de estados** (confirmar · check-in · check-out · cancelar · no-show),
política de cancelación **con vista previa del cargo antes de aplicarlo**,
reservas grupales, reprogramación de fechas y **cambio de unidad** (mudanza de
habitación).

Diez **vistas operativas** del listado, que son las que se usan de verdad en un
mostrador: las que llegan hoy, las que se van, las que registran saldo pendiente,
las que no pueden reubicarse.

La ficha incluye lo que pedía el sistema anterior: VIP, adultos / menores / bebés
por separado, cunas, plan de comidas, tipo de garantía, segmento, voucher, «no
mover» y el desglose fiscal.

### Huéspedes
Ficha, historial de estadías, documento y residencia. La residencia en el exterior
no es un dato decorativo: junto con el origen del pago **deriva la exención de
IVA** ([ADR 0024](Decisiones-de-arquitectura)).

### Punto de venta
Grilla por departamento con buscador, total en vivo, **número de comanda** y
anulación con el detalle del importe. Lo consumido va a la cuenta del huésped, con
**folios A y B** para dividir la cuenta cuando la habitación se comparte.

### Housekeeping
Estados de habitación, vista por responsable, asignación de mucamas y KPIs de
limpieza. La vista móvil está **ordenada por prioridad**, porque quien la usa
trabaja de pie y con una mano.

### Auditoría
Quién cambió qué en pagos, tarifas, reservas y estadías, con la fila previa. Se
escribe por trigger; esta pantalla sólo la lee.

### Errores del sistema
Los errores del servidor, guardados en una tabla de Postgres y no en un tercero
([ADR 0029](Decisiones-de-arquitectura)): los datos de los huéspedes no salen del
sistema y el hotel no depende de mirar el log de Vercel.

### Reportes
Cinco informes, cada uno con su pantalla: **ocupación, ADR y RevPAR** con
prorrateo y evolución de seis meses, **venta por categoría**, **satisfacción**
(NPS de las encuestas), **reservas por estado** y **facturación y medios de
cobro**. Con exportación a CSV.

### Configuración
Inventario, tipos, temporadas, tarifas, productos, políticas, cotización del dólar
y parámetros del hotel.

### Usuarios
Alta, baja y cambio de rol. Un usuario nuevo **nace sin privilegios** (`sin_rol`,
`activo = false`) y darlo de baja le revoca el acceso **en la base**, no sólo en la
pantalla ([ADR 0017](Decisiones-de-arquitectura)).

### Ayuda
La guía de uso, filtrada por rol. Al agregar un módulo hay que sumarle su capítulo.

---

## El portal público

Es una vista aparte, no una sección del panel.

| Pantalla | Qué hace |
|---|---|
| **Catálogo** (`/es/alojamientos`) | Los tipos con fotos, amenities, capacidad y precio por temporada |
| **Buscar** (`/es/reservar`) | Disponibilidad real por fechas y personas, **sin crear cuenta** |
| **Checkout** | Datos del huésped, resumen con IVA incluido y elección de medio de pago |
| **Confirmación** | Por **token opaco**, no por número de reserva adivinable |
| **Asistente** | Responde preguntas frecuentes **con reglas, no con un LLM** ([ADR 0011](Decisiones-de-arquitectura)) |

Y accesos por token, para quien no tiene ni puede tener cuenta:
`/encuesta/<token>` (satisfacción) y, desde el correo, la confirmación, el pago y
la factura de su propia reserva (`/reservar/confirmacion/<token>`,
`/reservar/pagar/<token>` y `/reservar/factura/<token>`).

El portal está **sólo en español** (`/es/…`): se quitó el selector de idioma y los
diccionarios en otros idiomas, pero se conservó la estructura (prefijo en la URL y
`IDIOMAS = ['es']`), así que volver a sumar uno es agregarlo a esa lista y escribir
su diccionario ([ADR 0045](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/docs/decisiones/0045-version-reducida-para-la-tesis.md)).

> **Regla de producto:** las funciones cara al cliente —las encuestas hoy— van en
> el portal, **nunca** en la gestión.

⚠️ Todo precio que ve un huésped pasa por `conIva()`: las tarifas se guardan **sin
IVA**, así que publicarlas directo sería anunciar un número más bajo del que
después se cobra.
