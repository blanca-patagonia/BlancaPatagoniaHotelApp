-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0006 — Privilegios para los roles de la API (Fase 1)
--
-- PostgREST accede a la base con los roles `anon` (público), `authenticated`
-- (staff logueado) y `service_role` (servidor privilegiado). Necesitan GRANT a
-- nivel de tabla; la SEGURIDAD REAL la imponen las políticas RLS ya definidas.
-- En Supabase hosted estos permisos los aplica la plataforma automáticamente;
-- en el entorno local hay que declararlos para que el acceso funcione.
-- ─────────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated, service_role;

-- Staff autenticado: DML completo; las políticas RLS acotan el alcance por rol.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Rol privilegiado del servidor (posee BYPASSRLS): acceso total.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Público anónimo: solo lectura; RLS limita a los registros marcados públicos.
grant select on all tables in schema public to anon;

-- Objetos creados en migraciones posteriores (por el rol `postgres`).
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
