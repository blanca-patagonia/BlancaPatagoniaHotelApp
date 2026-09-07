-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0077 — Movimientos externos y conciliación
-- (Bloque C de la auditoría 2026-09: objetivos 4 y 10 del pedido)
--
-- ── El problema ──────────────────────────────────────────────────────────────
--
-- El sistema sabe lo que **debería** haber cobrado y no tiene forma de contrastarlo
-- contra lo que de verdad entró. No existe ningún importador de extractos ni de
-- liquidaciones: los únicos CSV que entran son el informe de reservas de Booking y
-- las reseñas. La migración 0067 agregó `cupon` y `ultimos4` «para conciliar contra
-- la liquidación» y esa conciliación nunca se escribió.
--
-- Consecuencias concretas, todas de plata:
--
--   · Una liquidación de MercadoPago que descuenta comisiones distintas de las
--     pactadas no se detecta.
--   · Un cobro que la pasarela informó y el webhook perdió queda invisible: el
--     sistema dice impago y el dinero está en la cuenta.
--   · Los gastos del mes no existen en el sistema: se cargan de a uno a mano o no
--     se cargan.
--
-- ── Una tabla para las dos fuentes ──────────────────────────────────────────
--
-- El extracto del banco y la liquidación de la pasarela son la misma clase de
-- cosa: una lista de movimientos con fecha, importe y una referencia. Separarlas
-- en dos tablas duplicaría la conciliación y el listado sin ganar nada; lo que
-- cambia entre ellas es el importador, no el dato.
--
-- ⚠️ El importe va **con signo**: positivo lo que entró, negativo lo que salió.
-- Un `tipo` aparte ('ingreso'/'egreso') obligaría a recordar el signo en cada
-- suma, y ése es el error que después aparece como un total que no cierra.
-- ─────────────────────────────────────────────────────────────────────────────

create table movimientos_externos (
  id           uuid primary key default gen_random_uuid(),

  -- De dónde salió la fila. `banco` cubre cualquier extracto importado; el
  -- proveedor concreto va en `cuenta`, porque el hotel puede tener más de uno.
  origen       text not null check (origen in ('banco', 'mercadopago', 'stripe')),
  cuenta       text,

  /*
    Identificador del movimiento en la fuente. Es la mitad de la clave de
    idempotencia: volver a importar el mismo extracto —cosa que pasa, porque nadie
    recuerda si ya lo subió— no puede duplicar los movimientos.

    Cuando la fuente no trae un id propio (los extractos de banco a veces no lo
    hacen), el importador arma uno determinístico con fecha+importe+descripción.
    Es la misma idea que `canal_cargos.clave_idempotencia`.
  */
  external_id  text not null,

  fecha        date not null,
  descripcion  text,
  -- Con signo. Ver el aviso del encabezado.
  monto        numeric(12,2) not null,
  moneda       character(3) not null default 'ARS',

  -- ── Conciliación ──────────────────────────────────────────────────────────
  estado       text not null default 'sin_conciliar'
               check (estado in ('sin_conciliar', 'conciliado', 'ignorado')),
  -- Contra qué pago del sistema se casó. Nulo mientras no se concilió, y también
  -- en los egresos, que no tienen pago que los respalde.
  pago_id      uuid references pagos(id) on delete set null,
  -- Por qué se ignoró, o qué se anotó al conciliar a mano.
  nota         text,
  conciliado_por uuid references perfiles(id) on delete set null,
  conciliado_en  timestamptz,

  importado_por uuid references perfiles(id) on delete set null,
  creado_en    timestamptz not null default now(),

  -- La idempotencia. Reimportar el mismo archivo no duplica nada.
  constraint movimientos_externos_unicos unique (origen, external_id)
);

comment on table movimientos_externos is
  'Movimientos importados del banco o de una pasarela, para conciliar contra `pagos` y para ver los gastos del mes. El importe va CON SIGNO. Ver el encabezado de la 0077.';
comment on column movimientos_externos.monto is
  'Con signo: positivo lo que entró, negativo lo que salió. No hay columna `tipo` a propósito.';
comment on column movimientos_externos.external_id is
  'Id en la fuente. Con `origen` forma la clave de idempotencia: reimportar el mismo extracto no duplica.';

create index movimientos_externos_fecha_idx  on movimientos_externos (fecha desc);
create index movimientos_externos_estado_idx on movimientos_externos (estado, fecha desc);
create index movimientos_externos_pago_idx   on movimientos_externos (pago_id);
create index movimientos_externos_importado_por_idx on movimientos_externos (importado_por);
create index movimientos_externos_conciliado_por_idx on movimientos_externos (conciliado_por);

-- Un pago no puede quedar conciliado contra dos movimientos: sería contarlo dos
-- veces en el arqueo. Parcial porque `pago_id` es nulo mientras no se concilia.
create unique index movimientos_externos_un_pago
  on movimientos_externos (pago_id)
  where pago_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table movimientos_externos enable row level security;

/*
  Quién la ve: admin y gerencia.

  Es el extracto bancario del hotel — sueldos, proveedores, todo lo que pasó por
  la cuenta— y no sólo lo que tiene que ver con las reservas. Recepción concilia
  cobros de huéspedes desde la ficha de la reserva, no desde acá.
*/
create policy "movimientos_externos: admin y gerencia leen"
  on movimientos_externos for select
  using (rol_actual() in ('admin', 'gerencia'));

create policy "movimientos_externos: admin y gerencia concilian"
  on movimientos_externos for update
  using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- El alta es del importador, que corre con `service_role`: una fila cargada a mano
-- desaparecería del cuadre sin dejar rastro de qué archivo la trajo.
revoke insert, delete on movimientos_externos from authenticated;
revoke select, insert, update, delete on movimientos_externos from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- La reimportación no duplica:
--   insert into movimientos_externos (origen, external_id, fecha, monto)
--        values ('banco', 'x1', current_date, 100);
--   insert into movimientos_externos (origen, external_id, fecha, monto)
--        values ('banco', 'x1', current_date, 100);   -- 23505
--
--   -- Un pago no se concilia dos veces:
--   --   dos updates con el mismo `pago_id` → 23505 por el índice parcial.
--
--   select has_table_privilege('anon','movimientos_externos','select');        -- f
--   select has_table_privilege('authenticated','movimientos_externos','insert'); -- f
