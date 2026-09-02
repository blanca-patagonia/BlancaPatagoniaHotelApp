-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0068 — Los errores dejan de morir en stdout (Fase 2 de la auditoría)
--
-- Problema que resuelve:
--
-- El sistema ya tiene `lib/registro.ts`, que emite una línea JSON por evento con
-- id de petición y ocultamiento de datos sensibles. Lo que no tiene es **un lugar
-- donde esa línea quede**. Hoy termina en el stdout de Vercel, que nadie del hotel
-- mira. Con siete integraciones externas —dos pasarelas, AFIP, correo, OTAs,
-- cotización, firma— la pregunta no es si algo va a fallar de noche, sino cuánto
-- va a tardar alguien en enterarse. La respuesta actual es: hasta que se queja un
-- huésped.
--
-- Por qué en Postgres y no en un servicio de terceros (ADR 0029):
--
--  1. Los datos de huéspedes no salen del sistema. Un mensaje de error arrastra
--     con frecuencia el dato que lo causó.
--  2. Sin dependencias nuevas, que `AGENTS.md` pide evitar.
--  3. Se ve desde el panel, con los mismos componentes que el resto: el hotel no
--     depende de que alguien abra el log de una plataforma.
--
-- ⚠️ Esta tabla **no reemplaza a `auditoria`** y no hay que confundirlas.
-- `auditoria` es un libro de quién-hizo-qué: la escriben triggers, solo registra
-- escrituras que **salieron bien** y es parte del expediente del hotel. Ésta
-- registra lo que **falló**: excepciones, rechazos de pasarela, escrituras que la
-- base negó. Un error no es una operación sensible y una operación sensible no es
-- un error.
-- ─────────────────────────────────────────────────────────────────────────────

create table errores (
  id         uuid primary key default gen_random_uuid(),

  -- Nombre corto y estable del evento, para poder agrupar: `escritura_fallida`,
  -- `webhook_firma_invalida`, `excepcion_no_manejada`…
  evento     text        not null,
  nivel      text        not null default 'error' check (nivel in ('aviso', 'error')),

  -- Mensaje legible. NO lleva stack: el stack va en `datos`, que se limpia.
  detalle    text,

  -- Id de la petición (`x-vercel-id`). Es lo que permite juntar varias líneas de
  -- la misma navegación. Nulo fuera de una petición (cron, webhook, test).
  pedido     text,

  -- El `digest` que Next le muestra al usuario en la pantalla de error. Es el
  -- ÚNICO hilo entre «me salió un error» y el stack del servidor: sin guardarlo,
  -- alguien reporta un código de ocho caracteres y no hay con qué cruzarlo.
  digest     text,

  ruta       text,
  usuario_id uuid references perfiles(id) on delete set null,
  rol        text,

  -- Contexto libre, ya pasado por la limpieza de `lib/registro.ts`.
  datos      jsonb       not null default '{}'::jsonb,

  creado_en  timestamptz not null default now()
);

comment on table errores is
  'Errores del servidor, para que una falla se vea sin abrir el log de la plataforma. No confundir con `auditoria`, que registra operaciones exitosas.';
comment on column errores.digest is
  'El identificador que Next muestra en la pantalla de error. Es el hilo entre lo que vio el usuario y el stack del servidor.';
comment on column errores.pedido is
  'Id de petición de la plataforma; junta las líneas de una misma navegación.';

-- El listado del panel ordena por fecha descendente y filtra por evento.
create index errores_creado_idx on errores (creado_en desc);
create index errores_evento_idx on errores (evento, creado_en desc);
-- FK indexada desde el principio: `perfiles` es padre de 17 tablas y cada baja de
-- usuario escanea las que no tienen índice (ver migración 0071).
create index errores_usuario_idx on errores (usuario_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table errores enable row level security;

-- Lectura: solo quien puede hacer algo con la información. Un error arrastra
-- rutas, ids y a veces el dato que lo causó; no es para todo el staff.
create policy "errores: admin y gerencia leen"
  on errores for select
  using (rol_actual() in ('admin', 'gerencia'));

-- Sin políticas de INSERT/UPDATE/DELETE: sin política, RLS deniega. Los escribe
-- `service_role` desde `lib/registro.ts`, igual que `auditoria` se escribe sola
-- desde un trigger. Que nadie pueda borrar su propio rastro es el punto.
revoke insert, update, delete on errores from authenticated;
revoke select, insert, update, delete on errores from anon;

-- ── Purga ────────────────────────────────────────────────────────────────────
-- `auditoria` ya crece sin techo y `lib/domain/respaldos.ts` lo señala como
-- problema. Esta tabla nace con la purga puesta: un error de hace tres meses no
-- le sirve a nadie y una tabla de log sin retención termina siendo el objeto más
-- grande de la base.
create or replace function purgar_errores(p_dias int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados int;
begin
  delete from errores
  where creado_en < now() - make_interval(days => p_dias);
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

comment on function purgar_errores(int) is
  'Borra los errores más viejos que `p_dias`. Sin esto la tabla crece indefinidamente.';

-- `revoke ... from public` y no solo `from anon`: Postgres otorga EXECUTE a
-- PUBLIC por defecto al crear una función, y `anon` es miembro de PUBLIC. Un
-- `revoke` solo a `anon` deja el privilegio en pie (ver migración 0070).
revoke execute on function purgar_errores(int) from public;
grant execute on function purgar_errores(int) to service_role;
