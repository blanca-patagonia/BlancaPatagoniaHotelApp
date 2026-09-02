-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0071 — Los 28 índices que faltan en claves foráneas
-- (Fase 5 de la auditoría — deuda de rendimiento, mientras es barata)
--
-- ── El problema ──────────────────────────────────────────────────────────────
--
-- Postgres **no** indexa una clave foránea al declararla. Sin índice sobre la
-- columna hija:
--
--  · cada DELETE o UPDATE de la fila **padre** escanea la tabla hija entera para
--    verificar la restricción. `perfiles` es padre de 17 de estas 28 columnas, así
--    que **dar de baja un usuario hoy hace 17 seq scans**;
--  · todo JOIN o filtro por esa columna va secuencial.
--
-- La migración 0034 ya cerró 9 de estos casos y midió el efecto; la 0062 midió
-- otro (`2,6 ms → 0,1 ms` sobre 30k filas). Estos 28 quedaron afuera porque las
-- tablas que los tienen —los `canal_*`, `movimientos_*`, `ordenes_*`— están casi
-- vacías hoy. Se notan la primera temporada alta, y para entonces el diagnóstico
-- es difícil: nada empeoró de golpe, empeoró de a poco.
--
-- Detección (la misma consulta que trae el comentario de la 0034, adaptada):
--
--   select c.conrelid::regclass as tabla, a.attname as columna
--     from pg_constraint c
--     join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
--     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
--    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and k.ord = 1
--      and not exists (
--        select 1 from pg_index i
--         where i.indrelid = c.conrelid and i.indkey[0] = k.attnum
--      );
--
-- ── `CREATE INDEX` a secas y no `CONCURRENTLY` ───────────────────────────────
--
-- Igual criterio que la 0034: en una base con tráfico habría que usar
-- `CREATE INDEX CONCURRENTLY` fuera de la transacción de la migración, porque el
-- `create index` normal toma un lock que bloquea las escrituras de esa tabla.
-- Con el volumen actual del hotel —tablas de decenas de filas— el lock es
-- instantáneo y no lo justifica. Si esto se aplica sobre una base ya cargada y
-- en uso, conviene partir el archivo y correr cada índice con `CONCURRENTLY`.
--
-- Todos con `if not exists`: la migración es idempotente y no choca si alguno se
-- creó a mano antes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Hijas de `perfiles` (17) — el caso que más pesa: cada baja de usuario ────
create index if not exists avisos_autor_id_idx                    on avisos (autor_id);
create index if not exists canal_cargos_creado_por_idx            on canal_cargos (creado_por);
create index if not exists canal_config_actualizado_por_idx       on canal_config (actualizado_por);
create index if not exists canal_mapeos_columnas_creado_por_idx   on canal_mapeos_columnas (creado_por);
create index if not exists canal_mensajes_atendido_por_idx        on canal_mensajes (atendido_por);
create index if not exists canal_reservas_importada_por_idx       on canal_reservas (importada_por);
create index if not exists canal_sincronizaciones_corrida_por_idx on canal_sincronizaciones (corrida_por);
create index if not exists contratos_creado_por_idx               on contratos (creado_por);
create index if not exists cotizaciones_cargada_por_idx           on cotizaciones (cargada_por);
create index if not exists movimientos_cuenta_creado_por_idx      on movimientos_cuenta (creado_por);
create index if not exists movimientos_proveedor_creado_por_idx   on movimientos_proveedor (creado_por);
create index if not exists objetos_perdidos_creado_por_idx        on objetos_perdidos (creado_por);
create index if not exists ordenes_mantenimiento_asignada_a_idx   on ordenes_mantenimiento (asignada_a);
create index if not exists ordenes_mantenimiento_creada_por_idx   on ordenes_mantenimiento (creada_por);
create index if not exists pagos_creado_por_idx                   on pagos (creado_por);
create index if not exists respaldos_generado_por_idx             on respaldos (generado_por);
create index if not exists unidades_asignada_a_idx                on unidades (asignada_a);

-- ── Hijas de `reservas` (3) ─────────────────────────────────────────────────
create index if not exists canal_mensajes_reserva_id_idx     on canal_mensajes (reserva_id);
create index if not exists movimientos_cuenta_reserva_id_idx on movimientos_cuenta (reserva_id);
create index if not exists objetos_perdidos_reserva_id_idx   on objetos_perdidos (reserva_id);

-- ── Hijas de `unidades` (2) ─────────────────────────────────────────────────
create index if not exists ordenes_mantenimiento_unidad_id_idx on ordenes_mantenimiento (unidad_id);
create index if not exists planes_mantenimiento_unidad_id_idx  on planes_mantenimiento (unidad_id);

-- ── Hijas de `agencias` (2) ─────────────────────────────────────────────────
create index if not exists reservas_agencia_id_idx          on reservas (agencia_id);
create index if not exists reservas_folio_b_agencia_id_idx  on reservas (folio_b_agencia_id);

-- ── El resto (4) ────────────────────────────────────────────────────────────
create index if not exists canal_cargos_sincronizacion_id_idx on canal_cargos (sincronizacion_id);
create index if not exists canal_config_proveedor_id_idx      on canal_config (proveedor_id);
create index if not exists reserva_huespedes_huesped_id_idx   on reserva_huespedes (huesped_id);
create index if not exists tarifas_temporada_id_idx           on tarifas (temporada_id);

comment on index reservas_agencia_id_idx is
  'FK a agencias, sin índice hasta la 0071. El listado de reservas de una agencia y cada baja de agencia lo usan.';
comment on index reserva_huespedes_huesped_id_idx is
  'Columna final de la PK compuesta (reserva_id, huesped_id): sin índice propio, «las reservas de este huésped» iba secuencial.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Cero filas: no queda ninguna FK sin índice.
--   select c.conrelid::regclass as tabla, a.attname as columna
--     from pg_constraint c
--     join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
--     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
--    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and k.ord = 1
--      and not exists (select 1 from pg_index i
--                       where i.indrelid = c.conrelid and i.indkey[0] = k.attnum);
