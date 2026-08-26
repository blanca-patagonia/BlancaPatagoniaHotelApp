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

---

## 2026-08-06 · Fase 16 — Portal público

El panel quedó consistente, pero el portal —lo que ve el huésped— no había
recibido nada de ese trabajo. Y ahí cambia quién está del otro lado: no es staff
entrenado con sesión iniciada, sino alguien que llegó por un enlace de un email,
muchas veces desde el teléfono y a veces con apuro.

### Un hallazgo que costaba reservas

Buscando disponibilidad para septiembre de 2026 el portal contestaba **"sin
disponibilidad"** en todas las opciones. Había lugar: lo que faltaba era la
**tarifa** de ese período (el tarifario cargado es 2025/2026).

El código mezclaba las dos cosas en un solo campo:

```ts
disponible: t.disponibles > 0 && !cot.faltanTarifas
```

Con lo cual un olvido administrativo —no cargar precios de un período— se le
comunicaba al huésped como *"el hotel está lleno"*. La persona se iba a buscar
a otro lado y **nadie en el hotel se enteraba de que había perdido esa venta**.

Ahora son dos campos separados, `hayLugar` y `hayPrecio`, y cada combinación
dice la verdad: si hay lugar y precio, se reserva; si no hay lugar, se avisa; y
si hay lugar pero falta la tarifa, se ofrece **consultar** con un correo
prearmado en vez de cerrar la puerta. Las opciones reservables se ordenan
primero.

No es un problema de interfaz: es una regla de negocio que estaba mal expresada
y que solo se veía usando el portal como lo usaría un huésped.

### Una marca sola en todo el recorrido

Buscar, reservar y confirmar se veían como **tres sitios distintos**: cada
pantalla se dibujaba su propio encabezado, con anchos distintos. `_publico/ui.tsx`
define ahora el marco común —cabecera con la marca, contenido y pie con los
horarios—, además de tarjeta, campo con etiqueta, botón y avisos.

Son componentes **distintos de los del panel**, a propósito: tipografía más
grande, menos densidad y áreas de toque mayores. El staff usa el sistema todos
los días; el huésped, una vez.

### Otras mejoras

- **Confirmación de reserva:** el código pasó a ser el elemento principal de la
  pantalla —es el único dato que la persona necesita después de cerrarla— y se
  aclara que la reserva **todavía no está confirmada** hasta la seña, algo que
  antes se leía al pasar en letra chica.
- **Checkout:** el resumen va arriba del formulario. Quien está por dar sus
  datos quiere confirmar primero qué reserva y cuánto sale. Se explica que no se
  cobra nada en ese momento.
- **Pantalla de enlace vencido** (`app/not-found.tsx`): el caso frecuente no es
  alguien escribiendo mal una dirección, sino un enlace que ya no sirve
  —encuesta respondida, reserva cancelada, o un correo que cortó la URL en dos
  líneas—. Esas personas no se equivocaron en nada, así que el texto no las
  trata como si lo hubieran hecho.
- **Contrato a firmar:** el texto pasó de `text-sm` a tamaño de lectura con
  `max-w-prose`. Es un documento que hay que leer entero antes de aceptarlo;
  achicarlo empuja a firmar sin leer.
- **Portada:** los servicios salen de `lib/domain/hotel.ts`, el mismo lugar del
  que los toma el asistente, para que no queden dos respuestas conviviendo.

Firma y encuesta se dejaron con su tratamiento propio: son pantallas de una sola
tarea a las que se llega desde un correo, y ahí el foco sin distracciones es
mejor que la navegación completa. Entre ellas ya eran coherentes.

**Verificación:** **307 tests en verde**, typecheck y lint limpios. En el
navegador se comprobó el recorrido completo con dos rangos de fechas: con tarifa
cargada permite reservar y muestra el precio; sin tarifa ofrece consultar y
explica el motivo, en lugar de decir que está lleno.

---

## 2026-08-06 · Fase 17 — Por qué el CI nunca terminó en verde

El workflow escrito en la Fase 12 nunca se había ejecutado en un runner real.
En lugar de esperar a que fallara y leer el log, se **reprodujo la condición del
CI en la máquina local**: `supabase db reset` deja la base como la deja
`supabase start` en el runner, y desde ahí se corrió la suite.

### La causa

`supabase start` aplica migraciones y seed, pero **el seed no crea perfiles**:
los usuarios se crean con la API de auth, que necesita el `service_role`. Eso lo
hace `scripts/seed-usuarios.mjs`, y el workflow nunca lo llamaba.

Sin ningún perfil, los tests de facturación fallan por la clave foránea de
"quién emitió el comprobante". Reproducido:

```
FAIL tests/acciones/reservas.test.ts
Error: No hay ningún perfil en la base. `npx supabase db reset` borra los
usuarios de auth: hay que correr `npm run seed:usuarios` después.
```

Es decir: **el CI falla desde la Fase 12.1**, cuando se agregaron los tests de
Server Actions. El mensaje explícito que se había puesto ese mismo día —en lugar
del `expected [] to have a length of 2` original— fue lo que permitió
identificarlo de una sola lectura.

### El segundo problema, escondido detrás del primero

Agregar el paso no alcanzaba: el script se invoca con
`node --env-file=.env.local`, y **ese archivo no existe en el runner** porque
está en `.gitignore`. Con `--env-file` Node aborta si el archivo falta:

```
node: .env.local: not found
```

Se cambió a `--env-file-if-exists`, que continúa sin él. En local no cambia
nada —el archivo existe y se sigue leyendo—; en CI las credenciales llegan por
`GITHUB_ENV`.

### Otros ajustes preventivos

- **Guarda sobre las credenciales.** Si el CLI cambiara el formato de
  `status -o env`, las variables quedarían vacías y la falla aparecería después
  y disfrazada: los tests dirían "falta la base" y el build, "URL inválida".
  Ahora se corta en el paso que las lee, mostrando la salida recibida.
- **`concurrency` con `cancel-in-progress`:** varios push seguidos apilaban
  corridas que competían por el runner.
- **`timeout-minutes: 25`:** si `supabase start` se cuelga esperando a Docker,
  sin esto la corrida queda tomada hasta el límite por defecto de 6 horas.
- **`supabase status` cuando algo falla**, para tener diagnóstico en el log.

**Verificación:** se corrieron los seis pasos del workflow localmente, con la
base recién reseteada y **sin `.env.local`**, que es exactamente la situación
del runner: credenciales exportadas y validadas, administrador creado,
typecheck, lint, **307 tests en verde** y build. El YAML se parseó para
confirmar que los 12 pasos quedan bien declarados.

Queda una sola cosa fuera de alcance: que esto corra de verdad en GitHub. Todo
lo verificable desde acá está verificado.

---

## 2026-08-07 · Fase 17.1 — El CI en verde, por fin

Cierre de la Fase 17. La corrida **#31 terminó en verde**: la primera de 31.

### Cómo se llegó, sin poder leer los logs

Los logs de Actions piden autenticación y desde este entorno devuelven 403, así
que el diagnóstico se hizo con la **API pública**, que sí expone el estado de
cada paso. Eso alcanzó, y de hecho fue más rápido que leer un log entero.

**Corrida #28** (antes de tocar nada) — el detalle paso a paso mostró algo
valioso: `Levantar Supabase local` y `Exportar credenciales` **en verde**. Las
dos cosas que se habían marcado como "sin verificar" desde la Fase 12 —que
Docker levantara el stack en el runner y que el parseo de `status -o env`
funcionara— andaban bien. El único paso roto era `Tests`, exactamente el que
rompe la falta del perfil.

**Corrida #30** (con el paso del seed agregado) — falló en el paso nuevo, en
**menos de un segundo**. Ese dato fue el que resolvió el caso: una falla de red
o de servicio no listo habría tardado más, y las credenciales ya estaban
probadas por la #28. Una falla instantánea solo se explicaba porque Node
rechazaba la línea de comandos: el paso usaba `npm run seed:usuarios`, que lleva
`--env-file-if-exists`, opción que existe desde Node 20.12, y el workflow pedía
`node-version: 20`.

**Corrida #31** — con el seed invocado como `node scripts/seed-usuarios.mjs`,
sin depender de la versión de Node, los 12 pasos pasaron en 3 min 40 s.

### Lección para el proyecto

El CI estuvo roto **desde la Fase 12.1** sin que nadie lo notara, porque nunca se
miró. Un workflow que no se verifica no es una red de seguridad: es una etiqueta
verde que da falsa tranquilidad —o, en este caso, una roja que se ignora—.

Lo que finalmente permitió identificarlo de una lectura fue el mensaje explícito
que se había puesto en `tests/acciones/reservas.test.ts` el mismo día que el
problema apareció en local, en reemplazo del `expected [] to have a length of 2`
original. **El costo de un error que no explica nada se paga más tarde y con
intereses.**

**Estado:** CI verde y verificado en GitHub. Los 307 tests, incluidos los de
integración con `EXIGIR_DB=1`, corren de verdad en cada push.

---

## 2026-08-07 · Fase 18 — Bugs encontrados usando el sistema

Un recorrido manual completo del panel encontró cinco problemas que **307 tests
en verde no veían**. Vale registrarlo como está: los tests cubren reglas de
dominio y Server Actions, pero nadie había recorrido el sistema como lo recorre
alguien que trabaja con él.

### El más caro: «USD 0» al reservar

El buscador mostraba **USD 0** para las diez unidades y recién al confirmar
avisaba «No hay tarifa cargada para esas fechas», aunque el tarifario tuviera
todos los precios.

La causa no era la que parecía. El mapeo fecha → temporada **sí existe**
(`temporada_rangos`), pero los rangos cargados llegaban hasta el **2026-06-01**
y el sistema corre en agosto de 2026: ninguna temporada cubre la fecha actual,
así que no hay tarifa aplicable. Y **no había pantalla** para verlo ni
corregirlo: el dato vivía solo en la base.

Tres arreglos, en capas distintas:

1. **La interfaz deja de mentir.** El dato `faltanTarifas` ya llegaba al
   formulario y se ignoraba. Ahora la unidad sin tarifa dice «Sin tarifa
   cargada», queda deshabilitada, y si ninguna cotiza se avisa arriba con el
   enlace a dónde corregirlo. El mismo arreglo se había hecho en el portal
   público en la Fase 16 y **quedó sin replicar en el panel**.
2. **Pantalla de temporadas** (`/panel/config/temporadas`), con lo que faltaba.
3. **`lib/domain/temporadas.ts`**, con `huecosDeCobertura`: la función que
   responde *«¿desde cuándo el sistema no va a poder cotizar?»*. Es lo que
   convierte el problema en algo que se ve antes, y no cuando lo descubre un
   huésped.

La pantalla muestra primero **hasta cuándo se puede vender** y los tramos sin
temporada, y recién después la lista de períodos. El solape lo impide la base
—restricción de exclusión GiST, igual que el anti-overbooking— y su rechazo
(`23P01`) se traduce a una explicación.

### Huésped huérfano

Si la reserva fallaba, el huésped quedaba creado sin reserva asociada. Se
cotiza ahora **antes** de tocar la tabla, con lo cual el caso más común se
rechaza sin escribir nada; y si aun así falla —la unidad se ocupó entre la
búsqueda y el alta— se revierte, pero **solo si lo creó esa misma llamada**:
borrar uno preexistente destruiría la ficha de alguien que ya se alojó.

### El formulario se vaciaba

React limpia el formulario después de una Server Action, así que un error en un
campo obligaba a reescribir todo. La acción devuelve los valores y se reponen.

### Stock bajo con dos verdades

El tablero decía «4 productos con stock bajo» y Configuración decía 0. Los
cuatro eran **servicios** —excursiones, traslados— con `stock` en `null`: el
tablero comparaba `Number(null ?? 0) <= 0`, verdadero para todos ellos. Cada
pantalla escribía su propia condición. La regla pasó a
`lib/domain/inventario.ts`.

### Lo que no se pudo reproducir

La pestaña «Consultas del sitio» funciona: autenticado,
`?vista=consultas` cambia el contenido. Lo más probable es que la sesión se
hubiera vencido durante el recorrido —un `db reset` previo las invalidó— y el
clic rebotara al login.

**Prueba de que los tests tienen filo:** se desactivaron las dos defensas del
huésped huérfano y el test falló con «quedó un huésped sin reserva asociada».

**Verificación:** **334 tests en verde** (34 archivos), typecheck y lint
limpios. El circuito se probó de punta a punta en el navegador: se cargó el
período faltante desde la pantalla nueva y el buscador pasó de «USD 0» a
mostrar precios reales (435,60 · 471,90 · 504,57) en las nueve unidades.

---

## 2026-08-07 · Fase 19 — Experiencia de uso

Últimos puntos del recorrido manual. Se midió antes de implementar, y la
medición cambió dos de las tres decisiones.

### Buscador global

Lo que faltaba de verdad. Recepción atiende un llamado y tiene que encontrar a
la persona **mientras está al teléfono**, sin adivinar si está cargada como
huésped, como reserva o como cuenta de agencia. Ahora hay una caja en el
encabezado, presente en todo el panel, que busca a la vez por apellido, nombre,
email, documento y código de reserva.

`lib/domain/busqueda.ts` define **qué puede buscar cada rol**, apoyándose en los
mismos permisos que arman el menú. No alcanzaba con que la pantalla no muestre
un módulo: si el buscador consultara todo, alguien de housekeeping podría
escribir un apellido y ver datos que su navegación no le ofrece. La seguridad
real la sigue imponiendo RLS; esto evita pedir lo que no corresponde. Hay un
test que lo verifica para los cuatro roles.

También se escapan los comodines `%` y `_`: sin eso, buscar «%» devolvía el
sistema entero.

### Confirmaciones: la medición cambió el plan

El pedido era agregar *toasts* después de cada acción. Al medirlo, de **31
acciones** que redirigen sin `?ok=`, casi todas ya confirman de otra manera: la
lista se actualiza a la vista (cambiar el estado de una habitación mueve su
etiqueta, quitar un consumo borra la fila) o pasan un conteo que la página
muestra («se generaron N órdenes», «se enviaron N recordatorios»).

El hueco real era **uno**: publicar un aviso. El campo se vaciaba y no quedaba
nada en pantalla; sin mensaje no había forma de distinguir «se publicó» de «no
pasó nada». Ahora confirma.

Se optó por **mensaje persistente y no por toast**, siguiendo el principio que
fijó el usuario para todo el proyecto: *no ocultar información*. Un aviso que se
desvanece a los tres segundos es justamente información que desaparece, y quien
menos maneja la computadora es quien más probablemente se lo pierda.

### El nombre repetido

El encabezado mostraba el nombre y el rol siempre, y con el administrador de
desarrollo ambos son «Administrador». El rol se muestra ahora solo cuando aporta
algo distinto del nombre.

**Verificación:** **342 tests en verde** (35 archivos), typecheck y lint
limpios. En el navegador: el encabezado muestra «Administrador» una sola vez y
tiene el buscador; buscar con una letra pide más, con texto sin coincidencias
avisa, y buscando «Pér» encuentra a los huéspedes cargados.

---

