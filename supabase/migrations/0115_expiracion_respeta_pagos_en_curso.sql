-- ════════════════════════════════════════════════════════════════════════════
-- 0115 · La expiración de reservas pendientes respeta los pagos en curso
-- ════════════════════════════════════════════════════════════════════════════
--
-- `expirar_reservas_pendientes` (0011) cancelaba toda reserva pendiente vieja
-- sin una SEÑA aprobada. Dejaba afuera dos casos con plata de por medio:
--
--   · un pago aprobado de OTRO tipo: Payway registra siempre `saldo`, y un
--     cobro del mostrador puede ir como saldo. La reserva pagada expiraba;
--   · un cobro EN CURSO: el huésped eligió pagar en efectivo en Rapipago (que
--     acredita días después) o tiene un enlace de pago vigente. La reserva
--     expiraba, la unidad se liberaba —y se podía revender— y después llegaba
--     el pago aprobado.
--
-- Ahora no expira si hay un pago aprobado de cualquier tipo salvo reembolso, o
-- un pago pendiente vivo: con `vence_en` (el link de la 0067) todavía en el
-- futuro, o creado hace menos de 72 horas si no tiene vencimiento.
--
-- Misma firma: `create or replace` conserva los privilegios. Igual se
-- repiten el `revoke` y el `grant` de la 0073 para que la regla quede a la
-- vista en el archivo que define la función.

create or replace function expirar_reservas_pendientes(p_dias int default 5)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
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
  'Cancela reservas pendientes con más de p_dias días, salvo que tengan un pago aprobado (cualquier tipo menos reembolso) o un cobro en curso (link vigente o pago pendiente de menos de 72 h). Lo corre el cron de mantenimiento.';

revoke all on function expirar_reservas_pendientes(int) from anon, public;
grant execute on function expirar_reservas_pendientes(int) to authenticated, service_role;
