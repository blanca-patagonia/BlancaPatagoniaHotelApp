-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0031 — El precio neto sale del alcance del rol `anon`
-- (Fase 2 de la auditoría de seguridad, segunda parte)
--
-- Qué cierra
--
-- La migración 0030 impidió que `cotizar_estadia` devolviera el precio neto a
-- `anon`, pero dejó abierto el otro camino al mismo dato, y quedó anotado ahí:
--
--     GET /rest/v1/tarifas?select=precio_neto
--
-- `grant select on all tables … to anon` (migración 0006) más la política
-- «tarifas: lectura publica … using (true)», que no lleva cláusula `to` y por lo
-- tanto aplica a PUBLIC, dejaban leer la tabla entera con la clave publicable
-- —que viaja en el bundle del navegador por diseño—. RLS no alcanza acá: filtra
-- FILAS, y el problema es una COLUMNA.
--
-- Por qué no se hizo junto con la 0030
--
-- Porque el arreglo obvio rompe el portal. `cotizar_estadia` menciona
-- `t.precio_neto` en su `CASE`, y Postgres exige privilegio sobre toda columna
-- referenciada aunque la rama no se ejecute: un `revoke` a secas haría fallar la
-- función para `anon` y tiraría abajo la cotización pública entera.
--
-- La salida que NO se tomó, y por qué
--
-- Hacer `cotizar_estadia` SECURITY DEFINER habría resuelto el privilegio, pero
-- **habría desactivado en silencio la guarda de la 0030**: dentro de una función
-- definer, `current_user` es el DUEÑO de la función y no quien la llama, así que
-- `current_user <> 'anon'` sería siempre verdadero y `anon` volvería a recibir el
-- neto. El arreglo habría reabierto exactamente lo que vino a cerrar.
--
-- Decisión: dos funciones, cada una con un solo trabajo
--
-- En vez de una función que decide a quién le muestra qué, hay una que nunca
-- toca la columna sensible y otra a la que `anon` no llega:
--
--   · `cotizar_estadia_publica` — solo rack. NO menciona `precio_neto`, así que
--     funciona sin privilegio sobre esa columna. Es la que usa el portal.
--   · `cotizar_estadia` — sin cambios, con neto. Se le revoca el `execute` a
--     `anon`: deja de ser alcanzable desde el borde público.
--
-- Ninguna de las dos es `security definer`, así que no hay privilegio elevado
-- que auditar ni la trampa de `current_user`. Y la garantía es más fuerte que una
-- guarda por parámetro: no es que la función se niegue a devolver el neto, es que
-- el rol público no puede ni ejecutarla ni leer la columna.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Función pública: rack y nada más ──────────────────────────────────────
create or replace function cotizar_estadia_publica(
  p_tipo_unidad_id uuid,
  p_check_in       date,
  p_check_out      date
) returns table (fecha date, temporada_id uuid, precio numeric, iva_pct numeric)
language sql stable as $$
  select d::date as fecha,
         temporada_en(d::date) as temporada_id,
         t.precio_rack as precio,
         t.iva_pct
  from generate_series(p_check_in, p_check_out - 1, interval '1 day') as d
  left join tarifas t
    on t.tipo_unidad_id = p_tipo_unidad_id
   and t.temporada_id = temporada_en(d::date);
$$;

comment on function cotizar_estadia_publica is
  'Precio RACK por noche de un tipo de unidad en [check_in, check_out). Es la que usa el portal público: no menciona `precio_neto`, así que funciona sin privilegio sobre esa columna.';

grant execute on function cotizar_estadia_publica(uuid, date, date)
  to anon, authenticated, service_role;

-- ── 2. La función con neto deja de ser alcanzable por el público ─────────────
-- Se conserva igual la guarda por `current_user` que introdujo la 0030: hoy es
-- redundante, y ese es justamente el punto. Si alguien volviera a otorgar este
-- `execute` a `anon`, la guarda sigue ahí y el neto no se escapa igual.
revoke execute on function cotizar_estadia(uuid, date, date, text) from anon;

-- ── 3. La columna, fuera del alcance de `anon` ───────────────────────────────
-- Privilegios por columna: se quita el `select` sobre la tabla y se devuelve
-- sobre todas las columnas MENOS `precio_neto`. El asistente del portal lee
-- `precio_rack` de esta tabla como `anon` (`lib/asistente/index.ts`), así que no
-- alcanza con revocar y listo.
revoke select on tarifas from anon;
grant select (
  id,
  tipo_unidad_id,
  temporada_id,
  precio_rack,
  moneda,
  iva_pct,
  vigente
) on tarifas to anon;

comment on column tarifas.precio_neto is
  'Precio de agencia. NO legible por el rol anon: ver migración 0031.';