## 2026-08-13 · Mantenimiento — Traspaso a la organización y documentación al día

Sin cambios de código: se movió el repositorio a su lugar definitivo y se puso al
día lo que se lee antes de abrirlo.

### El repositorio pasó a una organización

El proyecto vivía en la cuenta personal `octi35` y se transfirió a la
organización **`blanca-patagonia`**. Al mismo tiempo se corrigió el nombre, que
arrastraba un error de tipeo desde el primer día: `BlancaPatgoniaHotelApp` →
**`BlancaPatagoniaHotelApp`** (faltaba la «a» de Patagonia).

La entrada del 2026-06-14 sigue diciendo `BlancaPatgoniaHotelApp` **a
propósito**: en esa fecha ese era el nombre real del remoto. Esta bitácora es un
registro cronológico, y corregir hacia atrás un dato que en su momento fue
cierto la volvería menos confiable como fuente para la tesis. El nombre viejo se
documenta acá, en la fecha en que cambió.

Efecto colateral: el badge de CI del README se reapuntó dos veces —primero por el
dueño, después por el nombre—, porque su URL incluye ambos.

### `main` quedó protegida

Se configuró un *ruleset* sobre `main`: no acepta escrituras directas, exige
**pull request** y que el check **`verificar`** termine en verde. La consecuencia
práctica es que ningún cambio entra a `main` sin haber pasado typecheck, lint,
los 342 tests con base real y el build.

**Decisión:** se mantiene el ruleset aun cuando el agente tenga permiso de
escritura sobre el repositorio. La tentación era desactivarlo para agilizar, pero
es justamente la única barrera automática que impide romper `main`, y el costo es
solo un PR intermedio. Lo que **no** se agrega es la exigencia de aprobación
humana: obligaría a una intervención manual en cada cambio sin sumar garantía
técnica alguna.

### Documentación al día

Los tres archivos que describen el proyecto se habían quedado atrás y son lo
primero que lee cualquiera que entre al repositorio, tribunal incluido:

- **README** reescrito: tabla de las doce áreas implementadas con su alcance
  real, las garantías que impone la base (anti-overbooking por exclusión GiST,
  RLS en las 33 tablas, auditoría *append-only*, límite de tasa de la migración
  0029) y una sección **«lo que todavía no está»** con el mismo peso que lo
  hecho. Sin esa sección, un README que enumera «pagos» y «facturación
  electrónica» deja creer que el sistema cobra dinero y emite CAE de verdad,
  cuando los cinco adapters son *stubs*. La guía de puesta en marcha se corrigió
  con los tropiezos reales de levantar el entorno desde cero: el `.env.local` se
  completa **antes** del seed, y de las varias URLs que imprime
  `npx supabase status` la que va es la de la API, no la de Storage/S3.
- **`docs/roadmap.md`**: cortaba en la Fase 8. Se completaron las fases 8 a 19 y
  la auditoría de seguridad (que lleva numeración propia y arranca de nuevo en
  Fase 0), a partir de esta bitácora.
- **`CLAUDE.md`**: decía «307 tests» en dos lugares siendo **342**, marcaba la
  Fase 8 «en curso» estando terminada y no mencionaba los ADR 0014 y 0015. Un
  número desactualizado en el archivo de contexto es peor que no tenerlo: se
  arrastra a cada resumen y de ahí a la tesis.

**Verificación:** CI en verde sobre `main` — 35 archivos, **342 tests**,
typecheck, lint y build, con Supabase levantado y `EXIGIR_DB=1`. Los datos del
README se comprobaron contra el código y no de memoria: los tests contados sobre
`tests/`, las 33 tablas con RLS sobre `supabase/migrations/`, y cada módulo de la
tabla verificado en `app/` y `lib/`.

---

## 2026-08-13 · Fase 2 de la auditoría de seguridad — Cuatro bugs leyendo el código

A diferencia de la Fase 18, que salió de recorrer el sistema a mano, estos cuatro
salieron de **leer el código**. Ninguno se ve usando la aplicación: tres de ellos
solo aparecen si se le pega directo a la API, y el cuarto solo cuando la base
falla.

Nota de método: la auditoría de RLS que iba a ser esta fase no se pudo hacer.
Requiere ejecutar las políticas contra una base con los cuatro roles —«activada»
no es «correcta»— y en el entorno de trabajo no se pudo levantar Supabase: el
*pull* de las imágenes muere con 403 contra las CDN de los registries, bloqueadas
por política de egreso. Queda pendiente, y se cambió de rumbo a buscar bugs en
código, que sí se puede sin base.

### Los precios de agencia eran públicos

`cotizar_estadia` (migración 0008) tenía tres propiedades que, juntas, abrían el
agujero: recibe `p_tarifa_tipo` y devuelve `precio_neto` cuando vale `'neto'`,
**no** es `security definer` —corre con los privilegios de quien llama— y tiene
`grant execute … to anon`, porque el portal la necesita.

La aplicación siempre manda `'rack'` en las rutas públicas, pero eso no defiende
nada: la clave publicable viaja en el bundle del navegador **por diseño**. Un POST
a `/rest/v1/rpc/cotizar_estadia` con `'neto'` devolvía, noche por noche, los
precios que el hotel negocia con las agencias (ADR 0004). No es un dato personal,
es un dato comercial, y de los que se defienden solos: una agencia que ve la
grilla de netos negocia distinto.

**Decisión — la guarda va sobre `current_user`, no sobre `rol_actual()`.** Parece
un detalle y es el corazón del arreglo: `rol_actual()` sale de `perfiles` vía
`auth.uid()`, y para `service_role` eso es NULL porque no hay perfil detrás de la
clave del servidor. Con `rol_actual() is not null` se habría roto el cotizado neto
del servidor **y** el test de integración que ya lo cubría. PostgREST cambia el rol
de Postgres según la credencial, así que `current_user` distingue exactamente lo
que hay que distinguir. Migración **0030**.

A `anon` que pida neto se le devuelve rack, en silencio y sin error: ningún
llamador legítimo pide neto sin sesión, y un error solo le confirmaría a quien
sondea que encontró algo.

**Queda abierto** el otro camino al mismo dato: `grant select on all tables … to
anon` (0006) más la política de lectura pública de `tarifas` sin cláusula `to`
permiten `GET /rest/v1/tarifas?select=precio_neto`. Cerrarlo exige revocar por
columna **y** hacer la función `security definer` a la vez, porque Postgres pide
privilegio sobre toda columna referenciada aunque la rama del `CASE` no se
ejecute: un `revoke` a secas tiraría abajo la cotización del portal entero. Está
documentado dentro de la migración 0030 y pide su propio ADR.

### El webhook de pagos fallaba abierto

Para una pasarela, un `200` significa «entregado, no reintentes». El handler
cuidaba el `insert` de `pagos` —chequeaba el error, manejaba la idempotencia del
23505— y después descartaba el resultado de la transición a `pagada`.

Escenario: entra un pago aprobado que salda la reserva, el pago **se registra**, el
`update` falla (deadlock, timeout, corte) y se responde `ok`. Plata cobrada,
reserva sin marcar, sin reintento y sin aviso.

**El agravante era peor que el bug:** como la fila de `pagos` ya existe con su
`external_id` único, reenviar el evento a mano entraba por el atajo del 23505 y
devolvía `{ok, duplicado}` **sin volver a intentar la transición**. La
inconsistencia era permanente: no había forma de repararla. Los dos `select`
previos tenían el mismo problema —si fallaba la lectura, el resumen daba «no
saldada» y se salteaba la transición por un problema de infraestructura—.

**Decisión:** toda operación de base responde 500, que es el único modo de pedir el
reintento, y la conciliación corre **también** cuando el evento viene repetido. Así
reenviar el evento pasa de ser un atajo que impedía la reparación a ser el
mecanismo de reparación.

Queda deliberadamente igual: una reserva anulada y saldada no se transiciona. Qué
hacer con esa plata es decisión del hotel, no del webhook.

### Inyección de condiciones en los filtros `or`

El término del usuario se interpolaba pelado dentro de `or=(…)`, donde **la coma
separa condiciones** y los paréntesis agrupan. Buscar `x,id.gt.0` dejaba de ser una
búsqueda y pasaba a ser un filtro elegido por quien escribe.

El escape que había cubría `%` y `_`, que son los comodines de **LIKE**: otra capa,
otro problema. Son dos y hay que atravesar las dos. Se agrega `patronOr()` en
`lib/listados.ts`, que encierra el patrón entre **comillas dobles** —el mecanismo
que PostgREST admite para valores con caracteres reservados— y escapa `\` y `"`.

Seis sitios, incluido el buscador global, que filtra por `doc_numero`. Las llamadas
`.ilike('col', …)` **no** estaban afectadas: ahí el valor viaja como parámetro y no
como sintaxis.

**Alcance real, dicho sin inflar:** RLS seguía imponiendo qué filas ve cada rol, así
que esto no cruzaba un límite de autorización; lo que se podía era ensanchar o
romper el filtro dentro de lo ya permitido. Se arregla igual porque la barrera no
debe ser un solo control.

### El `<details>` número 12

La Fase 15 eliminó los 11 que escondían acciones, pero quedó uno en `config`:
escondía el contenido de cada plantilla de correo **y** un formulario con acción de
servidor. Son 4 plantillas, así que quedan desplegadas.

**Verificación:** CI en verde sobre `main` con base real — 36 archivos, **358
tests**, cero salteados. Los 8 tests del webhook usan base **falseada** a propósito,
y es la herramienta correcta y no un atajo: lo que se prueba es qué pasa *cuando la
base falla*, y eso no se puede provocar contra una Postgres sana. Se comprobó que
sirven como regresión —contra el código anterior pasan los 4 comportamientos que ya
eran correctos y fallan exactamente los 4 de fallo cerrado—; un test que pasa en las
dos versiones no prueba nada. Y `cotizacion.test.ts` corrió con 4 tests en vez de 2:
los dos nuevos consultan con la **clave publicable**, que es el único modo de ver el
sistema como lo ve internet, y confirman que la guarda del neto no rompió el
cotizado rack del portal.

---

## 2026-08-13 · Fase 20 — Ningún fallo de escritura en silencio

Continúa el principio de la Fase 15 —*nada oculto*— pero del lado del resultado: no
alcanza con que la pantalla no esconda nada si, cuando la base rechaza una
escritura, no lo dice.

### El problema

Las acciones que devuelven estado podían informar un fallo con
`return { error: … }`, pero las que redirigen no tienen valor de retorno, y eso
derivó en **38 escrituras** cuyo resultado se descartaba:

```ts
await supabase.from('avisos').delete().eq('id', id)
redirect('/panel/avisos')
```

Si la base rechazaba —por RLS, por un trigger, por un corte— la pantalla recargaba
sin cambios y **sin un solo mensaje**. Quien lo usa no podía distinguir «no se
pudo» de «no pasó nada», que es exactamente lo que el proyecto decidió no hacer.

Que era un hueco y no una decisión de diseño se ve dentro de un mismo archivo: en
`avisos`, `publicarAviso` sí devolvía `{ error }` y las dos acciones void al lado
descartaban el suyo.

### Decisión: dos helpers, y no son intercambiables

`lib/acciones.ts`:

- **`cortarSiFalla(error, destino, motivo)`** — redirige a `destino?error=<motivo>`
  con la convención que el panel ya tenía. El mensaje real de la base va al **log
  del servidor y no a la URL**: al usuario le sirve saber qué operación falló, no
  leer `duplicate key value violates unique constraint`; sin el log, en cambio, la
  causa se perdería y el fallo sería imposible de diagnosticar.
- **`registrarFalla(error, contexto)`** — loguea sin cortar. Hace falta para las
  **compensaciones**: el rollback del huésped cuando el alta de la reserva falla no
  debe redirigir, porque taparía `res.error`, que es el motivo real. También para
  lo accesorio, donde cortar sería peor que seguir.

No hace falta mapear cada motivo nuevo: las pantallas traen fallback
(`MENSAJES_ERROR[x] ?? 'No se pudo completar la operación.'`), así que sumar un
motivo nunca deja al usuario sin respuesta.

### Los casos que merecen nombre propio

**Factura.** El `insert` de `facturas` ocurre **después** de pedir el CAE al
proveedor y de consumir el número correlativo del punto de venta. Si se perdía en
silencio quedaba un CAE emitido y un número gastado **sin factura**, con la pantalla
como si no hubiera pasado nada. La correlatividad es una obligación formal (ADR
0015): el mensaje avisa que el número ya se usó, antes de que alguien reemita.

**Firma.** Dos escrituras encadenadas: la constancia y el estado. Si se guardara
«firmado» sin la constancia, el contrato quedaría firmado **sin evidencia**.
`cortarSiFalla` lanza, así que la segunda no corre si falló la primera.

**Pago en el panel.** El mismo fallo que tenía el webhook. Acá hay alguien mirando
la pantalla, pero solo si se le dice.

**Puntos y totales.** El check-out o la mudanza ya se hicieron. Se corta igual:
perder los puntos de un huésped, o quedar facturando la unidad anterior, son
problemas reales que avisando se arreglan a mano.

### Bugs preexistentes que aparecieron revisando los destinos

Ajenos a los fallos silenciosos, y estaban desde antes:

1. `cambiarEtapaAgencia` mandaba `?error=etapa` y `?ok=etapa` **desde que existe**,
   y `/panel/agencias` no los renderizaba: el rechazo de la regla comercial —no se
   puede saltear de «contacto» a «activa»— era invisible.
2. `agencias/[id]` y `proveedores/[id]` no recibían `searchParams`, así que el
   `?ok=datos` que sus acciones ya mandaban al guardar nunca se vio.
3. `/panel/mantenimiento` solo renderizaba el motivo `plan` y `/encuesta/[token]`
   solo `puntaje`: los otros que las acciones ya usaban —`limite` e `invalida`— no
   se mostraban, así que un huésped que chocaba con el límite de respuestas por
   hora no veía nada y creía que el formulario estaba roto.

Y una colisión introducida durante la fase y corregida: se usó el slug `producto`
en `config`, que ya significaba «revisá el nombre y el precio». Pasó a
`producto_estado`, o la pantalla habría mostrado el mensaje equivocado.

### Lo que esta fase NO arregla

**Un mensaje de error no arregla la atomicidad.** En los flujos de varios pasos de
`reservas`, si falla el paso 3 los datos ya quedaron a medias. Mostrar el error es
estrictamente mejor que el silencio —la inconsistencia pasa de invisible a
revisable— pero resolverlo de verdad pide mover esos flujos a una **función SQL
transaccional**. Está anotado en el código donde corresponde, no tapado, y es el
siguiente paso natural.

El asistente sigue fallando **abierto a propósito**: inserta en `consultas_bot`, que
es el registro y no la respuesta al huésped. El ADR 0011 fijó que pasado el límite
«sigue respondiendo y deja de registrar»; cortarle la respuesta a un huésped real
porque no se pudo guardar el log sería el intercambio equivocado. Ahora usa
`registrarFalla`, así que la decisión queda explícita en el código en vez de
parecer un descuido.

