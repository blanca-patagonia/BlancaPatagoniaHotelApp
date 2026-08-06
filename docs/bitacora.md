# Bitácora de avances

Registro cronológico del desarrollo del Sistema Integral de Gestión Hotelera
para el Hotel Blanca Patagonia. Cada entrada documenta **qué se hizo**, **por qué**
y **qué decisiones** se tomaron. Es el insumo principal para los capítulos de
implementación de la tesis.

> Formato: fecha · fase · resumen · detalle · decisiones.

---

## 2026-06-14 — Fase 0: Fundaciones

**Resumen:** se montó el esqueleto del proyecto y la infraestructura base.

**Detalle de lo realizado:**
- Inicialización del proyecto con **Next.js 16** (App Router) + **TypeScript** +
  **Tailwind CSS 4**.
- Conexión del repositorio local con el remoto de GitHub
  (`BlancaPatgoniaHotelApp`) en la rama `main`.
- Dependencias base instaladas: `@supabase/supabase-js`, `@supabase/ssr`, `zod`
  (validación) y `vitest` (tests).
- Capa de acceso a Supabase:
  - `lib/supabase/server.ts` — cliente para Server Components / Route Handlers.
  - `lib/supabase/client.ts` — cliente para el navegador.
  - `lib/supabase/admin.ts` — cliente privilegiado (service role) solo-servidor.
  - `lib/supabase/proxy.ts` + `proxy.ts` — refresco de sesión por request
    (en Next.js 16 `middleware` se reemplaza por `proxy`).
- Primera migración SQL `0001_perfiles_y_roles.sql`: enum `rol_usuario`, tabla
  `perfiles`, helper `rol_actual()`, trigger de alta automática y políticas RLS.
- Tooling de calidad: `vitest.config.ts`, primer test (`tests/roles.test.ts`) y
  workflow de **CI** en GitHub Actions (lint + tests + build).
- Estructura de documentación (`docs/`) y primeros ADRs.

**Decisiones tomadas:**
- Stack **Next.js + Supabase** (ver [ADR 0001](decisiones/0001-eleccion-de-stack.md)).
- La integridad anti-overbooking se resolverá a nivel de base de datos
  (ver [ADR 0002](decisiones/0002-motor-de-disponibilidad.md)).

**Pendiente / próximo paso:** crear el proyecto Supabase (local o cloud), aplicar
la migración 0001 y comenzar la **Fase 1 — Núcleo de dominio**.

---

## 2026-07-27 — Fase 1: Núcleo de dominio

**Resumen:** se implementó y verificó el modelo de datos del negocio (inventario,
temporadas, tarifas, promociones, huéspedes) y el **motor de disponibilidad
anti-overbooking**, sobre Supabase local (Docker).

**Detalle de lo realizado:**
- Migraciones nuevas:
  - `0002_inventario.sql` — enums `categoria_unidad` y `estado_hk`; tablas
    `tipos_unidad` y `unidades`; RLS (público lee activos, admin/gerencia
    gestionan, housekeeping actualiza estado).
  - `0003_temporadas_tarifas.sql` — `temporadas`, `temporada_rangos` (con
    exclusión anti-solape de fechas), `tarifas` (neto/rack, IVA, moneda) y la
    función `temporada_en(fecha)`.
  - `0004_promociones_politicas_huespedes.sql` — `promociones`,
    `politicas_cancelacion`, `huespedes`.
  - `0005_reservas_ocupacion.sql` — enum `estado_reserva`; `reservas`,
    `estadias` (con **restricción de exclusión GiST** que impide overbooking),
    trigger de sincronización de estado, `reserva_huespedes`, y las funciones de
    disponibilidad `unidades_disponibles()` y `disponibilidad_por_tipo()`.
  - `0006_grants_api.sql` — privilegios de los roles `anon` / `authenticated` /
    `service_role` (ver "Decisiones").
- `seed.sql` con **datos reales del Tarifario 2025/2026** (Anexo A): 3 temporadas
  con sus rangos, 10 tipos de unidad, 30 tarifas (neto/rack), política de
  cancelación oficial, inventario físico representativo y 2 promociones de ejemplo.
- Lógica de dominio (pura, testeable): `lib/domain/precios.ts` (cálculo por
  canal + IVA + promociones), `lib/domain/cancelacion.ts` (cargos según
  anticipación), `lib/domain/unidades.ts` (tipos) y `lib/availability/` (acceso a
  las funciones de disponibilidad).
- Tests (**20 en verde**): `precios` (8), `cancelacion` (5), `roles` (3) y el
  test de integración `overbooking` (4) que verifica contra Postgres real que un
  solape se rechaza (`23P01`), que una estadía contigua se acepta y que una
  cancelación libera el inventario.
- Entorno: se levantó el stack local con `supabase start` + `supabase db reset`.
  `.env.local` apunta al stack local (nuevo formato de claves `sb_publishable` /
  `sb_secret`). `typecheck` y `lint` en verde.

**Decisiones tomadas:**
- Moneda **USD base + ARS a cotización configurable** (ver
  [ADR 0003](decisiones/0003-moneda-usd-ars.md)).
- Tarifas con **doble precio neto/rack** e **IVA discriminado** (ver
  [ADR 0004](decisiones/0004-tarifas-neto-rack-iva.md)).
- Se agregó `0006_grants_api.sql`: en Supabase hosted los `GRANT` a los roles de
  la API los aplica la plataforma; en local hay que declararlos explícitamente
  (la seguridad real la sigue imponiendo RLS). Sin esto, PostgREST devuelve
  *permission denied* y no funcionaría ni el panel interno.

**Pendiente / próximo paso:** **Fase 2 — Reservas internas (Recepción)**: pantalla
de grilla de ocupación, alta/consulta/cancelación de reservas con la máquina de
estados, y cableado del cálculo de precio + política sobre la UI. También:
confirmar con el hotel el inventario físico real y la tarifa rack de cabañas.

---

## 2026-07-27 — Fase 2: Panel interno de Recepción

**Resumen:** se construyó el **panel de gestión interno** (funciones de Front
Office tipo WinPax) con **autenticación y control de acceso por rol**, sobre el
núcleo de dominio de la Fase 1.

**Detalle de lo realizado:**
- **Autenticación y roles (ADR 0005):** login con Supabase Auth (Server Action),
  guard `requerirAcceso(area)` + mapa de permisos (`lib/domain/permisos.ts`),
  sidebar filtrado por rol y cierre de sesión. Bootstrap del admin con
  `scripts/seed-usuarios.mjs` (`npm run seed:usuarios`).
- **Dashboard** con KPIs del día (ocupación, llegadas/salidas, estados de unidad).
- **Grilla de ocupación** (`/panel/ocupacion`): unidades × días con navegación por
  semanas y estado de housekeeping.
- **Reservas:** alta (`/panel/reservas/nueva`) con búsqueda de disponibilidad y
  **cotización** (RPC `cotizar_estadia` — migración 0008 — + motor de precios con
  IVA); listado, detalle y **máquina de estados** (confirmar, check-in/out,
  cancelar con preview de cargo, no-show). El alta usa la RPC atómica
  `crear_reserva` (anti-overbooking); el error `23P01` se traduce a la UI.
- **Housekeeping:** cambio de estado de unidades (limpia/sucia/inspeccionada/bloqueada).
- **Usuarios (niveles):** alta de staff con rol, cambio de rol y activar/desactivar
  (cliente `service_role`, solo admin).
- **Huéspedes** con historial de reservas y **Configuración** (tarifario en lectura).
- Utilidades de fecha (`lib/fechas.ts`) y de cotización (`lib/pricing/cotizar.ts`).

**Verificado end-to-end en el navegador:** login como admin; alta de una reserva
(Doble Standard, 3 noches, USD 642,51 = 177×3 + IVA 21 %) que aparece en la grilla;
ciclo de estados; alta de un usuario de recepción y comprobación de que su menú
queda **restringido** y el acceso por URL a áreas prohibidas **redirige**.

**Decisiones y aprendizajes:**
- Control de acceso por rol en dos capas: app (guard/sidebar) + **RLS** (ver
  [ADR 0005](decisiones/0005-autenticacion-y-roles.md)).
- Al embeber `huespedes` desde `reservas` hay que **desambiguar** el FK
  (`huespedes!reservas_huesped_id_fkey`) porque existe una segunda relación
  (`reserva_huespedes`); si no, PostgREST devuelve `PGRST201`.
- Los tests de integración se ejecutan **en serie** (`fileParallelism: false`) por
  compartir la Postgres local. Suite: **38 tests en verde** + typecheck + lint.

**Pendiente / próximo paso:** **Fase 3 — Pagos** (MercadoPago/Stripe, seña →
confirmación, webhooks). Nota de datos: el Tarifario cargado es 2025/2026, anterior
a la fecha del sistema; para demos "en vivo" habría que cargar la temporada vigente.

---

## 2026-07-27 — Fase 3: Pagos

