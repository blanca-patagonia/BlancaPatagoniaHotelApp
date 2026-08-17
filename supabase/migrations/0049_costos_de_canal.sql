-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0049 — La comisión del canal llega a una cuenta
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- `canal_reservas.comision` se lee del informe del extranet, se guarda y se
-- muestra en una columna de la pantalla. Y ahí muere: `importarEntrante` **ni la
-- selecciona**. Con eso el sistema no puede responder la pregunta que decide si el
-- canal conviene —*cuánto me dejó Booking neto de comisión*— ni conciliar contra la
-- factura mensual que Booking emite.
--
-- ── Dos capas, y por qué no una ─────────────────────────────────────────────
--
-- **Capa 1, libro auxiliar por reserva: `canal_cargos`.** Cada reserva importada
-- devenga su comisión acá. Es lo que permite imputar el costo a la venta que lo
-- generó, que es justo lo que el libro mayor no puede hacer (ver abajo).
--
-- **Capa 2, libro mayor: `proveedores` + `movimientos_proveedor`, sin tocarlas.**
-- Booking es una fila de `proveedores` y la factura mensual entra como un `cargo`
-- con su comprobante y su vencimiento. Con eso hereda gratis la antigüedad de
-- saldos (`lib/domain/antiguedad.ts`), la vista `saldos_proveedores` (0026) y el
-- vencimiento automático (0022). No se reimplementa nada de eso.
--
-- Por qué **no** alcanzaba solo el libro mayor: `movimientos_proveedor` **no tiene
-- `reserva_id`**, así que la comisión no se puede imputar a la reserva; y su RLS es
-- admin/gerencia, mientras que quien importa los informes es **recepción**.
--
-- Por qué **no** `movimientos_cuenta` (Booking como agencia): tiene `reserva_id`,
-- que era tentador, pero su `monto` tiene `check (monto >= 0)` y la semántica
-- fijada es «saldo positivo → la agencia adeuda al hotel». Acá la deuda va al
-- revés y no hay signo negativo posible: habría que invertirle el significado a la
-- columna `tipo` solo para estas filas. Además `agencias` arrastra el pipeline
-- comercial (`etapa`) y Booking no es un convenio que se negocie.
--
-- Por qué **no** un cargo en la cuenta del huésped: `reservas.total` alimenta
-- `resumenPagos` y `saldarSiCorresponde`, así que inflarlo con la comisión haría
-- que la reserva **nunca se salde** y el huésped apareciera debiendo en el
-- mostrador. Y como `facturas.reserva_id` es único (0045), la comisión terminaría
-- facturada al huésped, que es fiscalmente falso: no le vendimos nada a él.
--
-- ── La decisión central: el origen entra en la idempotencia ─────────────────
--
-- La misma reserva puede tener **dos** filas de comisión: la que informó el archivo
-- de reservas y la que después cobró la factura mensual. No se pisan, se guardan
-- las dos y se comparan. Si compartieran clave, la segunda borraría a la primera y
-- la conciliación —que es todo el punto de esta migración— sería imposible, porque
-- el dato con el que había que comparar ya no estaría.
--
-- Por eso `clave_idempotencia` incluye el origen (`lib/domain/canales-costos.ts`,
-- función `claveDeCargo`) y el `unique` es sobre `(canal, clave_idempotencia)`.
--
-- ── Por qué el devengo NO crea un movimiento de proveedor automático ────────
--
-- Tres razones: la comisión de una cancelada o un no-show puede ser cero, parcial o
-- total y no se adivina; se generarían cientos de movimientos de USD 12 que
-- arruinan la antigüedad de saldos; y recepción no puede escribir en esa tabla. El
-- devengo por reserva lo escribe recepción acá; el asiento contable lo crea gerencia
-- con un botón cuando llega la factura, y ese botón **muestra la conciliación antes
-- de crear nada**.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Configuración del canal ──────────────────────────────────────────────────
--
-- Existe para que esto no se configure por variables de entorno: el hotel no edita
-- variables de entorno. Guarda con qué proveedor se contabiliza el canal, el
-- porcentaje pactado (para poder comparar contra el efectivo) y el token del feed
-- iCal de salida que usará la migración de B7.