**Verificación:** **363 tests**, typecheck, lint y build limpios, y CI en verde
sobre base real. Dos comprobaciones mecánicas sobre el árbol final: no queda
**ninguna** escritura cuyo error se descarte —el detector que encontró las 38
devuelve 0— y los **28 motivos** en uso tienen mensaje mapeado, salvo `firma`, cuyo
fallback dice exactamente «No pudimos registrar la firma», que es el texto
correcto. Uno de los 5 tests del helper existe porque armaba mal la URL cuando el
destino ya traía query string (`?canal=X?error=…`), detectado al aplicarlo a
conversaciones y antes de propagarlo a 38 sitios.

---

## 2026-08-13 · Fase 2 de la auditoría (2.ª parte) — El neto, fuera del alcance público

Cierra el pendiente que la migración 0030 había dejado anotado: el **segundo
camino** al precio de agencia, `GET /rest/v1/tarifas?select=precio_neto`.

**Por qué no se hizo junto con la 0030.** Porque el arreglo obvio rompe el portal.
`cotizar_estadia` menciona `t.precio_neto` en su `CASE`, y Postgres exige
privilegio sobre toda columna referenciada **aunque la rama no se ejecute**: un
`revoke` a secas haría fallar la función para `anon` y tiraría abajo la cotización
pública entera.

### La trampa que se evitó

El camino obvio era hacer la función `security definer`. Habría resuelto el
privilegio **y habría desactivado en silencio la guarda de la 0030**: dentro de una
función definer, `current_user` es el **dueño** de la función y no quien la llama,
así que `current_user <> 'anon'` habría quedado siempre en verdadero y `anon`
habría vuelto a recibir el neto.

Lo peor no es el error sino que **el test seguiría en verde**: prueba el resultado
con la clave publicable a través de una función que ya no distinguiría nada. Un
arreglo que reabre el agujero que vino a cerrar y encima se reporta como
verificado.

### Decisión: dos funciones, cada una con un solo trabajo

En vez de una función que decide a quién le muestra qué, hay una que **nunca toca
la columna sensible** y otra a la que `anon` **no llega**:

- `cotizar_estadia_publica` — solo rack, no menciona `precio_neto`, y por eso
  funciona sin privilegio sobre esa columna. Es la que usa el portal.
- `cotizar_estadia` — sin cambios, y se le revoca el `execute` a `anon`.
- `tarifas` — se revoca el `select` de tabla a `anon` y se otorga **por columna**
  sobre todas menos `precio_neto`.

Ninguna es `security definer`: no hay privilegio elevado que auditar. Y la garantía
es más fuerte que una guarda por parámetro —no es que la función se niegue a
devolver el neto, es que el rol público no puede ni ejecutarla ni leer la columna—.
Migración **0031**, **ADR 0016**.

Revocar la tabla entera habría sido más simple y habría roto el asistente del
portal, que lee `precio_rack` como `anon`. De ahí el grant por columna.

**Lo que este arreglo deja escrito sobre el modelo de seguridad:** RLS filtra
**filas**, y esto era una **columna**. La frase «RLS activado en las 33 tablas» no
cubre la exposición por columna, y conviene tenerlo presente al leer el README.

**Verificación:** 4 tests con la **clave publicable** —el único modo de ver el
sistema como lo ve internet—: que `anon` no pueda ejecutar la función que conoce el
neto, que no pueda leer la columna, que **sí** pueda leer `precio_rack` (el
asistente depende de eso) y que la cotización rack del portal siga dando los mismos
precios cruzando temporadas. **365 tests**, typecheck, lint y build limpios.

⚠️ Como en toda esta fase, la migración **no se pudo probar en el entorno de
trabajo** —sin Docker no hay base— y la verificación real es la corrida de CI.

---

## 2026-08-13 · Fase 21 — Catálogo público de alojamientos

**Resumen:** el portal tenía un buscador pero no una vitrina. Se agregan
`/alojamientos` y `/alojamientos/[codigo]`.

### El hueco

`/reservar` **exige elegir fechas antes de mostrar nada**. Quien todavía no
decidió cuándo viaja no tenía forma de ver qué ofrece el hotel: la portada
enumeraba servicios en texto y nada más. En Booking se puede mirar sin
comprometerse, y este portal existe justamente para reducir la dependencia de las
OTAs —que hoy concentran el 79 % de las reservas—. Pedirle a alguien que invente
unas fechas para poder mirar es perder la visita.

### Qué se hizo

- **`/alojamientos`** — los 10 tipos con foto (o cabecera de marca), descripción,
  capacidad, comodidades y «desde USD X». Filtro Todos / Hostería / Cabañas.
- **`/alojamientos/[codigo]`** — detalle con qué incluye, **tabla de precios por
  temporada con las fechas de cada una**, horarios, política de cancelación y
  otras opciones de la misma categoría.
- **Puntos de entrada:** la portada pasa a ofrecer dos caminos —«Ver alojamientos»
  para quien viene a mirar, «Consultar fechas» para quien ya decidió— y `/reservar`
  suma un enlace al catálogo.
- **`/reservar?tipo=`** destaca el alojamiento del que viene el visitante, sin
  ocultar el resto: si justo ese está lleno, la alternativa es la venta.

El contenido sale de la base. `tipos_unidad` ya guardaba `descripcion` y
`amenities`, así que el catálogo no duplica textos en el código: si el hotel
corrige una descripción desde el panel, cambia también en el portal.

### Dos bugs que se evitaron, y valen más que la pantalla

**1. Los precios se publicaban sin IVA.** `tarifas.precio_rack` se guarda **sin
IVA** (ADR 0004: se discrimina y se calcula en el dominio), pero el checkout sí lo
suma vía `calcularEstadia`. Volcar la columna cruda en el catálogo habría
publicado USD 177 para una Doble Standard en alta cuando el checkout cobra
**214,17**. El huésped lo descubre al momento de pagar: reclamo en el mostrador y
reseña mala. Se agrega `conIva()`, con el mismo redondeo que el motor de precios
para que el «desde» y el total no difieran ni por un centavo.

**2. La tabla de temporadas mostraba un día de más.** Los rangos de Postgres son
`[desde, hasta)` con el **fin excluido**. Volcarlos tal cual decía que la
temporada alta va «01/11 al 01/12», cuando la última noche a ese precio es el
**30/11** y el 1 de diciembre ya se cobra como media. No es formato: es un precio
equivocado publicado en el sitio. `textoRango()` resta el día, con tests que
cubren el cruce de mes y de año.

### Decisiones

**Sin fotos, y no se nota.** El sitio del hotel está bloqueado por la política de
egreso del entorno (403 al CONNECT), así que no se pudieron incorporar imágenes.
En vez de dejar recuadros grises, la portada sin foto es un diseño terminado: el
degradé de marca y la silueta del logo. Un placeholder roto le dice al huésped que
la página está a medio hacer, y de ahí a desconfiar del formulario de reserva hay
un paso. `FOTOS` en `lib/domain/catalogo.ts` tiene las diez líneas comentadas con
los nombres de archivo: cuando el hotel las entregue, se copian en
`public/alojamientos/` y se descomenta. Cero cambios de código.

**No se copió el mockup de Stitch.** Era otro sistema —serif dorada, fondo oscuro,
`amber`— y la paleta del proyecto es `lago`/`calafate`/`lenga`/`stone`. Se tomó la
idea (tarjetas, filtro, precio, CTA) y se vistió con el diseño propio.

**El filtro va en la URL**, así que se puede compartir «solo cabañas» y el botón
«atrás» hace lo que uno espera. Un valor inesperado cae en «todas» en vez de dejar
la pantalla vacía.

Encaja con la migración 0031 del mismo día: el catálogo lee `precio_rack` y el rol
público **no puede** leer `precio_neto`. La vitrina pública y el modelo de
permisos coinciden sin excepciones.

**Verificación:** **386 tests** (21 nuevos sobre el dominio del catálogo: filtro,
orden, «desde», IVA y rangos de fecha), typecheck, lint y build limpios.

---

## 2026-08-13 · Fase 22 — Revisión del código: dos bugs en la cara al huésped

Barrido sistemático buscando errores, no funcionalidades. Los dos hallazgos están
en el **asistente del portal**, que es justamente la parte que le habla al huésped
sin que ningún empleado revise lo que dice.

### El asistente informaba precios sin IVA, afirmando que los incluía

`lib/asistente/index.ts` leía `precio_rack` crudo y armaba el rango de tarifas. La
columna se guarda **sin IVA** (ADR 0004) y el checkout lo suma vía
`calcularEstadia`, así que el bot respondía «las tarifas van de USD 120 a USD 340
por noche **(con IVA)**» cuando el checkout cobra de 145,20 a 411,40.

Lo grave no es el número bajo: es que **el texto afirma «con IVA»**. No era un dato
incompleto, era una afirmación falsa, dicha por escrito y sin intervención humana.
Se arregla pasando por `conIva()`, el helper que se había creado el mismo día para
el catálogo, y se suma el filtro `vigente` que faltaba.

### El asistente anunciaba un día de más en cada temporada

`describirTemporadas` imprimía `hasta` tal como viene del `daterange`, que tiene el
**fin excluido**: decía «Temporada alta del 15/11 al 16/03» cuando la última noche
a ese precio es el **15/03** y el 16 ya se cobra como media.

Lo que hace interesante al hallazgo: **la pantalla del panel ya lo hacía bien**
(`app/panel/config/temporadas/page.tsx` resta el día con `sumarDias(p.hasta, -1)`).
El mismo concepto estaba resuelto correctamente para el staff y mal para el
huésped. No fue un descuido de quien escribió el asistente, fue que la convención
vivía en una pantalla y no en un lugar compartido.

Los tests **fijaban el bug**: `expect(texto).toContain('16/03')` daba verde porque
16/03 aparece además como inicio de la temporada siguiente — pasaba por casualidad,
no por estar bien. Se reemplaza por una prueba que afirma la semántica (`al 15/03`
y `not.toContain('16/03')`), más el caso del cruce de mes.

### Lo que se revisó y está sano

Se barrieron las clases de error que este proyecto ya conoce, y las cuatro dieron
cero: escrituras que descartan el error, interpolación en filtros `or`, `<details>`
escondiendo acciones y embeds de `huespedes` sin la clave foránea explícita. Las
divisiones del código de dinero están todas guardadas (ADR/RevPAR y NPS cortan
antes de dividir por cero). Las seis consultas que parecían construidas sin
ejecutar resultaron falsos positivos: se resuelven dentro de un `Promise.all`. Y
las pantallas de checkout y confirmación muestran totales que **sí** incluyen IVA.

### Dos cosas que quedan anotadas y NO se tocaron

**Zona horaria.** `lib/fechas.ts` trabaja en UTC y lo declara. Para un hotel en
Santa Cruz (UTC−3) eso significa que entre las 21:00 y la medianoche el sistema ya
cuenta el día siguiente. Impacta donde hay plata: el cargo por cancelación depende
de los días de anticipación, así que una cancelación a las 22:00 puede caer en el
tramo equivocado. Arreglarlo bien no es cambiar `hoyISO()`: las funciones SQL
(`expirar_reservas_pendientes`, `vencer_contratos`) usan la fecha de la base, y
tocar solo el lado JavaScript dejaría la aplicación y la base discrepando. Pide su
propia fase y un ADR.

**Lecturas que descartan el error.** La Fase 20 dejó en cero las escrituras, pero
del lado de la lectura hay **56 consultas** que no capturan el error contra 18 que
sí. Una lectura fallida no rompe: renderiza el estado vacío, así que un problema de
base se ve como «no hay datos». Es menos grave que el equivalente en escritura
—nada se pierde— pero puede hacer creer que un listado está vacío cuando no lo
está.

**Verificación:** **387 tests**, typecheck, lint y build limpios.

---

## 2026-08-14 · Fase 3 de la auditoría — Las migraciones, por fin aplicadas contra una base real

**Resumen:** la Fase 3 de la auditoría de seguridad se escribió en un entorno **sin
Docker**, así que sus tres migraciones (`0032`, `0033`, `0034`) quedaron escritas y
**nunca aplicadas** — el propio `docs/audit/HANDOFF.md` lo declaraba como el P0
bloqueante. Al correrlas por primera vez contra Postgres apareció que la `0032`
**no podía aplicarse nunca**. Se corrigió, se aplicaron las cuatro y se verificó
todo lo que dependía de ellas.

### El bug: un valor de enum recién agregado no se puede usar todavía

La `0032` hacía dos cosas en un mismo archivo:

```sql
alter type rol_usuario add value if not exists 'sin_rol';   -- línea 34
alter table perfiles alter column rol set default 'sin_rol'; -- línea 37
```

Postgres rechaza la segunda con **SQLSTATE 55P04** («unsafe use of new value of
enum type»): un valor agregado a un enum no se puede usar hasta que la transacción
que lo agregó haya commiteado. Y el CLI de Supabase aplica **cada archivo de
migración dentro de una sola transacción**. Resultado: `supabase db reset` cortaba
en la `0032` y **no aplicaba nada de lo que venía después** — es decir, ninguna de
las correcciones de seguridad de la Fase 3 llegaba a la base.

Es el tipo de error que no se puede encontrar leyendo: el SQL es válido, la lógica
es correcta y la revisión humana lo aprueba. Solo aparece al ejecutarlo. Es
exactamente el argumento de la regla de bloqueo del handoff: *SQL sin aplicar es
riesgo acumulado, no trabajo hecho.*

**Corrección:** la `0032` queda con el `alter type` solo, y todo lo que **usa** el
valor —los dos defaults y la reescritura del trigger `manejar_nuevo_usuario`— se
mueve a la nueva `0035_defaults_sin_rol.sql`. Al ser archivos distintos, cada uno
commitea y el segundo ya encuentra el valor disponible. La intención de seguridad
no cambió en nada; cambió dónde está escrita.