**Resumen:** se incorporó el **registro de pagos** de las reservas (seña / saldo /
reembolso) operable desde recepción, con una **abstracción de pasarelas** y un
**webhook idempotente** listos para MercadoPago/Stripe.

**Detalle de lo realizado:**
- **Migración 0009 (`pagos`):** medio, tipo, monto, estado y `external_id` único
  (idempotencia). RLS: staff lee, recepción+ gestiona.
- **Dominio `lib/domain/pagos.ts`:** `resumenPagos` (pagado/saldo/saldada) y
  `seniaSugerida` (primera noche) + tests.
- **UI:** sección **Pagos** en el detalle de la reserva (Total / Pagado / Saldo,
  lista y registro manual). Al saldarse, la reserva pasa **automáticamente** a
  `pagada` (`registrarPago`).
- **Abstracción `PaymentProvider`** (`lib/payments/`) con stubs MercadoPago/Stripe
  y **webhook** `POST /api/webhooks/pagos/{proveedor}` idempotente (service_role).

**Verificado:** registro de seña (USD 214,17) + saldo (USD 428,34) → reserva
**Pagada** (como usuario de recepción); webhook: 1er POST inserta, 2do idéntico
devuelve `duplicado`, proveedor desconocido → 404. **43 tests en verde.**

**Decisiones:** ver [ADR 0006](decisiones/0006-pagos-abstraccion-e-idempotencia.md).
No se integran pasarelas reales (requieren credenciales del hotel y mueven dinero);
el sistema queda operable con cobros manuales y preparado para enchufarlas.

**Pendiente / próximo paso:** **Fase 4 — Portal público de reservas** (búsqueda,
checkout con pago, email de confirmación), reutilizando el motor de disponibilidad,
cotización y la capa de pagos ya construidos.

---

## 2026-07-27 — Fase 4: Portal público de reservas

**Resumen:** se construyó el **portal público** (sin login) para que el huésped
final reserve online, reutilizando disponibilidad, cotización y pagos.

**Detalle de lo realizado:**
- **Landing** pública (boutique) con CTA a reservar y acceso discreto al staff.
- **`/reservar`:** búsqueda por fechas/huéspedes → tipos disponibles con precio
  (rack, con IVA), usando `disponibilidad_por_tipo` y `cotizar_estadia` (accesibles
  por `anon`).
- **`/reservar/checkout`:** resumen (total + seña) y datos del huésped.
- **Alta pública** (`crearReservaPublica`, Server Action con `service_role`): asigna
  unidad libre, cotiza y crea la reserva en estado **`pendiente`** (bloquea el
  inventario por la exclusión). Traduce el error `23P01`.
- **`/reservar/confirmacion/[codigo]`:** confirmación por código con la seña.
- **Email de confirmación** (`lib/email/confirmacion.ts`): stub listo para proveedor real.

**Verificado end-to-end:** landing → búsqueda → checkout → reserva
**BP-260727-DC2C** (`pendiente`, canal `web`, huésped Pérez). La ocupación de Doble
Standard subió a 2 (Fakiani + Pérez) → **la reserva pública bloqueó inventario en
vivo**. El stub de email registró el envío. **43 tests en verde.**

**Decisiones:** ver [ADR 0007](decisiones/0007-portal-publico-reservas.md). No hay
pago de seña online (requiere pasarela) ni envío real de email; ambos quedan
enganchados a las capas ya preparadas (ADR 0006).

**Pendiente / próximo paso:** **Fase 5 — Check-in/out + consumos + factura PDF**;
además: expiración de reservas `pendiente` sin seña y rate-limiting del portal.

---

## 2026-07-28 — Fase 5: Consumos y factura interna

**Resumen:** se incorporó el **cargo de consumos** a la cuenta de la reserva y la
**factura interna** consolidada, con las columnas AFIP preparadas.

**Detalle de lo realizado:**
- **Migración 0010:** `productos_servicios` (catálogo: frigobar, desayuno,
  excursiones, traslados), `consumos` (con precio congelado) y `facturas` (número
  propio + columnas AFIP `cae`/`punto_venta`/etc. preparadas). Catálogo inicial en
  la propia migración.
- **Dominio `lib/domain/consumos.ts`:** `totalConsumos` y `cuentaConsolidada`
  (alojamiento + consumos) + tests.
- **UI:** sección **Consumos y cuenta** en el detalle de la reserva (cargar/quitar
  consumos, cuenta consolidada) y **factura imprimible** en
  `/panel/reservas/[id]/factura` (`window.print()` → PDF del navegador).
- **Check-in / check-out**: por la máquina de estados ya existente.

**Verificado end-to-end:** se cargó "Perito Moreno clásico" (USD 90) a la reserva
BP-260727-755C y se emitió la factura **FAC-…** con total **USD 732,51** (642,51
alojamiento + 90 consumo). **47 tests en verde.**

**Decisiones:** ver [ADR 0008](decisiones/0008-consumos-y-factura-interna.md). Queda
pendiente la generación server-side de PDF a Storage y la facturación electrónica
AFIP (Fase 8), sobre las columnas ya previstas.

**Pendiente / próximo paso:** **Fase 6 — Reportes / Dashboard gerencial** (ocupación,
facturación mensual, ranking de canales), reutilizando los datos ya consolidados.

---

## 2026-07-28 — Fase 6: Reportes gerenciales

**Resumen:** se agregó el **dashboard gerencial** (`/panel/reportes`, para admin y
gerencia) con los indicadores clave de gestión.

**Detalle de lo realizado:**
- Nueva área **`reportes`** en el control de acceso (admin + gerencia) y en el sidebar.
- Helpers de fecha `nochesEnVentana` e `inicioFinDeMes` (prorrateo de ocupación por
  mes) + tests.
- **`/panel/reportes`:** ocupación del mes (selector), ingresos cobrados (pagos),
  facturación (comprobantes), **ranking de canales** (reservas + monto) y **reservas
  por estado** (barras).

**Verificado end-to-end:** con la ocupación de noviembre 2025 → **6/450
noches-unidad**; ingresos USD 642,51, facturado USD 732,51, canales Directo/Web 1 c/u.
Recepción **no** ve Reportes (gating). **49 tests en verde.**

**Pendiente / próximo paso:** **Fase 7 — Hardening de producción** (revisión de RLS,
expiración de reservas pendientes, backups, dominio y deploy a Vercel + Supabase cloud).

---

## 2026-07-28 — Revisión de seguridad

**Resumen:** auditoría de seguridad del código y la base antes de continuar. Detalle
completo en [revisión de seguridad](revision-seguridad.md).

**Verificado ✅:** RLS habilitado en todas las tablas; ninguna tabla con RLS sin
políticas; funciones `SECURITY DEFINER` con `search_path` fijo; y —lo más
importante— el rol **anónimo** obtiene **0 filas** de huéspedes/reservas/pagos/
perfiles/facturas/consumos (PII y datos financieros protegidos por RLS), leyendo solo
el catálogo público.

**Corregido:**
- **Webhook *fail-closed* en producción** (crítico): sin secreto de firma, se rechaza
  en prod (antes aceptaba) → evita pagos falsos. Bug adicional: el nombre de la
  variable no coincidía con `.env.example` (`MERCADOPAGO_WEBHOOK_SECRET`); alineado.
- **Validación de email** server-side y **tope de 30 noches** en el alta pública.

**Pendiente (Fase 7):** token inadivinable para la confirmación pública (evitar
enumeración del código), rate-limiting de endpoints públicos, expiración de reservas
`pendiente`. **49 tests en verde.**

---

## 2026-07-28 — Fase 7 (parcial): hardening de reservas

**Resumen:** se resolvieron dos de los riesgos de la revisión de seguridad.

**Detalle (migración 0011):**
- **Token opaco de confirmación:** columna `reservas.token` (`uuid`); la URL pública
  de confirmación usa el token en lugar del código. **Verificado:** la página abre
  por token y **devuelve 404 por código** (enumeración anulada).
- **Expiración de pendientes:** función `expirar_reservas_pendientes(dias)` que cancela
  las reservas `pendiente` sin seña con más de N días (libera inventario). Con test de
  integración (cancela la que no tiene seña, respeta la que sí).

**Mejora de código:** se unificó la lógica de alta de reserva (antes duplicada entre
recepción y portal público) en `lib/reservas/crear.ts` (`crearReservaEnUnidadLibre`):
un único punto para elegir unidad libre + cotizar + crear atómicamente. Ambos flujos
re-verificados en el navegador (interno USD 519,09; público USD 598,95).

**Pendiente:** rate-limiting, programar la expiración por cron (pg_cron / Edge Function),
y el deploy (Vercel + Supabase cloud). **50 tests en verde.**

---

## 2026-07-29 — Fase 8: Ampliación de funciones (WinPax / Odoo)

Se analizaron WinPax y Odoo Hotel y se agregan funciones que faltaban. Se
construyen de a una, verificadas y commiteadas.

### 8.1 — Cuentas corrientes de agencias / empresas

