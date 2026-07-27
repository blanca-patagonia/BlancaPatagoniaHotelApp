# ADR 0005 — Autenticación y control de acceso por rol

- **Estado:** Aceptada
- **Fecha:** 2026-07-27

## Contexto

El panel interno (Front Office tipo WinPax) debe separar responsabilidades por
puesto: administración, gerencia, recepción y housekeeping. Cada rol accede a un
subconjunto distinto de funciones, y los datos sensibles (huéspedes, reservas) no
deben quedar expuestos.

## Decisión

- **Autenticación** con **Supabase Auth** (email + contraseña) sobre el layer de
  sesión de Fase 0 (`proxy.ts` + `@supabase/ssr`). El login se resuelve con un
  **Server Action** (`app/login/actions.ts`).
- **Autorización en dos capas:**
  1. **Aplicación:** mapa de permisos por área en `lib/domain/permisos.ts`
     (`puedeAcceder(rol, area)`), consumido por el guard `requerirAcceso(area)`
     (`lib/auth/session.ts`) en cada página del panel y por el sidebar (muestra
     solo las áreas permitidas). El guard **redirige** si el rol no tiene acceso.
  2. **Datos:** **RLS** por rol en la base (ya definida desde Fase 0/1). Es la
     barrera real: aunque la app fallara, la base no entrega datos fuera de rol.
- **Alta de staff:** los usuarios no se auto-registran. Un administrador los crea
  desde `app/panel/usuarios` usando el **cliente admin** (service_role,
  solo-servidor) — `auth.admin.createUser` + asignación de rol en `perfiles`. El
  primer admin se siembra con `scripts/seed-usuarios.mjs` (`npm run seed:usuarios`).

## Matriz de acceso

| Área | admin | gerencia | recepción | housekeeping |
|---|:-:|:-:|:-:|:-:|
| Inicio | ✅ | ✅ | ✅ | ✅ |
| Ocupación | ✅ | ✅ | ✅ | — |
| Reservas | ✅ | ✅ | ✅ | — |
| Huéspedes | ✅ | ✅ | ✅ | — |
| Housekeeping | ✅ | ✅ | — | ✅ |
| Configuración | ✅ | ✅ | — | — |
| Usuarios | ✅ | — | — | — |

## Justificación

- Defensa en profundidad: la UI oculta y el guard redirige, pero **RLS** es la
  garantía. Coherente con el criterio anti-overbooking (la integridad vive en la base).
- Reutiliza el stack (Supabase Auth) sin montar un sistema de sesiones propio.

## Consecuencias

- `recepción` no gestiona estados de habitación (coherente con la RLS de `unidades`,
  que solo permite escribir a admin/gerencia/housekeeping). Revisable si el hotel
  prefiere que recepción también los cambie (requeriría ampliar la política RLS).
- La gestión de usuarios usa `service_role`: debe permanecer estrictamente en el
  servidor y detrás del guard de admin.
