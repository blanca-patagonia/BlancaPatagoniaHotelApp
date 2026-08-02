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
