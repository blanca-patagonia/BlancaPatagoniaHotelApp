# Arquitectura del sistema

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
        │                │      │   gerencia)      │
        └───────┬────────┘      └────────┬─────────┘
                │   Next.js (App Router)  │
        ┌───────▼─────────────────────────▼─────────┐
        │  Server Components · Route Handlers (API)  │
        │  lib/ (dominio, disponibilidad, pagos)     │
        └───────┬───────────────────────┬────────────┘
                │ @supabase/ssr          │ webhooks
        ┌───────▼────────┐      ┌────────▼─────────┐
        │   Supabase     │      │ MercadoPago /    │
        │  Postgres +    │      │ Stripe / Email   │
        │  Auth + RLS +  │      │ (externos)       │
        │  Storage       │      └──────────────────┘
        └────────────────┘
```

## Capas

- **Presentación:** Next.js App Router. Dos áreas por _route group_:
  - `app/(public)` — portal de reservas del huésped.
  - `app/(admin)` — panel interno por rol.
- **Lógica de negocio:** `lib/` (sin acoplar a la UI):
  - `lib/domain` — tipos y reglas (precios, política de cancelación, roles).
  - `lib/availability` — motor de disponibilidad.
  - `lib/payments` — abstracción de pasarelas de pago.
  - `lib/supabase` — clientes de acceso a datos.
- **Datos:** PostgreSQL gestionado por Supabase. **RLS** por rol. La integridad
  crítica (no-overbooking) se garantiza con restricciones a nivel de base de
  datos, no solo en la aplicación.

## Seguridad

- **RLS activado** en todas las tablas. El rol se resuelve con `rol_actual()`.
- La `service_role` key solo se usa en servidor (`lib/supabase/admin.ts`,
  protegido con `server-only`).
- Webhooks de pago **idempotentes** y con verificación de firma.

## Decisiones técnicas relevantes

Las decisiones de arquitectura se documentan como ADRs en `docs/decisiones/`.
