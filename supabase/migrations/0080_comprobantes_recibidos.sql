-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0080 — Comprobantes recibidos (objetivo 9 del pedido)
--
-- «Que se le saque una foto a una factura y que se carguen los datos de esa
--  factura a un excel.»
--
-- ── Por qué el QR y no el reconocimiento de texto ────────────────────────────
--
-- La forma obvia de «leer una foto» sería OCR. Es peor idea de lo que parece:
-- el OCR **adivina**, y un `8` leído como `3` en el importe da una factura
-- plausible y equivocada que después nadie revisa, porque el sistema «ya la
-- cargó». Además necesita un servicio pago de terceros, con la imagen de una
-- factura —datos fiscales del hotel y del proveedor— saliendo del sistema.
--
-- **Desde 2021 toda factura electrónica argentina lleva un QR obligatorio**
-- (RG 4892/2020) que codifica los datos del comprobante en JSON, con su CAE.
-- Leerlo no adivina nada: devuelve exactamente lo que el emisor le informó a
-- ARCA. El gesto para quien usa el sistema es el mismo —apuntar la cámara a la
-- factura— y el resultado es **autoritativo en vez de probable**.
--
-- ⚠️ **Acá no se guarda la imagen.** Sólo los datos. Guardar fotos de facturas
-- es gestión documental y eso tiene su propio ADR pendiente (0013, Storage +
-- seguridad por campo). Meterlo por la puerta de atrás dejaría archivos con
-- datos fiscales sin política de acceso ni de retención.
--
-- ── La clave natural ─────────────────────────────────────────────────────────
--
-- `CUIT del emisor · tipo · punto de venta · número` identifica un comprobante
-- de forma única en todo el país. Es la clave de idempotencia: escanear dos
-- veces la misma factura —cosa que pasa cuando la primera foto sale movida— no
-- puede cargar el gasto dos veces.
-- ─────────────────────────────────────────────────────────────────────────────

create table comprobantes_recibidos (
  id            uuid primary key default gen_random_uuid(),

  -- ── Identidad fiscal (viene del QR, no de un OCR) ─────────────────────────
  cuit_emisor   text not null check (cuit_emisor ~ '^[0-9]{11}$'),
  /*
    Código de tipo de comprobante de WSFEv1: 1 = Factura A, 6 = Factura B,
    11 = Factura C, 3/8/13 = notas de crédito. Se guarda el **código** y no la
    letra porque el código es lo que dice el QR; la letra se deriva.
  */
  tipo_codigo   integer not null,
  -- Nula cuando el código no está en la tabla del sistema. Inventar la letra de
  -- un comprobante fiscal es el error que después hay que corregir con otro.
  letra         char(1),
  punto_venta   integer not null check (punto_venta >= 0),
  numero        bigint  not null check (numero > 0),
  fecha         date    not null,

  -- ── Importes ──────────────────────────────────────────────────────────────
  total         numeric(12,2) not null check (total >= 0),
  moneda        char(3) not null default 'ARS'
                check (moneda in ('USD', 'ARS', 'BRL', 'EUR')),
  cotizacion    numeric(14,4) not null default 1 check (cotizacion > 0),

  -- ── Autorización ──────────────────────────────────────────────────────────
  cae           text not null,
  -- 'E' = CAE, 'A' = CAEA. Del campo `tipoCodAut` del QR.
  tipo_autorizacion char(1) not null default 'E',

  /*
    De dónde salieron los datos. Es información de confianza, no decorativa:
    un comprobante cargado a mano puede tener un número mal tipeado y uno leído
    del QR no. Quien revise el mes tiene que poder distinguirlos.
  */
  origen_dato   text not null default 'qr' check (origen_dato in ('qr', 'manual')),

  -- ── Vínculos con el resto del sistema ─────────────────────────────────────
  -- La razón social NO viene en el QR: la escribe quien carga, o sale del
  -- proveedor vinculado.
  razon_social  text,
  proveedor_id  uuid references proveedores(id) on delete set null,
  -- El asiento en la cuenta corriente, cuando se decidió imputarlo. Nulo
  -- mientras el comprobante está sólo registrado.
  movimiento_id uuid references movimientos_proveedor(id) on delete set null,
  nota          text,

  cargado_por   uuid references perfiles(id) on delete set null,
  creado_en     timestamptz not null default now(),

  -- La idempotencia. Escanear dos veces la misma factura no la carga dos veces.
  constraint comprobantes_recibidos_unicos
    unique (cuit_emisor, tipo_codigo, punto_venta, numero)
);

comment on table comprobantes_recibidos is
  'Facturas que el hotel RECIBE, leídas del QR obligatorio de la factura electrónica argentina. No guarda la imagen: sólo los datos. Ver el encabezado de la 0080.';
comment on column comprobantes_recibidos.origen_dato is
  'qr = leído del código, sin intervención humana. manual = tipeado. Un número tipeado puede estar mal y uno del QR no: quien revisa tiene que poder distinguirlos.';
comment on column comprobantes_recibidos.tipo_codigo is
  'Código de WSFEv1 (1, 6, 11, 3, 8, 13…). Se guarda el código, no la letra: el código es lo que dice el QR.';
comment on constraint comprobantes_recibidos_unicos on comprobantes_recibidos is
  'CUIT del emisor + tipo + punto de venta + número identifica un comprobante en todo el país. Escanear dos veces la misma factura no carga el gasto dos veces.';

create index comprobantes_recibidos_fecha_idx      on comprobantes_recibidos (fecha desc);
create index comprobantes_recibidos_proveedor_idx  on comprobantes_recibidos (proveedor_id);
create index comprobantes_recibidos_movimiento_idx on comprobantes_recibidos (movimiento_id);
create index comprobantes_recibidos_cargado_por_idx on comprobantes_recibidos (cargado_por);
-- «Cuáles todavía no se imputaron a la cuenta del proveedor»: es la consulta con
-- la que se cierra el mes.
create index comprobantes_recibidos_sin_imputar_idx
  on comprobantes_recibidos (fecha desc)
  where movimiento_id is null;

-- Un movimiento de la cuenta corriente no puede respaldarse con dos comprobantes
-- distintos: sería el mismo gasto contado dos veces.
create unique index comprobantes_recibidos_un_movimiento
  on comprobantes_recibidos (movimiento_id)
  where movimiento_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table comprobantes_recibidos enable row level security;

/*
  Misma línea que `movimientos_proveedor` (0016): lo lee todo el staff y lo
  gestionan admin y gerencia.

  Que recepción lo LEA es deliberado: quien recibe la factura del proveedor en el
  mostrador tiene que poder ver si ya está cargada antes de volver a escanearla.
  Cargarla o imputarla a la cuenta corriente sí es de gerencia.
*/
create policy "comprobantes: staff lee" on comprobantes_recibidos
  for select using (rol_actual() is not null);

create policy "comprobantes: admin/gerencia gestionan" on comprobantes_recibidos
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

revoke select, insert, update, delete on comprobantes_recibidos from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Escanear dos veces la misma factura:
--   insert into comprobantes_recibidos
--     (cuit_emisor, tipo_codigo, punto_venta, numero, fecha, total, cae)
--   values ('30712345678', 1, 3, 1234, current_date, 100, '7'.repeat(14));
--   -- repetirlo → 23505
--
--   -- Un CUIT que no es un CUIT:
--   ... cuit_emisor = '123'   -- 23514
--
--   select has_table_privilege('anon','comprobantes_recibidos','select');  -- f
