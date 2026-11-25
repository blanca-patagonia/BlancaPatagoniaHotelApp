# Arquitectura del sistema

> Rama `tesis-a-presentar` (versión reducida, [ADR 0045](../decisiones/0045-version-reducida-para-la-tesis.md)).
> Mapa de carpetas completo: [`ESTRUCTURA.md`](../../ESTRUCTURA.md).

## Visión general

Aplicación web única construida con **Next.js 16 (App Router)** desplegada en
**Vercel**, con **Supabase** como backend de datos, autenticación y almacenamiento.

```
┌──────────────────────────────────────────────────────────┐
│                     Navegador / Móvil                      │
└───────────────┬───────────────────────┬──────────────────┘
                │ (público)             │ (staff)
        ┌───────▼────────┐      ┌────────▼─────────┐
        │  Portal de     │      │  Panel interno   │
        │  reservas      │      │  (recepción /    │
        │  (huésped)     │      │   admin /        │
        │                │      │   gerencia /     │
        │                │      │   housekeeping)  │
        └───────┬────────┘      └────────┬─────────┘
                │   Next.js (App Router)  │
        ┌───────▼─────────────────────────▼─────────┐
        │  Server Components · Route Handlers (API)  │
        │  src/lib (dominio, disponibilidad, pagos)  │
        └───────┬───────────────────────┬────────────┘
                │ @supabase/ssr          │ webhooks
        ┌───────▼────────┐      ┌────────▼─────────┐
        │   Supabase     │      │ MercadoPago /    │
        │  Postgres +    │      │ Stripe / Payway  │
        │  Auth + RLS +  │      │ / Email          │
        │  Storage       │      │ (externos)       │
        └────────────────┘      └──────────────────┘
```

## Capas

- **Presentación:** Next.js App Router. Dos áreas por _route group_:
  - `src/app/(front-publico)` — portal de reservas del huésped
    (`reservar`, `[idioma]/alojamientos`, `[idioma]/reservar`, `encuesta`).
  - `src/app/(front-gestion)` — login y panel interno por rol
    (`src/app/(front-gestion)/panel`, 12 áreas).
- **Back HTTP:** `src/app/(back-api)` — webhook de pagos
  (`/api/webhooks/pagos/[proveedor]`), tareas programadas (`/api/cron/*`),
  búsqueda global, cotización, salud y la vuelta del login con Google.
- **Lógica de negocio:** `src/lib` (sin acoplar a la UI):
  - `src/lib/domain` — reglas puras (precios, política de cancelación, roles,
    permisos), sin base ni framework.
  - `src/lib/availability` — consulta de disponibilidad.
  - `src/lib/payments` — abstracción de pasarelas de pago (Mercado Pago, Stripe,
    Payway y el simulador).
  - `src/lib/facturacion`, `src/lib/email`, `src/lib/divisas`,
    `src/lib/notificaciones` — los demás adaptadores y la bandeja de salida.
  - `src/lib/supabase` — clientes de acceso a datos.
- **Datos:** PostgreSQL gestionado por Supabase. **RLS** por rol. La integridad
  crítica (no-overbooking) se garantiza con restricciones a nivel de base de
  datos, no solo en la aplicación.

## Seguridad

- **RLS activado** en todas las tablas. El rol se resuelve con `rol_actual()`.
- La `service_role` key solo se usa en servidor (`src/lib/supabase/admin.ts`,
  protegido con `server-only`).
- Webhooks de pago **idempotentes** y con verificación de firma.

## Decisiones técnicas relevantes

Las decisiones de arquitectura se documentan como ADRs en `docs/decisiones/`.
