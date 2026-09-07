# Informe final — camino a PMS productivo

- **Fecha:** 2026-09-07
- **Alcance:** los 11 objetivos del pedido, ejecutados sobre la auditoría de
  `docs/auditoria-pms-2026-09.md`.
- **Verificación:** **1894 tests / 117 archivos / 0 salteados**, con las **82
  migraciones** aplicadas en orden, en CI (Docker + `EXIGIR_DB=1`). Lint 0,
  typecheck 0, build 0.
- **Rama:** `fix/bloque-a-p0-auditoria` · PR #35.

---

## 1. Qué cambió, en una página

Se cerraron **los 7 defectos P0** que perdían dinero o corrompían datos, los
**bloques B, C, D y E** del plan, y **5 de los 7 P1**. Entraron **9 migraciones**
(0074–0082) y **3 ADRs** (0030, 0031, 0032).

El sistema pasó de:

| Antes | Ahora |
|---|---|
| No salía un solo correo | Bandeja de salida con idempotencia, reintentos acotados y consentimiento |
| Una factura mal emitida no tenía corrección | Notas de crédito, con la letra y el tope impuestos por la base |
| No había forma de saber si el dinero entró | Conciliación bancaria y de pasarela, con gastos por mes |
| Las facturas de proveedor se tipeaban a mano | Se escanea el QR y los datos entran solos |
| El puerto de salida a canales no tenía llamadores | Se calcula el ARI todos los días y queda el rastro |
| El CUIT del hotel no existía en el sistema | Está, y valida el dígito verificador |

---

## 2. Los 11 objetivos

| # | Objetivo | Estado |
|---|---|---|
| 1 | Booking / canales | 🟡 **Directa: imposible**, y no es de ingeniería (§3 de la auditoría). Vía channel manager: **el sistema ya está completo de su lado** (ADR 0032); falta el adapter, que depende de contratarlo |
| 2 | Prevención de overbooking | 🟡 La garantía de la base es sólida y sin agujeros; P0-1 corregido. **El riesgo residual es una contratación**, no un bug |
| 3 | Sincronización | 🟡 Entrada completa. Salida: cupo, tarifas, mínimo de noches y cierres se calculan a diario y se registran; hoy no salen porque el proveedor es de solo lectura, y la pantalla lo dice |
| 4 | Conciliación de facturas | 🟢 **Cerrado** (ADR 0030) |
| 5 | Registro y confirmación de pagos | 🟢 **Cerrado** — reembolsos, idempotencia de mostrador y el link que ya no cruza pasarelas |
| 6 | Recordatorios automáticos | 🟢 **Cerrado** — falta contratar la cuenta de correo |
| 7 | Avisos ante pagos o cambios de estado | 🟢 **Cerrado** |
| 8 | Operación diaria | 🟢 Ya era lo más maduro del sistema |
| 9 | Foto de factura → Excel | 🟢 **Cerrado** (ADR 0031) |
| 10 | MercadoPago + Santander, gastos mensuales | 🟢 **Cerrado** (ADR 0030) |
| 11 | Trazabilidad y seguridad | 🟢 Auditoría y RLS fuertes; el camino del dinero ya se ve en `/panel/errores`. 🟡 Queda **restaurar un backup**, que no se cierra desde el código |

---

## 3. Las decisiones que conviene discutir

Son las tres que un lector podría querer revertir, con el motivo por el que están
así.

### 3.1 La conciliación **propone**; casi nunca cierra sola

Sólo la **referencia de la pasarela** concilia automáticamente. Coincidir en
importe y fecha **no alcanza**: dos huéspedes que pagan la misma seña el mismo día
es lo más común del mundo, y casar el cobro con la reserva equivocada deja a uno
figurando impago y al otro pagado sin haber pagado — y eso **no lo revisa nadie
después**, porque la reserva sale de todas las listas de pendientes.

Es trabajo manual a propósito. (ADR 0030 §4)

### 3.2 Se lee el **QR** de la factura, no se hace OCR

