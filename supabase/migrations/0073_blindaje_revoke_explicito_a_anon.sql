-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0073 — `revoke` explícito a `anon`, no solo a PUBLIC (blindaje)
--
-- ── Por qué existe ──────────────────────────────────────────────────────────
--
-- La 0070 cerró las funciones con `revoke execute ... from public`. Contra
-- PostgREST 14 (el stack local) alcanza: `anon` recibe 42501. Contra
-- **PostgREST 16** —el que levanta el CI— una prueba de borde detectó que `anon`
-- todavía alcanzaba `siguiente_numero_comprobante` (el contador fiscal). El
-- resto de las funciones de la 0070 sí quedaron cerradas para `anon` en las dos
-- versiones; la diferencia se da en las `security definer` que además pasaron
-- por la reescritura de la 0033 (`pg_get_functiondef` + `create or replace`).
--
-- No se llegó a la causa exacta de la discrepancia entre versiones. La respuesta
-- correcta a eso es no depender de que `revoke from public` alcance el grant
-- implícito: acá se **revoca a `anon` por nombre** sobre las funciones que nunca
-- debe alcanzar, y se re-otorga `execute` explícitamente a quien corresponde.
-- Es idempotente y no cambia el comportamiento donde la 0070 ya funcionaba.
--
-- `cotizar_estadia_publica`, `disponibilidad_por_tipo` y `unidades_disponibles`
-- NO se tocan: `anon` las necesita para el portal.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Contadores y numeración fiscal ─────────────────────────────────────────
revoke all on function siguiente_numero_comprobante(int) from anon, public;
grant execute on function siguiente_numero_comprobante(int) to authenticated, service_role;

revoke all on function reservar_numero_factura(uuid, int) from anon, public;
grant execute on function reservar_numero_factura(uuid, int) to authenticated, service_role;

revoke all on function siguiente_comanda() from anon, public;
grant execute on function siguiente_comanda() to authenticated, service_role;

-- ── Precio de agencia ──────────────────────────────────────────────────────
revoke all on function cotizar_estadia(uuid, date, date, text) from anon, public;
grant execute on function cotizar_estadia(uuid, date, date, text) to authenticated, service_role;

-- ── Límite de tasa y rastreo por IP ────────────────────────────────────────
revoke all on function registrar_intento(inet, text, int, int) from anon, public;
grant execute on function registrar_intento(inet, text, int, int) to service_role;

revoke all on function consultas_recientes_de_ip(inet, int) from anon, public;
grant execute on function consultas_recientes_de_ip(inet, int) to service_role;

revoke all on function purgar_intentos(int) from anon, public;
grant execute on function purgar_intentos(int) to service_role;

revoke all on function purgar_errores(int) from anon, public;
grant execute on function purgar_errores(int) to service_role;

-- ── Tareas de mantenimiento ────────────────────────────────────────────────
revoke all on function expirar_reservas_pendientes(int) from anon, public;
grant execute on function expirar_reservas_pendientes(int) to authenticated, service_role;

revoke all on function generar_mantenimiento_preventivo() from anon, public;
grant execute on function generar_mantenimiento_preventivo() to authenticated, service_role;

revoke all on function vencer_comprobantes_proveedor() from anon, public;
grant execute on function vencer_comprobantes_proveedor() to authenticated, service_role;

-- ── Operaciones de reserva (RLS ya las acota; el grant nominal lo confirma) ──
revoke all on function cambiar_unidad_reserva(uuid, uuid, text) from anon, public;
grant execute on function cambiar_unidad_reserva(uuid, uuid, text) to authenticated, service_role;

-- ── Introspección de la auditoría ──────────────────────────────────────────
revoke all on function funciones_expuestas_a_publico() from anon, public;
grant execute on function funciones_expuestas_a_publico() to service_role;

-- PostgREST recarga su schema cache. Sin efecto durante `supabase start` (las
-- migraciones corren antes de que arranque), pero cierra el círculo si esto se
-- aplica sobre un entorno ya en marcha.
notify pgrst, 'reload schema';