- **Migración 0012:** `agencias` (tipo, CUIT, email, % descuento), `movimientos_cuenta`
  (cargo/pago) y `reservas.agencia_id`.
- **Dominio `lib/domain/cuentas.ts`:** `saldoCuenta` (cargos − pagos) y
  `aplicarDescuento` + tests.
- **UI `/panel/agencias`** (admin/gerencia gestionan, recepción registra movimientos):
  lista con saldo por agencia, alta de agencia, y detalle con movimientos y registro
  de cargo/pago.
- **Verificado:** agencia con cargo USD 642,51 + pago USD 400 → **saldo USD 242,51**.
  **56 tests en verde.**

### 8.3.b — Reportes avanzados (ADR / RevPAR)

- Se sumaron al dashboard gerencial los KPIs hoteleros **ADR** (tarifa media diaria =
  ingreso alojamiento / noches vendidas) y **RevPAR** (ingreso por unidad disponible),
  calculados con `estadias.precio_noche` prorrateado al mes. Verificado (ADR USD 177).

### 8.2 — Reservas grupales

- **Migración 0013:** `reservas.grupo_id`. Una reserva grupal = varias reservas (una
  por unidad) con el mismo `grupo_id`; reutiliza el alta atómica por unidad, el folio
  y el ciclo de estados (habilita check-out escalonado y facturación consolidada).
- **UI `/panel/reservas/nueva-grupo`** (cantidades por tipo + titular) + filtro
  `?grupo=` en la lista con **total consolidado**.
- **Verificado:** grupo de 2 Doble Standard + 1 Triple → 3 reservas, total consolidado
  **USD 1.691,58**.

### Decisión de alcance — dos vistas separadas

Se define separar claramente **dos vistas**: (1) **gestión hotelera** (`/panel`, solo
staff, con login) — el foco actual; y (2) **reservas de clientes** (sitio público
`/reservar` + landing, tipo blancapatagonia.com) — a desarrollar como vista aparte más
adelante. Las funciones **cara al cliente** (web check-in, encuestas de satisfacción)
se **difieren** a esa vista; en la fase de gestión solo se agregan módulos de staff.

### 8.4 — Mantenimiento y objetos perdidos (gestión interna)

- **Migración 0014:** `ordenes_mantenimiento` (unidad, prioridad, estado, asignación) y
  `objetos_perdidos` (descripción, ubicación, estado). RLS por rol.
- **UI:** `/panel/mantenimiento` (alta + ciclo pendiente→en_proceso→resuelta) y
  `/panel/objetos-perdidos` (registro + marcar devuelto). Áreas nuevas en permisos.
- **Verificado:** orden "Pérdida de agua" (prioridad alta) y objeto "Campera azul".
  **56 tests en verde.**

### 8.5 — Consolidación de la gestión

- **Limpieza de datos de prueba:** `supabase db reset` → base limpia (inventario,
  tarifas y catálogo reales, sin reservas/agencias/órdenes de prueba) + admin recreado.
- **Dashboard como hub:** KPIs operativos (mantenimiento pendiente, objetos guardados)
  y sección **Módulos** con accesos rápidos filtrados por rol (badges de pendientes).
- Verificado: dashboard limpio con los 10 módulos accesibles para admin.

### 8.6 — Fidelidad e inventario (funciones WinPax/Odoo faltantes)

- **Migración 0015:** `huespedes.puntos`; `productos_servicios.stock` + `stock_minimo`
  y trigger que **descuenta stock** al cargar un consumo.
- **Fidelidad** (`lib/domain/fidelidad.ts`): `puntosPorEstadia` (1 pto por USD 10) y
  `nivelFidelidad` (bronce/plata/oro/platino) + tests. Los puntos se otorgan en el
  **check-out** y se muestran (nivel + puntos) en el detalle del huésped.
- **Inventario:** sección en Configuración con stock, mínimo, **alerta de stock bajo**
  y reposición (admin/gerencia). Stock inicial sembrado (frigobar 24, desayuno 40).
- **58 tests en verde.** Verificado: stock en base y sección de inventario en el panel.

### 8.7 — Proveedores, reprogramación, mucamas y avisos (funciones de gestión)

Cierre de las funciones de **gestión interna** faltantes detectadas al comparar con
WinPax/Odoo (las de cara al cliente se difieren a la vista pública).

- **Migración 0016:** `proveedores` (nombre, rubro, cuit, email, teléfono, activo) y
  `movimientos_proveedor` (cargo/pago), `unidades.asignada_a` (mucama/o responsable) y
  `avisos` (mensajería interna). RLS por rol; política para que el staff vea el nombre
  de los perfiles (autor del aviso / mucama asignada).
- **Proveedores** (`/panel/proveedores`): cuentas **por pagar** reutilizando el dominio
  `saldoCuenta` de agencias — alta de proveedor, registro de factura (cargo) y pago, y
  saldo por proveedor. Admin/gerencia gestionan.
- **Reprogramación de reservas** (`reprogramarReserva` en el detalle): cambia el período
  de la estadía, **recotiza** la nueva estancia y actualiza el total; si el nuevo período
  se solapa con otra estadía activa el motor anti-overbooking la rechaza (`23P01` →
  aviso "las fechas se solapan"). No disponible en estados terminales.
- **Mucamas** (Housekeeping): selector por unidad para **asignar/desasignar** una mucama/o
  (perfiles con rol `housekeeping`).
- **Avisos** (`/panel/avisos`): tablón de mensajería interna del equipo; cualquier rol
  del staff publica y lee, el autor (o admin) puede borrar.
- Permisos, sidebar y hub del dashboard actualizados con las áreas nuevas.
- **58 tests en verde** (typecheck + lint OK). Verificado en navegador: proveedor
  "Lavandería del Sur" con factura USD 642,51 − pago USD 400 → **saldo USD 242,51**;
  aviso publicado con autor y borrado; selector de mucama por unidad en Housekeeping.

## Fase 9 — Mejora integral del panel de gestión

### 9.1 — Identidad patagónica y base transversal

Rediseño de los 13 módulos a partir de una base común, en lugar de retocar
pantalla por pantalla (ver **ADR 0009**).

- **Tres bugs corregidos:**
  1. `globals.css` conservaba `font-family: Arial` del starter, que **pisaba a
     Geist**: la fuente se descargaba y no se usaba. Verificado en el navegador:
     `body` pasó de `Arial` a `Geist`.
  2. La barra lateral era `hidden … sm:flex` sin alternativa, así que **desde un
     teléfono no se podía navegar**. Ahora hay un cajón deslizable con foco,
     cierre con `Escape` y bloqueo del scroll de fondo. Verificado a 375 px:
     13 enlaces accesibles.
  3. Se quitó el bloque `prefers-color-scheme: dark`, que invertía las variables
     de color sin que la interfaz acompañara (texto casi blanco sobre blanco).
- **Identidad visual:** paleta con nombres del entorno del hotel — `lago`
  (turquesa glaciar), `calafate` (violeta de la baya), `lenga` (otoño) y `stone`
  (estepa) — más **Fraunces** para títulos y marca junto a Geist para la
  interfaz. Barra lateral en degradé glaciar con iconografía propia.
- **Componentes compartidos** (`_components/ui.tsx`) e **iconos SVG propios**
  (`_components/iconos.tsx`), sin dependencias nuevas.
- **Listados:** búsqueda, filtros y paginación por URL (GET, sin JavaScript).
  Antes los listados cortaban en `.limit(100)` **descartando filas en silencio**;
  ahora informan «26–50 de 214». Lógica pura en `lib/listados.ts` con tests.
- **Exportación a CSV** centralizada en `/panel/exportar/[recurso]`, con control
  de permisos por área en un único punto auditable. Escapa la **inyección de
  fórmulas** (un huésped `=1+1` no se ejecuta al abrir el archivo).
- **Accesibilidad:** foco visible propio, `aria-label` en controles, `<caption>`
  en tablas, salto al contenido, roles en formularios de búsqueda.
- **Estados de carga y error** por ruta (`loading.tsx` / `error.tsx`): la
  navegación deja de sentirse trabada y un fallo de red ya no tira la interfaz.
- Se eliminó código muerto (`_components/proximamente.tsx`).

### 9.2 — Mejora funcional módulo por módulo

- **Inicio:** saludo y panorama del día; llegadas y salidas **accionables** (con
  acceso directo a cada reserva), alertas de mantenimiento, objetos en depósito
  y stock bajo, y grilla de módulos por rol.
- **Ocupación:** hoy destacado, filtro por categoría (hostería / cabañas),
  ventana de 14 o 30 días, salto a fecha, KPIs del período y **celdas
  interactivas**: una celda libre abre la reserva con las fechas ya cargadas y
  una ocupada lleva a su reserva.
- **Reservas:** búsqueda por código, huésped o email; filtros combinados de
  estado, canal y **rango de estadías** (por superposición de períodos);
  paginación y exportación con los filtros aplicados.
- **Huéspedes:** la búsqueda ahora cubre apellido, nombre, documento y email
  (antes solo apellido); nivel de fidelidad y contacto en la grilla.
