---
name: db-migration
description: Escribir una migración SQL de Supabase para este proyecto. Usalo cuando haya que crear o cambiar tablas, columnas, índices, políticas RLS, funciones de Postgres o triggers. Cubre la numeración, las políticas obligatorias por rol, los GRANT y lo que nunca se hace.
---

# Escribir una migración

> **Una migración aplicada es historia: no se reescribe.** Si algo salió mal, se corrige con la
> siguiente. Hay un hook que bloquea la edición de migraciones existentes y te dice qué número usar.

## 1. Numeración y nombre

```
supabase/migrations/0032_descripcion_en_espanol.sql
```

Cuatro dígitos, `snake_case`, en español. La última hoy es `0031_tarifas_neto_fuera_del_alcance_publico.sql`.
Encabezado con el mismo formato que el resto:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0032 — Qué hace (Fase N)
-- Por qué se hace. El "por qué" es lo que no se deduce del SQL.
-- ─────────────────────────────────────────────────────────────────────────────
```

## 2. RLS es obligatorio en toda tabla nueva

```sql
create table cosas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  creado_en  timestamptz not null default now()
);

alter table cosas enable row level security;   -- ← nunca falta
```

**Activar RLS sin políticas deja la tabla inaccesible; activarla con una política floja es peor que
no activarla**, porque da sensación de seguridad. Escribí una política por operación y decí a qué rol
alcanza:

```sql
create policy "cosas: staff lee"
  on cosas for select
  using (rol_actual() is not null);

create policy "cosas: recepcion+ gestiona"
  on cosas for all
  using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));
```

`for all` **necesita `with check`** además de `using`. Sin `with check`, un usuario puede escribir
filas que después no puede leer, y ese hueco se usa para escalar.

`rol_actual()` está definida en `0001_perfiles_y_roles.sql:25` — `security definer` con
`set search_path = public` para evitar recursión de RLS y secuestro de `search_path`.

## 3. Índices en las claves foráneas

**Postgres NO indexa las FK automáticamente.** Sin índice, cada `DELETE` del padre escanea la tabla
hija entera:

```sql
create index on cosas (reserva_id);
```

Indexá también las columnas por las que filtrás y ordenás en el panel.

## 4. GRANT en local

En local hay que declarar los `GRANT` a `anon` / `authenticated` / `service_role` (ver
`0006_grants_api.sql`); en hosted los aplica la plataforma. **La seguridad real la impone RLS**, no
el GRANT: `0006:14` ya le da a `authenticated` todo sobre todas las tablas.

Si la tabla NO debe ser visible para `anon`, revocá explícito, como hace `0031`:

```sql
revoke select on cosas from anon;
```

## 5. Cosas que este repo ya aprendió a los golpes

- **No hagas `cotizar_estadia` `security definer`.** Ahí `current_user` pasa a ser el dueño de la
  función y la guarda del precio neto queda siempre en verdadero (ADR 0016).
- Toda función nueva `security definer` lleva `set search_path = public`. Sin eso es un vector de
  secuestro.
- El anti-overbooking es una **restricción de exclusión GiST** sobre `estadias`
  (`unidad_id WITH =, periodo WITH &&`), ADR 0002. Si tocás estados de reserva, verificá que la
  restricción siga cubriendo todos los estados activos.
- Migraciones que bloquean en producción: `ALTER TABLE ... ADD COLUMN NOT NULL` sin default barato,
  y `CREATE INDEX` sin `CONCURRENTLY`.

## 6. Probar

Necesita Docker. Si no lo tenés, decilo explícitamente en vez de dar por buena la migración.

```bash
npx supabase db reset        # aplica TODAS las migraciones desde cero + seed
npm run seed:usuarios        # db reset borra los usuarios de auth: hay que rehacerlos
EXIGIR_DB=1 npm test         # los tests de integración ahora son obligatorios
```

Escribí un test que verifique la política nueva con `clienteAnonimo()`: que `anon` **no** pueda leer
lo que no debe. Ver el skill `write-tests`.

## Checklist

- [ ] Número correlativo, nombre en español, encabezado con el porqué
- [ ] `enable row level security` en toda tabla nueva
- [ ] Una política por operación, con `with check` donde haya escritura
- [ ] Índice en cada FK y en las columnas de filtro/orden
- [ ] `set search_path = public` en toda función `security definer`
- [ ] Test con `clienteAnonimo()` que verifique lo que NO debe verse
- [ ] `npx supabase db reset` aplica limpio (o se aclara que no se pudo probar)
