-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0017 — Avisos fijados (Fase 9)
--
-- Permite destacar un aviso para que quede arriba del tablón (por ejemplo, un
-- corte de agua programado o el cierre de una temporada).
-- ─────────────────────────────────────────────────────────────────────────────

alter table avisos add column fijado boolean not null default false;
comment on column avisos.fijado is 'Si está fijado, se muestra primero en el tablón.';

-- El orden natural del tablón: primero los fijados, después por fecha.
create index on avisos (fijado desc, creado_en desc);

-- Cualquier integrante del staff puede fijar o desfijar un aviso.
create policy "avisos: staff fija" on avisos
  for update using (rol_actual() is not null)
  with check (rol_actual() is not null);

-- El rol `authenticated` tiene UPDATE a nivel de tabla (migración 0006), así que
-- la restricción por columna se impone con un trigger: el staff solo puede
-- cambiar `fijado`; el texto y la autoría quedan congelados. Un admin sí puede
-- corregir el contenido.
create or replace function solo_fijar_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if rol_actual() is distinct from 'admin'
     and (new.mensaje   is distinct from old.mensaje
       or new.autor_id  is distinct from old.autor_id
       or new.creado_en is distinct from old.creado_en) then
    raise exception 'Solo se puede fijar o desfijar un aviso';
  end if;
  return new;
end;
$$;

comment on function solo_fijar_aviso() is
  'Impide que un UPDATE del staff altere algo distinto de avisos.fijado.';

create trigger avisos_solo_fijar
  before update on avisos
  for each row execute function solo_fijar_aviso();