- **Housekeeping:** vista **por responsable** además de por unidad, filtros por
  estado y por mucama, y KPIs por estado de limpieza.
- **Mantenimiento:** filtros por estado y prioridad, búsqueda, **antigüedad de
  la orden** con destaque de las demoradas (7 días o más) y KPIs.
- **Objetos perdidos:** búsqueda, filtro por estado y KPIs de depósito.
- **Avisos:** tablón con **avisos fijados** (migración 0017), búsqueda y fechas
  relativas. La restricción se impone en la base: un trigger garantiza que el
  staff solo pueda cambiar `fijado`, nunca el texto ni la autoría.
- **Agencias y Proveedores:** buscador, filtro «con saldo», KPIs de total a
  cobrar / a pagar, estado activo y exportación. El alta quedó plegada para que
  la lista sea lo primero que se ve.
- **Reportes:** métricas extraídas a `lib/domain/metricas.ts` (**lógica pura y
  testeada**: ocupación, ADR y RevPAR con prorrateo de estadías a caballo entre
  meses), **comparativa contra el mes anterior**, gráfico de evolución de 6
  meses, navegación entre meses y exportación de la serie de 12 meses.
- **Configuración:** el tarifario pasó de solo lectura a **editable** por
  admin/gerencia, con validación (importes positivos y neto ≤ rack) y mensajes
  de confirmación o error.
- **Usuarios:** buscador por nombre o email, **último acceso** de cada usuario y
  KPIs de activos, inactivos y administradores.

**Verificación:** 96 tests en verde (antes 58; se sumaron `csv`, `listados` y
`metricas`), typecheck y lint limpios. Las 13 pantallas responden 200 sin caer
en el límite de error. Probado contra la base: fijar un aviso se permite y
**adulterar su mensaje se rechaza** (`Solo se puede fijar o desfijar un aviso`);
la exportación de reportes devuelve 12 meses con las columnas correctas y un
recurso inexistente responde 404.

## Fase 10 — Contratos con firma y conversaciones (inspiradas en Odoo)

### 10.1 — Contratos y firma electrónica

Adaptación de la app **Firma (Sign)** de Odoo al dominio hotelero (ver **ADR 0010**).

- **Migración 0018:** enums `tipo_contrato` y `estado_contrato`; tablas
  `contratos` (con vigencia y referencia polimórfica a agencias, proveedores o
  perfiles) y `firmas` (token, hash, IP, user-agent, fecha). RLS: todo el staff
  lee, solo admin y gerencia gestionan.
- **Integridad en la base:** como `entidad_id` es polimórfico y no admite clave
  foránea, un trigger (`validar_entidad_contrato`) verifica que la entidad exista
  en la tabla que corresponde al tipo.
- **Dominio puro** (`lib/domain/contratos.ts`): máquina de estados y reglas de
  firma («no se firma un contrato vencido», «no se reenvía uno ya firmado»),
  **23 tests**. La misma función la consultan la vista pública, la acción y el panel.
- **Adapter `FirmaElectronicaProvider`** con el patrón de `PaymentProvider`:
  proveedor local que computa un **SHA-256 real** con Web Crypto y deja lista la
  sustitución por un servicio externo vía variable de entorno.
- **UI:** `/panel/contratos` (listado con KPIs, filtros y redacción) y su detalle
  (envío, enlace de firma, constancia y verificación de integridad); vista pública
  `/firmar/[token]` sin cuenta, resuelta con `service_role` como la confirmación
  de reserva.
- **Limitación documentada:** la constancia tiene trazabilidad pero **no es firma
  digital con validez legal** (Ley 25.506); se aclara al pie de la vista pública.
- **Verificado de punta a punta:** el trigger rechazó un contrato con entidad
  inexistente; se firmó un convenio real desde la URL pública y quedaron
  registrados firmante, IP (`::1`) y fecha; el **hash guardado coincide
  exactamente** con el SHA-256 recalculado por fuera del sistema.

### 10.2 — Conversaciones internas y asistente del portal

Adaptación de **Conversaciones (Discuss)** de Odoo, diferenciada de Avisos:
aquel es una cartelera unidireccional, esto es un chat bidireccional por área.

- **Migración 0019:** `canales` (con los roles que participan), `mensajes` y
  `consultas_bot`. Permiso encapsulado en la función `puede_ver_canal()`, que
  usan las políticas de `mensajes`; el INSERT además exige que `autor_id` sea el
  usuario de la sesión, para que nadie escriba en nombre de otro. Se habilitó
  `supabase_realtime` sobre `mensajes` y se sembraron cuatro canales.
- **Dominio puro** (`lib/domain/conversaciones.ts`): pertenencia a canales,
  validación y normalización de mensajes y agrupación de mensajes consecutivos.
  **12 tests**.
- **Chat en vivo** (`/panel/conversaciones`): render inicial del servidor más
  suscripción a Realtime, de modo que la conversación se ve aunque el WebSocket
  no conecte. Es el único componente de cliente del panel.
- **Asistente del portal público** (`/reservar`): motor **basado en reglas**
  (ver **ADR 0011**) que responde horarios, política de cancelación, servicios,
  ubicación y mascotas **con datos reales de la base** — la política se redacta a
  partir de `politicas_cancelacion`, no de un texto fijo—, deriva las consultas
  de precio y disponibilidad al buscador real, y registra en `consultas_bot` lo
  que no supo responder. **18 tests**.
- **Bandeja de consultas** en el panel para que recepción dé seguimiento y sepa
  qué reglas conviene sumar.
- **Por qué no un LLM:** costo recurrente, credenciales de terceros,
  alucinaciones sobre datos del negocio y imposibilidad de testear. La interfaz
  `AsistenteProvider` deja el reemplazo abierto sin reescribir el dominio.

**Verificación:** **150 tests en verde** (antes 96; se sumaron `contratos`,
`asistente` y `conversaciones`), typecheck y lint limpios. Las pantallas nuevas
del panel y el portal renderizan con contenido real.

## Fase 11 — Alcance ERP: facturación fiscal, conciliación, CRM, NPS y auditoría

Se comparó el sistema contra las funcionalidades de un ERP maduro (Odoo)
aplicadas a hotelería y se priorizaron diez áreas no cubiertas. La evaluación
completa —qué entró, qué quedó como trabajo futuro y por qué— está en el
**ADR 0013**.

### Implementado

- **Facturación electrónica argentina (ADR 0012).** Migración 0021: enums
  `condicion_iva` y `tipo_comprobante`, condición fiscal en agencias y huéspedes,
  y desglose del impuesto en `facturas`. Dominio puro `lib/domain/facturacion.ts`
  con la letra del comprobante según condición de emisor y receptor, la
  discriminación del IVA, el **desglose que garantiza que neto + iva = total** y
  la **validación de CUIT por módulo 11**. Cuarto adapter del proyecto
  (`FacturacionElectronicaProvider`) con proveedor simulado que reproduce dos
  comportamientos reales de AFIP: rechaza una factura A sin CUIT y devuelve el
  CAE con vencimiento. **17 tests**.
- **Auditoría de operaciones sensibles.** Migración 0020: tabla `auditoria`
  *append-only* y un **trigger genérico** que sirve para cualquier tabla, puesto
  sobre `pagos`, `tarifas` y los cambios de estado de `reservas`. Se revocó
  INSERT/UPDATE/DELETE a `authenticated`: el staff solo puede leer. Pantalla
  `/panel/auditoria` que muestra **solo los campos que cambiaron**
  (`precio_rack: 270 → 999`) en lugar de volcar la fila entera.
- **Conciliación de proveedores y antigüedad de saldos.** Migración 0022: estado,
  vencimiento y número de comprobante en `movimientos_proveedor`, más la función
  `vencer_comprobantes_proveedor()`. Dominio `lib/domain/antiguedad.ts` con los
  tramos del *aging report* (por vencer, 1-30, 31-60, 61-90, +90) y el reporte
  integrado al módulo Proveedores. **17 tests**.
- **Pipeline comercial de agencias.** Misma migración: etapas
  contacto → cotización enviada → convenio firmado → activa (más «perdida»).
  Dominio `lib/domain/comercial.ts` con las transiciones válidas —no se puede
  saltear de contacto a activa—, el embudo y la tasa de conversión sobre las
  oportunidades **cerradas**. **13 tests**.
- **Encuestas de satisfacción (NPS).** Migración 0023: `encuestas_satisfaccion`
  con token público y un **trigger que la genera sola al pasar la reserva a
  checkout**, idempotente. Encuesta pública `/encuesta/[token]` sin cuenta, con
  los diez puntajes como radios y sin JavaScript. Dominio `lib/domain/encuestas.ts`
  que **descarta las encuestas sin responder** en lugar de contarlas como cero,
  que es el error clásico al implementar NPS. Índice y distribución en Reportes.
  **18 tests**.
