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

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completar con credenciales de Supabase
npm run dev                  # http://localhost:3000
```

Ver el [manual técnico](docs/manual-tecnico.md) para el detalle (incluida la
base de datos local con Supabase CLI).

## Documentación

Toda la documentación vive en [`docs/`](docs/):

- [Bitácora de avances](docs/bitacora.md) — registro cronológico del desarrollo.
- [Roadmap por fases](docs/roadmap.md) — plan y estado de cada fase.
- [Arquitectura](docs/arquitectura.md) — visión técnica del sistema.
- [Modelo de datos](docs/modelo-datos.md) — entidades y relaciones.
- [Decisiones (ADR)](docs/decisiones/) — decisiones de arquitectura.

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