El OCR adivina. Un `8` leído como `3` en el importe da una factura **plausible y
equivocada**, y nadie la revisa porque el sistema «ya la cargó». El QR obligatorio
de la factura electrónica argentina trae lo que el emisor le informó a ARCA, con su
CAE: mismo gesto para quien lo usa, resultado autoritativo.

Cuesta la cobertura de lo que no tiene QR —tickets, remitos, facturas anteriores a
2021— que se cargan a mano y quedan marcados como tales. (ADR 0031)

### 3.3 El ARI **se calcula aunque no salga**, y el cron devuelve 200

Con el proveedor real de hoy (feed iCal, de solo lectura) la publicación responde
`noSoportado`. El cron responde **200** en ese caso: con 500 quedaría en rojo
**para siempre** —porque ésa es la situación normal— y el día que sí haya channel
manager un fallo real se perdería entre un año de ruido.

⚠️ El proveedor **simulado** sí declara que publica, a propósito, para poder
ejercitar las pantallas. **En desarrollo el circuito publica y en producción no.**
(ADR 0032)

---

## 4. Los defectos corregidos

### P0 — perdían dinero o corrompían datos

| # | Qué pasaba | Migración |
|---|---|---|
| P0-1 | Una cancelación de Booking bloqueaba la unidad **para siempre** | 0074 |
| P0-2 | Un reembolso de pasarela nunca aterrizaba: la reserva quedaba `pagada` con la plata devuelta | — |
| P0-3 | El descuento de stock **se perdía** (ver §5) | — |
| P0-4 | Se podía emitir una factura con CAE por menos importe, y `facturas` es inmutable | — |
| P0-5 | El cobro de mostrador no tenía idempotencia: dos envíos, dos pagos | — |
| P0-6 | La expiración de reservas dependía sólo de pg_cron, programado dentro de un bloque que se traga el fallo | — |
| P0-7 | El `motivo` de las entrantes se borraba en cada corrida del cron | — |

### P1 — cerrados en esta pasada

| # | Qué pasaba |
|---|---|
| P1-1 | El puerto de salida ARI **no tenía llamadores**, así que la promesa del ADR 0021 no era cierta |
| P1-2 | Cero notificaciones reales |
| P1-3 | `movimientos_cuenta` y `movimientos_proveedor` tenían columna `moneda` que **ninguna acción escribía**: una factura de ARS 185.000 entraba como **USD 185.000** |
| P1-4 | `estado_conciliacion` existía desde la 0049 y **nada lo escribía** |
| P1-5 | El link de pago **cruzaba de pasarela**: quien elegía pesos recibía el de Stripe en dólares |
| P1-6 | Los webhooks de pago reportaban en `console.error`, invisible para el hotel |

### P1 que siguen abiertos

- **P1-7 · atomicidad.** Nueve flujos de varios pasos donde, si falla el paso 3,
  los datos quedan a medias. Está anotado en el código y resolverlo pide funciones
  SQL transaccionales, una por flujo.
- **El resto de los `console.*`** fuera del camino del dinero.

---

## 5. Dónde me equivoqué

Va explícito porque un informe que sólo cuenta lo que salió bien no sirve para
decidir cuánto confiar en el resto.

1. **P0-3, mal diagnosticado.** Escribí que «el stock se descuenta dos veces».
   **Era falso.** Lo descubrí porque el test de regresión pasaba sin el arreglo: la
   aritmética no da doble descuento. El defecto real es una lectura-modificación-
   escritura que **pierde** descuentos, y el inventario queda **más alto** que la
   realidad. Con una sola línea de producto los números coinciden y no se ve.
2. **«`facturas` no tiene columna de moneda».** La tiene desde la migración 0010.
   El defecto real era el mismo de P1-3 —nadie la escribía— y ahí el default
   resultaba correcto.
3. **El CUIT del hotel no figuraba en ninguna lista de pendientes** y bloqueaba dos
   cosas. No lo vi hasta que lo necesité.