- **Mantenimiento preventivo.** Misma migración: `planes_mantenimiento` y la
  función `generar_mantenimiento_preventivo()` que crea las órdenes vencidas y
  reprograma la siguiente. Dominio `lib/domain/preventivo.ts`, donde la suma de
  meses **cae en el último día del mes** cuando el día no existe (31 de enero
  + 1 mes = 28 de febrero). Sección en el módulo Mantenimiento. **17 tests**.
- **Plantillas de comunicaciones.** `lib/domain/plantillas.ts` con las cuatro
  plantillas pedidas (confirmación, recordatorio previo, encuesta y cambio de
  nivel de fidelidad) y un render de marcadores que **deja visible** el marcador
  sin valor en lugar de enviar «Hola ,». **11 tests**.

### Diferido a trabajo futuro (ADR 0013)

Gestión documental con Storage, seguridad granular por campo y multi-propiedad.
Los tres quedan documentados con su diseño concreto y el motivo del diferimiento:
Storage introduce un modelo de permisos paralelo a RLS; los permisos por columna
exigen un rol de Postgres por cada rol de negocio (hoy los cuatro comparten
`authenticated`); y multi-tenant sin un segundo hotel que lo valide es
complejidad a ciegas.

**Verificación:** **228 tests en verde** (antes 150), typecheck y lint limpios.
Probado contra la base: un cambio de tarifa quedó auditado con su valor previo y
nuevo; el check-out de una reserva **generó la encuesta automáticamente**; la
encuesta se respondió desde la URL pública (puntaje 9, promotor) y quedó
registrada. Las pantallas de auditoría, NPS en Reportes, antigüedad de saldos,
embudo comercial y preventivo renderizan con datos reales.

### 11.1 — Cableado de las capas que faltaban conectar

Revisión de completitud: tres capas de la Fase 11 estaban implementadas y
testeadas pero **sin usarse desde ninguna pantalla**, y el bot no consultaba los
datos que debía. Se cerraron los cuatro huecos.

- **Facturación fiscal conectada al check-out.** `emitirFactura` dejó de crear
  una proforma sin datos: ahora resuelve la letra del comprobante según la
  condición frente al IVA del receptor (la agencia si la reserva vino por
  convenio, si no el huésped), desglosa el impuesto, valida el CUIT cuando
  corresponde una factura A, asigna numeración correlativa por punto de venta y
  pide el CAE al proveedor. El comprobante muestra la letra, el número oficial,
  el neto y el IVA discriminado (solo en la A), el CAE con su vencimiento y el
  aviso de que es simulado. **Verificado:** huésped consumidor final →
  **factura B 0001-00000001**, neto 531,00 + IVA 111,51 = **642,51 exacto**,
  CAE de 14 dígitos con vencimiento a 10 días.
- **Vencimiento de comprobantes de proveedor.** El *aging report* existía pero
  **ninguna pantalla cargaba la fecha de vencimiento**, así que todo caía en «por
  vencer» y el informe era inerte. Se sumaron los campos de vencimiento y número
  de comprobante al alta, el estado por movimiento con acción de saldar, y el
  botón que dispara `vencer_comprobantes_proveedor()`. **Verificado:** una
  factura de junio quedó marcada como vencida y el reporte la ubicó en el tramo
  **31 a 60 días**.
- **El bot consulta datos reales.** Antes derivaba toda consulta de precio o
  disponibilidad al buscador. Ahora extrae las fechas de la pregunta
  (`10/09`, `10/09/2026` o ISO), llama a **`disponibilidad_por_tipo`** —la misma
  función SQL del motor anti-overbooking que usa el buscador— y responde con la
  disponibilidad real por tipo de unidad; para las tarifas informa el rango
  vigente leído del tarifario. **Verificado:** «¿tienen lugar del 10/09 al
  13/09?» devolvió los diez tipos con sus plazas y capacidades.
- **Plantillas de correo conectadas.** Se agregó `EmailProvider` (quinto adapter
  del proyecto) y `enviarPlantilla()`, único punto por el que salen las
  comunicaciones. El check-out ahora envía la encuesta con su token. En
  Configuración hay previsualización de las cuatro plantillas con datos de
  muestra y envío de prueba, avisando que el proveedor es simulado.

**Verificación:** **239 tests en verde** (antes 228; se sumaron extracción de
fechas y respuesta de disponibilidad), typecheck y lint limpios.

**Nota de entorno:** borrar `.next` obliga a `next/font/google` a redescargar las
tipografías; si esa descarga falla, el error queda cacheado y **toda la app
devuelve 500**, incluido `/login`. Se resuelve reiniciando el servidor. Conviene
tenerlo presente al desplegar sin red estable.

### 11.2 — Portal de agencias y proveedores

Último punto pendiente del requisito original de la Fase 10: «cada agencia o
proveedor ve solo sus propios contratos desde el portal» (ver **ADR 0014**).

- **Migración 0024:** `token` único en `agencias` y `proveedores`. Se optó por
  un portal **por token** y no por cuentas de usuario: montar autenticación
  pública para una decena de socios agrega superficie de ataque sin resolver un
  problema real, y el token es el mismo mecanismo que ya usan la confirmación de
  reserva, la firma y la encuesta.
- **`/portal/[token]`**: cuenta corriente con movimientos y saldo (para
  proveedores, además vencimiento y estado de cada comprobante) y listado de
  contratos con su estado y vigencia, incluyendo el botón para firmar los
  pendientes. Server Component puro, resuelto con `service_role`; `anon` no
  recibe ninguna política de lectura nueva.
- **La regla de aislamiento vive en el dominio:** `contratosDeEntidad()` filtra
  por tipo **y** por id, y oculta los borradores que el hotel todavía está
  redactando. Se aplica aunque la consulta SQL ya filtre, para que el
  aislamiento sea una función testeada y no dependa de recordar el `.eq()`.
- El enlace se muestra en el detalle de la agencia y del proveedor, para que el
  staff se lo haga llegar al contacto.

**Verificado con dos proveedores distintos:** el portal de la lavandería
devolvió **cero** coincidencias con el contrato y la deuda de la panadería, y el
de la panadería **cero** con los de la lavandería, viendo cada uno lo suyo. Un
contrato en borrador **no aparece** en el portal de su propia contraparte, y el
firmado sí. Token inexistente → 404. **244 tests en verde**, typecheck y lint
limpios.

### 11.3 — Cierre de los últimos huecos de cableado

Segunda revisión de completitud contra los prompts originales. Aparecieron tres
huecos del mismo tipo que la 11.1: **código escrito y testeado que nadie usaba**.

- **Recordatorio de vencimientos.** `porVencer()` estaba en el dominio con sus
  tests desde la Fase 11, pero **ninguna pantalla la llamaba**: el punto pedía
  «recordatorios automáticos de vencimientos» y solo existía el *aging report*.
  Ahora hay una tarjeta «Vencen en los próximos 7 días» en Proveedores —con los
  días restantes y el número de comprobante— y una alerta en Inicio que combina
  las facturas ya vencidas con las que vencen esta semana.
- **Las tres plantillas que no se disparaban.** De las cuatro, solo salía la
  encuesta post-checkout. Se conectaron: la **confirmación de reserva** (el
  checkout público dejó de usar el stub suelto de la Fase 4 y ahora usa la
  plantilla del catálogo), el **aviso de cambio de nivel de fidelidad** —que se
  envía solo si la estadía hizo **cruzar el umbral**, no cada vez que suma
  puntos— y el **recordatorio previo a la llegada**, como tarea programada con
  el mismo patrón que `expirar_reservas_pendientes`: botón en Reservas ahora,
  cron en producción.
- **El bot y las temporadas.** Consultaba políticas y tarifas, pero no el
  calendario. Se sumó la intención `temporadas`, que se resuelve leyendo
  `temporadas` + `temporada_rangos` de la base: si el hotel cambia las fechas, el
  asistente responde las nuevas sin tocar código. La intención se evalúa **antes**
  que tarifas, porque «¿la temporada alta tiene otro precio?» pregunta por el
  calendario.

Dos defectos de redacción detectados al probarlo en el navegador y corregidos
con test: el texto decía «Temporada temporada alta» (el nombre de la base ya
trae la palabra) y encadenaba «del A al B y del C al D y del E al F» en lugar de
enumerar con comas y una sola conjunción.

**Nota sobre una desviación deliberada:** el prompt pedía que el bot reutilizara
la RPC `unidades_disponibles`. Se usa `disponibilidad_por_tipo` en su lugar,
porque la primera devuelve las unidades concretas con nombre e id —expondría el
inventario interno al público— y la segunda está documentada en el propio código
como «apta para el portal público». Ambas se apoyan en el mismo motor
anti-overbooking.

**Verificación:** **253 tests en verde** (antes 244), typecheck y lint limpios.
En el navegador: el bot respondió el calendario real de las tres temporadas; la
tarjeta de vencimientos mostró «Lavado semana 31 · 0001-00000052 · en 3 días ·
USD 220»; Inicio avisó «1 factura vencida · 1 vence esta semana»; y el disparador
de recordatorios de llegada corrió y devolvió su resultado.

### 11.4 — Auditoría de completitud funcional por apartado