> ⚠️ El número `0035` estaba **reservado en el plan** para la restricción única
> sobre `facturas.reserva_id` (P0 #2 del handoff). Esa migración pasa a ser la
> `0036`.

### Lo verificado, ya con base

| Qué | Resultado |
|---|---|
| `npx supabase db reset` | **35 migraciones + seed** aplican de punta a punta |
| `npm test` con `EXIGIR_DB=1` | **486 pasan · 0 salteados** (47 archivos) |
| `npm run typecheck` · `npm run lint` · `npm run build` | limpios |
| `GET /api/salud` | `{"estado":"ok","base":"ok"}` |
| Portal, catálogo, login y panel en el navegador | responden; `/panel` redirige a login |

Con esto quedan cerrados los puntos **1, 4, 5, 8, 9 y 10** de la tabla «Corregido en
esta rama» de `docs/audit/00-pendientes.md`, que estaban marcados «⚠️ sin Docker».

### Los 4 tests que salteaban en silencio, y por qué importan

`EXIGIR_DB=1` convierte la falta de base en un error, pero solo mira `hayDB`
(`tests/db.ts:20`). La bandera `hayAnon` depende además de
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, y **vitest no lee `.env.local`**. Sin esa variable
exportada a mano, los 4 tests del borde público —los que verifican el ADR 0016:
que `anon` no pueda ejecutar `cotizar_estadia` ni leer `precio_neto`— se saltean
localmente sin decir nada.

En CI no pasa: el workflow la exporta desde `supabase status -o env`
(`.github/workflows/ci.yml:72`). Es un agujero **solo local**, pero es el mismo
patrón que la Fase 17 ya había pagado caro. Queda anotado en `AGENTS.md`.

### Entorno

Se rehízo la puesta en marcha en Windows: el `node_modules` que venía en el
traspaso era de macOS (`@next/swc-darwin-arm64`, `@tailwindcss/oxide-darwin-arm64`),
así que `npm ci`. También se completó `.env.example` con `EMAIL_PROVIDER`,
`FIRMA_PROVIDER` y `FACTURACION_PROVIDER` (ADR 0018), que era la tarea #3 de la
lista del usuario en el handoff: el entorno anterior tenía bloqueada la escritura
sobre archivos `.env`.

**Decisión registrada:** no se abrió ADR. Dividir la `0032` no cambia ninguna
decisión de arquitectura —el ADR 0017 sigue describiendo exactamente lo que hace el
esquema—, solo corrige cómo está empaquetada. El motivo queda en el encabezado de
las dos migraciones, que es donde lo va a leer quien las toque.

---

## 2026-08-14 · Fase 23 — El portal público con patrones de Booking (A · B · C)

**Resumen:** primera de tres tandas de mejoras de interfaz en el portal del
huésped, tomando los patrones que hacen efectivo a Booking.com y adaptándolos a
la escala del hotel. **No se tocó el panel** (es otro sistema de diseño, ADR 0009)
ni el motor de precios, ni disponibilidad, ni las Server Actions: todo el cambio
es de presentación.

### A · Fundación: un formato de precio, señales y fotos

**El bug que estaba a la vista de todos.** El portal escribía los importes con
`monto.toLocaleString('es-AR')`, que usa **entre 0 y 3 decimales**. La tarifa base
de USD 120 más el 21 % de IVA da 145,2 y se publicaba **«USD 145,2»**, al lado de
«USD 168,19» y de «USD 120». Tres formatos en la misma columna, y uno de ellos con
cara de número cortado. Se centraliza en `lib/domain/moneda.ts` (`importe`,
`formatearUSD`, `porNoche`), con dos decimales siempre. El panel repite el mismo
`toLocaleString` en unos 30 lugares: queda anotado, no se migró de paso.

**Fotos.** `FOTOS` estaba vacío y `public/` solo tenía los SVG del starter de Next,
así que los patrones que dependen de imagen no se podían ni evaluar. Se cargaron
**10 portadas de muestra** de Pexels (licencia libre, sin atribución obligatoria),
elegidas revisando una por una: se descartaron una con vista a una ciudad, otra con
las almohadas marcadas de otro hotel y otra con decoración del sudeste asiático.
⚠️ **No son fotos del hotel**; están documentadas como muestra en `catalogo.ts` y
se reemplazan pisando los archivos, sin tocar código.

### B · El buscador dejó de ser una pantalla y pasó a ser un elemento

Patrón: en Booking la búsqueda acompaña siempre. `app/_publico/buscador.tsx` es un
único componente que va en la portada (grande, es la acción principal) y como barra
adherida arriba de `/reservar` y `/alojamientos`. Antes la portada tenía dos botones
y ningún campo, y el catálogo no tenía forma de consultar fechas sin volver.

**Sobre «colapsable en móvil», que choca con una regla del proyecto.** El principio
fijado es *nada oculto, pensado para gente que no usa mucho la computadora*; un
buscador reducido a una lupa lo incumple. La resolución: en el teléfono se colapsa,
pero lo que queda visible **no es un ícono, es la búsqueda escrita** —«10 abr — 13
abr · 2 huéspedes»— dentro de un botón rotulado. En escritorio no se colapsa nunca.
Sigue siendo `method="get"`: la búsqueda vive en la URL, se comparte y anda sin
JavaScript.

### C · Los resultados, con foto y con el precio que se compara

Las filas de texto de `/reservar` pasan a tarjetas con portada, y el precio adopta
la jerarquía de Booking: **por noche en grande** —que es con lo que se compara entre
opciones— y el total con IVA debajo, que es lo que se paga.

### El hallazgo: una alerta de urgencia que iba a mentir todos los días

`disponibilidadPorTipo` ya devolvía `disponibles` y el portal lo estaba tirando
—solo miraba `> 0`—, así que la señal de escasez se podía construir con **el dato
real**, sin inventar nada. La primera versión avisaba con 3 o menos: «Quedan 2
habitaciones», «Queda 1 cabaña».

Al verlo renderizado apareció el problema: **salía en las nueve opciones**. El
inventario son 15 unidades en 10 tipos, y **seis tipos tienen una sola unidad** (las
cinco cabañas y la Suite). «Queda 1 cabaña» no informaba escasez, informaba el
inventario, y lo iba a mostrar todos los días del año aunque no hubiera ni una
reserva: cada palabra cierta y el conjunto dando a entender algo falso. Además, una
alerta presente en el 100 % de los resultados deja de ser una alerta.

Se corrigió la regla (`lib/domain/senales.ts`): habla **solo cuando queda una**, con
tono suave y como hecho —«Última libre en estas fechas»—, no como cuenta regresiva.

⚠️ **Pendiente honesto:** aun así la insignia aparece siempre en las cinco cabañas,
porque tienen una unidad. Para el patrón completo —«quedan pocas» comparado contra
el total del tipo— hace falta que `disponibilidadPorTipo` devuelva también cuántas
unidades tiene el tipo, y eso es una **migración**: `unidades` no es legible por el
rol público. No se resolvió de contrabando con `service_role` en una pantalla
pública. Decisión de producto pendiente con el usuario.

### Un test que fijaba una situación, no un contrato

`tests/catalogo.test.ts` afirmaba que `fotoDe` devolvía `null` **para todo**, porque
`FOTOS` estaba vacío. Eso no era el contrato de la función —resolver el código al
archivo de su portada— sino el estado transitorio de no tener fotos. Se reescribió
para verificar lo que la función promete.

### Falsa alarma, anotada para que no se repita

La captura de pantalla en móvil mostraba el contenido cortado y parecía scroll
horizontal, que este proyecto prohíbe. Medido en el navegador por CDP:
`scrollWidth === clientWidth === 390` y **cero** elementos desbordados. El corte era
del método de captura —Edge headless en Windows no achica la ventana por debajo de
~500 px y después recorta—. Para mirar el móvil hay que **emular el dispositivo**
(`Emulation.setDeviceMetricsOverride`), no encoger la ventana.

**Verificación:** `npm run check` exit 0 · **499 tests** (eran 486; +13 de `moneda` y
`senales`) · portada, catálogo, resultados y detalle revisados en escritorio y en
móvil emulado.

---

## 2026-08-16 — Modernización WinPAX · Paso 1: cotización de divisas

**Resumen:** se cerró la tarea que el ADR 0003 dejó abierta hace un año. El sistema
ya sabe convertir USD a pesos (y a reales y euros), con fuente pública, respaldo
manual y la garantía de que una API caída no frena un cobro.

**Contexto:** el cliente venía de **WinPAX** (Oracle Forms, ~año 2000) y se está
modernizando el sistema para cubrir sus funciones core. El recorrido inicial del
repo produjo un inventario de 11 pasos, documentado en
[`docs/modernizacion-winpax.md`](modernizacion-winpax.md), que es la lista viva del
trabajo. Este es el primero.

**Por qué este paso primero:** el [ADR 0003](decisiones/0003-moneda-usd-ars.md) decidió
en julio «USD base + ARS a cotización configurable» y terminó anotando *«hace falta un
mecanismo para cargar/actualizar la cotización (Fase 3/4)»*. Nunca se hizo. No era una
función nueva: era una decisión de arquitectura abierta. El Tarifario manda cobrar a
«la cotización oficial de venta billete del Banco Nación del día de pago» y ese número
no existía en ninguna parte del código.

**Detalle de lo realizado:**
- `lib/domain/divisas.ts` — reglas puras: validación de la entrada externa, frescura
  con dos umbrales, conversión en ambas direcciones y resolución de la vigente.
- `lib/divisas/index.ts` — **sexto adapter** del proyecto (`CotizacionProvider`), con
  DolarAPI, ArgentinaDatos y modo manual, elegidos por `COTIZACION_PROVIDER`.
- `lib/divisas/servicio.ts` — la cadena de respaldo completa: caché en memoria →
  fuente externa → última guardada → USD.
- Migración `0036_cotizaciones_de_divisas.sql` — historial con idempotencia por clave
  natural, RLS de solo lectura para staff e inserción reservada a admin/gerencia.
- `app/api/cotizacion/route.ts` — endpoint interno propio, con sesión obligatoria.
- Widget en el dashboard (en `Suspense`, para no demorar el panel) y carga manual en
  la pantalla de configuración.
- [ADR 0020](decisiones/0020-cotizacion-de-divisas.md).

**Decisiones tomadas** (el detalle y el porqué de cada una están en el ADR):
1. **Se cobra al valor de venta**, no al de compra: lo dice el Tarifario, y usar el de
   compra le regalaría el spread (~4 %) a cada huésped que pague en pesos.
2. **Una cotización vencida se usa igual, avisando.** Ningún camino del código bloquea
   una operación por falta de cotización: si nada hay, se muestra USD, que es la moneda
   real del sistema. Requisito explícito del usuario.
3. **Un valor manual reciente le gana a uno automático viejo** — se elige por frescura,
   sin privilegiar la fuente. La carga manual es una corrección deliberada de alguien
   mirando el pizarrón del banco.
4. **Historial, no valor mutable**: el ADR 0003 pide trazabilidad de la cotización usada
   el día de pago. No hay `update` ni `delete`; se corrige cargando el valor correcto.
5. **Se declara que DolarAPI no es el Banco Nación**, sino un tercero que replica su
   valor. Para una tesis la precisión importa; el camino con respaldo documental del
   banco es la carga manual.

**Hallazgo del recorrido inicial, que vale registrar:** WinPAX guardaba número de
tarjeta, vencimiento, autorización y **PIN**. Este sistema **no guarda nada de eso** en
ninguna tabla: `pagos` tiene sólo `medio`, `monto`, `estado` y el `external_id` de la
pasarela. No hay nada que migrar a un flujo tokenizado — el trabajo es *no agregarlo*.
El único riesgo real es que alguien pegue un número de tarjeta en `pagos.nota` o
`reservas.notas`, que son texto libre; quedó anotado como deuda.

**Verificación:** `npm run check` exit 0 · **62 tests nuevos** (`tests/divisas.test.ts`
38 y `tests/divisas-proveedor.test.ts` 24), 537 pasan y 43 saltean sin base local.
Los tests del adapter cubren el borde que no controlamos: ceros, `null`, importes como
texto, el par compra/venta invertido, 500, 429, timeout, HTML en vez de JSON y la caída
de la segunda pata del cruce de monedas.

---

## 2026-08-16 — Modernización WinPAX · Pasos 2 a 11

**Resumen:** se completaron los once pasos del inventario funcional contra WinPAX. Ocho
migraciones nuevas (`0036`–`0043`), todas aplicadas y verificadas contra la base local.
**882 tests verdes, cero salteados.**

El plan completo, con las decisiones de cada paso y su porqué, está en
[`docs/modernizacion-winpax.md`](modernizacion-winpax.md). Acá queda el registro de lo
que cambió y las cuatro cosas que conviene recordar.

**Lo hecho, en una línea por paso:**

- **2 · Grilla de ocupación.** Fila resumen por día (ocupadas, libres, llegadas, salidas, pax, %)
  y accesibilidad: cada estado con **letra + color**, no sólo color.
- **3 · Toggles del listado.** Diez vistas operativas (en el hotel, llegadas hoy, salidas hoy…),
  columna de saldo y totales al pie. Requirió columnas generadas en `estadias`.
- **4 y 5 · Canales / Booking.** Se enchufó el puerto que estaba huérfano: cuatro tablas, lector
  del informe CSV del extranet, feed iCal, y pantalla con las entrantes, los mensajes y las
  reseñas. [ADR 0021](decisiones/0021-canales-de-venta-solo-lectura.md).
- **6 · Ficha de reserva completa.** VIP, adultos/menores/bebés, camas extra, cunas, plan,
  garantía, segmento, voucher, «no mover», descuento y desglose fiscal.
- **7 · Punto de venta.** Grilla por departamento con buscador, total en vivo y número de comanda.
- **8 · Folios y departamentos.** Folio A/B con split, jerarquía de departamentos, cargos en otra
  moneda con la cotización registrada.
- **9 · Housekeeping móvil.** «Mi trabajo»: las habitaciones ordenadas por prioridad real, con el
  motivo escrito y un botón por tarjeta.
- **10 · Piso y bloque.** Filtros y orden de recorrido en la grilla, más acciones rápidas.
- **11 · Respaldos.** Exportación completa de los datos operativos, con el alcance declarado.

**Cuatro cosas que conviene recordar:**

1. **Sobre las tarjetas de crédito.** WinPAX guardaba PAN, vencimiento, autorización y **PIN**.
   Este sistema no guarda nada de eso y no se agregó: `pagos` registra el medio y el `external_id`
   de la pasarela. No había nada que migrar a un flujo tokenizado — el trabajo era *no agregarlo*.
   Hay un test en el lector de CSV de Booking que lo fija como contrato.

2. **La trampa del enum se esquivó.** El paso 8 iba a necesitar dos migraciones por el SQLSTATE
   55P04. No hizo falta: el departamento/subdepartamento es una **jerarquía**, y un enum plano no
   la representa por más valores que se le agreguen. Fue una tabla y una sola migración. La regla
   de `AGENTS.md` sigue vigente para el futuro; acá no aplicaba.

3. **La sincronización con Booking NO evita el overbooking, y el sistema lo dice.** Los dos
   caminos disponibles sin ser partner certificado (CSV e iCal) son de solo lectura: nadie le
   informa a Booking qué queda libre. La pantalla lo advierte con ícono y texto, el puerto lo
   declara en `capacidades()` y `ResultadoEnvio.noSoportado` distingue «no puedo» de «fallé».
   Callarlo habría generado confianza falsa sobre lo más caro que le puede pasar al hotel.

4. **Los respaldos: la app no puede hacer un backup de Postgres.** Lo hace la plataforma y no hay
   API para pedirlo desde acá. Un botón que dijera «hacer backup» sin hacerlo sería la peor
   función del sistema. En su lugar, la pantalla explica quién es responsable de qué, exporta los
   datos operativos a un archivo verificable y registra cuándo fue la última vez.

**Bug preexistente corregido de paso:** `lib/pricing/cotizar.ts` siempre creaba su propio cliente
con `cookies()`, así que `crearReservaEnUnidadLibre` —que recibe un cliente justamente para poder
correr con `service_role`— quedaba atada a una petición HTTP. No se podía crear una reserva desde
un webhook, un cron ni un test de integración, y el error (`cookies was called outside a request
scope`) no dejaba adivinar la causa. Ahora el cliente se inyecta; sin pasarlo, el comportamiento
es el de antes.

**Áreas nuevas del panel:** `canales`, `punto_venta` y `respaldos`, las tres con su capítulo en la
ayuda, su entrada en la navegación y su icono.

**Verificación:** `npm run check` exit 0 · **882 tests** (66 archivos), cero salteados, con
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` exportadas. Las ocho
migraciones se aplicaron con `npx supabase migration up --local` y se verificó a mano lo que un
test no cubre: que la exclusión GiST del ADR 0002 siga en pie, que `crear_reserva` tenga **una
sola** versión en `pg_proc` (no una sobrecarga), que el trigger de la jerarquía de departamentos
rechace el tercer nivel, que `anon` no pueda leer ninguna de las tablas nuevas, y que las 22
tablas del respaldo existan de verdad.

---

## 2026-08-22 — Booking B7: el calendario que el hotel le publica al canal

**Resumen:** el feed iCal de **salida**. Hasta acá la integración era de una sola
dirección —entraban reservas, no salía nada— y cuando el hotel se llenaba, alguien
tenía que entrar al extranet a cerrar fechas a mano. Eso falla justo el día de mucho
trabajo, que es el día en que el hotel se llena.

**Detalle de lo realizado:**
- `lib/canales/ical-saliente.ts` (puro): `calcularBloquesOcupados`, `generarIcal`
  (RFC 5545 con plegado a 75 octetos y escape de comas) y `describirUltimaLectura`.
- `app/api/canales/ical/[token]/route.ts`: token al portador, límite de tasa,
  `?tipo=` y `?unidad=`, ventana de un año.
- Migración `0065`: `canal_config.ical_leido_en`.
- Nueva vista **Calendario para el canal** en `/panel/canales` con las direcciones
  armadas para copiar, y la advertencia de overbooking **matizada, no borrada**.
- `docs/decisiones/0022-feed-ical-saliente.md`.
- 28 tests nuevos (19 puros + 9 contra la base).

**Decisiones:**
- **Una noche se marca ocupada sólo cuando no queda ninguna unidad activa del tipo
  libre.** Un calendario dice «ocupado», no «me queda una»: cerrar el tipo al vender
  la primera unidad le costaría ventas reales al hotel. La contracara —que con varias
  unidades por tipo el feed avisa tarde— está dicha en la pantalla, tipo por tipo.
- **`capacidades().publicaDisponibilidad` sigue en `false`.** El feed no da ninguna de
  las garantías que ese `true` promete: el canal lo lee cuando quiere y nadie confirma
  que lo aplicó. Angosta la ventana del overbooking; no la cierra.
- **Si la consulta de estadías queda truncada, el handler responde 503 y no sirve un
  calendario parcial.** Un calendario incompleto no se ve roto: se ve como uno con
  menos bloqueos, o sea publicando como libres noches que están llenas.
- El registro de la lectura sí es accesorio: si falla, el calendario se sirve igual.
- **Hallazgo de paso, y era un test de seguridad rompiéndose al azar:**
  `interpretarCsvBooking` estaba documentada como pura pero leía el reloj adentro
  (`emitidaEn` cae en el momento de importación cuando el informe no trae fecha de
  reserva). El test-contrato que verifica que **ningún dato de tarjeta** quede en el
  resultado serializa todo y busca subcadenas, así que fallaba una de cada mil veces:
  los milisegundos formaban «737», el CVC del caso de prueba. Se confirmó el
  mecanismo en vez de suponerlo, el reloj pasó a entrar por parámetro y quedó un test
  que fija la determinismo. Un test de seguridad que falla al azar termina desactivado
  por molesto.
- Se eliminó una guarda de «cero unidades activas» que parecía necesaria: una prueba
  de mutación mostró que borrarla no cambiaba ni un resultado. El camino general ya
  hacía lo mismo.

---

## 2026-08-24 — Relevamiento con el cliente del 15/08: P6, P1, P4, P3 y P2

**Resumen:** Franco (Blanca Patagonia) mandó 8 audios y 12 capturas mostrando WinPAX 9 y el
extranet de Booking. La mayoría de lo que pidió ya estaba hecho; se abordaron los cinco
pedidos que no. Dos migraciones nuevas (`0058`, `0059`), dos ADRs (`0024`, `0025`).
**1351 tests verdes en 81 archivos, cero salteados**, verificados contra una base levantada
**desde cero** con las 59 migraciones. Lint, typecheck y build en verde.

Lo pedido y no hecho quedó en un solo lugar: **P5** (bandeja, comentarios y analytics de
Booking), que **el propio cliente difirió** y que no se arrancó a propósito.

### P6 · La documentación decía tres generaciones atrás

El README hablaba de 486 tests y 35 migraciones cuando había 1292 y 57, y no mencionaba el
módulo de canales —de lo más trabajado del sistema—. `docs/roadmap.md` terminaba en la Fase 21,
así que quien lo leyera concluía que canales no existe.

Se actualizaron README, roadmap, modelo de datos y manual de usuario **verificando cada número
contra el repo**, no copiándolo del pedido: el propio pedido decía «77 archivos de test» y eran
79. El manual pasó de 21 líneas a cubrir el flujo real de canales (bajar el informe, mapear
columnas, conciliar la factura, importar reseñas), con las advertencias que importan: que
Booking es de solo lectura y que `/panel/respaldos` **no es un backup de Postgres**.

### P1 · Exención de IVA al turista del exterior (ADR 0024)

Era lo único del relevamiento que **no estaba implementado en absoluto**. El toggle «con/sin
IVA» del listado es de presentación: no exime a nadie.

La decisión central: **la exención se DERIVA de dos hechos y no hay ninguna casilla que
tildar.** La RG 3971 exige residencia en el exterior **y** pago desde el exterior; un extranjero
que paga en efectivo **no está exento**, y es el error más fácil de cometer a mano. Una casilla
convertiría una regla fiscal en una decisión de quien está apurado en el mostrador.

Tres decisiones más, con su porqué en el ADR:

- **La residencia va en el huésped, el origen del pago en la reserva.** Uno es una propiedad de
  la persona; el otro cambia en cada estadía.
- **`pago_desde_exterior` tiene tres estados, no dos.** «No sé» y «pagó local» son cosas
  distintas aunque las dos cobren IVA. Ante un valor inesperado se cae en `null`: **ante la
  duda, se cobra el impuesto.**
- **Se decide al facturar, no al cotizar.** La forma de pago se conoce recién al cobrar. La ficha
  muestra qué pasaría —«USD 122,89 en vez de USD 148,70»— y la factura aplica. El sentido del
  error importa: cotizar de más y facturar de menos es una corrección a favor del huésped.

En la factura, `exento` es un **subconjunto de `neto`**, no un tercer sumando: así
`neto + iva = total` sigue siendo cierto, que es una garantía que el sistema tiene testeada en
todos lados. Es además cómo lo modela AFIP (`ImpNeto` / `ImpOpEx` / `ImpIVA`).

### P4 · La cotización ya era automática; lo que faltaba era decir de dónde sale

Estaba resuelto desde el ADR 0020: automática, cacheada, con override manual del gerente. Lo que
faltaba era chico y no cosmético: la etiqueta decía **«DolarAPI (oficial)»**, y quien la lee
concluye razonablemente que el número viene del Banco Nación. **El BNA no publica un servicio
para consultarlo**; se usa un tercero que replica el valor.

Ahora la pantalla lo declara: fuente, antigüedad, si es automático o manual, y una línea que
dice que **no es el Banco Nación informando**. La aclaración va junto a la frase que menciona al
BNA en Configuración, que es donde se produce el malentendido.

### P3 · Desayuno vendido suelto: el problema era la cocina, no el cobro

«Llegan a las 9 de la mañana, el check-in es a las 2 o 3 de la tarde, y te dicen si se puede
subir a desayunar. Tiene un costo de 15 dólares.»

Al revisarlo, **cobrarlo ya funcionaba**: el punto de venta lista las estadías activas que tocan
hoy, y una reserva que llega hoy en estado `confirmada` está ahí. El hueco real era otro: la
lista de cocina se arma con **quién durmió anoche**, así que ese cubierto vendido **no aparecía**
y la cocina preparaba de menos — justo el problema que la pantalla existe para evitar.

Ahora `listaDeDesayuno` recibe los desayunos vendidos del día y los suma al total, marcados como
extra y con guion en la columna de unidad cuando el huésped todavía no tiene habitación.

Y se fijó dónde se cierra la cuenta: **en la factura, no en el check-out**. Es lo que permite los
dos casos reales —el que llega temprano y el que desayunó la mañana que se va—. Lo que corta es
el comprobante emitido: un cargo posterior no entraría en él, y `facturas` es inmutable.

### P2 · Verificar la tarjeta sin guardar el número (ADR 0025)

Este pedido **choca con una decisión ya tomada** y se resolvió al revés de como se pidió.

WinPAX guardaba número, vencimiento, autorización y **PIN**. Guardar un PAN sacaría al hotel del
alcance SAQ-A de PCI-DSS; guardar un PIN está prohibido incluso cifrado. Pero la necesidad de
Franco no es *tener el número*: es **saber si la tarjeta sirve para cobrar**. Son cosas distintas
y la segunda se resuelve sin la primera, con preautorización tokenizada.

**El simulador declara que NO puede verificar.** `capacidades()` devuelve
`{ verificaTarjeta: false }` y el resultado trae `noSoportado: true`. Un stub que dijera «válida»
generaría la confianza falsa que el ADR 0021 evitó con el overbooking: recepción dejaría pasar un
check-in confiando en una garantía que nadie comprobó. Por eso `noSoportado` es un campo aparte
de `ok`: «el emisor la rechazó» y «no hay con qué probarla» llevan a acciones distintas.

### Cinco cosas que conviene recordar

1. **La exención no se puede forzar.** No hay campo «exento» en ninguna tabla. Si alguien agrega
   uno, rompe la garantía entera del ADR 0024.

2. **El test-contrato de PCI se vio fallar.** Se agregó a propósito
   `alter table reservas add column tarjeta_numero text;` y la suite se puso en rojo con el
   mensaje correcto; después se revirtió. Un test-contrato que nunca se vio fallar no protege
   nada.

3. **Las barreras contra el PAN son de la base.** La `0059` rechaza 12 o más dígitos seguidos en
   el token y en el detalle. Los comentarios se ignoran; una restricción no.

4. **`create type` sí puede usarse en la misma migración; `alter type ... add value` no.** La
   `0059` crea el enum y lo usa en el mismo archivo, y aplica bien. La regla del SQLSTATE 55P04
   (que motivó dividir la `0032`) aplica solo a agregar valores a un enum **ya existente**.

5. **El typecheck atrapó una colisión de claves real.** `MENSAJES_NO_CARGABLE` usaba `anulada` y
   `ya_facturada`, que ya existían en `MENSAJES_NO_FACTURABLE` con otro significado; al
   combinarse en la ficha, una de las dos explicaciones desaparecía. Se les puso el prefijo
   `cargo_`.

### Un error propio, para que no se repita

La primera versión del bloque de la tarjeta usaba `<details>` para plegar el formulario.
`CLAUDE.md` lo **prohíbe explícitamente** desde la Fase 15 (se eliminaron los 11 que había), y
acá pesaba doble: si la garantía no sirve, cargar otra tarjeta es justo lo que hay que hacer y no
puede estar escondido. Se corrigió a un bloque siempre visible.

### Verificación

`npm run check` exit 0. **1351 tests (81 archivos), cero salteados**, con `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` exportadas. Las dos migraciones se
aplicaron primero con `migration up` y después se verificó lo que de verdad importa: se levantó
el stack **desde cero** (`supabase stop --no-backup` + `start`), las **59** migraciones
aplicaron limpias y la suite completa volvió a pasar. Es el mismo camino que hace el CI.

Además se comprobó a mano, contra Postgres, lo que un test no cubre: que las cuatro
restricciones de la `0059` rechacen un PAN, una verificación sin fecha y un exento mayor que el
neto; y que las de la `0058` rechacen una exención sin fundamento legal.

## 2026-08-24 — Auditoría técnica: los hallazgos aplicados

**Resumen:** se corrieron doce fases de auditoría (arquitectura, seguridad, rendimiento,
escalabilidad, datos, calidad, CI/CD, integraciones, pagos y UX) y acá se aplican los
hallazgos. Cuatro migraciones (`0060`–`0063`), **1389 tests verdes en 84 archivos**, cero
salteados. Las vulnerabilidades de dependencias pasaron de **8 (6 altas) a 1 baja**.

Lo que distingue esta entrada de una lista de mejoras: **cada hallazgo se verificó
ejecutándolo antes de arreglarlo, y se volvió a ejecutar después**. Las sondas están
descritas abajo con su salida real.

### Los dos hallazgos ALTA

**1 · Una mucama podía firmar un contrato en nombre de una agencia** (migración `0060`)

Dos políticas escritas como `rol_actual() is not null` —«cualquiera con sesión»— dejaban
`agencias` y `proveedores` legibles por los cuatro roles, **token incluido**. Verificado
con una sesión de housekeeping, que ni siquiera tiene esas áreas en `permisos.ts`:

```
── housekeeping ──
   agencias    : LEYÓ 1 fila(s) → tokens visibles: 1
   ejemplo: Agencia Sonda = 5f276040-f54b-4505-96a8-1b2569e4f2a4
```

Y el token no es un dato: abre `/portal/<token>`, que muestra la cuenta corriente completa
del socio y enlaza a `/firmar/<token>`, donde `firmarContrato` **no exige sesión**.

Es el escenario que la migración 0034 describe como su razón de ser («un token no es un
dato: es una credencial»), alcanzado por una puerta que quedó abierta.

Al arreglarlo apareció un segundo hallazgo: **el `revoke select (token)` de la 0034 nunca
tuvo efecto.** En Postgres un revoke de columna no recorta un grant de tabla previo —el de
`0006_grants_api.sql`—, y Postgres lo acepta sin error, así que el arreglo *parecía*
aplicado. Comprobado con `has_column_privilege`, que devolvía `true`. La 0060 lo hace de la
forma que sí funciona: quita el grant de tabla y lo repone columna por columna.

Después: los cuatro roles reciben `42501` al pedir el token, la matriz de lectura coincide
exactamente con `lib/domain/permisos.ts`, y el portal sigue funcionando con `service_role`.

**2 · Recepción borraba una reserva y se llevaba la plata** (migración `0061`)

```
ANTES:   {"pagos":1,"consumos":1,"estadias":1}
DELETE como recepción: ACEPTADO
DESPUÉS: {"pagos":0,"consumos":0,"estadias":0}
```

Se fueron USD 150 de seña aprobada, un consumo y la estadía, arrastrados por las cascadas
de las 0009 y 0010. Del borrado de la reserva no quedaba rastro: su trigger de auditoría es
`after update`.

Se revocó `delete` a `authenticated` en las siete tablas donde ninguna pantalla lo usa, y se
sumaron triggers de auditoría de DELETE en `reservas`, `estadias`, `consumos` y los dos
`movimientos_*`. Después: `42501: permission denied for table reservas`, y los tres
registros siguen ahí.

**Las cascadas se dejaron a propósito**, y está argumentado en la migración: el agujero ya
lo cierra el revoke, y para `service_role` una limpieza legítima *tiene* que llevarse los
hijos. Cambiar cuatro claves foráneas era un cambio más grande que el problema.

### Corrección de un error propio en la sonda

La primera versión de la sonda de borrado apuntaba a un **id inexistente**. Eso mide el
GRANT de tabla, **no la política RLS**: una policy que filtra filas devuelve «0 filas, sin
error», idéntico a una que permite. Reportaba «PERMITIDO» en 13 tablas para los cuatro
roles, housekeeping incluido, y habría sido un falso positivo grave. Se rehízo creando filas
reales y comprobando si sobrevivían. **El método importa tanto como el hallazgo.**

### Lo demás, en una línea cada uno

- **Una sola implementación de la IP del cliente.** `ipDePeticion` en `lib/firma` había
  quedado con el bug del primer `x-forwarded-for` que `lib/limites` ya había arreglado.
  Alimentaba el límite del asistente público —evadible rotando la cabecera— y la IP que se
  guarda en `firmas.ip` como constancia de quién firmó: un dato probatorio que elegía el
  propio firmante. Se borró la copia.
- **El proveedor de email ya no loguea el cuerpo.** Es el proveedor por omisión y los
  cuerpos llevan tokens vivos: cada reserva pública dejaba en el log el email del huésped y
  un enlace a su ficha. Ahora van metadatos; el cuerpo solo con `EMAIL_LOG_CUERPO=1`.
- **El webhook de pagos ya no da por aprobado un evento sin estado.** Era
  `?? 'aprobado'`: fail-open sobre dinero. Y el `as EstadoPago` no verificaba nada, así que
  un valor fuera del enum explotaba recién en el insert y la pasarela reintentaba en bucle.
- **Recuperación de contraseña** (`/login/recuperar`). No existía: quien perdía la clave
  dependía de un admin disponible, y hoy hay **un solo usuario**. La respuesta es siempre la
  misma exista o no el email —si no, el formulario es un verificador de cuentas del staff— y
  tiene límite propio de 3/hora. Verificado de punta a punta: el correo llega a Mailpit.
- **Los enlaces del portal se pueden cerrar** (migración `0063`). Dar de baja una agencia
  **no le cerraba el portal**, y un enlace filtrado servía para siempre. Ahora la consulta
  exige `activo` y `token_revocado_en is null`, y hay botones para regenerar y para dar de
  baja el enlace.
- **Tres KPIs dejaron de mentir.** `mantenimiento`, `objetos-perdidos` y el portal contaban
  filas trayéndolas, y PostgREST corta en 1000 **con HTTP 200 y sin aviso**. Verificado
  sembrando 1100 filas: llegaban 1000, `Content-Range: 0-999/*`, sin error. Ahora cuenta la
  base. El portal además traía **todos los tokens de firma del sistema** para usar tres.
- **Índices del listado de reservas** (migración `0062`). Ordena por `creada_en` y filtra
  por `estado`, y ninguna tenía índice. Medido con EXPLAIN sobre 30.000 filas: **2,599 ms →
  0,101 ms**, y de 755 a 27 páginas tocadas.
- **`reservas.canal` dejó de ser texto libre.** Alimenta el reporte de rentabilidad y la
  conciliación de comisiones; un typo creaba un canal fantasma **sin fallar**. El CHECK usa
  exactamente la lista de `CANALES` del dominio, ni un valor de más.
- **La sesión se resuelve una vez por request.** Eran 3 llamadas a Auth y 2 SELECT sobre
  `perfiles`, en serie, antes de empezar. Un `cache()` de React.
- **Quitar un cargo pide confirmación.** Era un `<button>` crudo con `✕`: borrado
  irreversible de dinero, sin confirmar, sin estado de envío y sin nombre accesible.
  `BotonEnvio` ahora acepta `aria-label`.
- **El CI corre en todas las ramas** y tiene `npm audit --audit-level=high`. Había cinco
  ramas divergidas, la mayor con 50 commits sin una sola corrida. Se sumó Dependabot.
- **Next 16.2.9 → 16.3.2.** Cerraba SSRF en Server Actions y exposición no autenticada de
  endpoints internos, entre otras. De 8 vulnerabilidades a 1 baja.

### Tres cosas que conviene recordar

1. **Un `revoke select (columna)` NO recorta un `grant` de tabla previo.** Postgres lo acepta
   sin error y no hace nada. Hay que revocar el de tabla y reponer por columna — y eso rompe
   a quien lea esa columna con el cliente del usuario, así que van juntos.

2. **La matriz de lectura RLS ahora sondea con `id` en las tres tablas con columna revocada.**
   Con `select('*')` daría 42501 para todos, incluido admin, y el test diría «admin no puede
   leer agencias», que es falso. La protección por columna tiene su propio bloque de tests.

3. **El guardián de la auditoría hizo su trabajo.** Al agregar tres casos negativos nuevos, el
   test que verifica que ningún caso pasó «por tabla vacía» los reportó como no auditados —con
   razón—. Hubo que sembrar `agencias` y `proveedores`. Un caso que pasa sobre una tabla vacía
   no prueba nada.

### Verificación

`npm run check` exit 0 · **1389 tests (84 archivos), cero salteados** · **63 migraciones**
aplicadas · `npm audit`: 1 baja. Cada sonda se corrió **antes y después** del arreglo, y las
que crearon datos los borraron.

### Addendum del 2026-08-24 — el stock que no se descontaba

Al verificar un pendiente que estaba anotado como **sospecha** («trigger de stock y
`cambiar_unidad_reserva` como `SECURITY INVOKER`, mismo defecto que la 0033») apareció que
uno de los dos era un bug real y **peor de lo que decía la sospecha**.

Con una sesión de recepción —el rol que carga consumos todos los días—:

```
stock inicial: 50
cargar consumo como recepción: OK        ← sin error
stock después: 50                        ← NO descontó
```

No fallaba: descontaba **cero**. `descontar_stock_consumo()` corre con los privilegios de
quien inserta el consumo, su `update` sobre `productos_servicios` choca con la política
`admin/gerencia gestionan`, RLS filtra la fila y el update afecta cero filas — que para
Postgres es un éxito. El consumo se cobraba y el inventario quedaba mintiendo.

La diferencia con el caso de la 0033 es que aquél **fallaba ruidosamente** (no se podía
emitir ninguna factura, así que se notó) y éste no falla. Por eso duró.

Migración `0064`: `security definer` con `search_path` fijo. Después: 50 → 47.

**`cambiar_unidad_reserva` se probó y no tenía el problema**: devuelve `{"ok":true,...}` con
sesión de recepción. Queda anotado en la migración para que nadie lo «arregle».

El test (`tests/stock-descuento.test.ts`) corre como **recepción y no con `service_role`**:
con el cliente privilegiado el bug no se reproduce porque saltea RLS, y un test que no puede
ver el bug no protege de él. Se comprobó volviendo la función a invoker: la suite se pone en
rojo con «expected 50 to be 47».

**1392 tests verdes en 85 archivos.**

### Addendum del 2026-08-24 — el N+1 de la sincronización de canales

`guardarEntrantes` hacía un `select` por entrante antes de decidir si insertar o
actualizar. Con el insert/update y el devengo de comisión, eran **3·N viajes**: un informe
de 40 reservas, ~125 round-trips en serie. Con el cron (`maxDuration = 60`) eso no era solo
lento — un informe grande podía no llegar a terminar.

Ahora los existentes se traen en **una consulta por canal** antes del bucle: de 3·N a
2·N + 1. Es el mismo patrón que `marcarConflictosDeCupo` ya usaba veinte líneas más abajo.

**Los 20 tests de canales pasaron sin editar una línea**, que es el criterio de terminado
que el propio repo fija para un refactor.

Se sumó un test por el riesgo que introduce el cambio: la identidad de una entrante es
**(canal, external_id)**, no el id solo. Si el mapa se llaveara solo por id, dos canales que
reusaran el mismo número se pisarían y se perdería una reserva. El test falla si alguien
simplifica la clave.

**1393 tests verdes.**

### Addendum del 2026-08-24 — paginación, B9 y registro estructurado

**B9 ya estaba hecho.** Al ir a implementarlo apareció que `app/panel/reportes/page.tsx:193`
ya lee `resumen_canal_mes`, calcula neto y ADR, y ordena **por neto y no por bruto**. Las dos
honestidades que el pendiente exigía también estaban: `—` en vez de `USD 0` para
`directo`/`web`, y el aviso de cuántas reservas no informaron comisión. Era el último pedido
del relevamiento que figuraba abierto; el pendiente estaba desactualizado, no el código.

**Paginación en tres listados** (mantenimiento, objetos perdidos, contratos). Sin ella
PostgREST cortaba en 1000 filas **sin avisar** y el listado se quedaba mudo a partir de ahí.

Dos cosas que aparecieron al hacerlo, y que importan más que la paginación en sí:

1. **Paginar rompe los KPI si se calculaban en memoria.** En contratos, `vigentes`,
   `pendientesFirma` y `porVencer` salían de `contratos.filter(...)`: con paginación habrían
   contado solo las 25 filas visibles y **dirían un número distinto en cada página**. Se
   pasaron a conteos en la base. Es el mismo error que la auditoría encontró antes, con otra
   causa.

2. **Proveedores NO se pagina, y es una decisión escrita en el código.** Esa pantalla filtra
   en memoria por saldo, y el saldo viene de la vista `saldos_proveedores`, no de la consulta.
   Paginar aplicaría el filtro «solo con deuda» sobre la página en vez de sobre todos: el
   resultado sería distinto en cada página y **equivocado, sin fallar**. La tabla es chica
   —decenas de proveedores, no miles—, así que el riesgo de un filtro que miente es peor que
   el de una lista larga. Si crece, primero hay que mover el filtro a la base.

**Registro estructurado** (`lib/registro.ts`). Había ~29 `console.error`/`warn` sueltos, cada
uno con su formato. Eso alcanza mientras alguien mira una terminal y deja de alcanzar el día
del deploy: en un log con varias peticiones entrelazadas no hay forma de saber qué líneas son
del mismo pedido.

Ahora es **una línea JSON por evento**, con el id de la petición (`x-vercel-id`). Sin
dependencias nuevas: lo que un logger aporta acá se reduce a emitir JSON a stdout, que es lo
que cualquier plataforma indexa.

Dos decisiones del módulo:

- **Oculta datos sensibles en dos capas**: por nombre de campo (`token`, `password`, `cvv`…)
  y por contenido (12+ dígitos seguidos → `[oculto]`). La segunda es la que salva cuando el
  dato viaja anidado en un mensaje de error de la base, que es como se cuela de verdad.
- **`registrarErrorSync` existe a propósito.** `cortarSiFalla` tiene que ser síncrona porque
  lanza para **detener** la Server Action; si fuera `async` y alguien olvidara el `await`, el
  redirect no ocurriría y la acción seguiría — un bug peor que el que se registraba. Como
  `headers()` es async en Next 16, esa variante va sin id de petición y se acepta.

**1400 tests verdes en 86 archivos.**

### Addendum del 2026-08-24 — los 23 literales de permisos

`['admin','gerencia'].includes(sesion.rol)` estaba repetido **23 veces en 12 archivos**.
`AGENTS.md` pedía migrarlos a la matriz de `lib/domain/permisos.ts` al tocarlos.

Al hacerlo apareció que **no todos se podían migrar**, y ésa es la parte interesante. Se
comparó cada área contra la matriz antes de tocar nada:

```
agencias      → admin, gerencia, recepcion       ⚠️ migrar CAMBIARÍA permisos
proveedores   → admin, gerencia                  ✅ el literal coincide
contratos     → admin, gerencia                  ✅ el literal coincide
config        → admin, gerencia                  ✅ el literal coincide
mantenimiento → admin, gerencia, housekeeping    ⚠️ migrar CAMBIARÍA permisos
```

Usar `requerirAcceso('agencias')` le habría dado a **recepción** permiso de escritura sobre
cuentas corrientes, y `requerirAcceso('mantenimiento')` se lo habría dado a **housekeeping**
sobre los planes de preventivo. Un refactor «de limpieza» que amplía permisos en silencio es
exactamente lo que no puede pasar en este archivo.

Entonces se partió en dos:

- **12 → `requerirAcceso(area)`**, donde el literal coincidía con la matriz. Tres de esos
  eran además **dobles chequeos redundantes**: `requerirAcceso('proveedores')` seguido del
  literal, que repetía la misma regla y podía divergir de la matriz sin que nada avisara.
- **11 → `requerirRol('admin', 'gerencia')`**, una guarda nueva en `lib/auth/session.ts`. No
  cambia el comportamiento, pero deja **una** implementación en vez de once copias, y sobre
  todo **declara que la restricción es más estrecha que el área a propósito**.

Verificado con la sonda de roles: la matriz de acceso quedó idéntica antes y después.

**La guarda estructural (`tests/autorizacion-acciones.test.ts`) falló al hacer el cambio**, y
con razón: no conocía `requerirRol` y marcó seis acciones como «sin verificar rol». Se le
enseñó la forma nueva, con el porqué escrito en el propio test.

Quedan **0 literales en código** (uno en un comentario que explica la migración).

### Addendum del 2026-08-24 — quién prueba la puerta

El proyecto tenía las dos mitades de la verificación de autorización y le faltaba el medio:

- `tests/permisos.test.ts` prueba `puedeAcceder(rol, area)` — la **regla**.
- `tests/autorizacion-acciones.test.ts` prueba que las 51 Server Actions **llamen** a una
  guarda — análisis estático.
- **Nadie probaba que la guarda rechace de verdad.**

Y el hueco importa: los 29 tests de Server Actions reemplazan `requerirAcceso` por un no-op
que devuelve un admin fijo. Si esa función dejara de redirigir, la suite entera seguiría en
verde.

`tests/guardas-de-sesion.test.ts` cubre el mecanismo: 16 casos sobre `requerirSesion`,
`requerirAcceso`, `requerirRol` y `obtenerSesion`. Entre ellos, los tres que más valen:

- **un usuario dado de baja no tiene sesión** aunque su login siga siendo válido (la garantía
  de la migración 0033);
- **un área apagada no la abre nadie, ni el admin** (`AREAS_OCULTAS`);
- **recepción tiene el área `agencias` pero no puede mover su cuenta corriente**, que es el
  caso que justifica que `requerirRol` exista.

Comprobado rompiendo `requerirAcceso` a propósito: **tres tests se ponen en rojo**.

Esto no reemplaza migrar los 29 a sesiones reales —sigue siendo deseable—, pero ya no es lo
único que separa a la suite de verificar la autorización.

**1416 tests verdes en 87 archivos.**

### Addendum del 2026-08-24 — lo que solo se ve abriendo el navegador

`docs/PENDIENTES.md` tenía dos cosas anotadas como **pendientes de verificación en el
navegador**, y llevaban meses así. Se verificaron. Aparecieron **dos bugs que ningún test de
los 1417 podía ver**, porque los dos viven en el borde entre React y el DOM.

#### 1. Los `<select>` perdían lo elegido, y eso guardaba datos fiscales equivocados

El pendiente preguntaba si el patrón de preservación de formularios funcionaba. La respuesta
es **a medias**, y la mitad que fallaba era la peor.

Se cargó un huésped con los nueve campos y un CUIT inválido a propósito:

- Los **7 campos de texto se conservaron** ✅ (incluida la casilla de residencia)
- Los **2 `<select>` no** ❌ — «Tipo de documento» volvió de CUIT a **DNI**, y «Condición
  frente al IVA» de Responsable Inscripto a **Consumidor Final**

La causa: `defaultValue` en un `<select>` marca la opción **al montar**; volver a renderizar
con otro valor no toca el DOM, y el reseteo de formulario de React 19 devuelve el control a
la opción de origen. Los `<input>` no tienen el problema porque ahí React sí actualiza el
atributo `value`.

**Por qué es grave y no una molestia.** Quien corrige solo el número del CUIT y reenvía
guarda el huésped como **Consumidor Final** creyendo que puso Responsable Inscripto. De eso
depende la letra del comprobante (ADR 0012). Es un dato fiscal equivocado, guardado en
silencio, por un error de interfaz.

Arreglado con `key` atado al valor, que fuerza el remontaje. Re-verificado en el navegador:
CUIT y Responsable Inscripto ahora sobreviven.

**Consecuencia para el pendiente UX-02:** el patrón sirve para los campos de texto, pero
replicarlo a los otros formularios exige el `key` en cada `<select>`. Sin eso se estaría
copiando el bug doce veces.

#### 2. La ficha prometía una exención distinta de la que la factura aplicaba

Al abrir una reserva de un huésped residente en el exterior, el aviso decía:

> «Al facturar, el alojamiento sale sin IVA: **USD 0,00** en vez de USD 363,00»

El número correcto es USD 300. La ficha leía `reservas.total_neto` —una columna que puede
venir en cero— mientras que `emitirFactura` lo calcula bien con `desglosarConExencion`. O sea
que **la pantalla y el comprobante se contradecían**, que es exactamente lo que el comentario
del código decía estar evitando: ahí se usaba la misma función solo para el booleano, no para
el importe.

Arreglado: la ficha usa `desglosarConExencion`, la misma que la factura. Re-verificado:
ahora dice USD 300,00. El caso quedó fijado en `tests/exencion-iva.test.ts` con los números
exactos.

#### Lo que sí estaba bien

- `/panel/canales` y sus cinco vistas renderizan, con un estado vacío que dice qué hacer.
- El bloque de garantía de tarjeta muestra «Sin tarjeta · Sin verificar» y el motivo.
- `/login/recuperar` redirige al panel si ya hay sesión, como se codeó.
- El enlace «¿Olvidaste tu contraseña?» está en el login.

#### La lección

Los dos bugs eran **de borde entre React y el DOM**, y ninguna de las tres capas de tests los
alcanzaba: el dominio es puro, los de integración van contra Postgres y la guarda estructural
lee el código fuente. Un test de componente los habría visto, pero exige dependencias nuevas.
Mientras tanto, **abrir la pantalla sigue siendo la única verificación que cubre esa capa**, y
conviene hacerlo antes de replicar un patrón a doce archivos.

---

## 2026-08-25 — Integración a `main`: el feed iCal y el relevamiento, juntos

**Resumen:** las ramas vivas eran dos y las dos colgaban del tip de `main`:
`feat/relevamiento-cliente-agosto` (+6901 líneas, migraciones 0058–0064) y
`feat/5-ical-saliente` (+1454, B7). Se integraron en una sola rama verificada.
**1446 tests verdes en 89 archivos, cero salteados**, más typecheck, lint, `npm
audit --audit-level=high` y build: las cinco puertas del CI.

### El hallazgo: dos migraciones `0058` no conviven

Las dos ramas nacieron del mismo commit y **las dos crearon una `0058`**: la
exención de IVA y la lectura del feed iCal. Parecía un detalle cosmético de
numeración. No lo era.

Supabase registra la migración aplicada **por el prefijo numérico**, no por el
nombre del archivo. La base local ya tenía anotado `0058 | lectura_del_feed_ical`
de cuando se trabajó esa rama, así que al correr `migration up` el CLI dio el
número 0058 por aplicado y **salteó `0058_exencion_iva_turista_extranjero.sql`
sin decir una palabra**. El síntoma apareció lejos de la causa: 16 tests rojos
con `Could not find the 'residente_exterior' column of 'huespedes' in the schema
cache`, que parece un problema de caché de PostgREST y era una migración que
nunca corrió.

La migración del iCal pasó a ser la **`0065`**. Se actualizaron las dos
referencias al número —`docs/bitacora.md` y el ADR 0022—, y la cabecera del
propio archivo. La de IVA conserva la `0058`, que es la que ya estaba publicada.

### Lo que NO se mergeó, y por qué

Cuatro ramas viejas (`audit/fase-1-seguridad-critica`, `feat/4-booking-integracion`,
`feat/booking-y-auditoria-rls`, `historia/detalle-hasta-0057`) figuraban como «sin
mergear» porque `main` es historia lineal de squashes: los SHA nunca coinciden. Al
comparar **contenido** resultó que las cuatro ya estaban absorbidas por los squashes
#9, #10, #11 y #14, y que lo único que aportaban eran revisiones viejas de código que
`main` ya mejoró.

Mergearlas habría **revertido** trabajo. El caso más caro:
`audit/fase-1-seguridad-critica` trae `[auth.email].enable_signup = false`, que no
bloquea el auto-registro —eso lo hace `[auth].enable_signup = false`, que ya está—
sino que desactiva el proveedor de email entero, incluido `signInWithPassword`. Es
decir: **nadie podría iniciar sesión en el panel**. `main` tiene la línea correcta,
documentada y sostenida por `tests/auth-config.test.ts`, archivo que esa rama ni
siquiera tiene.

## 2026-08-25 — Rediseño azul y blanco, y los bugs de scroll que aparecieron al medirlo

Pedido del usuario: paleta y tipografía del registro de las plataformas de reserva,
entrada con Google, arreglar los desbordes de las tarjetas al scrollear, compactar
la Ayuda y que todo sea responsive.

### La paleta cambia de valor, no de nombre (ADR 0026)

`lago` pasa a azul de acción, `calafate` a azul marino, `lenga` a ámbar. Los rojos
de error y los verdes de éxito no se tocan: significan lo mismo en cualquier
interfaz y cambiarlos por estética le quitaría información a quien lee rápido.

**Los nombres de los tokens no cambiaron, y es la decisión importante.** Tienen 244,
15 y 98 usos. El riesgo de renombrar no es el tamaño del diff sino su naturaleza:
Tailwind resuelve las clases **por texto**, así que un `bg-azul-600` mal tipeado no
rompe el typecheck ni el linter — simplemente no pinta. Cambiar el valor repinta
todo desde `app/globals.css` y no puede romper una clase que funcionaba.

La tipografía de Booking es propietaria y no se usa; va Inter, que es libre y tiene
un aire parecido. El ADR deja escrito el costo: se pierde la identidad propia que
el ADR 0009 había construido, y parecerse a la plataforma de la que el proyecto
busca reducir la dependencia tiene algo de contradictorio. Es decisión del dueño
del producto.

### Entrada con Google

No abre el registro: `[auth].enable_signup = false` impide que GoTrue cree un
usuario por cualquier proveedor, y un perfil creado fuera del alta nace `sin_rol` y
`activo = false` (ADR 0005 y 0017). El callback atiende el caso intermedio que sí
ocurre —autenticado en Google pero sin acceso al panel—: sin eso rebotaría entre
`/login` y `/panel` sin entender por qué. El botón solo se muestra si está
configurado: uno que existe y falla es peor que uno que no está (ADR 0018).

### El menú lateral se iba con el scroll, en TODO el panel

Lo destapó una captura del usuario. `<aside>` era `position: static` y, como ítem
flex de un contenedor que estira, la caja azul medía lo que midiera la página:
**5.739 px en Ayuda**. Se veía la franja de color de arriba abajo pero los enlaces
vivían en los primeros 400 px, así que a media página el menú estaba 1.296 px más
arriba y no había forma de navegar sin volver al principio.

Ahora es `sticky top-0 h-screen`. El scroll de la lista **no** se puso en el aside:
el `<nav>` de `Enlaces` ya es `flex-1 overflow-y-auto`, y un segundo `overflow`
habría dejado dos scrollports anidados peleándose por la rueda.

### Tres arrastres laterales en el teléfono, tres causas distintas

Buscados con la prueba que importa —`scrollTo(9999,0)` y ver si `scrollX` se
mueve—, no mirando capturas.

**Hub (+253 px a 320).** La causa era un arreglo propio anterior: `truncate`
incluye `white-space: nowrap`, así que el ancho **mínimo** de ese span es la línea
entera. Un apellido compuesto daba 515 px y la tarjeta —ítem de grilla, o sea
`min-width: auto`— se estiraba a 557 dentro de una pantalla de 320. El `truncate`
que estaba justamente para evitarlo nunca llegaba a activarse. El `min-w-0` va en
el componente `Tarjeta`, no en el llamador: vale para las ~90 tarjetas del panel.

**Reservas (+91 px).** Siete `<select>` sin `min-w-0`. `w-full` no alcanza en un
ítem flex, porque `min-width: auto` lo ancla a su opción más ancha: 361 px medidos.

**Ocupación (+276 px).** El más raro: el desborde era hacia espacio **vacío**, nada
cortado. Lo causan las celdas `sticky` de la columna congelada, que extienden la
región scrolleable de sus ancestros y se escapan del recorte del scrollport.
Descartados por medición, uno por uno: `overflow-x: hidden` en el `main` **no** lo
frena, ni sacar el `whitespace-nowrap`, ni el `max-width`, ni `table-layout: fixed`.
`contain: paint` sí.

### La grilla de ocupación no se pegaba, aunque el comentario dijera que sí

El `tfoot` era `sticky bottom-0` y un comentario afirmaba que quedaba pegado. No lo
estaba: con `overflow-x: auto` el `overflow-y` computa a `auto`, así que ese div ya
era el scrollport — pero sin altura acotada su `scrollTop` era siempre 0 y el
sticky no tenía contra qué pegarse. Con `max-h-[70vh]` la grilla se lee como una
planilla. Verificado a 0 px de offset con la grilla scrolleada a fondo en los dos
ejes.

Se sumó el estado vacío que faltaba —era el único listado del módulo sin uno—: con
los filtros sin resultados mostraba un pie con seis filas de ceros, que se lee como
«el hotel está vacío» cuando lo que pasa es que el filtro no dejó pasar nada.

### Ayuda: de 6,3 a 4,8 pantallas, sin esconder nada

Diez de los diecisiete capítulos tienen uno o dos pasos y aun así costaban
172-210 px cada uno: casi todo marco de tarjeta. Se reparten en dos columnas con
`columns` y no con `grid`, porque miden de 172 a 543 px y una grilla alinea por
fila —cada fila queda tan alta como su tarjeta más alta y al lado sobra un hueco—.

Los tres umbrales salieron de medir una matriz, no de estimar, y el primer intento
**empeoró** el 1024 un 10 %: el índice al costado dejaba los capítulos en 704 px y
dos columnas internas de 330 px desperdician más de lo que ahorran. Corregido:
1024 px −30 %, 1180 px −25 %, 1440 px −22 %.

Sigue sin acordeones: lo que se achica es el alto, no lo que está a la vista.
Ctrl+F sigue encontrando todo, que es como se busca en un manual.

### Las cuatro variantes de botón ahora miden lo mismo

`secundario` y `peligro` llevaban `border` y `primario` y `fantasma` no: 38 px
contra 36 con el mismo padding. En cada fila de acciones del `Encabezado` el botón
principal quedaba 1 px más bajo que sus vecinos, y en `canales` —donde la variante
cambia según el estado— el botón cambiaba de alto solo.

Ocho botones de estado vacío escritos a mano medían **33 px**, no los ~36 que decía
el diagnóstico: son `<a>` sin `inline-flex`, así que quedan en caja de línea y el
`py-2` ni se aplica entero. El mínimo táctil de 44 px de `globals.css` alcanza a
`button` y `select`, **no a un `<a>` suelto** — por eso `botonClases` incluye la
clase `toque`, y por eso estos ocho quedaban fuera de una garantía que el resto del
panel sí tenía.

### Trece hallazgos de una revisión por agentes

Verificados uno por uno contra el código antes de aplicar. Cuatro de importes con
`toLocaleString` en vez de `formatearUSD` —el peor en el comprobante impreso, que
mezclaba «1.234,5» en el ítem con «1.234,50» en el total de la misma columna—; la
tabla del punto de venta con `overflow-hidden` que cortaba cantidad y subtotal en el
teléfono; el email desbordando la ficha de reserva; y el KPI «Total» de contratos
que mostraba 25 mientras el paginador decía «1–25 de 137».

En contratos se hizo distinto de lo propuesto: el agente sugería usar `enFiltro`,
pero los otros tres indicadores se cuentan globales y habría quedado uno filtrado al
lado de tres que no lo están.

### Dos notas de método, para no repetir los errores

**El código de salida no es el resultado.** Se reportó «tests en verde (exit 0)»
mirando solo el exit code; leyendo la salida, tres archivos fallaban por variables
de entorno. `npm run check` **devuelve 0 con tests rojos** cuando no hay `.env.local`
—es justo la trampa que `tests/db.ts` documenta querer evitar, pero el guardián
(`EXIGIR_DB=1`) no está en ese script—. Queda anotado como pendiente.

**Una captura del usuario mostrando la app pintada en una esquina no era un bug.**
El navegador que maneja Playwright estaba conectado a la ventana del usuario, y un
`setViewportSize(1440×560)` puesto para probar el sticky le impuso ese tamaño de
render. De ahí en más la verificación se hizo con un navegador headless aparte.

### Verificación

**38 pantallas** —las 35 del panel y las 3 del portal— barridas a 360, 768 y 1440:
ninguna arrastra de lado, ninguna tarjeta recorta contenido sin forma de alcanzarlo.
1446 tests en 89 archivos contra la base local con `EXIGIR_DB=1`. Lint y build
limpios.

Detalle del arnés, porque confunde: varias pantallas daban «no carga» y no era la
app. Navegar dos veces seguidas en modo dev devuelve `ERR_ABORTED` a los ~90 ms —no
es un timeout—; con un reintento espaciado dan 38/38.

---

## 2026-08-25 — Fase 23: la pasarela de pagos, enchufada

**Resumen:** el puerto de pagos existía desde la Fase 3 y estaba **desenchufado**.
Se conectó de punta a punta —web y mostrador—, con dos pasarelas reales
(MercadoPago y Stripe), cobro en dos monedas y un simulador que permite recorrer
el circuito completo sin contratar nada. En el camino aparecieron dos bugs que
sólo existen cuando el cobro funciona de verdad, y el más caro se llevaba plata.

**El diagnóstico, verificado sobre el código antes de tocar nada:**

| Qué | Estado real |
|---|---|
| `crearCheckout()` | **Cero call sites.** Nadie cobraba en línea |
| `/pago-simulado` | La URL que devolvía el stub **daba 404** |
| Portal público | Creaba la reserva `pendiente` y decía «te escribimos para coordinar» |
| Panel | `medio = 'tarjeta'` era una etiqueta sin cupón ni últimos 4 |
| `PAGO_PROVIDER` | **No existía**: pagos era el único de los siete adaptadores fuera del ADR 0018 |
| `MERCADOPAGO_ACCESS_TOKEN` | Declarado en `.env.example`, ningún archivo lo leía |
| Webhook | Bien hecho (idempotente, HMAC, fail-closed) pero **sin límite de tasa** |

**Detalle de lo realizado:**

- **Migración 0067.** `pagos` gana `monto_cobrado`, `cotizacion`, `cupon`,
  `ultimos4`, `tarjeta_marca`, `url_pago` y `vence_en`, más siete `check` que
  imponen la coherencia de la conversión y **rechazan un PAN** en las columnas
  nuevas (mismo criterio que la 0059).
- **`lib/domain/cobro.ts`** (dominio puro): conversión de moneda con la
  cotización congelada, contraste de importe al centavo, catálogo de medios y
  vigencia del link.
- **Tres adaptadores** con el mismo contrato: `ProveedorSimulado`,
  `ProveedorMercadoPago` (Checkout Pro) y `ProveedorStripe` (Checkout Sessions).
  Por HTTP, sin SDK y sin dependencias nuevas.
- **`lib/payments/servicio.ts`** — `iniciarCobro`, el único camino por el que
  nace un link, lo pida la web o el mostrador.
- **Portal público:** botón de pago en la confirmación y pantalla de elección de
  medio, con el importe en la moneda en la que se va a debitar.
- **Panel:** link de pago para mandar por WhatsApp, moneda del cobro en el
  formulario manual y rastro del posnet.
- **`/pago-simulado`**, la pantalla que faltaba, que cierra el circuito
  disparando el webhook real firmado.
- **Límite de tasa del webhook**, contado **sólo después de rechazar la firma**.

**Los dos bugs que aparecieron al conectarlo:**

1. **La seña no confirmaba la reserva, y eso costaba plata.**
   `pendiente → pagada` no es una transición válida: hay que pasar por
   `confirmada`. Una reserva de la web nace `pendiente`, así que el pago se
   registraba, la transición se descartaba **en silencio** por inválida y la
   reserva quedaba `pendiente`. La expiración la liberaba a los 5 días y el hotel
   revendía la unidad **con la plata del huésped ya cobrada**. Se resolvió con
   `estadoSegunPagos` y `caminoDeEstados` en el dominio.

2. **Un pago rechazado trababa el reintento.** `puedeAvanzarEstadoPago` trataba
   `rechazado` como final, pero una pasarela real crea varios intentos bajo la
   misma referencia: la tarjeta se rechaza por fondos, el huésped pone otra y
   aprueba. El rechazo trababa la fila y la reserva no se saldaba nunca con la
   plata ya cobrada.

**Verificación (ejecutada, no supuesta):**
- Migración 0067 aplicada a la base local; los siete `check` probados uno por uno
  con `insert` que deben fallar, y comprobado que un pago en pesos bien formado sí
  entra.
- Circuito completo contra la app corriendo: reserva `pendiente` de USD 300 →
  seña de USD 100 por webhook → **pasa a `confirmada`** → saldo de ARS 290.000 a
  1450 → **pasa a `pagada`** con USD 300 imputados. El detalle guardado muestra
  `USD 100 @ 1` y `ARS 290.000 @ 1450`.
- `npm run check` completo: lint, typecheck, **1555 tests en verde con cero
  salteados** (eran 1446) y build.

**Decisiones:** [ADR 0027](decisiones/0027-cobro-en-linea-dos-pasarelas-y-una-sola-moneda-de-saldo.md).
La más importante: **`pagos.monto` está siempre en USD**. `resumenPagos` suma esa
columna sin mirar la moneda, así que guardar ahí un importe en pesos habría dado
la reserva por pagada al instante y el huésped se iba sin pagar.

**Pendiente:** contratar las pasarelas. Enchufarlas es cargar variables de
entorno; no hay que tocar código. Ninguna de las dos verifica la tarjeta de
garantía, y las tres implementaciones lo declaran (ADR 0025).


---

## 2026-08-26 — El repositorio en GitHub: análisis estático, plantillas y lo que no vive en el código

**Resumen:** el panel **Security and quality** del repositorio tenía cinco
funciones apagadas y el código no tenía forma de encender ninguna. Se resolvió lo
que sí se puede versionar —análisis estático, revisión de dependencias,
plantillas de issue y de PR, `CODEOWNERS`, `CONTRIBUTING.md`— y se documentó el
resto en `docs/github.md`, con el estado de cada casilla y cómo se activa.

**El hallazgo que lo motivó, y que ningún test podía detectar:** `SECURITY.md`
dice, textual, que se reporte por *«Security → Report a vulnerability»*. **Ese
botón no existe** mientras el reporte privado esté apagado. O sea que el documento
mandaba a un canal cerrado, y las dos salidas que le quedaban a quien encontrara
algo eran publicarlo en un issue —lo que el propio documento pide no hacer— o
callárselo.

**Detalle de lo realizado:**

- **`codeql.yml`** — análisis estático de seguridad sobre el código propio. Es lo
  que faltaba: el CI mira las dependencias (`npm audit`), los tipos (`tsc`) y el
  estilo (ESLint), y **ninguna de las tres ve** el dato del request que llega a una
  consulta, la redirección abierta o la expresión regular que se cuelga — bugs con
  el tipo perfectamente válido. Corre con `build-mode: none`, así que **no necesita
  Docker ni Supabase ni las variables del CI**: son dos minutos y no puede romperse
  por los motivos por los que se rompe el CI.
- **`dependency-review.yml`** — bloquea el PR que **agrega** una dependencia con
  vulnerabilidad alta o crítica. No se pisa con `npm audit`: ése audita el árbol
  entero y por eso corta en `high` (con el umbral más bajo se pone rojo por deuda
  vieja, y un CI que falla siempre se deja de leer); la revisión de dependencias
  mira sólo lo que trae ese PR, que es deuda que todavía se puede no contraer.
- **Plantillas de issue** (error y mejora) que piden **el rol** y la pantalla. No es
  burocracia: en este sistema los permisos los impone la base con RLS, así que un
  bug de permisos sin el rol no se puede reproducir. Sin issue en blanco, y con
  enlaces a la política de seguridad, a `docs/` y a `COMO-LEVANTARLO.md`.
- **Plantilla de PR** con la Definition of Done de `AGENTS.md` y un bloque propio
  para migraciones (número correlativo, `db reset` de cero, RLS y `GRANT`, y la
  regla del enum en dos archivos por el SQLSTATE 55P04).
- **`CODEOWNERS`** con los dos autores, para que la revisión se pida sola.
- **`CONTRIBUTING.md`** — cómo levantarlo, qué se verifica y las convenciones que
  sorprenden a alguien de afuera (todo en español, `lib/domain/` puro, las
  migraciones no se editan, la integridad vive en la base).
- **`docs/github.md`** — las cinco casillas de la web, una por una: qué hace, qué
  pasa si sigue apagada y dónde está el botón. Más las reglas de rama que
  convertirían en obligatorio lo que hoy es una regla escrita en `AGENTS.md`
  («no `push --force`, no trabajar sobre `main`»).

**Un bug de configuración encontrado de paso:** el CI corría **dos veces** por cada
PR. `push: branches: ['**']` disparaba en la rama y `pull_request` disparaba en el
PR, con grupos de `concurrency` distintos, así que ninguna cancelaba a la otra:
veinticinco minutos con Docker, dos veces, por cada uno de los siete PRs de
dependencias abiertos. Se cambió a `branches-ignore: ['dependabot/**']`, que
mantiene intacto el motivo original —las ramas humanas se validan desde el primer
push— y saca la corrida duplicada de las ramas que nacen con su PR abierto.

**La confusión que quedó escrita, porque el repositorio se ve más cubierto de lo
que está:** Dependabot hace dos cosas distintas. Las *version updates* son las que
configura `.github/dependabot.yml` y ya funcionan (son los siete PRs abiertos); las
*security updates* —las que abren un PR **porque se publicó una vulnerabilidad**,
sin esperar al lunes— **necesitan que las alertas estén encendidas**, y están
apagadas. El `npm audit` del CI tapa parte del hueco, pero sólo corre cuando
alguien hace push: una vulnerabilidad publicada en una semana sin commits no la ve
nadie.

**Verificación:**
- Los cinco archivos YAML nuevos parsean (`yaml.safe_load`), incluidas las tres
  plantillas de issue. Una fallaba por un `: ` dentro de un texto sin comillas.
- Las etiquetas `bug` y `enhancement` que declaran las plantillas **existen** en el
  repositorio: una etiqueta inexistente no se aplica y la plantilla queda muda.
- Los dos usuarios de `CODEOWNERS` (`@octi35`, `@santimoran19`) se verificaron
  contra los colaboradores del repositorio, no contra el nombre del autor de los
  commits — que en Git es texto libre y no un usuario de GitHub.
- No se tocó código de la aplicación: el cambio es de configuración y
  documentación, así que no hay tests nuevos que correr.

**Decisiones:** [ADR 0028](decisiones/0028-analisis-estatico-y-configuracion-de-github.md)
— CodeQL versionado en el repositorio y no la casilla de la web (una casilla no se
revisa en un PR ni explica qué corre); `security-extended` y no
`security-and-quality`, que duplicaría ESLint y llenaría el panel de ruido; y para
los secretos, el *push protection* de la plataforma en vez de un escáner de
terceros en el CI, porque el CI corre **después** del push y un secreto que llegó
al historial ya está comprometido.

**Pendiente:** las cinco casillas son de la web y las tiene que apretar alguien con
acceso al repositorio. Orden sugerido en `docs/github.md`: primero el reporte
privado (hay una promesa rota), después las alertas de Dependabot, después el
escaneo de secretos con *push protection* —que rinde el día del deploy, cuando
aparezcan las claves reales de Supabase, Stripe y MercadoPago— y último *code
quality*, cuando CodeQL esté en cero pendientes.


---

## 2026-08-26 — Wiki del proyecto: 12 páginas, versionadas en el repositorio

**Resumen:** el repositorio tenía la pestaña Wiki habilitada y vacía. Se escribió
completa —12 páginas, unas 73 KB— y se resolvió el problema de fondo que tiene
todo wiki: **dónde vive**.

**La decisión de forma, que es la que más importa:** las páginas se escriben y se
versionan en `docs/wiki/`, y publicarlas es un paso aparte (`scripts/publicar-wiki.sh`).
El wiki de GitHub es un repositorio git distinto —el mismo nombre con sufijo
`.wiki.git`—, así que editarlo desde la web tiene dos costos: no pasa por un pull
request, y se desincroniza del código sin que nada avise. Un wiki que describe una
arquitectura que ya cambió es peor que no tener wiki, porque se le cree. Teniéndolo
en `docs/wiki/`, un cambio que rompa lo que el wiki afirma aparece en el mismo diff
que el cambio de código.

**Las páginas:**

- **Home** — qué es, qué reemplaza punto por punto, los números del sistema y el
  mapa del wiki con tres recorridos según a qué vino el lector.
- **El problema que resuelve** — la más larga y la que faltaba en toda la
  documentación: el hotel real (15 unidades en 10 tipos, estacionalidad de El
  Calafate), qué era WinPAX y qué costaba cada una de sus limitaciones, el Excel
  para todo lo demás, el 79 % de reservas por OTA, y los cinco problemas de fondo
  con el mecanismo concreto que resuelve cada uno. **Cierra con lo que el sistema
  NO resuelve**, en una tabla de siete filas.
- **Arquitectura** — diagrama, las tres reglas de dependencia verificables, los dos
  frentes, los siete puertos y los cinco lugares que hay que tocar para agregar un
  área.
- **Modelo de datos** — las 43 tablas agrupadas por dominio y las cinco garantías
  que impone la base.
- **Módulos del panel** — la matriz de las 21 áreas por rol, con las tres
  decisiones que la explican, y qué hace cada módulo.
- **Reglas de negocio** — la máquina de estados en diagrama, tarifas, IVA, monedas,
  cancelación, garantías y ocupantes.
- **Seguridad** — el enfoque en capas, los cuatro roles, la auditoría por fases y lo
  que sigue pendiente.
- **Decisiones (ADR)** — los 28, agrupados por tema y con una línea cada uno.
- **Puesta en marcha** — instalación, comandos, las dos trampas de los tests y las
  variables del deploy.
- **Preguntas frecuentes** — «por qué está hecho así» más el inventario de trampas.
- **_Sidebar** y **_Footer** — navegación en todas las páginas.

**Los números se verificaron contra el repositorio, no se recordaron:** 43 tablas
(contadas de las migraciones), 67 migraciones, 94 archivos de test, 21 áreas, 50
módulos de dominio, 28 ADRs, 15 unidades y 10 tipos en el seed, 24 archivos de
Server Actions y 6 route handlers. La matriz de permisos por rol y la máquina de
estados salieron de leer `lib/domain/permisos.ts` y `lib/domain/reservas.ts`, no de
la documentación previa —que en un punto estaba vieja: `docs/arquitectura.md`
todavía describe `app/(public)` y `app/(admin)`, que hoy son `app/reservar` y
`app/panel`—.

**Verificación:** los 28 enlaces a ADRs apuntan a archivos que existen y no queda
ningún ADR sin enlazar (comprobado con un script); los enlaces entre páginas del
wiki resuelven a páginas que existen; `bash -n` sobre el script de publicación.

**Pendiente:** el wiki **todavía no está publicado**. GitHub no crea el repositorio
`.wiki.git` hasta que exista la primera página, y eso hay que hacerlo una vez desde
la web. El procedimiento completo está en `docs/wiki-publicacion.md`.

**Pasada de registro formal (mismo día).** Revisada la redacción para el lector que
importa —un tribunal de tesis— sin tocar un solo dato. La portada pasa a abrir con
un bloque de identificación (institución, carrera, autores, establecimiento,
naturaleza, estado y fecha de revisión), y se reemplazaron las once marcas de
registro coloquial que quedaban: «plata» por «dinero» o «importe» según el caso,
el voseo de las instrucciones («leé», «corré», «venís») por formas impersonales, y
«apretar el botón» por «confirmar la operación». La sección final de la portada
pasó a llamarse «Alcance y vigencia del documento» y deja explícito que ante una
discrepancia **prevalece el código**.

Verificado con un barrido de expresiones regulares que no queda ninguna marca, y
revalidado que los enlaces entre páginas siguen resolviendo.

**Por qué la publicación sigue siendo un paso manual, confirmado ejecutándolo:**
`git ls-remote` contra el repositorio principal responde; contra
`…HotelApp.wiki.git` pide usuario y falla. El wiki es un repositorio git aparte,
todavía no inicializado, fuera del alcance de las credenciales del entorno, y
**GitHub no expone API para wikis**. La primera página tiene que crearse desde la
web una única vez; a partir de ahí el script se encarga.
