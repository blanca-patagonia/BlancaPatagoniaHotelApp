-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0020 — Auditoría de operaciones sensibles (Fase 11)
--
-- Equivalente al "revisar datos" de contabilidad en Odoo. Registra quién cambió
-- qué y cuándo en las tablas donde un error o un abuso tiene consecuencias
-- económicas: pagos, tarifas y el estado de las reservas (cancelaciones).
--
-- El registro es *append-only*: nadie puede editarlo ni borrarlo desde la API.
-- ─────────────────────────────────────────────────────────────────────────────

create table auditoria (
  id            bigint generated always as identity primary key,
  tabla         text        not null,
  registro_id   uuid,
  accion        text        not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  usuario_id    uuid,
  rol           rol_usuario,
  datos_previos jsonb,
  datos_nuevos  jsonb,
  creado_en     timestamptz not null default now()
);

comment on table auditoria is
  'Bitácora append-only de cambios en operaciones sensibles (pagos, tarifas, estados de reserva).';
comment on column auditoria.datos_previos is 'Fila completa antes del cambio (null en INSERT).';
comment on column auditoria.datos_nuevos is 'Fila completa después del cambio (null en DELETE).';

create index on auditoria (tabla, creado_en desc);
create index on auditoria (registro_id);

-- ── Función genérica ─────────────────────────────────────────────────────────
-- Una sola función sirve para todas las tablas: se apoya en TG_TABLE_NAME y en
-- los registros OLD/NEW, así sumar una tabla nueva es agregar un trigger.
create or replace function registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previos jsonb := null;
  v_nuevos  jsonb := null;
  v_id      uuid  := null;
begin
  if TG_OP <> 'INSERT' then
    v_previos := to_jsonb(OLD);
    v_id := OLD.id;
  end if;
  if TG_OP <> 'DELETE' then
    v_nuevos := to_jsonb(NEW);
    v_id := NEW.id;
  end if;

  insert into auditoria (tabla, registro_id, accion, usuario_id, rol, datos_previos, datos_nuevos)
  values (TG_TABLE_NAME, v_id, TG_OP, auth.uid(), rol_actual(), v_previos, v_nuevos);

  -- AFTER trigger: el valor de retorno se ignora, pero PL/pgSQL lo exige.
  return null;
end;
$$;

comment on function registrar_auditoria() is
  'Trigger genérico que vuelca la fila anterior y la nueva en `auditoria`.';

-- ── Triggers ─────────────────────────────────────────────────────────────────
-- Pagos: cualquier movimiento de dinero.
create trigger pagos_auditoria
  after insert or update or delete on pagos
  for each row execute function registrar_auditoria();

-- Tarifas: cambiar un precio afecta todas las cotizaciones futuras.
create trigger tarifas_auditoria
  after insert or update or delete on tarifas
  for each row execute function registrar_auditoria();

-- Reservas: solo los cambios de estado (una cancelación libera inventario y
-- puede generar un cargo). Auditar cada UPDATE llenaría la tabla de ruido.
create trigger reservas_estado_auditoria
  after update on reservas
  for each row
  when (old.estado is distinct from new.estado)
  execute function registrar_auditoria();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table auditoria enable row level security;

-- Solo lectura, y solo para quien audita. No hay política de INSERT, UPDATE ni
-- DELETE: las filas las escribe el trigger, que corre como `security definer` y
-- por lo tanto no está sujeto a estas políticas.
create policy "auditoria: admin y gerencia leen" on auditoria
  for select using (rol_actual() in ('admin', 'gerencia'));

-- El rol `authenticated` recibió DML sobre todas las tablas en la migración
-- 0006. Acá se revoca lo que no corresponde: la bitácora no se toca a mano.
revoke insert, update, delete on auditoria from authenticated;
revoke insert, update, delete on auditoria from anon;