Se recorrieron los 15 apartados preguntando lo mismo en cada uno: **¿se puede
crear, editar y dar de baja lo que el módulo administra?** Aparecieron cinco
huecos, dos de ellos graves.

- **Huéspedes no tenía `actions.ts`.** No se podía crear ni editar un huésped
  desde el panel: solo nacían como efecto secundario de una reserva. Grave
  porque la **condición frente al IVA** —que define la letra del comprobante—
  no había forma de cargarla ni corregirla. Ahora hay alta en el listado y
  edición en la ficha, con validación: un responsable inscripto exige CUIT y se
  verifica su **dígito verificador** antes de guardar.
- **La reserva no permitía elegir agencia.** `emitirFactura` decide la letra del
  comprobante mirando `reserva.agencia_id`, pero **ningún formulario lo cargaba
  nunca**: el circuito agencia → tarifa neta → factura A era inalcanzable desde
  la interfaz. Se agregó el selector de agencia al alta, y con convenio se aplica
  tarifa **neta** cualquiera sea el canal, que es lo que define el acuerdo.
- **El catálogo de consumos estaba congelado.** Se podía reponer stock y editar
  tarifas, pero no dar de alta un producto: el hotel no podía sumar una bebida
  nueva al frigobar. Ahora se crean desde Configuración, con código derivado del
  nombre, y se pueden activar o desactivar (no borrar: los consumos ya cargados
  siguen apuntando al producto). La tabla distingue lo que lleva stock de los
  servicios, que no.
- **Agencias y proveedores no se podían editar ni desactivar**, aunque la
  columna `activo` existía y la interfaz la mostraba. Se agregó la edición de
  datos —incluida la condición frente al IVA de la agencia— y el alta/baja
  lógica.

**Verificado creando de verdad:** se dio de alta el huésped «Gutiérrez, Rodrigo»
con todos sus campos; el intento de crear un responsable inscripto con DNI
**fue rechazado** y no se guardó; y se creó el producto «Vino Malbec Patagónico»
con código `vino-malbec-patagonico`, precio 18,50 y stock 24/6. Las 20 rutas del
panel y del portal responden 200. **253 tests en verde**, typecheck y lint limpios.

## Fase 12 — Endurecimiento: CI real, reglas faltantes y concurrencia

Revisión crítica del sistema completo. Los hallazgos y su prioridad quedaron en
el **ADR 0015**.

### El CI no probaba la garantía central del sistema

El workflow corría `npm test` **sin credenciales de base**, así que los cuatro
tests de integración —anti-overbooking, cotización, expiración y alta atómica—
**se salteaban en silencio** y el badge quedaba verde. Tampoco corría
`typecheck`.

- El CI ahora **levanta Supabase** con el CLI (el runner ya trae Docker) y corre
  typecheck, lint, tests y build contra una base real.
- Se agregó `tests/db.ts` con la variable **`EXIGIR_DB`**: cuando vale `1` —como
  en CI— la falta de base es un **error**, no un salto. Si `supabase start`
  falla, la suite falla y se ve. Verificado en las dos direcciones: sin la
  variable saltea y pasa; con la variable falla con un mensaje explícito.

### Reglas de negocio que faltaban

- **No se validaba el estado al facturar.** Se podía emitir el comprobante de
  una reserva **pendiente o cancelada**; con un CAE real eso deja un documento
  fiscal que hay que anular con nota de crédito. Se agregó
  `motivoNoFacturable()` al dominio (solo se factura `pagada`, `in_house` o
  `checkout`, y nunca dos veces), se aplica en la acción y **el botón ya no se
  ofrece** cuando no corresponde: se explica por qué.

### Concurrencia y volumen

- **Numeración de comprobantes.** Se emitía con `count(*) + 1`, que ante dos
  emisiones simultáneas genera el **mismo número**. La migración 0025 agrega
  `puntos_venta` y `siguiente_numero_comprobante()`, que reserva el correlativo
  con bloqueo de fila. Se eligió un contador en tabla y no una `sequence`
  porque las secuencias **no se revierten en un rollback** y dejarían huecos,
  que AFIP también observa. **Verificado con 10 llamadas concurrentes: números
  2 a 11, sin un solo repetido.**
- **Saldos calculados en la base.** Los listados de Agencias y Proveedores
  traían **todos** los movimientos a memoria para sumarlos en JavaScript. La
  migración 0026 agrega las vistas `saldos_agencias` y `saldos_proveedores` con
  `security_invoker = true`, de modo que **RLS sigue aplicando**. El aging
  ahora consulta solo la deuda viva en lugar del historial completo.

### Operación

- **Tareas programadas** (migración 0027): expiración de reservas, vencimiento
  de comprobantes y de contratos, y mantenimiento preventivo pasan a `pg_cron`.
  Si la extensión no está disponible, la migración no rompe y las funciones
  siguen disponibles a mano. El recordatorio de llegadas queda manual porque
  envía correos desde la aplicación, no desde la base.
- **Límite de escrituras públicas.** El asistente registraba consultas sin tope.
  Ahora se acota a 5 por IP y por minuto: pasado el límite **sigue respondiendo**
  —no se corta el servicio— pero deja de escribir.
- **Validación de variables de entorno** (`lib/env.ts`, con zod). Antes una
  variable faltante se manifestaba como un error de red incomprensible en medio
  de una pantalla; ahora falla al construir el cliente y dice cuál falta.

**Verificación:** **258 tests en verde** corriendo con `EXIGIR_DB=1`, es decir
**con los de integración incluidos**, más typecheck y lint limpios.

### 12.1 — Tests sobre las Server Actions

Última deuda de la revisión (ADR 0015). Hasta acá la suite probaba `lib/domain`
—lógica pura— y las funciones SQL, pero **nada verificaba la capa del medio**:
la que lee el `FormData`, aplica las reglas y escribe. Ese hueco dejó pasar tres
veces el mismo error en este proyecto: dominio construido y testeado que
**ninguna pantalla llamaba**.

- **`tests/acciones/entorno.ts`** monta el andamiaje. Se falsea solo el borde de
  Next (`redirect`, `revalidatePath`) y la sesión, porque dependen del contexto
  de una petición HTTP. **La base, el dominio y el código de la acción corren de
  verdad.** `destinoDe()` captura el `redirect` —que lanza— para poder afirmar
  a dónde fue la acción, y `limpiar()` borra en orden inverso al de registro
  para no chocar con las claves foráneas.
- **20 tests nuevos** sobre reservas, huéspedes y proveedores. Verifican
  exactamente la clase de error que se repetía: *el formulario manda X, ¿la
  acción lo persiste?* Entre otros: que el vínculo con la agencia se guarde y
  aplique tarifa neta, que no se facture una reserva sin consumir ni dos veces,
  que los comprobantes reciban números distintos, que el vencimiento del
  comprobante llegue a la base, y que un responsable inscripto con DNI o con un
  CUIT mal formado **se rechace sin escribir nada**.
- Se agregó el alias de `server-only` en Vitest: el paquete lo provee Next y sin
  él los módulos de servidor no se pueden ni cargar en los tests. La protección
  que aporta sigue intacta en el build de la aplicación.

**Prueba de que los tests tienen filo:** se reintrodujo a propósito el bug
original —quitar el `update` que guarda `agencia_id`— y la suite **lo detectó**:
`expected null to be 'd5de2085-…'`. Restaurado el código, vuelve a verde.

También se corrigieron dos defectos de la propia limpieza: se borraba en el
orden equivocado y una factura se intentaba borrar por el id de la reserva. Tras
una corrida completa la base queda **sin residuo**.

**Verificación:** **278 tests en verde** con `EXIGIR_DB=1` (29 archivos),
typecheck y lint limpios.

---

## 2026-08-04 · Fase 13 — Limpieza de código muerto y cambio de unidad

Revisión del sistema buscando funciones sin uso, duplicación y huecos
funcionales, con el código en la mano en lugar de la memoria. Aparecieron tres
cosas.

### 13.1 · Una reserva no podía cambiar de habitación

El hueco más serio, y el que explicaba por qué había código huérfano. La unidad
se asignaba al crear la reserva y **después no había forma de cambiarla**. En un
hotel eso pasa todos los días: se rompe el calefactor, el huésped pide otra
habitación, o hay que liberar una unidad para acomodar un grupo. Winpax lo
resuelve; nosotros no.

- **Migración `0028`** con la función `cambiar_unidad_reserva`. Es una función y
  no un `update` desde la aplicación porque son **dos escrituras que van
  juntas**: mover la estadía y dejar sucia la unidad liberada. Si la segunda
  fallara por separado, la habitación quedaría marcada como limpia con las
  sábanas usadas. La fila se toma con `for update`, así dos recepcionistas
  mudando la misma reserva se serializan en lugar de pisarse.
- **La garantía de que el destino esté libre no se programó**: ya la daba la
  restricción de exclusión del ADR 0002. Si la unidad destino está ocupada, el
  `update` levanta `23P01` y la función entera se revierte. Es el mismo motor
  anti-overbooking protegiendo un caso para el que no fue escrito.
