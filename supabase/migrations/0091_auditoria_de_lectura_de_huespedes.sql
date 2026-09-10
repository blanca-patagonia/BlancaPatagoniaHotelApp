-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0091 — Auditoría de LECTURA de datos de huésped
--
-- `auditoria` (migración 0020) registra quién ESCRIBIÓ qué en pagos, tarifas y
-- reservas. No dice nada de quién ABRIÓ la ficha de un huésped — un dato
-- personal se filtra igual mirándolo que modificándolo, y hasta ahora nadie
-- quedaba registrado por solo mirar.
--
-- Un SELECT no dispara un trigger en Postgres (a diferencia de INSERT/UPDATE/
-- DELETE), así que esto no se puede resolver del mismo modo que la 0020: hay
-- que dejar que la propia pantalla avise cuándo mostró la ficha. Por eso es una
-- FUNCIÓN que la página llama al renderizar, no un trigger.
--
-- Mismo patrón de seguridad que `registrar_auditoria()`: `security definer`
-- para que cualquier rol autenticado pueda dejar el registro sin necesitar
-- permiso de escritura directo sobre la tabla, y sin poder falsificar el
-- usuario o el rol (los toma el propio `auth.uid()`/`rol_actual()` del lado
-- del servidor, no un parámetro que la pantalla podría mentir).
-- ─────────────────────────────────────────────────────────────────────────────

create table auditoria_accesos (
  id          bigint generated always as identity primary key,
  huesped_id  uuid not null references huespedes (id) on delete cascade,
  usuario_id  uuid,
  rol         rol_usuario,
  -- Desde dónde se accedió: la ficha propia del huésped o la de una reserva
  -- suya. Sin esto, «se vio 40 veces» no dice si fue por gestionar sus
  -- reservas o por curiosear el listado de huéspedes sin motivo operativo.
  origen      text not null check (origen in ('ficha_huesped', 'ficha_reserva')),
  creado_en   timestamptz not null default now()
);

comment on table auditoria_accesos is
  'Quién ABRIÓ la ficha de un huésped y cuándo. Complementa a `auditoria`, que
   solo cubre escrituras.';

create index on auditoria_accesos (huesped_id, creado_en desc);
create index on auditoria_accesos (creado_en desc);

create or replace function registrar_acceso_huesped(p_huesped_id uuid, p_origen text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into auditoria_accesos (huesped_id, usuario_id, rol, origen)
  values (p_huesped_id, auth.uid(), rol_actual(), p_origen);
end;
$$;

comment on function registrar_acceso_huesped(uuid, text) is
  'Deja constancia de que el rol actual abrió la ficha de un huésped. Llamada
   desde la página, no desde un trigger: un SELECT no dispara triggers.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table auditoria_accesos enable row level security;

-- Mismo criterio que `auditoria`: solo quien audita puede leer el registro.
create policy "auditoria_accesos: admin y gerencia leen" on auditoria_accesos
  for select using (rol_actual() in ('admin', 'gerencia'));

-- Nadie inserta a mano: todo pasa por la función `security definer` de arriba.
revoke insert, update, delete on auditoria_accesos from authenticated;
revoke insert, update, delete on auditoria_accesos from anon;

grant execute on function registrar_acceso_huesped(uuid, text) to authenticated;
