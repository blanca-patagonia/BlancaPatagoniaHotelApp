# Cómo contribuir

Proyecto de tesis del Sistema Integral de Gestión Hotelera del **Hotel Blanca
Patagonia** — Analista de Sistemas, IES. Lo desarrollan Octavio Fakiani y
Santiago Morán.

Es un repositorio público, así que esto está escrito para tres lectores a la vez:
los dos autores, quien evalúe la tesis y quien pase por acá y encuentre algo roto.

## Si venís de afuera

Lo más útil que podés hacer es **abrir un issue**. Las plantillas piden el rol y
la pantalla porque en este sistema los permisos los impone la base de datos (RLS):
sin saber con qué rol pasó, un bug de permisos no se puede reproducir.

- 🐛 [Reportar un error](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/issues/new?template=01-bug.yml)
- 💡 [Proponer una mejora](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/issues/new?template=02-mejora.yml)
- 🔒 **Vulnerabilidades: no van en un issue.** El camino está en [`SECURITY.md`](SECURITY.md).

Antes de proponer una mejora conviene mirar `docs/decisiones/`: varias cosas que
parecen faltar **están decididas a propósito**, y el ADR explica por qué. Que la
sincronización con Booking sea de sólo lectura, por ejemplo, no es un pendiente
(ADR 0021).

Los pull requests de afuera son bienvenidos, con una advertencia honesta: es una
entrega académica con fecha, así que puede que uno grande no se pueda revisar a
tiempo. Para algo que no sea un arreglo chico, **abrí primero un issue** y
charlémoslo.

## Poner el proyecto a andar

```bash
npm run setup     # instala y dice qué falta y cómo resolverlo
npm run dev
```

El paso a paso, incluido el Supabase local con Docker, está en
[`COMO-LEVANTARLO.md`](COMO-LEVANTARLO.md).

## Antes de mandar un pull request

Las reglas completas están en [`AGENTS.md`](AGENTS.md) —arquitectura,
convenciones, trampas conocidas— y el proceso, en [`CLAUDE.md`](CLAUDE.md). Lo
mínimo:

```bash
npm run check     # lint + typecheck + tests + build
```

⚠️ **Leé la salida, no el exit code.** Sin `.env.local`, `npm run check` devuelve 0
con tests en rojo: tres archivos fallan por falta de `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`, y el código de salida igual da 0. Para que la suite
corra completa hay que exportar las **tres** variables:

```bash
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

La tercera es la que se olvida: sin ella, los cuatro tests del borde público del
ADR 0016 se saltean **en silencio**, aun con `EXIGIR_DB=1`.

Después, la checklist del template del PR. Los tres puntos que más se pasan por
alto en este repositorio:

1. **Todo `{ error }` de Supabase se revisa.** Un `insert` que falla sin que nadie
   avise deja la pantalla recargando sin cambios, y quien la usa no puede
   distinguir «no se pudo» de «no pasó nada». Va `cortarSiFalla` o
   `registrarFalla`, de `lib/acciones.ts`.
2. **Toda página y acción del panel verifica el rol** con `requerirAcceso(area)`.
3. **Un bugfix entra con el test que fallaba antes del fix.**

## Convenciones que sorprenden

- **Todo en español**, identificadores incluidos: `cortarSiFalla`,
  `calcularEstadia`, `rol_actual()`. No es decorativo — es un requisito de la
  tesis y hace que el código se lea igual que la documentación.
- **`lib/domain/` es puro.** No importa Supabase, ni Next, ni React, ni zod. Son
  las reglas de negocio, testeables sin base.
- **Las migraciones no se editan.** Ya aplicada, es historia: se crea la siguiente
  con el número que sigue, y **dos migraciones con el mismo número no conviven**
  (Supabase da la segunda por aplicada y la saltea sin avisar).
- **La integridad crítica vive en la base de datos, no en la aplicación.** El
  anti-overbooking es una restricción de exclusión de Postgres: aunque la app
  tenga un bug, la doble venta se rechaza (ADR 0002).

## Qué corre cuando abrís el PR

| Check | Qué verifica |
|---|---|
| **CI** | Levanta Postgres con Docker y corre `npm audit`, typecheck, lint, la suite completa y el build |
| **CodeQL** | Análisis estático de seguridad sobre el código |
| **Dependencias nuevas del PR** | Falla si el PR agrega una dependencia con vulnerabilidad alta o crítica |

La configuración del repositorio en GitHub —lo que hay que activar desde la web y
no puede vivir en un archivo— está en [`docs/github.md`](docs/github.md).