- **`lib/domain/mudanzas.ts`** decide lo que la base no puede: si la mudanza
  corresponde según el estado, si la unidad liberada queda sucia y qué pasa con
  la tarifa. `puedeCambiarUnidad` se apoya en `ocupaInventario` en vez de
  repetir la lista de estados: si la reserva no bloquea una unidad, no hay nada
  que mudar.
- **La tarifa la decide quien opera.** No hay una respuesta única: si la mudanza
  la decide el hotel (una avería, una cortesía) el huésped no paga la
  diferencia; si la pide él para mejorar, sí. Dentro del mismo tipo nunca se
  recotiza, porque la tarifa se carga por tipo y recotizar solo arriesgaría
  mover el total por un redondeo.
- **La recotización va después de la mudanza, fuera de la transacción**: si
  fallara, el huésped ya está mudado —que es lo urgente— y el precio se corrige
  a mano. Al revés sería peor.
- Se auditan solo los cambios de `unidad_id`, no todo `update` sobre estadías:
  auditar también las reprogramaciones de fecha llenaría la tabla de ruido.
- Esto le devolvió su razón de ser a `unidadesDisponibles`, que estaba escrita y
  no la llamaba nadie. De paso se descubrió que la función SQL devuelve
  `setof unidades` y la interfaz de TypeScript **descartaba el estado de
  housekeeping**: ahora el listado avisa si la unidad libre está sucia, que es
  justo lo que recepción necesita saber antes de mudar a alguien.

### 13.2 · Dos sistemas de correo, uno muerto

`lib/email/confirmacion.ts` (Fase 4) quedó superado por el adapter
`EmailProvider` (Fase 11) y **no lo llamaba nadie**. Se eliminó. La bitácora no
se reescribe, pero el ADR 0007 apuntaba a un archivo inexistente: se le agregó
la nota de reemplazo.

### 13.3 · Los horarios del hotel, en tres lugares

`HORA_CHECK_IN`, `HORA_CHECK_OUT`, `DIRECCION` y `ADMITE_MASCOTAS` estaban
copiados en `lib/asistente`, el alta del panel y la del portal —con un
comentario que afirmaba que vivían "en un solo lugar"—. El riesgo no era el
duplicado sino la divergencia: que el hotel cambie el horario y queden dos
respuestas conviviendo, el asistente diciendo una hora y el email otra. Ahora
están en `lib/domain/hotel.ts`.

### Otras mejoras

- La pantalla de detalle de reserva resolvía los mensajes de error con una
  cadena de **ternarios anidados de diez niveles**. Pasó a ser un mapa: sumar un
  error es una línea.
- Los tests de facturación fallaban con `expected [] to have a length of 2`
  cuando faltaba correr `seed:usuarios` después de un `db reset`. Ahora cortan
  con el motivo real. Es el mismo criterio que `EXIGIR_DB`: un fallo que no
  explica nada cuesta más que el que falla fuerte.

**Verificación:** **297 tests en verde** con `EXIGIR_DB=1` (31 archivos),
typecheck y lint limpios. Además se probó **la mudanza en el navegador**, de
punta a punta: la estadía quedó en la unidad nueva con el tipo actualizado, la
liberada pasó a `sucia`, la nueva siguió `limpia` y la operación quedó auditada.

---

## 2026-08-04 · Fase 14 — Experiencia de uso e interacción táctil

El panel se veía bien en un monitor, pero recepción y mucamas trabajan de pie y
con el teléfono. Revisión enfocada en eso.

**Método, y una hipótesis descartada.** El panel de vista previa no propaga el
cambio de tamaño al layout (`innerWidth` seguía en 981 con el viewport en 375) y
tampoco expone `document.head` ni las hojas de estilo. Eso hizo aparecer una
pista falsa: cero etiquetas `<meta>` y un ancho de 980px, que es justo lo que
usa un móvil **cuando falta el meta viewport**. Antes de anotarlo como defecto
se revisó el código de Next: `lib/metadata/default-metadata.js` inyecta
`width=device-width, initial-scale=1` por defecto en el App Router. No había tal
bug. La verificación terminó haciéndose sobre el **CSS compilado del build**,
que sí es comprobable.

### 14.1 · Base táctil

Se agregaron reglas en `globals.css` bajo `@media (pointer: coarse)` —el dedo—
en lugar de por ancho de pantalla, porque el problema es el dispositivo de
entrada: una tablet ancha se usa con el dedo igual que un teléfono. Así el
escritorio no engorda.

- **Campos a 16px.** Safari en iOS hace **zoom automático** al enfocar un campo
  con letra menor a 16px y deja la página corrida. Toda la interfaz usa `text-sm`
  (14px), así que **cada campo del panel** disparaba ese zoom.
- **Área mínima de toque de 44px** en botones, selects y chips. Los botones
  medían unos 36px y los chips de filtro, 28px. `botonClases` lleva ahora la
  clase `toque` porque un `<Link>` se renderiza como `<a>` y la regla de
  `button` no lo alcanzaba.

### 14.2 · Listados legibles en un teléfono

Un listado de cinco o seis columnas obliga a arrastrar la tabla de lado para
leer una fila. Se agregó `COL_SECUNDARIA` (`hidden sm:table-cell`) y se
marcaron las columnas que no identifican ni deciden.

Pero ocultar y ya sería perder datos, así que en cada listado **lo importante se
pliega bajo la columna principal** en móvil: las fechas y el total bajo el
huésped en reservas, el email bajo el nombre en usuarios, la fecha y el lugar
bajo la descripción en objetos perdidos. En huéspedes se prioriza el **teléfono
como enlace `tel:`**: desde un teléfono se llama, no se copia un correo.

El buscador tenía ancho fijo `w-56`; ahora ocupa lo que sobra en móvil y vuelve
a su ancho en escritorio.

### 14.3 · Desbordes que recortaban datos

Tres pantallas de detalle (agencias, huéspedes, proveedores) envolvían su tabla
en `overflow-hidden`, que **recorta** las columnas en lugar de dejarlas
desplazar: en un teléfono el dato quedaba inaccesible, que es peor que
desbordar. Pasaron a `overflow-x-auto`. Tres grillas de KPIs e importes estaban
fijas en `grid-cols-3` / `grid-cols-2`: en 375px daban columnas de ~110px que
partían los números. En la factura se conservan las dos columnas al imprimir
(`print:grid-cols-2`), porque ahí el ancho no es el de un teléfono.

### 14.4 · Formularios usables con el pulgar

Los cuatro formularios del detalle de reserva (pago, consumo, reprogramar,
mudanza) usaban `flex-wrap` con campos de ancho automático: en móvil quedaban
cuatro controles diminutos en una fila. Ahora los campos y el botón ocupan el
ancho completo y se apilan, y desde `sm` vuelven a la fila de siempre.

**Verificación:** **297 tests en verde**, typecheck, lint y `build` limpios. Las
reglas nuevas se comprobaron en el CSS compilado: el bloque
`@media (pointer:coarse)` con los 16px y los 2.75rem, y `.sm\:table-cell` /
`.sm\:hidden` dentro de `@media (min-width:40rem)` —o sea, que por debajo de
640px las columnas secundarias efectivamente desaparecen—.

**Pendiente de comprobar en un teléfono real:** el entorno de trabajo no permite
renderizar a 375px, así que el comportamiento se verificó por las reglas CSS y
no viendo la pantalla. Conviene abrirlo en un celular antes de la entrega.

---

## 2026-08-06 · Fase 15 — Rediseño de la interfaz y sección de Ayuda

Pedido: llevar la interfaz y la experiencia de uso al nivel siguiente, y sumar
una guía de uso. Al presentar el plan, el usuario fijó un principio que terminó
reorganizándolo entero: **«no quiero que ocultes ninguna info ni manejarme por
urls; el sistema tiene que estar pensado para gente que por lo general no usa
mucho la PC»**.

Eso descartó dos propuestas que ya estaban escritas —pestañas en el detalle de
reserva y acordeones de preguntas frecuentes en la Ayuda— y obligó a mirar
cuánto del sistema actual contradecía ese principio. Bastante.

### 15.1 · La acción principal de cada módulo estaba escondida

El hallazgo que justificó reordenar el plan: había **11 bloques `<details>`
plegados**, y lo que escondían era exactamente esto:

> Registrar un huésped nuevo · Registrar una agencia o empresa · Registrar un
> proveedor nuevo · Dar de alta un usuario · Crear una orden de trabajo ·
> Redactar un contrato nuevo · Registrar un objeto encontrado · Editar datos…

Es decir: quien entraba a Huéspedes veía una lista y **no encontraba cómo
agregar uno**, porque "Registrar un huésped nuevo" parecía un título.

Los once se eliminaron. Cada módulo tiene ahora un **botón primario visible en
el encabezado** que lleva a una pantalla propia de alta o edición: una sola
tarea a la vez, campos anchos y un botón de guardar imposible de no ver. Ocho
pantallas nuevas entre altas y ediciones.

