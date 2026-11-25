# Manual técnico

> Rama `tesis-a-presentar` (versión reducida, [ADR 0045](../decisiones/0045-version-reducida-para-la-tesis.md)).
> Documento en construcción: se completa hacia la entrega final.

## Requisitos

- Node.js ≥ 20.12 (`engines` de `package.json`) y npm
- Un proyecto de Supabase (es la base con la que se trabaja; instructivo en
  [`COMO-LEVANTARLO.md`](../../COMO-LEVANTARLO.md))
- (Sólo para correr los tests) Docker, para la base local de Supabase

## Puesta en marcha (desarrollo)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local   # y completar con los valores reales

# 3. Levantar la app
npm run dev                  # http://localhost:3000
```

`npm run setup` instala y dice qué falta para arrancar.

## Base de datos

El sistema usa un proyecto Supabase en la nube. La base local (Docker) es sólo
para los tests y se maneja con un comando que la levanta, la deja en cero, siembra
el administrador y corre todo ([ADR 0042](../decisiones/0042-verificacion-base-aislada-esquema-e2e.md)):

```bash
npm run test:aislado         # base propia en el puerto 55321, sin saltear tests
npm run test:aislado:parar   # la apaga
npm run esquema:comparar     # ¿la base tiene el esquema de las migraciones?
```

Las 127 migraciones (`supabase/migrations/`) crean 69 tablas. La base no se achicó
con la reducción: cuáles son del sistema y cuáles quedaron sin código está en
[`modelo-datos.md`](../2-arquitectura/modelo-datos.md).

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Servidor de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | Chequeo de tipos |
| `npm test` | Tests (Vitest); sin base local los que la necesitan se saltean |
| `npm run test:dominio` · `test:servicios` · `test:acciones` · `test:db` · `test:contratos` · `test:componentes` | Un tipo de test por vez (ver `tests/README.md`) |
| `npm run test:aislado` | Todos los tests, sin saltear nada, contra una base propia |
| `npm run e2e` | Recorrido de las pantallas en un navegador (Playwright) |
| `npm run check` | lint + typecheck + tests + build |
| `npm run seed:usuarios` | Crea el primer administrador de una base nueva |

## Tareas programadas

`vercel.json` declara tres, todas protegidas por `CRON_SECRET`:

| Ruta | Frecuencia | Qué hace |
|---|---|---|
| `/api/cron/notificaciones` | cada 5 min | Manda lo anotado en la bandeja de avisos por correo |
| `/api/cron/salud` | cada 15 min | Sondea que la base responda |
| `/api/cron/mantenimiento` | diaria | Expira reservas pendientes y purga errores viejos |

## Estructura del repositorio

Ver [arquitectura.md](../2-arquitectura/arquitectura.md), [ESTRUCTURA.md](../../ESTRUCTURA.md)
y el README principal.