create table canal_config (
  canal                text primary key check (canal in ('booking', 'expedia')),

  -- Con qué fila de `proveedores` se contabiliza. Nullable: el canal puede estar
  -- configurado para importar antes de que alguien decida la parte contable, y
  -- exigirlo bloquearía la importación, que es lo que no puede pasar.
  proveedor_id         uuid references proveedores(id) on delete set null,

  -- Lo pactado con el canal. Sirve para contrastar contra la comisión efectiva:
  -- un 18 % real contra un 15 % acordado son tres puntos que nadie estaba mirando.
  comision_pct_pactada numeric(5, 2) check (comision_pct_pactada is null
                                            or (comision_pct_pactada >= 0
                                                and comision_pct_pactada <= 100)),

  moneda_liquidacion   char(3) not null default 'USD',

  -- A qué mes se imputa la comisión. `salida` por omisión: es cuando se consume la
  -- estadía y con qué criterio el canal factura el mes siguiente. Imputar por
  -- entrada desalinearía nuestro mes contra su factura.
  imputa_por           text not null default 'salida' check (imputa_por in ('entrada', 'salida')),

  -- Token del feed iCal de salida (B7). Se genera acá para que exista un solo lugar
  -- de configuración del canal.
  ical_token           uuid not null default gen_random_uuid(),

  actualizado_en       timestamptz not null default now(),
  actualizado_por      uuid references perfiles(id)
);

comment on table canal_config is
  'Configuración contable y de integración de cada canal. `proveedor_id` es nullable a propósito: importar no puede depender de que la parte contable esté resuelta.';
comment on column canal_config.comision_pct_pactada is
  'Lo acordado con el canal. Se compara contra la comisión efectiva (comision/bruto) para detectar que el canal cobra otro porcentaje.';
comment on column canal_config.ical_token is
  'Token del feed iCal de salida. Va en la URL, así que es el único secreto de esta tabla y por eso su RLS es admin/gerencia.';

-- ── El libro auxiliar ────────────────────────────────────────────────────────

create table canal_cargos (
  id                  uuid primary key default gen_random_uuid(),
  canal               text not null check (canal in ('booking', 'expedia')),

  concepto            text not null check (concepto in ('comision', 'payout', 'ajuste',
                                                        'impuesto_canal', 'marketing')),
  origen              text not null check (origen in ('informe_reservas', 'factura_comision',
                                                      'liquidacion', 'manual')),

  -- ⚠️ NULLABLE a propósito, y no es un descuido.
  --
  -- Una línea de la factura del canal que no se puede atribuir a ninguna reserva
  -- significa que el canal cobró algo que no reconocemos, y **eso es exactamente lo
  -- que hay que poder ver**. Si la columna fuera obligatoria, esa línea habría que
  -- descartarla, o sea perder el único rastro del cobro que no cierra.
  --
  -- El mismo motivo vale para `concepto = 'marketing'`: un gasto de captación del
  -- canal no pertenece a ninguna reserva en particular.
  canal_reserva_id    uuid references canal_reservas(id) on delete set null,
  reserva_id          uuid references reservas(id) on delete set null,

  monto               numeric(12, 2) not null,
  moneda              char(3) not null default 'USD',

  -- Conversión a la moneda base (ADR 0003). Nullable porque la cotización puede no
  -- estar disponible al importar, y una caída de la API de divisas **nunca** puede
  -- bloquear una importación (ADR 0020). Cuando queda null, los reportes cuentan
  -- cuántas filas no pudieron convertir en vez de sumarlas como cero.
  monto_usd           numeric(12, 2),
  tipo_cambio         numeric(14, 4),

  -- Corrida que trajo el dato. Permite deshacer o auditar una importación entera.
  sincronizacion_id   bigint references canal_sincronizaciones(id) on delete set null,

  -- Asiento del libro mayor, cuando gerencia registra la factura.
  movimiento_proveedor_id uuid references movimientos_proveedor(id) on delete set null,

  estado_conciliacion text not null default 'devengado'
                      check (estado_conciliacion in ('devengado', 'conciliado', 'en_disputa')),

  -- Fecha a la que se imputa (ver `canal_config.imputa_por`).
  imputado_el         date,
  detalle             text not null default '',

  clave_idempotencia  text not null,
  creado_por          uuid references perfiles(id),
  creado_en           timestamptz not null default now(),

  -- La decisión central de la migración: el origen está dentro de la clave, así que
  -- el informe y la factura conviven sobre la misma reserva.
  unique (canal, clave_idempotencia)
);

comment on table canal_cargos is
  'Libro auxiliar de lo que cuesta vender por un canal, con el devengo imputado a la reserva. El asiento contable vive en `movimientos_proveedor`; acá está el detalle por venta, que allá no se puede representar porque no tiene `reserva_id`.';
comment on column canal_cargos.clave_idempotencia is
  'origen:concepto:referencia (ver `claveDeCargo`). El origen va adentro para que la comisión del informe y la de la factura NO se pisen: compararlas es el punto de la tabla.';
comment on column canal_cargos.canal_reserva_id is
  'Nullable a propósito: una línea de factura que no se atribuye a ninguna reserva es la señal de que el canal cobró algo que no reconocemos, y hay que poder guardarla.';
comment on column canal_cargos.monto_usd is
  'Nullo si no había cotización al importar. Los reportes cuentan estas filas aparte en vez de sumarlas como cero (ADR 0020: la falta de cotización no bloquea nada).';

