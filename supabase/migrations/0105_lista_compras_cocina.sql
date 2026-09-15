-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0105 — Lista de compras de cocina
--
-- Pedido del dueño del hotel: una hoja tipo planilla, con casillero de
-- comprado, para ir anotando qué hay que comprarle al supermercado para el
-- restaurante, con precio estimado, e imprimirla.
--
-- Tabla nueva y chica a propósito: no es el catálogo de `productos_servicios`
-- (eso es lo que se le vende al huésped, con stock y precio de venta) ni
-- `movimientos_proveedor`/`conciliacion` (eso es gasto ya hecho y facturado).
-- Acá es al revés: cosas que TODAVÍA no se compraron, con un precio que es una
-- estimación para no ir a ciegas al súper, no un importe fiscal. Por eso
-- `precio_estimado` no lleva la disciplina de `pagos`/`facturas` (USD, con
-- `check`): es una anotación de cocina, en la moneda en la que se compra
-- (pesos), y puede quedar en blanco si todavía no se averiguó.
-- ─────────────────────────────────────────────────────────────────────────────

create table lista_compras_cocina (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null check (char_length(trim(nombre)) > 0),
  cantidad         text not null default '',
  precio_estimado  numeric(10, 2) check (precio_estimado is null or precio_estimado >= 0),
  comprado         boolean not null default false,
  nota             text not null default '',
  creado_por       uuid references perfiles (id),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
comment on table lista_compras_cocina is
  'Lista de compras del restaurante/cocina: qué hay que comprarle al supermercado, con precio estimado. No es catálogo de venta ni gasto ya facturado.';
comment on column lista_compras_cocina.precio_estimado is
  'Estimación para presupuestar la compra, en la moneda local. No es un importe fiscal ni pasa por el desglose de IVA.';

create index lista_compras_cocina_pendientes_idx
  on lista_compras_cocina (comprado, creado_en);

alter table lista_compras_cocina enable row level security;

-- Mismos tres roles que ya ven el área `servicio` en lib/domain/permisos.ts
-- (admin, gerencia, recepcion — housekeeping no entra a `servicio`). Es una
-- lista de trabajo compartida entre quien cocina y quien recibe, así que los
-- tres pueden leer, cargar, tildar y borrar por igual: no hay nada que
-- proteger acá con más granularidad que "es del hotel o no lo es".
create policy "lista_compras_cocina: staff de servicio administra" on lista_compras_cocina
  for all
  using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));