4. **Un test que afirmaba que el proveedor simulado no publica.** Lo volteó CI. La
   premisa era falsa y sonaba obvia.
5. **Un test que prometía «el número de línea que ves en Excel».** No era cierto:
   el lector descarta las filas en blanco, así que una línea vacía en el medio
   corre la numeración y manda a mirar la fila equivocada.

Los cinco están anotados en el código o en la bitácora, en el lugar donde alguien
los va a volver a pensar.

---

## 6. Lo que necesito de vos

**Bloqueantes para producción**

1. **Apagar el auto-registro** en el Supabase hosted (*Authentication → Providers*).
2. **Verificar pg_cron** en el proyecto hosted: `select jobname, schedule, active
   from cron.job;`.
3. **Cargar los datos fiscales del hotel** en *Configuración → Datos fiscales*.
   Sin el CUIT no se puede pedir un CAE ni avisar cuando una factura escaneada no
   es del hotel.

**Contrataciones y credenciales**

4. **Channel manager** — la única solución real al overbooking de OTAs
   (~USD 50–150/mes). Sin esto, los objetivos 1, 2 y 3 no se cierran del todo.
5. **Cuenta de Resend** (o SMTP) para que salga un correo de verdad.
6. **WhatsApp Business + Meta Cloud API**, si se quiere WhatsApp oficial.
7. **Certificado AFIP/ARCA** + alta del punto de venta electrónico + homologación.
8. **MercadoPago**: credenciales de producción (las mismas del cobro sirven para el
   reporte de liquidaciones).
9. **Un extracto de Santander de muestra**, anonimizado, para fijar el formato del
   importador contra un archivo real.

**Decisiones**

10. Cerrar el **ADR 0019** (la política de cancelación se calcula y nunca se cobra).
11. Confirmar el **inventario físico real** y la **tarifa rack de cabañas**.
12. Del contador: moneda de emisión de las facturas y tratamiento de percepciones.

---

## 7. Lo que sigue sin poder cerrarse desde el código

- **El sistema nunca corrió en producción.** Latencia real, límites de conexión, un
  pago por una pasarela viva, un CAE real.
- **Restaurar un backup.** Es el punto ciego más grande que queda: la app no puede
  hacer backups de Postgres —lo hace la plataforma— y nadie probó restaurar uno.
- **La auditoría de las ~90 políticas RLS de escritura**, una por una. La matriz de
  **lectura** sí es exhaustiva y se verifica en cada corrida de CI.

---

## 8. Anexo — lo que entró

**Migraciones**

| # | Qué |
|---|---|
| 0074 | Ausencia en el feed del canal (P0-1) |
| 0075 | Bandeja de salida de notificaciones |
| 0076 | Notas de crédito |
| 0077 | Movimientos externos y conciliación |
| 0078 | Moneda real en cuentas corrientes (P1-3) |
| 0079 | Cerrar la conciliación del canal (P1-4) |
| 0080 | Comprobantes recibidos |
| 0081 | Mapeo de tipos por canal (P1-1) |
| 0082 | Datos fiscales del hotel |

**ADRs**

- **0030** — Conciliación: de dónde salen los movimientos y qué se cierra solo.
- **0031** — La factura se lee por su QR, no por OCR.
- **0032** — El lado saliente del canal: se calcula y se declara que no sale.

**Áreas nuevas del panel**

- `/panel/conciliacion` — movimientos y gastos del mes (admin y gerencia).
- `/panel/proveedores/comprobantes` — escaneo de facturas recibidas.
- `/panel/canales` → vista **Publicación al canal**.
- `/panel/config` → sección **Datos fiscales del hotel**.

**Crons** (`vercel.json`)

| Ruta | Cuándo |
|---|---|
| `/api/cron/canales` | 06:00 |
| `/api/cron/ari` | 06:20 |
| `/api/cron/mantenimiento` | 06:40 |
| `/api/cron/notificaciones` | cada 5 min |
| `/api/cron/salud` | cada 15 min |