create index on canal_cargos (canal, concepto, imputado_el);
create index on canal_cargos (canal_reserva_id);
create index on canal_cargos (reserva_id);
create index on canal_cargos (estado_conciliacion) where estado_conciliacion <> 'conciliado';
create index on canal_cargos (movimiento_proveedor_id);

-- ── La columna que dejó de ser huérfana ──────────────────────────────────────

comment on column canal_reservas.comision is
  'Comisión que informó el canal, dato CRUDO del staging (igual que `importe_canal`). El devengo contable vive en `canal_cargos`; esta columna se conserva para poder cotejar contra el archivo original.';

-- ── Backfill de lo ya cargado ────────────────────────────────────────────────
--
-- Sin esto, las reservas ya importadas quedarían fuera de la contabilidad y el
-- primer reporte saldría incompleto sin que nadie sepa por qué. Se replica la regla
-- de `devengarComision`: no se devengan las canceladas ni las que no informaron
-- comisión ni las de comisión cero.
--
-- `imputado_el` sale de `check_out` porque el default de `imputa_por` es `salida`.

insert into canal_cargos (canal, concepto, origen, canal_reserva_id, reserva_id,
                          monto, moneda, imputado_el, clave_idempotencia, detalle)
select cr.canal,
       'comision',
       'informe_reservas',
       cr.id,
       cr.reserva_id,
       cr.comision,
       coalesce(nullif(cr.moneda_canal, ''), 'USD'),
       cr.check_out,
       'informe_reservas:comision:' || cr.external_id,
       'Devengado por la migración 0049 a partir de lo ya importado.'
  from canal_reservas cr
 where cr.comision is not null
   and cr.comision > 0
   and cr.operacion <> 'cancelada'
on conflict (canal, clave_idempotencia) do nothing;

-- ── La vista de conciliación ─────────────────────────────────────────────────
--
-- `security_invoker = true` para que la vista respete las políticas de quien
-- consulta y no las del dueño (mismo patrón que `saldos_agencias`, 0026). Sin eso
-- una vista se convierte en un agujero por el que se lee lo que la tabla niega.

create view conciliacion_comision_canal
with (security_invoker = true) as
select canal,
       date_trunc('month', imputado_el)::date            as mes,
       origen,
       count(*)                                          as cargos,
       sum(monto)                                        as total,
       sum(monto) filter (where monto_usd is null)        as total_sin_convertir,
       count(*)   filter (where monto_usd is null)        as cargos_sin_convertir
  from canal_cargos
 where concepto = 'comision'
   and imputado_el is not null
 group by canal, date_trunc('month', imputado_el), origen;

comment on view conciliacion_comision_canal is
  'Comisión por canal, mes y origen. Comparar la fila `informe_reservas` contra la `factura_comision` del mismo mes es la conciliación: si difieren, el canal factura distinto de lo que informó.';

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table canal_config enable row level security;
alter table canal_cargos enable row level security;

-- `canal_config` guarda el token del feed iCal y el porcentaje pactado. NO va
-- «staff lee»: el token es un secreto —va en una URL pública— y housekeeping no
-- tiene ninguna razón para leerlo. Mismo criterio que el padrón de huéspedes
-- (0045).
create policy "canal_config: gerencia+ lee" on canal_config
  for select using (rol_actual() in ('admin', 'gerencia'));
create policy "canal_config: gerencia+ gestiona" on canal_config
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- `canal_cargos` sí lo lee todo el staff: es el volumen del canal, no un secreto.
create policy "canal_cargos: staff lee" on canal_cargos
  for select using (rol_actual() is not null);

-- Recepción **inserta**, porque el devengo nace de importar el informe y eso lo hace
-- el mostrador. Pero no puede conciliar ni disputar: eso mueve el libro mayor.
create policy "canal_cargos: recepcion+ devenga" on canal_cargos
  for insert with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "canal_cargos: gerencia+ concilia" on canal_cargos
  for update using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "canal_cargos: gerencia+ borra" on canal_cargos
  for delete using (rol_actual() in ('admin', 'gerencia'));

-- La 0006 dejó `alter default privileges ... grant select on tables to anon`, así
-- que toda tabla nueva nace legible por el rol anónimo. Acá sería grave: en
-- `canal_config` está el token del feed, y `canal_cargos` revela cuánto vende y
-- cuánto paga de comisión el hotel. Las políticas ya lo bloquean (para `anon`,
-- `rol_actual()` es null); se revoca igual, para no depender de que nadie escriba
-- mal una política nueva más adelante.
revoke select on canal_config from anon;
revoke select on canal_cargos from anon;

-- La vista hereda el default de la 0006 igual que las tablas.
revoke select on conciliacion_comision_canal from anon;
grant select on conciliacion_comision_canal to authenticated, service_role;
