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

## Dos vistas separadas (decisión de producto)
- **Gestión hotelera** (`app/panel`, login de staff) — el foco actual del desarrollo.
- **Reservas de clientes** (público: `app/reservar` + landing) — vista aparte, se
  amplía más adelante. Las funciones cara al cliente (web check-in, encuestas) van
  ahí, NO en la gestión.

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
- ⚠️ `db reset` **borra los usuarios de auth**: hay que correr `npm run seed:usuarios`
  después, o los tests de facturación fallan (hay FK contra `perfiles`).
- Studio http://127.0.0.1:54323 · API http://127.0.0.1:54321 · claves con nuevo
  formato `sb_publishable_…` / `sb_secret_…`. `.env.local` (gitignored) apunta al
  stack local.

## Comandos
- Dev `npm run dev` · Tests `npm test` · Typecheck `npm run typecheck` · Lint `npm run lint`.
- **CI (`.github/workflows/ci.yml`): verde y verificado en GitHub** desde la
  corrida #31. Levanta Supabase con Docker, crea el admin y corre typecheck,
  lint, los 307 tests con `EXIGIR_DB=1` y el build. Dos cosas a respetar si se
  toca: el paso del seed invoca `node scripts/seed-usuarios.mjs` **directo** y no
  `npm run seed:usuarios` (ese script usa `--env-file-if-exists`, que necesita
  Node ≥ 20.12 y no hay `.env.local` en el runner); y sin ese paso la tabla
  `perfiles` queda vacía y los tests de facturación fallan por la FK.
- El test de integración anti-overbooking necesita DB local + env
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); sin ellos se saltea.
- **Gate de cada fase:** typecheck + lint + tests en verde.

## Estado actual
- **Fase 0-2 ✅** fundaciones + núcleo de dominio + panel interno de Recepción ·
  **Fase 3 ✅** pagos · **Fase 4 ✅** portal público de reservas ·
  **Fase 5 ✅** consumos + factura · **Fase 6 ✅** reportes gerenciales ·
  **Fase 7 (parcial) ✅** hardening (token confirmación, expiración pendientes, webhook
  fail-closed) · **Fase 8 (en curso)** ampliación tipo WinPax/Odoo: **8.1 ✅ cuentas
  corrientes de agencias · **8.2** reservas grupales · **8.3** mantenimiento, objetos
  perdidos, encuestas, reportes avanzados (ADR/RevPAR) · **8.4/8.5** consolidación +
  dashboard-hub · **8.6** fidelidad + inventario · **8.7** proveedores (cuentas por
  pagar), reprogramación de reservas, asignación de mucamas y avisos internos ·
  **Fase 9** mejora integral del panel: identidad visual propia (ADR 0009),
  componentes compartidos, búsqueda + paginación + export CSV en todos los
  listados, navegación móvil y más funciones por módulo · **Fase 10** contratos
  con firma electrónica por token (ADR 0010) y conversaciones internas en tiempo
  real + asistente del portal basado en reglas (ADR 0011) · **Fase 11** alcance
  ERP: facturación fiscal argentina (ADR 0012), auditoría de operaciones
  sensibles, conciliación y antigüedad de saldos, pipeline comercial, encuestas
  NPS y mantenimiento preventivo · **Fase 12** endurecimiento del CI y tests
  sobre las Server Actions · **Fase 13** limpieza de código muerto y **cambio de
  unidad** (mudanza de habitación, migración 0028) · **Fase 14** experiencia de
  uso e interacción táctil · **Fase 15** rediseño de la interfaz (se eliminaron
  los 11 formularios plegados, altas en pantalla propia) y **sección de Ayuda**.
  **307 tests verdes.**
- **Cinco adapters** con el mismo patrón (interfaz + stub, se cambia por env):
  `PaymentProvider`, `FirmaElectronicaProvider`, `AsistenteProvider`,
  `FacturacionElectronicaProvider` y `EmailProvider` (`lib/email/index.ts`, el
  único camino para mandar correo). Ningún borde externo es real.
- **Trabajo futuro documentado (ADR 0013):** gestión documental con Storage,
  seguridad por campo y multi-propiedad. No implementar sin releer ese ADR.
- **Diseño del panel:** usar SIEMPRE los componentes de `app/panel/_components/ui.tsx`
  (`Encabezado`, `Tarjeta`, `Kpi`, `Tabla`, `Buscador`, `Paginacion`, `Chip`…) y los
  iconos de `iconos.tsx`.
- **Interfaz (Fase 15) — principio fijado por el usuario:** *nada oculto, nada
  manejado por URL, pensado para gente que no usa mucho la computadora.* En
  concreto: **prohibido `<details>` para esconder una acción o un formulario**
  (se eliminaron los 11 que había); el alta y la edición van en **pantalla
  propia** con un botón primario visible en el `Encabezado` del listado; todo
  campo lleva **etiqueta visible** (`Campo`), nunca solo `placeholder`; al
  guardar no se redirige solo, se usa `ExitoConPasos`; los `<form action={…}>`
  de servidor usan `BotonEnvio` (bloquea el doble clic) y `confirmar` si la
  acción no tiene vuelta atrás. Envolver cada pantalla en `Pagina`.
- **Ayuda:** el contenido vive en `lib/domain/ayuda.ts` y se filtra por rol con
  `puedeAcceder`. Al agregar un módulo, sumarle su capítulo ahí.
- **Móvil (Fase 14):** columnas de tabla no esenciales con `COL_SECUNDARIA`
  (`hidden sm:table-cell`), aplicado al `<th>` **y** al `<td>`; si el dato importa,
  plegarlo bajo la columna principal con `sm:hidden` en vez de perderlo. Campos y
  botones de formulario `w-full sm:w-auto`. Nunca `overflow-hidden` sobre una tabla
  (recorta datos): va `overflow-x-auto`. `globals.css` ya da 16px a los campos y
  44px de área de toque bajo `@media (pointer: coarse)`; no hace falta repetirlo. Paleta de marca: `lago` / `calafate` / `lenga` / `stone`
  (no usar `sky` ni `amber`). Títulos con `font-display`.
- ⚠️ `next/font/google` descarga las tipografías en build. Si se borra `.next` y la
  descarga falla, el error se cachea y **toda la app da 500** (incluido `/login`):
  se arregla reiniciando el dev server.
- ⚠️ El builder de PostgREST es **thenable**: una función `async` no debe devolverlo
  pelado o el `await` del llamador ejecuta la consulta (ver `reservas/consulta.ts`).
- **Cara al cliente (diferido a la vista pública `app/reservar`):** web check-in y
  encuestas de satisfacción NO van en la gestión.
- **Deploy** (Vercel + Supabase cloud) pendiente — requiere cuentas del usuario.
- No se integran pasarelas reales ni envío de email real (credenciales/dinero);
  stubs listos para enchufar (`lib/payments`, `lib/email`).
- Admin de dev: `admin@blancapatagonia.local` / `blancadev1234` (`npm run seed:usuarios`).
- Al embeber `huespedes` desde `reservas` usar `huespedes!reservas_huesped_id_fkey` (hay 2 FKs).
- Pendiente de confirmar con el hotel: **inventario físico real** de unidades y
  **tarifa rack de cabañas**. El Tarifario cargado es 2025/2026 (anterior a la fecha del sistema).

@AGENTS.md
