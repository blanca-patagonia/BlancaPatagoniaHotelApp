# ADR 0017 — El alta de un usuario nace sin privilegios

**Estado:** aceptada · **Fecha:** 2026-08-14 · **Fase:** Auditoría · Fase 3

## Contexto

La migración `0001_perfiles_y_roles.sql` creó la tabla `perfiles` con
`rol rol_usuario not null default 'recepcion'` y `activo boolean not null default true`
(líneas 13-14). El trigger `manejar_nuevo_usuario` (línea 46) inserta únicamente
`(id, nombre)`, de modo que toma ambos valores por omisión. El trigger está declarado
sobre `after insert on auth.users`, es decir que se dispara en **cualquier** alta.

`supabase/config.toml` tenía `enable_signup = true` en las dos secciones y
`enable_confirmations = false`. La clave publicable de Supabase viaja al navegador por
diseño —se verificó que aparece en `.next/static/chunks/`— y con ella se puede invocar
`POST /auth/v1/signup` desde cualquier lado.

La combinación daba esto: **cualquier persona en internet podía crearse una cuenta y
obtener un perfil de recepción activo, sin confirmar el correo.**

Ese perfil satisface directamente las políticas RLS del esquema
(`rol_actual() in ('admin','gerencia','recepcion')` sobre huéspedes, reservas, estadías,
pagos, consumos, facturas y movimientos de cuenta). Los `GRANT` de
`0006_grants_api.sql:14` ya habilitan a `authenticated` sobre todas las tablas, así que
RLS era lo único que separaba a un desconocido de la base entera. Además,
`obtenerSesion` (`lib/auth/session.ts:32`) valida `activo` y `esRolValido`: ambos daban
verdadero, con lo cual el atacante también entraba al panel interno.

Esto contradecía de frente el **ADR 0005**, que declara que «los usuarios no se
auto-registran». La decisión estaba bien tomada; lo que faltaba era algo que la hiciera
cumplir.

## Decisión

Dos capas, ambas necesarias.

**1. Apagar el auto-registro.** `enable_signup = false` en las dos secciones de
`supabase/config.toml`.

**2. Que el default no conceda nada.** Migración `0032`: se agrega el valor `sin_rol` al
enum `rol_usuario`, se cambian los defaults a `rol = 'sin_rol'` y `activo = false`, y se
reescribe `manejar_nuevo_usuario` para que inserte esos valores **de forma explícita**.

Del lado del código, `sin_rol` se deja deliberadamente **fuera** de `ROLES`
(`lib/domain/roles.ts`): así `esRolValido` devuelve `false` y `obtenerSesion` descarta la
sesión.

## Alternativas consideradas

- **Solo apagar el signup.** Descartada: es una casilla del panel de Supabase que
  cualquiera puede volver a marcar sin saber lo que habilita. La configuración puede
  fallar; el default de la tabla, no.
- **Borrar el trigger.** Descartada: `app/panel/usuarios/actions.ts` depende de que el
  perfil exista al crear el usuario con `service_role`.
- **Permitir `rol` nulo.** Descartada: la columna es `not null`, y varias políticas
  comparan con `rol_actual() is not null`, que un NULL habría dejado pasar por otro camino.
- **Cambiar el rol de los perfiles ya existentes.** Descartada: sería un incidente
  operativo. La migración documenta la consulta para revisarlos a mano.

## Consecuencias

- Un alta que no pase por `app/panel/usuarios` no puede iniciar sesión ni leer nada.
- El camino legítimo no cambia: ya fijaba `rol` y `activo` explícitamente.
- **`sin_rol` no debe agregarse nunca a `ROLES`.** Hacerlo convertiría un perfil sin
  aprovisionar en una sesión válida. Hay un test que lo protege
  (`tests/alta-sin-privilegios.test.ts`).
- ⚠️ `config.toml` configura el Supabase **local**. En el proyecto hosted hay que apagar
  el registro además en *Authentication → Providers*, donde el default de la plataforma
  es «habilitado».
- Si la base estuvo expuesta con el registro abierto, hay que auditar a mano qué perfiles
  se crearon fuera del alta legítima.
