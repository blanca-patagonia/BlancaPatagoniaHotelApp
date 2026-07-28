# Sistema de Gestión Hotelera — Hotel Blanca Patagonia

Aplicación web integral para la gestión del Hotel Blanca Patagonia (El Calafate):
reservas online, check-in / check-out, consumos, facturación y reportes.
Reemplaza el sistema heredado **Winpax** y reduce la dependencia de **Booking**.

> Proyecto de tesis — Tecnicatura/Analista de Sistemas, Colegio Universitario IES.
> Autores: Octavio Fakiani · Santiago Morán.

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind CSS 4**
- **Supabase** (PostgreSQL + Auth + Storage + RLS)
- Pagos: **MercadoPago / Stripe** (capa de abstracción) · Email transaccional
- Despliegue: **Vercel**

## Puesta en marcha (desarrollo local)

Requiere **Docker** (para Supabase local).

```bash
npm install
npx supabase start           # levanta Postgres + Auth local (Docker)
npx supabase db reset        # aplica migraciones + seed (Tarifario real)
# Copiar en .env.local la URL y las claves que imprime `npx supabase status`
npm run seed:usuarios        # crea el admin de desarrollo
npm run dev                  # http://localhost:3000
```

**Panel interno:** entrar en `http://localhost:3000/panel` con el admin de
desarrollo (por defecto `admin@blancapatagonia.local` / `blancadev1234`; se
configuran con `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Desde **Usuarios** se dan de
alta el resto de los roles (gerencia, recepción, housekeeping).

Ver el [manual técnico](docs/manual-tecnico.md) para el detalle.

## Documentación

Toda la documentación vive en [`docs/`](docs/):

- [Bitácora de avances](docs/bitacora.md) — registro cronológico del desarrollo.
- [Roadmap por fases](docs/roadmap.md) — plan y estado de cada fase.
- [Arquitectura](docs/arquitectura.md) — visión técnica del sistema.
- [Modelo de datos](docs/modelo-datos.md) — entidades y relaciones.
- [Decisiones (ADR)](docs/decisiones/) — decisiones de arquitectura.
- [Revisión de seguridad](docs/revision-seguridad.md) — auditoría de RLS y endpoints.

## Estructura

```
app/            # Next.js App Router — (public) portal · (admin) panel interno
components/     # UI reutilizable
lib/            # dominio, disponibilidad, pagos, clientes Supabase
supabase/       # migraciones SQL + seed
docs/           # documentación del proyecto / tesis
tests/          # tests (Vitest)
```

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | Chequeo de tipos |
| `npm run seed:usuarios` | Crea/actualiza el admin de desarrollo |
