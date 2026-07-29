-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0015 — Fidelidad e inventario (Fase 8, funciones WinPax/Odoo)
-- 1) Programa de fidelidad: puntos acumulados por huésped.
-- 2) Control de stock de productos (frigobar / amenities) con mínimo de alerta.
-- ─────────────────────────────────────────────────────────────────────────────

-- Fidelidad ───────────────────────────────────────────────────────────────────
alter table huespedes add column puntos int not null default 0 check (puntos >= 0);
comment on column huespedes.puntos is 'Puntos de fidelidad acumulados por el huésped.';

-- Inventario ──────────────────────────────────────────────────────────────────
-- stock NULL = producto sin control de stock (p. ej. excursiones, traslados).
alter table productos_servicios add column stock int;
alter table productos_servicios add column stock_minimo int not null default 0;
comment on column productos_servicios.stock is
  'Unidades en stock; NULL = no se controla (servicios). Se descuenta al cargar consumos.';

-- Descuenta el stock del producto al registrar un consumo (si lleva control).
create or replace function descontar_stock_consumo()
returns trigger language plpgsql as $$
begin
  update productos_servicios
  set stock = greatest(0, stock - new.cantidad)
  where id = new.producto_id and stock is not null;
  return new;
end;
$$;
create trigger consumos_descuenta_stock
  after insert on consumos
  for each row execute function descontar_stock_consumo();

-- Stock inicial de los productos con control (frigobar y desayuno).
update productos_servicios set stock = 24, stock_minimo = 6 where categoria = 'frigobar';
update productos_servicios set stock = 40, stock_minimo = 10 where codigo = 'DES-EXTRA';
