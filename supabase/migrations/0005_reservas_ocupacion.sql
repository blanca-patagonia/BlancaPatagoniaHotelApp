-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0005 — Reservas, ocupación y motor anti-overbooking (Fase 1)
-- El corazón del sistema: la tabla `estadias` lleva una restricción de exclusión
-- que impide, a nivel de base de datos, que dos reservas activas se solapen sobre
-- la misma unidad (ver ADR 0002).
-- ─────────────────────────────────────────────────────────────────────────────

create type estado_reserva as enum
  ('pendiente','confirmada','pagada','in_house','checkout','cancelada','no_show');

-- ── Reservas ──────────────────────────────────────────────────────────────────
create table reservas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique
                 default ('BP-' || to_char(now(),'YYMMDD') || '-' ||
                          upper(substr(md5(random()::text), 1, 4))),
  huesped_id   uuid references huespedes (id) on delete restrict,
  estado       estado_reserva not null default 'pendiente',
  canal        text not null default 'directo',          -- directo|web|booking|expedia
  tarifa_tipo  text not null default 'rack'
                 check (tarifa_tipo in ('neto','rack')), -- rack=mostrador, neto=agencia
  promocion_id uuid references promociones (id),
  politica_id  uuid references politicas_cancelacion (id),
  moneda       char(3) not null default 'USD',
  total        numeric(12,2) not null default 0,
  notas        text not null default '',
  creada_por   uuid references perfiles (id),
  creada_en    timestamptz not null default now()
);
comment on table reservas is 'Reserva con su estado, canal y totales.';

-- ── Estadías (ocupación) ──────────────────────────────────────────────────────
create table estadias (
  id             uuid primary key default gen_random_uuid(),
  reserva_id     uuid not null references reservas (id) on delete cascade,
  unidad_id      uuid not null references unidades (id) on delete restrict,
  tipo_unidad_id uuid not null references tipos_unidad (id) on delete restrict,
  periodo        daterange not null,          -- [check_in, check_out)
  estado         estado_reserva not null default 'pendiente',
  precio_noche   numeric(10,2) not null default 0,
  huespedes      int not null default 1 check (huespedes > 0),
  check (not isempty(periodo)
         and lower(periodo) is not null
         and upper(periodo) is not null),
  -- Anti-overbooking: ninguna unidad puede tener dos estadías ACTIVAS solapadas.
  constraint estadias_sin_solape exclude using gist (
    unidad_id with =,
    periodo   with &&
  ) where (estado in ('pendiente','confirmada','pagada','in_house'))
);
comment on table estadias is
  'Ocupación por unidad y período. La restricción de exclusión impide overbooking.';
create index on estadias (reserva_id);

-- Mantiene `estadias.estado` en sincronía con `reservas.estado`, de modo que al
-- cancelar/confirmar una reserva la unidad se libera/ocupa automáticamente.
create or replace function sincronizar_estado_estadias()
returns trigger language plpgsql as $$
begin
  update estadias set estado = new.estado where reserva_id = new.id;
  return new;
end;
$$;
create trigger reservas_estado_sync
  after update of estado on reservas
  for each row execute function sincronizar_estado_estadias();

-- Acompañantes de la reserva (además del titular en `reservas.huesped_id`).
create table reserva_huespedes (
  reserva_id uuid not null references reservas (id) on delete cascade,
  huesped_id uuid not null references huespedes (id) on delete cascade,
  primary key (reserva_id, huesped_id)
);

-- ── Motor de disponibilidad ───────────────────────────────────────────────────
-- Para el staff: unidades libres (invoker → respeta RLS del recepcionista).
create or replace function unidades_disponibles(
  desde date, hasta date, p_categoria categoria_unidad default null
) returns setof unidades language sql stable as $$
  select u.*
  from unidades u
  join tipos_unidad t on t.id = u.tipo_unidad_id
  where u.activo and t.activo
    and u.estado <> 'bloqueada'
    and (p_categoria is null or t.categoria = p_categoria)
    and not exists (
      select 1 from estadias e
      where e.unidad_id = u.id
        and e.estado in ('pendiente','confirmada','pagada','in_house')
        and e.periodo && daterange(desde, hasta, '[)')
    );
$$;

-- Para el portal público: disponibilidad AGREGADA por tipo (no expone unidades
-- ni ocupación). SECURITY DEFINER para poder calcularla sin sesión.
create or replace function disponibilidad_por_tipo(
  desde date, hasta date, p_categoria categoria_unidad default null
) returns table (
  tipo_unidad_id uuid, codigo text, nombre text,
  categoria categoria_unidad, capacidad_max int, disponibles bigint
) language sql stable security definer set search_path = public as $$
  select t.id, t.codigo, t.nombre, t.categoria, t.capacidad_max,
         count(u.id) filter (
           where u.id is not null
             and not exists (
               select 1 from estadias e
               where e.unidad_id = u.id
                 and e.estado in ('pendiente','confirmada','pagada','in_house')
                 and e.periodo && daterange(desde, hasta, '[)')
             )
         ) as disponibles
  from tipos_unidad t
  left join unidades u
    on u.tipo_unidad_id = t.id and u.activo and u.estado <> 'bloqueada'
  where t.activo and (p_categoria is null or t.categoria = p_categoria)
  group by t.id, t.codigo, t.nombre, t.categoria, t.capacidad_max;
$$;

grant execute on function disponibilidad_por_tipo(date, date, categoria_unidad)
  to anon, authenticated;
grant execute on function unidades_disponibles(date, date, categoria_unidad)
  to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table reservas          enable row level security;
alter table estadias          enable row level security;
alter table reserva_huespedes enable row level security;

create policy "reservas: staff lee" on reservas
  for select using (rol_actual() is not null);
create policy "reservas: recepcion+ gestiona" on reservas
  for all using (rol_actual() in ('admin','gerencia','recepcion'))
  with check (rol_actual() in ('admin','gerencia','recepcion'));

create policy "estadias: staff lee" on estadias
  for select using (rol_actual() is not null);
create policy "estadias: recepcion+ gestiona" on estadias
  for all using (rol_actual() in ('admin','gerencia','recepcion'))
  with check (rol_actual() in ('admin','gerencia','recepcion'));

create policy "reserva_huespedes: staff lee" on reserva_huespedes
  for select using (rol_actual() is not null);
create policy "reserva_huespedes: recepcion+ gestiona" on reserva_huespedes
  for all using (rol_actual() in ('admin','gerencia','recepcion'))
  with check (rol_actual() in ('admin','gerencia','recepcion'));
