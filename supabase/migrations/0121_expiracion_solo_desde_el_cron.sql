-- ════════════════════════════════════════════════════════════════════════════
-- 0121 · La expiración de reservas pendientes sólo la corre el cron
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── El hallazgo (auditoría de seguridad, 2026-10-20) ─────────────────────────
--
-- `expirar_reservas_pendientes` (0011, rehecha en la 0115) es `security
-- invoker` y tenía EXECUTE para `authenticated`. Nadie la llama con el cliente
-- del usuario: el único llamador es el cron de mantenimiento, con
-- `service_role` (`api/cron/mantenimiento/route.ts`). Pero el grant estaba:
--
--   Una persona de recepción toma su token de la cookie de sesión y llama por
--   PostgREST `rpc/expirar_reservas_pendientes` con `{"p_dias": 0}`. La
--   política `reservas: recepcion+ gestiona` (0005) la deja escribir, y en un
--   solo `update` cancela TODAS las reservas pendientes sin pago —también las
--   que entraron por la web hace un minuto—. No pasa por `cambiarEstadoReserva`:
--   no sale aviso al huésped ni a la cartelera, no queda rastro por reserva, y
--   la unidad se libera para revenderse.
--
-- ── El arreglo ───────────────────────────────────────────────────────────────
--
-- · EXECUTE sólo para `service_role`. Se revoca de `public`, `anon` y
--   `authenticated` (revocar sólo de `anon` no cierra nada: el privilegio llega
--   por PUBLIC, ver 0070).
-- · `p_dias` menor que 1 se rechaza. Con 0 o negativo la condición de antigüedad
--   deja de filtrar, y eso no es una expiración: es cancelar todo lo pendiente.
--   Vale para cualquier llamador, el cron incluido.
--
-- Misma firma: `create or replace` conserva la identidad de la función; los
-- privilegios se vuelven a declarar abajo de todos modos.
--
-- ── Lo que se revisó y NO se tocó ────────────────────────────────────────────
--
-- `generar_mantenimiento_preventivo()` y `vencer_comprobantes_proveedor()`
-- (0073) tienen el mismo grant, pero las llaman Server Actions con el cliente
-- del usuario (`panel/mantenimiento/actions.ts`, `panel/proveedores/actions.ts`)
-- y no tienen parámetros: llamarlas directo hace exactamente lo mismo que el
-- cron diario, y RLS acota lo que escriben. No hay nada que un parámetro
-- elegido por el atacante cambie.

create or replace function expirar_reservas_pendientes(p_dias int default 5)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  if p_dias is null or p_dias < 1 then
    raise exception 'p_dias tiene que ser al menos 1 (recibido: %)', p_dias
      using errcode = '22023';
  end if;

  with vencidas as (
    update reservas r
    set estado = 'cancelada'
    where r.estado = 'pendiente'
      and r.creada_en < now() - make_interval(days => p_dias)
      -- Un pago aprobado, del tipo que sea (salvo devoluciones).
      and not exists (
        select 1 from pagos p
        where p.reserva_id = r.id
          and p.estado = 'aprobado'
          and p.tipo <> 'reembolso'
      )
      -- Un cobro todavía en curso.
      and not exists (
        select 1 from pagos p
        where p.reserva_id = r.id
          and p.estado = 'pendiente'
          and coalesce(p.vence_en, p.creado_en + interval '72 hours') > now()
      )
    returning 1
  )
  select count(*) into v_count from vencidas;
  return v_count;
end;
$$;

comment on function expirar_reservas_pendientes is
  'Cancela reservas pendientes con más de p_dias días (p_dias >= 1), salvo que tengan un pago aprobado (cualquier tipo menos reembolso) o un cobro en curso. Sólo la ejecuta service_role: la corre el cron de mantenimiento (0121).';

revoke all on function expirar_reservas_pendientes(int) from public, anon, authenticated;
grant execute on function expirar_reservas_pendientes(int) to service_role;
