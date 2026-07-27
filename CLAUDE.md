# Blanca Patagonia — Guía para Claude (pautas fijas del proyecto)

> Este archivo define **cómo trabajar en este repo**. Vale siempre, incluso si se
> compacta el contexto. Leerlo antes de actuar.

## Qué es
Sistema Integral de Gestión Hotelera (PMS) para el **Hotel Blanca Patagonia**
(El Calafate, Santa Cruz). Proyecto de **tesis** de Analista de Sistemas (IES).
Autores: Octavio Fakiani y Santiago Morán. Reemplaza Winpax (gestión) y reduce la
dependencia de Booking/OTAs. Referencias de negocio: blancapatagonia.com y el
Tarifario 2025/2026 (Anexo A).

## Cómo trabajar (proceso — OBLIGATORIO)
- Desarrollo **prolijo, escalable y documentado paso a paso**: es entrega de tesis;
  la documentación importa tanto como el código.
- Trabajar **por fases** (ver `docs/roadmap.md`). Cada fase = **avance demostrable
  + tests verdes + bitácora actualizada + ADR** si hubo decisión de arquitectura.
- **Documentación y comentarios en español.**
- Antes de escribir código nuevo, **revisar lo existente** para no duplicar ni romper.
- Actualizar `docs/bitacora.md` en cada avance (fecha · fase · qué · por qué · decisiones).
- Registrar decisiones de arquitectura como **ADRs numerados** en `docs/decisiones/`.
- **Antes de implementar algo grande, mostrar el plan y esperar validación.**
- **Commit/push SOLO cuando el usuario lo pida.**

## Stack
- **Next.js 16** (App Router, TypeScript) + **Tailwind 4**. Deploy en **Vercel**.
- **Supabase** (Postgres + Auth + RLS + Storage). Validación con **zod**. Tests con **vitest**.
- ⚠️ Ver `@AGENTS.md`: Next.js 16 trae breaking changes. Leer
  `node_modules/next/dist/docs/` antes de tocar APIs de Next. `middleware` → `proxy`;
  `cookies()` es **async**.

## Arquitectura (capas)
- Presentación: `app/(public)` portal del huésped · `app/(admin)` panel por rol ·
  `app/api/...` route handlers · `app/api/webhooks/...`.
- Lógica: `lib/domain` (reglas puras, testeables), `lib/availability`,
  `lib/payments`, `lib/supabase` (clientes server/client/admin/proxy).
- Datos: Postgres con **RLS por rol**. La integridad crítica vive en la **base**,
  no solo en la app.

## Reglas de dominio clave
- **Roles:** `admin`, `gerencia`, `recepcion`, `housekeeping` (+ huésped público
  sin cuenta). Helper SQL `rol_actual()`.
- **Anti-overbooking (ADR 0002):** restricción de exclusión GiST sobre `estadias`
  (`unidad_id WITH =, periodo WITH &&`) para estados activos. Nunca confiar solo
  en la app; la garantía es de la base.
- **Moneda (ADR 0003):** USD base + ARS a **cotización configurable**.
- **Tarifas (ADR 0004):** doble precio **neto** (agencia) / **rack** (mostrador),
  **IVA discriminado** (se calcula en el dominio, no se almacena sumado). El canal
  de la reserva define `tarifa_tipo`.
- **Cancelación (Tarifario):** >14 días sin cargo · 14–7 días primera noche · <7
  días 100% · no-show 100%.

## Convenciones de base de datos
- Migraciones SQL **numeradas** en `supabase/migrations/`; nombres y comentarios en
  español, `snake_case`.
- **RLS activado en TODAS las tablas.** Lectura pública solo en catálogo
  (tipos/tarifas/temporadas/promos activas); datos personales (huéspedes, reservas)
  solo staff.
- En **local** hay que declarar los `GRANT` a `anon`/`authenticated`/`service_role`
  (migración `0006`); en **hosted** los aplica la plataforma. La seguridad real la
  impone RLS.
- `service_role` **solo en servidor** (`lib/supabase/admin.ts`, `server-only`).

## Entorno local (decisión vigente: "por ahora local")
- Supabase local con **Docker**. CLI vía devDependency: `npx supabase`.
- Levantar: `npx supabase start` · aplicar migraciones+seed: `npx supabase db reset`
  · ver claves: `npx supabase status`.
- Studio http://127.0.0.1:54323 · API http://127.0.0.1:54321 · claves con nuevo
  formato `sb_publishable_…` / `sb_secret_…`. `.env.local` (gitignored) apunta al
  stack local.

## Comandos
- Dev `npm run dev` · Tests `npm test` · Typecheck `npm run typecheck` · Lint `npm run lint`.
- El test de integración anti-overbooking necesita DB local + env
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); sin ellos se saltea.
- **Gate de cada fase:** typecheck + lint + tests en verde.

## Estado actual
- **Fase 0 ✅** fundaciones · **Fase 1 ✅** núcleo de dominio (inventario, tarifas,
  motor anti-overbooking; 20 tests verdes).
- **Próximo: Fase 2 — Reservas internas (Recepción).**
- Pendiente de confirmar con el hotel: **inventario físico real** de unidades y
  **tarifa rack de cabañas** (en el seed están como valores representativos).

@AGENTS.md
