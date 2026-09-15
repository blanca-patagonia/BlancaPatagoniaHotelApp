-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0108 — Termina lo que la 0107 no pudo
--
-- La 0107 intentaba borrar `CAB-2D-5P` y `CAB-3D-7P` directo, asumiendo que
-- ya no tenían ninguna unidad física apuntándolos. Eso vale para un
-- `db reset` de cero, pero no para una base que ya tenía cargado el catálogo
-- **representativo** original (como la hosted, o como quedó la local de
-- tanto probar en esta sesión): ahí siguen «Cabaña Lenga», «Cabaña Ñire»,
-- «Cabaña Calafate», «Cabaña Notro» y «Cabaña Coihue» — las unidades
-- ficticias de `seed.sql` antes de la 0106—, y esas SÍ referencian los tipos,
-- así que la 0107 se corta con un error de FK sin borrar nada.
--
-- ── Mismo criterio que la 0107: borrar si se puede, dar de baja si no ───────
--
-- Si alguna de esas cinco unidades ficticias tiene una estadía real cargada
-- (`estadias.unidad_id` es `on delete restrict`, migración 0005), borrarla
-- perdería de qué unidad fue esa estadía — el mismo error que el proyecto
-- evita en cualquier otro lado. Se intenta el borrado y, si la base lo
-- rechaza por historial, se da de baja (`activo = false`) en su lugar: sigue
-- existiendo para no romper el historial, pero deja de aparecer en la
-- grilla de ocupación y en cualquier alta nueva (que sólo lee `activo = true`).
--
-- Recién después se reintentan los dos `tipos_unidad`: si terminó quedando
-- una unidad dada de baja (no borrada) bajo alguno, ese tipo se queda —lo
-- sigue referenciando— y no es un error, es la misma garantía.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  nombre_unidad text;
begin
  foreach nombre_unidad in array array[
    'Cabaña Lenga', 'Cabaña Ñire', 'Cabaña Calafate', 'Cabaña Notro', 'Cabaña Coihue'
  ]
  loop
    begin
      delete from unidades where nombre = nombre_unidad;
    exception when foreign_key_violation then
      update unidades set activo = false where nombre = nombre_unidad;
    end;
  end loop;
end $$;

do $$
declare
  codigo_tipo text;
begin
  foreach codigo_tipo in array array['CAB-2D-5P', 'CAB-3D-7P']
  loop
    begin
      delete from tipos_unidad where codigo = codigo_tipo;
    exception when foreign_key_violation then
      null; -- Queda una unidad de baja con historial real bajo este tipo.
    end;
  end loop;
end $$;
