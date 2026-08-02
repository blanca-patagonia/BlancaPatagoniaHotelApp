-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0023 — Encuestas de satisfacción y mantenimiento preventivo (Fase 11)
--
-- 1) Encuesta NPS ligada a la estadía, con token público (mismo mecanismo que
--    la confirmación de reserva y la firma de contratos).
-- 2) Planes de mantenimiento preventivo por unidad, que generan órdenes
--    automáticamente en lugar de esperar a que algo se rompa.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Encuestas de satisfacción ────────────────────────────────────────────────
create table encuestas_satisfaccion (
  id           uuid        primary key default gen_random_uuid(),
  reserva_id   uuid        not null references reservas (id) on delete cascade,
  token        uuid        not null default gen_random_uuid(),
  -- Net Promoter Score: «¿Qué tan probable es que nos recomiendes?» de 0 a 10.
  puntaje      int         check (puntaje between 0 and 10),
  comentario   text,
  enviada_en   timestamptz not null default now(),
  respondida_en timestamptz,

  -- Una encuesta por reserva: si no, el NPS se podría inflar respondiendo dos veces.
  constraint encuestas_una_por_reserva unique (reserva_id)
);

comment on table encuestas_satisfaccion is
  'Encuesta NPS post check-out, ligada a la estadía y respondida por URL con token.';
comment on column encuestas_satisfaccion.puntaje is
  'NPS de 0 a 10; null mientras no se responda.';

create unique index encuestas_token_idx on encuestas_satisfaccion (token);
create index on encuestas_satisfaccion (respondida_en);

/*
  Genera la encuesta al pasar la reserva a `checkout`.

  Se dispara en la base y no en la aplicación para que valga sea cual sea el
  camino por el que se haga el check-out (panel, acción futura, script).
  `on conflict do nothing` la hace idempotente: volver a checkout no duplica.
*/
create or replace function generar_encuesta_checkout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'checkout' and old.estado is distinct from 'checkout' then
    insert into encuestas_satisfaccion (reserva_id)
    values (new.id)
    on conflict (reserva_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function generar_encuesta_checkout() is
  'Crea la encuesta de satisfacción cuando la reserva pasa a checkout.';

create trigger reservas_generar_encuesta
  after update on reservas
  for each row execute function generar_encuesta_checkout();

-- ── Mantenimiento preventivo ─────────────────────────────────────────────────
create table planes_mantenimiento (
  id              uuid    primary key default gen_random_uuid(),
  unidad_id       uuid    references unidades (id) on delete cascade,
  titulo          text    not null,
  descripcion     text,
  -- Cada cuántos meses se repite la tarea (ej. calefacción cada 6).
  cada_meses      int     not null check (cada_meses between 1 and 60),
  prioridad       prioridad_mant not null default 'media',
  ultima_ejecucion date,
  proxima_ejecucion date   not null,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

comment on table planes_mantenimiento is
  'Tareas de mantenimiento preventivo recurrentes por unidad.';
comment on column planes_mantenimiento.proxima_ejecucion is
  'Fecha en la que corresponde generar la próxima orden de trabajo.';

create index on planes_mantenimiento (activo, proxima_ejecucion);

/*
  Genera las órdenes de los planes que ya vencieron y reprograma la siguiente.

  Devuelve cuántas órdenes creó. Igual que las otras funciones programadas del
  proyecto, hoy se dispara desde el panel; en producción iría por cron.
*/
create or replace function generar_mantenimiento_preventivo()
returns int
language plpgsql
as $$
declare
  v_plan   record;
  v_creadas int := 0;
begin
  for v_plan in
    select * from planes_mantenimiento
    where activo and proxima_ejecucion <= current_date
  loop
    insert into ordenes_mantenimiento (unidad_id, titulo, descripcion, prioridad, estado)
    values (
      v_plan.unidad_id,
      v_plan.titulo,
      coalesce(v_plan.descripcion, '') || ' (mantenimiento preventivo programado)',
      v_plan.prioridad,
      'pendiente'
    );

    update planes_mantenimiento
    set ultima_ejecucion = current_date,
        proxima_ejecucion = current_date + make_interval(months => v_plan.cada_meses)
    where id = v_plan.id;

    v_creadas := v_creadas + 1;
  end loop;

  return v_creadas;
end;
$$;

comment on function generar_mantenimiento_preventivo() is
  'Crea las órdenes de los planes preventivos vencidos y reprograma la siguiente. Programar por cron.';

grant execute on function generar_mantenimiento_preventivo() to authenticated, service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table encuestas_satisfaccion enable row level security;
alter table planes_mantenimiento   enable row level security;

-- Las respuestas las lee el staff; la pantalla pública usa `service_role` con
-- el token, así que `anon` no necesita ninguna política.
create policy "encuestas: staff lee" on encuestas_satisfaccion
  for select using (rol_actual() is not null);

create policy "planes: staff lee" on planes_mantenimiento
  for select using (rol_actual() is not null);
create policy "planes: admin/gerencia gestionan" on planes_mantenimiento
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));
