# ADR 0042 — Cómo se verifica el sistema: base de tests aislada, comparación de esquema, tests de interfaz y recorrido de punta a punta

- **Estado:** aceptada
- **Fecha:** 2026-10-20
- **Relacionadas:** ADR 0002 (anti-overbooking en la base), 0016 y migraciones 0070/0089/0119 (el borde de `anon`)

## Contexto

Un análisis del proyecto entero (2026-10-20) encontró que la verificación tenía
cuatro huecos, y que cada uno ya había dejado pasar errores reales:

1. **Los ~630 tests de base de datos no corrían en desarrollo.** La única base
   local era la misma que usaba `npm run dev`, con datos cargados a mano, y la
   suite borra reservas y huéspedes para limpiar. Correrla destruía esos datos,
   así que en la práctica se salteaba: el anti-overbooking (ADR 0002) sólo se
   verificaba en el CI.
2. **Nadie comparaba la base con las migraciones.** La base local tenía
   anotadas migraciones sin aplicar (la 0087, sin su tabla) y aplicadas sin
   anotar; seis más faltaban del todo, entre ellas la 0114 —reprogramar una
   reserva fallaba—. Y una base armada **desde cero** resultó distinta de la
   migrada de a poco: en la nueva, `anon` podía ejecutar `crear_reserva` y
   funciones DEFINER (cerrado por la 0119).
3. **Cero tests de interfaz.** Vitest corría sólo en `node`. Los bugs de pantalla
   de las auditorías aparecieron probando a mano.
4. **Nadie recorría las pantallas.** Un recorrido a mano de las 74 encontró, en
   una pasada, que la búsqueda de usuarios y de promociones nunca había
   funcionado y que una ficha inexistente mostraba la pantalla de error.

## Decisión

Cuatro piezas, cada una para un hueco:

| Hueco | Pieza | Comando |
|---|---|---|
| 1 | Un segundo Supabase local, **sólo para tests** (`supabase-tests/`, puerto 55321), que se deja en cero en cada corrida. `migrations/` y `seed.sql` son enlaces a los de `supabase/`: una sola fuente. `tests/apoyo/db.ts` corta si los tests apuntan a la base que usa la app. | `npm run test:aislado` |
| 2 | Volcar el esquema `public` de una base y compararlo con el de la base aislada recién armada. Sirve igual para la nube, por variable de entorno. | `npm run esquema:comparar` |
| 3 | Testing Library + jsdom, por archivo (`// @vitest-environment jsdom`), en `tests/componentes/`. | `npm run test:componentes` |
| 4 | Playwright recorre todas las pantallas del panel —la lista sale de la carpeta, así una nueva entra sola— y el portal sin sesión. | `npm run e2e` |

## Alternativas descartadas

- **Esquemas o bases separadas dentro del mismo Supabase local.** El CLI levanta
  un proyecto por carpeta; un segundo proyecto con otros puertos es lo que el
  CLI ya soporta (`--workdir`) y no toca la configuración del primero.
- **Mockear la base en todos los tests.** Los errores que importan en este
  sistema —RLS, exclusión GiST, privilegios por omisión— viven en Postgres y un
  mock los esconde. Se mantiene el criterio del proyecto: contra la base real.
- **Comparar sólo `supabase migration list`.** El registro dice qué se anotó,
  no qué se aplicó; fue exactamente lo que estaba mal.
- **Contar archivos para el trinquete de la capa de datos.** Partir un archivo
  grande —una mejora— lo subía. Se cuentan los lugares que crean un cliente.

## Consecuencias

- Correr la suite completa ya no cuesta datos: `npm run test:aislado` es el
  comando para «antes de decir que terminaste». `npm test` a secas sigue
  sirviendo sin Docker, salteando lo de base.
- Hacen falta dos stacks de Docker a la vez (unos 2–3 GB más). La aislada se
  apaga con `npm run test:aislado:parar`.
- El recorrido e2e corre en GitHub a mano (`e2e.yml`, `workflow_dispatch`) hasta
  que se lo vea en verde; después conviene sumarlo a cada PR.
- Dependencias nuevas, sólo de desarrollo: `@testing-library/react`,
  `@testing-library/dom`, `@testing-library/user-event`, `jsdom` y
  `@playwright/test`. Ninguna llega al bundle del hotel.
