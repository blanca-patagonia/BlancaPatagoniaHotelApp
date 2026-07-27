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
