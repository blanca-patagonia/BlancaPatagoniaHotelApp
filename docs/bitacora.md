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
