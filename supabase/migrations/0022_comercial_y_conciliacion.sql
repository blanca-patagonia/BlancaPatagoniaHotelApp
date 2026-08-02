-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0022 — Pipeline comercial y conciliación de proveedores (Fase 11)
--
-- 1) Agencias: etapa de negociación del convenio de tarifas netas, para que
--    "Agencias" deje de ser solo cuentas por cobrar y refleje el trabajo
--    comercial (inspirado en el CRM de Odoo).
-- 2) Proveedores: estado y vencimiento de cada comprobante, que es lo que
--    habilita el reporte de antigüedad de saldos (aging report).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Pipeline comercial ───────────────────────────────────────────────────────
create type etapa_comercial as enum (
  'contacto',
  'cotizacion_enviada',
  'convenio_firmado',
  'activa',
  'perdida'
);

alter table agencias add column etapa etapa_comercial not null default 'contacto';
alter table agencias add column notas_comerciales text;

comment on column agencias.etapa is
  'Etapa de la negociación del convenio de tarifas netas.';

create index on agencias (etapa);

-- Las cuentas que ya estaban activas en el sistema arrancan como tales: se
-- crearon cuando el convenio ya existía.
update agencias set etapa = 'activa' where activo;

-- ── Conciliación de cuentas por pagar ────────────────────────────────────────
create type estado_comprobante as enum ('pendiente', 'pagado', 'vencido', 'anulado');

alter table movimientos_proveedor
  add column estado      estado_comprobante not null default 'pendiente',
  add column vencimiento date,
  add column comprobante text;

comment on column movimientos_proveedor.estado is
  'Estado del comprobante; solo aplica a los cargos (facturas del proveedor).';
comment on column movimientos_proveedor.vencimiento is
  'Fecha de vencimiento de la factura; alimenta el reporte de antigüedad.';
comment on column movimientos_proveedor.comprobante is
  'Número de la factura del proveedor, para conciliar contra el papel.';

create index on movimientos_proveedor (estado, vencimiento);

-- Los pagos que ya registramos no son deuda pendiente: se marcan como saldados.
update movimientos_proveedor set estado = 'pagado' where tipo = 'pago';

/*
  Marca como vencidos los cargos impagos cuya fecha de vencimiento ya pasó.

  Es el mismo patrón que `expirar_reservas_pendientes` (migración 0011) y
  `vencerContratos` (Fase 10): por ahora se dispara desde el panel; en
  producción iría por cron (pg_cron o una Edge Function programada).
*/
create or replace function vencer_comprobantes_proveedor()
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  with vencidos as (
    update movimientos_proveedor
    set estado = 'vencido'
    where tipo = 'cargo'
      and estado = 'pendiente'
      and vencimiento is not null
      and vencimiento < current_date
    returning 1
  )
  select count(*) into v_count from vencidos;
  return v_count;
end;
$$;

comment on function vencer_comprobantes_proveedor() is
  'Marca como vencidos los cargos impagos pasados de fecha. Programar por cron.';

grant execute on function vencer_comprobantes_proveedor() to authenticated, service_role;
