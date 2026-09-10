-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0093 — `registrar_acceso_huesped` no debía quedar abierta a PUBLIC
--
-- Postgres le da EXECUTE a PUBLIC por default en toda función nueva. La 0091
-- se olvidó del `revoke` que sí llevan las demás funciones `security definer`
-- del proyecto (ver 0053, 0070, 0076) — lo encontró
-- `tests/funciones-sin-public.test.ts`, el test-contrato que existe
-- exactamente para esto, al correr la suite contra una base real por primera
-- vez.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function registrar_acceso_huesped(uuid, text) from public;
