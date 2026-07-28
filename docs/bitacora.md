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
