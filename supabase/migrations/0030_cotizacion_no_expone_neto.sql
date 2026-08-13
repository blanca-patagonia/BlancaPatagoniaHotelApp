-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0030 — La cotización pública no devuelve el precio neto (Fase 1 de
-- la auditoría de seguridad)
--
-- Problema
--
-- `cotizar_estadia` (migración 0008) tenía tres propiedades que, juntas, dejaban
-- los precios de agencia al alcance de cualquiera:
--
-- 1. Recibe `p_tarifa_tipo` como parámetro y devuelve `precio_neto` cuando vale
--    'neto'.
-- 2. NO es `security definer`, así que corre con los privilegios de quien llama.
-- 3. Tiene `grant execute … to anon`, porque el portal público la necesita para
--    mostrar precios.
--
-- La aplicación siempre manda 'rack' en las rutas públicas, pero eso no protege
-- nada: la clave publicable viaja en el bundle del navegador por diseño, así que
-- cualquiera puede hacer un POST a /rest/v1/rpc/cotizar_estadia con
-- `p_tarifa_tipo: 'neto'` y recibir, noche por noche, los precios que el hotel
-- negocia con las agencias (ADR 0004: neto = agencia, rack = mostrador).
--
-- No es un dato personal, es un dato comercial, y es de los que se defienden
-- solos: una agencia que ve la grilla de netos del hotel negocia distinto.
--
-- Decisión
--
-- La guarda va **sobre el rol de base de datos**, no sobre `rol_actual()`.
-- Parece un detalle y no lo es: `rol_actual()` sale de `perfiles` vía
-- `auth.uid()`, y para `service_role` eso es NULL —no hay perfil detrás de la
-- clave del servidor—. Con `rol_actual() is not null` se habría roto el cotizado
-- neto del servidor y el test de integración que ya lo cubre. PostgREST cambia
-- el rol de Postgres según la credencial (`anon` / `authenticated` /
-- `service_role`), así que `current_user` distingue exactamente lo que hay que
-- distinguir, y al no ser `security definer` esta función ve el rol real de quien
-- la invoca.
--
-- A `anon` que pida 'neto' se le devuelve rack, en silencio y sin error. Es
-- deliberado: ningún llamador legítimo pide neto sin sesión, así que un error
-- solo le confirmaría a quien sondea que encontró algo.
--
-- Lo que esta migración NO cierra
--
-- Queda abierto el otro camino al mismo dato: `grant select on all tables … to
-- anon` (migración 0006) más la política «tarifas: lectura publica … using
-- (true)» sin cláusula `to` permiten `GET /rest/v1/tarifas?select=precio_neto`.
--
-- Cerrarlo exige revocar el privilegio por columna Y hacer esta función
-- `security definer`, las dos cosas a la vez: Postgres pide privilegio sobre
-- toda columna referenciada aunque la rama del `CASE` no se ejecute, así que un
-- `revoke` a secas haría fallar la función para `anon` y tiraría abajo la
-- cotización del portal entero. Eso cambia el modelo de seguridad de una función
-- central y merece su propio ADR y una prueba contra la base.
-- ─────────────────────────────────────────────────────────────────────────────

-- `create or replace` conserva los privilegios ya otorgados: los `grant execute`
-- de la migración 0008 siguen vigentes y no hay que repetirlos.
create or replace function cotizar_estadia(
  p_tipo_unidad_id uuid,
  p_check_in       date,
  p_check_out      date,
  p_tarifa_tipo    text default 'rack'
) returns table (fecha date, temporada_id uuid, precio numeric, iva_pct numeric)
language sql stable as $$
  select d::date as fecha,
         temporada_en(d::date) as temporada_id,
         case
           -- El neto es solo para quien tiene credencial: staff autenticado
           -- (`authenticated`) o el servidor (`service_role`). `anon` recibe rack.
           when p_tarifa_tipo = 'neto' and current_user <> 'anon'
             then t.precio_neto
           else t.precio_rack
         end as precio,
         t.iva_pct
  from generate_series(p_check_in, p_check_out - 1, interval '1 day') as d
  left join tarifas t
    on t.tipo_unidad_id = p_tipo_unidad_id
   and t.temporada_id = temporada_en(d::date);
$$;

comment on function cotizar_estadia is
  'Precio por noche (según canal) de un tipo de unidad en [check_in, check_out); resuelve la temporada de cada fecha. El precio neto (agencia) NO se devuelve al rol anon: ver migración 0030.';
