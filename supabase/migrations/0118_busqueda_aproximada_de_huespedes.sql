-- 0118 — Búsqueda aproximada de huéspedes (tolera errores de tipeo).
--
-- Origen: en el asistente de IA, «busca la reserva a nombre de amiron» no
-- encontraba a «almiron»: la búsqueda era por coincidencia exacta de texto
-- (`ilike '%amiron%'`), y una letra de menos alcanzaba para no encontrar nada.
--
-- Se usa `pg_trgm` (similitud por trigramas), disponible en Supabase. La
-- función devuelve SÓLO el id y un puntaje: el nombre se compara adentro de la
-- base y no sale. Así el asistente sigue sin recibir datos personales (ADR
-- 0039): con los ids busca las reservas y contesta con códigos y enlaces.
--
-- `security invoker`: corre con los permisos de quien pregunta, así que RLS de
-- `huespedes` sigue aplicando (housekeeping no ve huéspedes, tampoco por acá).

create extension if not exists pg_trgm with schema extensions;

create or replace function buscar_huespedes_parecidos(p_termino text, p_limite int default 5)
returns table (id uuid, parecido real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select h.id,
         greatest(
           word_similarity(lower(p_termino), lower(h.apellido)),
           word_similarity(lower(p_termino), lower(coalesce(h.nombre, ''))),
           similarity(lower(p_termino), lower(h.apellido || ' ' || coalesce(h.nombre, '')))
         ) as parecido
  from huespedes h
  where length(trim(p_termino)) >= 3
  order by parecido desc
  limit least(greatest(p_limite, 1), 20)
$$;

comment on function buscar_huespedes_parecidos(text, int) is
  'Huéspedes con nombre o apellido parecido al término (pg_trgm). Devuelve sólo id y puntaje, nunca el nombre: lo usa el asistente de IA, que no recibe datos personales (ADR 0039). security invoker: aplica RLS.';

-- Una función nace ejecutable por PUBLIC (y `anon` es parte de PUBLIC): se
-- cierra y se abre sólo al personal (ver 0070 y tests/base-de-datos/funciones-sin-public.test.ts).
revoke execute on function buscar_huespedes_parecidos(text, int) from public;
grant execute on function buscar_huespedes_parecidos(text, int) to authenticated, service_role;