### 15.2 · Formularios para quien no vive frente a una pantalla

- **Etiquetas visibles en todos los campos.** Varios se identificaban solo por
  el `placeholder`, que desaparece al escribir: quien se distrae ya no sabe qué
  estaba cargando, y el lector de pantalla no siempre lo anuncia.
- **Ayuda donde el dato tiene consecuencias.** La condición frente al IVA define
  la letra de la factura y hoy explota recién al facturar; ahora se explica
  debajo del campo. Lo mismo con el descuento de una agencia, que define la
  tarifa neta.
- **Botón Cancelar** junto a Guardar: antes no había forma de salir sin usar el
  navegador.
- **Al terminar, la aplicación no salta sola a otra pantalla.** Confirma qué
  pasó y ofrece las continuaciones como botones —«Ver su ficha», «Registrar
  otro», «Volver al listado»—. Que la vista cambie sin aviso desorienta.

### 15.3 · El doble clic que duplicaba operaciones

Corrección de una medición propia: se había reportado que «solo 1 de 20
formularios avisa que está procesando». Falso —12 usan `useActionState` y sí
avisan—; el escaneo buscaba `useFormStatus` y no lo detectaba. El problema real
estaba en los `<form action={…}>` de componentes de **servidor**, que no pueden
usar ese hook: ahí el botón quedaba igual después de apretarlo y un segundo clic
impaciente **repetía la operación**.

`app/panel/_components/boton-envio.tsx` resuelve eso con `useFormStatus` en la
pieza mínima de cliente: se bloquea, muestra un girador y cambia el texto. Se
aplicó a lo que mueve dinero o no tiene vuelta atrás —registrar pago, facturar,
cambiar de estado, mudar de unidad, movimientos de cuenta corriente— y de paso
pide **confirmación** antes de cancelar una reserva, marcar un no-show, borrar
un aviso o congelar un contrato al enviarlo a firmar.

Es una red de seguridad de interfaz, no la garantía: las reglas que impiden
facturar dos veces siguen en el dominio y en la base.

### 15.4 · Sección de Ayuda

Nueva área `/panel/ayuda`, visible para **todos los roles** —quien más necesita
el manual es justamente quien menos permisos tiene—. Contiene primeros pasos,
una guía por módulo y un glosario de los términos que el sistema usa sin
explicar (rack, neto, no-show, in house, CAE, ADR, RevPAR).

El contenido vive en `lib/domain/ayuda.ts`, no dentro de la pantalla, por dos
razones. La primera es la de siempre: se puede testear. La segunda es concreta
—**una guía que miente es peor que no tener guía**—: si a alguien de
housekeeping se le explica cómo facturar, va a buscar un botón que no existe y
va a concluir que el sistema está roto. Por eso `guiaPara(rol)` filtra con los
**mismos permisos** que arman el menú, en lugar de mantener dos listas que se
desincronizan, y hay un test que lo verifica para los cuatro roles.

Todo el contenido está a la vista, sin acordeones: obligar a descubrir dónde
hacer clic para leer una explicación es agregarle un problema a quien ya tenía
uno.

### 15.5 · Base compartida

`Pagina` fija un ancho único: las pantallas usaban cinco anchos distintos
(`max-w-2xl` a `7xl`) y el contenido saltaba de lugar al navegar. `Campo`,
`CAMPO`, `PieDeFormulario` y `ExitoConPasos` centralizan lo que cada formulario
repetía a mano.

**Verificación:** **307 tests en verde** (32 archivos), typecheck y lint
limpios. Las 16 rutas nuevas y modificadas responden 200 y se comprobó en el
navegador que ya no queda ningún `<details>` escondiendo un alta.

---

## 2026-08-06 · Fase 15.6 — Detalle de reserva, esqueletos y pantalla de "no encontrado"

Cierre de los puntos que quedaban del rediseño.

### Detalle de reserva a dos columnas

Eran **ocho bloques apilados** en una sola columna: para facturar había que
recorrer toda la pantalla. Siguiendo el principio fijado —nada oculto— no se
usaron pestañas ni acordeones: ahora son **dos columnas con todo a la vista al
mismo tiempo**, y en el teléfono se apilan en el mismo orden.

El corte quedó por tema, no por tamaño: **a la izquierda la reserva y qué hacer
con ella** (huésped, estadía, acciones de estado, reprogramar, cambiar de
unidad); **a la derecha la plata** (pagos, consumos y factura). Los bloques ya
estaban agrupados así en el archivo, con lo cual no hubo que reordenar nada:
solo insertar los límites de columna.

De paso la pantalla adoptó `Pagina`, `Encabezado` y `Mensaje` en lugar del
markup propio que arrastraba.

### Esqueletos de carga por sección

Había **uno solo**, con forma de tablero —encabezado, cuatro KPIs y un bloque
grande—, y se usaba para todas las secciones. Un esqueleto que no se parece a lo
que después aparece es peor que uno neutro: la pantalla "salta" al reemplazarse
y da sensación de error.

`_components/esqueletos.tsx` define cuatro formas —listado, detalle a dos
columnas, tablero y formulario— y **25 archivos `loading.tsx`** las conectan a
la sección que corresponde.

### Pantalla de "no encontramos eso"

Antes caía la genérica de Next, en inglés y sin salida: quien llegaba por un
enlace viejo quedaba varado. Ahora explica qué pudo haber pasado y ofrece tres
salidas (inicio, buscar en reservas, ayuda).

Nota honesta: en desarrollo la respuesta llega con estado 200 en lugar de 404
porque el streaming de Next ya envió la cabecera antes de llamar a `notFound()`.
La pantalla que ve el usuario es la correcta; el código de estado conviene
verificarlo en producción.

### Alta de reserva

Pasó al sistema de diseño y el primer paso quedó **numerado** ("1 · ¿Para
cuándo?"): quien no usa mucho la computadora necesita saber cuántos pasos
faltan, no descubrirlo. Cuando no hay disponibilidad, en lugar de una línea de
texto aparece un estado vacío con un enlace a la grilla de ocupación.

**Un tropiezo del entorno, no del código:** a mitad de la verificación todas las
subrutas empezaron a dar 404, incluidas las que funcionaban minutos antes. Es el
manifiesto de rutas viejo de Turbopack, ya anotado en `CLAUDE.md`; se resolvió
borrando `.next` y reiniciando. Conviene recordarlo antes de salir a buscar un
bug inexistente.

**Verificación:** **307 tests en verde**, typecheck y lint limpios. En el
navegador se comprobó que el detalle muestra los siete bloques a la vez, que las
siete acciones bloquean el botón mientras procesan y que cancelar y no-show
piden confirmación nombrando la reserva.

---

## 2026-08-06 · Fase 15.7 — Consistencia: ancho único, etiquetas y últimas vistas

Pasada final de coherencia sobre lo que quedaba disparejo. Se midió primero, en
lugar de suponer.

### Un solo ancho de página

Diez pantallas todavía elegían el suyo (`max-w-2xl` … `7xl`), con lo cual el
contenido se corría de lugar al navegar. Todas pasaron a `Pagina`.

`Pagina` ganó una tercera variante, `ancho`, **con motivo**: la grilla de
ocupación es un calendario y necesita mostrar la mayor cantidad de días posible.
Que sea la excepción declarada en el componente, y no un `max-w-7xl` suelto en
la pantalla, es lo que evita que la excepción se propague por copiar y pegar.

### Los últimos campos sin etiqueta

Quedaban tres formularios donde el campo se identificaba **solo por el
placeholder**: el alta de productos en Configuración ("Precio USD", "Stock",
"Mínimo"), el plan de mantenimiento preventivo y el titular de la reserva
grupal. Los tres pasaron a `Campo` con etiqueta visible, y donde el dato tiene
consecuencias se agregó la explicación —el stock mínimo es lo que dispara el
aviso de reposición en el tablero—.

### Reserva grupal

Última vista con markup propio. Pasó al sistema de diseño y los pasos quedaron
numerados —1 fechas, 2 unidades, 3 titular—, igual que en el alta individual.
Cuando no hay disponibilidad, en lugar de una línea de texto aparece un estado
vacío con enlace a la grilla.

La **factura** se dejó a propósito con su markup propio: es un documento pensado
para imprimir, con su propio ancho y sus reglas `print:`. Meterla en el sistema
de diseño del panel no la mejoraría.

### El mismo tropiezo, dos veces

Durante la verificación `/panel/ocupacion` empezó a dar 404 mientras las otras
18 rutas respondían bien, con los archivos correctos y el typecheck en verde. Es
otra vez el manifiesto de rutas de Turbopack; se resolvió reiniciando el
servidor. **Es la segunda vez en el día**: conviene reiniciar antes de salir a
buscar un bug en el código.

**Verificación:** **307 tests en verde**, typecheck y lint limpios. Las **19
rutas del panel** responden 200 y se comprobó en el navegador que las etiquetas
nuevas y los pasos numerados aparecen.
