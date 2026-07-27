-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0008 — Cotización de estadía (Fase 2)
-- Devuelve el precio por noche de un tipo de unidad en un rango, resolviendo la
-- temporada de cada fecha. Sirve al panel interno y al portal público (Fase 4).
-- Montos SIN IVA; el IVA lo aplica el motor de precios (lib/domain/precios.ts).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function cotizar_estadia(
  p_tipo_unidad_id uuid,
  p_check_in       date,
  p_check_out      date,
  p_tarifa_tipo    text default 'rack'
) returns table (fecha date, temporada_id uuid, precio numeric, iva_pct numeric)
language sql stable as $$
  select d::date as fecha,
         temporada_en(d::date) as temporada_id,
         case when p_tarifa_tipo = 'neto' then t.precio_neto else t.precio_rack end as precio,
         t.iva_pct
  from generate_series(p_check_in, p_check_out - 1, interval '1 day') as d
  left join tarifas t
    on t.tipo_unidad_id = p_tipo_unidad_id
   and t.temporada_id = temporada_en(d::date);
$$;

comment on function cotizar_estadia is
  'Precio por noche (según canal) de un tipo de unidad en [check_in, check_out); resuelve la temporada de cada fecha.';

grant execute on function cotizar_estadia(uuid, date, date, text)
  to anon, authenticated, service_role;
