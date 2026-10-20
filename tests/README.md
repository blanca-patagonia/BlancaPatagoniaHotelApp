# `tests/` — las pruebas automáticas

Se corren con **Vitest**. Están separadas por **qué necesitan para correr**,
que es lo primero que hay que saber de un test en este proyecto: unos corren en
cualquier máquina y otros exigen una base de datos local.

| Carpeta | Qué prueba | Necesita | Comando |
|---|---|---|---|
| `dominio/` | Reglas de negocio puras de `src/lib/domain/` (precios, IVA, cancelación, disponibilidad, permisos…) | Nada | `npm run test:dominio` |
| `servicios/` | Lógica de servidor con sus dependencias simuladas: webhooks, cron, pasarelas, proveedores externos | Nada | `npm run test:servicios` |
| `acciones/` | Server Actions (lo que guardan los formularios) | Base local para la mayoría | `npm run test:acciones` |
| `base-de-datos/` | RLS por rol, funciones atómicas, anti-overbooking, permisos de `anon` | **Base local** (Docker) | `npm run test:db` |
| `contratos/` | Leen el código del repositorio y fallan si se rompe una regla: capas de la arquitectura, nada de `console` en el camino del dinero, ningún dato de tarjeta… | Nada | `npm run test:contratos` |
| `apoyo/` | Helpers compartidos: conexión a la base de prueba (`db.ts`), sesiones por rol (`roles.ts`) y stubs. **No son tests.** | — | — |

`npm test` corre todo junto.

## La pirámide, en números

La mayoría de las pruebas está abajo, en las reglas puras, que son rápidas y no
dependen de nada. Arriba hay menos, pero son las que prueban que la **base**
—no la aplicación— impide el overbooking y que cada rol ve solo lo suyo.

```
              contratos   ← reglas de arquitectura y seguridad sobre el código
           base-de-datos  ← RLS, funciones SQL, anti-overbooking
        acciones · servicios
   ────────── dominio ──────────   ← la base de la pirámide
```

## Sin base local, 600 tests se saltean (y está bien)

Los de `base-de-datos/` y la mayoría de `acciones/` van bajo
`describe.skipIf(!hayDB)`: sin una base local se saltean y `npm test` igual sale
verde. **No hay que leer «verde» como «todo probado».** Para correrlos:

```bash
npx supabase start
npx supabase db reset        # ⚠️ borra los usuarios de auth
npm run seed:usuarios        # los vuelve a crear
export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… NEXT_PUBLIC_SUPABASE_URL=…
EXIGIR_DB=1 npm test         # con EXIGIR_DB, saltear pasa a ser un error
```

`tests/apoyo/db.ts` **se niega a correr contra una base que no sea local**: estos
tests escriben y borran filas, y contra la base real del hotel destruirían datos.

## Dónde va un test nuevo

| Si probás… | Va en |
|---|---|
| Una función de `src/lib/domain/` | `dominio/<modulo>.test.ts` |
| Un route handler, un cron o un adaptador externo, con `vi.mock` o `fetch` simulado | `servicios/` |
| Una Server Action (`actions.ts`) | `acciones/` (usá `acciones/entorno.ts`) |
| Algo que solo la base garantiza (RLS, una función SQL, una restricción) | `base-de-datos/` |
| Una regla que debe cumplirse en **todo** el código | `contratos/` |

Convención: `describe`/`it` en español, sin mocks en `dominio/`, y todo bugfix
entra con el test que fallaba antes del arreglo.

## Dónde quedó cada archivo (reorganización del 2026-10-17)

Antes todos los tests estaban sueltos en `tests/`. La bitácora, los ADRs y las
migraciones los nombran con la ruta vieja (`tests/overbooking.test.ts`): el
archivo es el mismo, solo cambió de carpeta. `tests/db.ts`, `tests/roles.ts` y
`tests/stubs/` están en `tests/apoyo/`.
