# Módulos del panel

El panel interno tiene **21 áreas**. Cada rol ve sólo las suyas, y el filtro no es
sólo visual: `requerirAcceso(area)` corta también si alguien escribe la URL a mano,
y por debajo está RLS decidiendo qué filas puede tocar.

---

## Quién ve qué

| Área | admin | gerencia | recepción | housekeeping |
|---|:---:|:---:|:---:|:---:|
| **Inicio** (hub) | ✅ | ✅ | ✅ | ✅ |
| **Ocupación** | ✅ | ✅ | ✅ | — |
| **Reservas** | ✅ | ✅ | ✅ | — |
| **Huéspedes** | ✅ | ✅ | ✅ | — |
| **Servicio de cocina** | ✅ | ✅ | ✅ | — |
| **Punto de venta** | ✅ | ✅ | ✅ | — |
| **Housekeeping** | ✅ | ✅ | — | ✅ |
| **Mantenimiento** | ✅ | ✅ | — | ✅ |
| **Avisos** | ✅ | ✅ | ✅ | ✅ |
| **Agencias** | ✅ | ✅ | ✅ | — |
| **Proveedores** | ✅ | ✅ | — | — |
| **Contratos** | ✅ | ✅ | — | — |
| **Canales de venta** | ✅ | ✅ | ✅ | — |
| **Reportes** | ✅ | ✅ | — | — |
| **Configuración** | ✅ | ✅ | — | — |
| **Respaldos** | ✅ | 👁 ver | — | — |
| **Usuarios** | ✅ | — | — | — |
| **Ayuda** | ✅ | ✅ | ✅ | ✅ |

**Tres decisiones que explican la tabla:**

- **Recepción entra a Canales.** Las reservas de Booking las importa y las atiende
  quien está en el mostrador, no gerencia: es trabajo diario, no gestión.
- **Gerencia *ve* Respaldos pero no exporta.** Saber que hace 40 días que nadie
  exporta es información de gestión; el archivo, en cambio, concentra los datos
  personales de todos los huéspedes del hotel.
- **Ayuda la tienen todos.** Quien más la necesita es justamente quien menos
  permisos tiene. La guía se filtra por dentro y le muestra a cada uno sólo lo que
  puede hacer.

**Tres áreas están apagadas hoy por decisión del hotel** —Auditoría,
Conversaciones y Objetos perdidos—: el código, las tablas, las políticas y los
tests permanecen intactos, y su reactivación consiste en retirar el nombre de una
lista.
⚠️ Lo que **no** se apagó es el registro: la tabla `auditoria` sigue escribiendo.
Un rastro que se deja de escribir porque nadie lo mira pierde justamente el valor
que tiene, y volver a encenderlo no recupera lo que no se guardó.

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

### Servicio de cocina
Los desayunos y las comidas del día, contados por la cocina. Salió de un pedido
concreto del hotel: el desayuno suelto lo cuenta quien lo sirve.

### Punto de venta
Grilla por departamento con buscador, total en vivo, **número de comanda** y
anulación con el detalle del importe. Lo consumido va a la cuenta del huésped, con
**folios A y B** para dividir la cuenta cuando la habitación se comparte.

### Housekeeping
Estados de habitación, vista por responsable, asignación de mucamas y KPIs de
limpieza. La vista móvil está **ordenada por prioridad**, porque quien la usa
trabaja de pie y con una mano.

### Mantenimiento
Órdenes con prioridad y antigüedad, y **planes de mantenimiento preventivo** —lo
que se hace antes de que se rompa, que es lo que un Excel nunca recuerda—.

### Avisos
Avisos internos, fijables. Lo que antes era un papel pegado en el mostrador.

### Agencias
Cuentas corrientes, pipeline comercial, conciliación, **antigüedad de saldos**
(*aging*) y un portal de socios por token para que la agencia mire lo suyo sin
tener cuenta.

### Proveedores
Cuentas por pagar, con el mismo esquema de movimientos y portal por token.

### Contratos
Redacción, envío, **firma electrónica por token** desde una vista pública y
verificación de integridad por hash ([ADR 0010](Decisiones-de-arquitectura)).

### Canales de venta
Importación del informe CSV de Booking y del feed iCal, mapeo manual de columnas,
zona de recepción de reservas entrantes, costos y comisiones por canal,
conciliación de la factura del canal, mensajes y reseñas.

⚠️ **Es de sólo lectura y no evita el overbooking.** La pantalla lo dice, el
código lo declara y hay un ADR que explica por qué
([ADR 0021](Decisiones-de-arquitectura)). No es un olvido: la solución real es un
*channel manager* y es una contratación del hotel.

### Reportes
Ocupación, ingresos, **ADR y RevPAR con prorrateo**, comparativa contra el mes
anterior, evolución de seis meses, ranking de canales y NPS de las encuestas.

### Configuración
Inventario, tipos, temporadas, tarifas, productos, políticas, cotización del dólar
y parámetros del hotel.

### Respaldos
Exportación verificable de los datos operativos, con el alcance declarado en
pantalla.

⚠️ **No es un backup de Postgres** —eso lo hace la plataforma— y la pantalla lo
explica. Convertirlo en un botón que diga «hacer backup» sería la peor función del
sistema: daría por cubierto lo que no está.

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
| **Catálogo** (`/alojamientos`) | Los tipos con fotos, amenities, capacidad y precio por temporada |
| **Buscar** (`/reservar`) | Disponibilidad real por fechas y personas, **sin crear cuenta** |
| **Checkout** | Datos del huésped, resumen con IVA incluido y elección de medio de pago |
| **Confirmación** | Por **token opaco**, no por número de reserva adivinable |
| **Asistente** | Responde preguntas frecuentes **con reglas, no con un LLM** ([ADR 0011](Decisiones-de-arquitectura)) |

Y tres accesos por token, para quien no tiene ni puede tener cuenta:
`/portal/<token>` (agencias y proveedores), `/firmar/<token>` (contratos) y
`/encuesta/<token>` (satisfacción).

> **Regla de producto:** las funciones cara al cliente —web check-in, encuestas—
> van en el portal, **nunca** en la gestión.

⚠️ Todo precio que ve un huésped pasa por `conIva()`: las tarifas se guardan **sin
IVA**, así que publicarlas directo sería anunciar un número más bajo del que
después se cobra.
