-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0026 — Saldos agregados en la base (Fase 12)
--
-- Los listados de Agencias y Proveedores traían **todos** los movimientos a
-- memoria para sumar el saldo en JavaScript. Con 15 unidades y varios años de
-- operación son decenas de miles de filas por cada carga de pantalla, y el
-- costo crece para siempre.
--
-- La suma la hace Postgres, que es lo que sabe hacer.
-- ─────────────────────────────────────────────────────────────────────────────

/*
  `security_invoker = true` hace que la vista se evalúe con los permisos de
  quien consulta, de modo que **las políticas RLS de las tablas de origen
  siguen aplicando**. Sin esa opción una vista correría con los permisos de su
  dueño y sería un agujero por el que ver datos vedados.
*/
create view saldos_agencias
with (security_invoker = true) as
select
  a.id as agencia_id,
  coalesce(sum(m.monto) filter (where m.tipo = 'cargo'), 0) as cargos,
  coalesce(sum(m.monto) filter (where m.tipo = 'pago'), 0)  as pagos,
  coalesce(sum(m.monto) filter (where m.tipo = 'cargo'), 0)
    - coalesce(sum(m.monto) filter (where m.tipo = 'pago'), 0) as saldo
from agencias a
left join movimientos_cuenta m on m.agencia_id = a.id
group by a.id;

comment on view saldos_agencias is
  'Saldo de cuenta corriente por agencia (cargos − pagos), calculado en la base.';

create view saldos_proveedores
with (security_invoker = true) as
select
  p.id as proveedor_id,
  coalesce(sum(m.monto) filter (where m.tipo = 'cargo'), 0) as cargos,
  coalesce(sum(m.monto) filter (where m.tipo = 'pago'), 0)  as pagos,
  coalesce(sum(m.monto) filter (where m.tipo = 'cargo'), 0)
    - coalesce(sum(m.monto) filter (where m.tipo = 'pago'), 0) as saldo
from proveedores p
left join movimientos_proveedor m on m.proveedor_id = p.id
group by p.id;

comment on view saldos_proveedores is
  'Saldo a pagar por proveedor (facturas − pagos), calculado en la base.';

grant select on saldos_agencias, saldos_proveedores to authenticated, service_role;

-- Índices que sostienen el agrupamiento cuando la tabla crezca.
create index if not exists movimientos_cuenta_agencia_idx on movimientos_cuenta (agencia_id);
create index if not exists movimientos_proveedor_proveedor_idx on movimientos_proveedor (proveedor_id);
