-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0034 — Tokens fuera del alcance del staff, facturas inmutables e
--                  índices en las claves foráneas (Auditoría · Fase 3)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Los tokens de firma eran legibles por cualquier rol de staff
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `firmas` guarda en la columna `token` (0018:83) la credencial con la que se
-- accede a `/firmar/[token]`. La política de lectura era:
--
--     create policy "firmas: staff lee" on firmas
--       for select using (rol_actual() is not null);
--
-- Es decir, **cualquier** rol autenticado —housekeeping incluido— podía leer la
-- tabla entera vía PostgREST y quedarse con todos los tokens pendientes. Un
-- token no es un dato: es una credencial. Poder leerlo es poder usarlo, así que
-- eso alcanza para firmar contratos en nombre de una agencia, un proveedor o un
-- empleado.
--
-- La corrección alinea la política con la matriz de permisos que ya usa el panel
-- (`lib/domain/permisos.ts`): el área `contratos` la tienen solamente `admin` y
-- `gerencia`. Recepción y housekeeping no la ven en la interfaz; ahora tampoco
-- en la base, que es donde importa.
--
-- Las pantallas públicas `/firmar/[token]` y `/portal/[token]` no se ven
-- afectadas: resuelven el acceso con `service_role`, que ignora RLS.

drop policy if exists "firmas: staff lee" on firmas;

create policy "firmas: admin/gerencia leen"
  on firmas for select
  using (rol_actual() in ('admin', 'gerencia'));

-- Defensa en profundidad: aunque la política se afloje en el futuro, la columna
-- del token no se puede seleccionar desde la API con una sesión de usuario. El
-- servidor la lee con `service_role`, que no pasa por este GRANT.
revoke select (token) on firmas from authenticated;

comment on column firmas.token is
  'Credencial de acceso a /firmar/[token]. Solo legible con service_role: a authenticated se le revocó el SELECT sobre esta columna (migración 0034).';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Una factura emitida no se modifica ni se borra
-- ═════════════════════════════════════════════════════════════════════════════
--
-- La política original (0010:77) era `for all` para recepción, gerencia y admin:
-- permitía UPDATE y DELETE sobre comprobantes ya emitidos con CAE. Dos problemas
-- distintos:
--
--  · Un comprobante fiscal autorizado es inmutable por definición. Si hay un
--    error, se corrige con una nota de crédito, no editando el original.
--  · Borrar una factura deja un **hueco permanente** en la numeración
--    correlativa, que es exactamente lo que la migración 0025 se ocupó de
--    garantizar. El agujero no se puede reparar después.
--
-- Se verificó que la aplicación no hace ni un `update` ni un `delete` sobre
-- `facturas`: solo un `insert` (app/panel/reservas/actions.ts:491) y lecturas.
-- Esta migración no rompe ningún camino existente; cierra uno que nadie usaba y
-- que no debería existir.

drop policy if exists "facturas: recepcion+ gestiona" on facturas;

create policy "facturas: recepcion+ emite"
  on facturas for insert
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- No se crean políticas de UPDATE ni de DELETE: sin política, RLS deniega.
revoke update, delete on facturas from authenticated;

comment on table facturas is
  'Comprobantes emitidos. INMUTABLES: no hay política de UPDATE ni de DELETE. Un error se corrige con una nota de crédito, nunca editando el original (migración 0034).';


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Índices en las claves foráneas
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Postgres **no** indexa automáticamente las claves foráneas. Sin índice:
--
--  · cada DELETE o UPDATE de la fila padre escanea la tabla hija entera para
--    verificar la restricción;
--  · todo filtro y todo JOIN por esa columna hace secuencial. El listado
--    principal de reservas filtra y ordena por `huesped_id`, que era una FK sin
--    índice: es la consulta más frecuente del panel.
--
-- Se crean solo los que faltaban, con `if not exists` para que la migración sea
-- idempotente. En una base con tráfico habría que usar `CREATE INDEX
-- CONCURRENTLY` fuera de la transacción de la migración; con el volumen actual
-- de este hotel el bloqueo es instantáneo y no lo justifica.

create index if not exists reservas_huesped_id_idx        on reservas (huesped_id);
create index if not exists reservas_promocion_id_idx      on reservas (promocion_id);
create index if not exists reservas_politica_id_idx       on reservas (politica_id);
create index if not exists reservas_creada_por_idx        on reservas (creada_por);
create index if not exists estadias_unidad_id_idx         on estadias (unidad_id);
create index if not exists consumos_producto_id_idx       on consumos (producto_id);
create index if not exists consumos_cargado_por_idx       on consumos (cargado_por);
create index if not exists facturas_emitida_por_idx       on facturas (emitida_por);
create index if not exists mensajes_autor_id_idx          on mensajes (autor_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Housekeeping no debe poder leer firmas. Con una sesión de ese rol:
--   select count(*) from firmas;   -- esperado: 0 filas
--
--   -- Una factura no se debe poder modificar ni borrar con ningún rol de staff:
--   update facturas set total = 0 where id = '<uuid>';   -- esperado: 0 filas afectadas
--   delete from facturas where id = '<uuid>';            -- esperado: 0 filas afectadas
--
--   -- FKs que sigan sin índice:
--   select c.conrelid::regclass as tabla, a.attname as columna
--     from pg_constraint c
--     join unnest(c.conkey) k on true
--     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
--    where c.contype = 'f'
--      and not exists (
--        select 1 from pg_index i
--         where i.indrelid = c.conrelid and a.attnum = any (i.indkey)
--      );
