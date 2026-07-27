-- ─────────────────────────────────────────────────────────────────────────────
-- Seed de datos — Hotel Blanca Patagonia
-- Datos reales del Anexo A (Tarifario Temporada 2025 / 2026, IVA discriminado).
-- Se ejecuta con `supabase db reset`.
--
-- NOTA: el inventario físico de `unidades` es representativo (cantidades a
-- confirmar con el hotel). Las tarifas y temporadas SÍ son las oficiales.
-- Para cabañas el tarifario solo publica tarifa neta (agencia); se replica en
-- rack hasta confirmar el precio de mostrador.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Temporadas y sus rangos de fecha ──────────────────────────────────────────
insert into temporadas (codigo, nombre, orden) values
  ('baja',  'Temporada Baja',  1),
  ('media', 'Temporada Media', 2),
  ('alta',  'Temporada Alta',  3);

insert into temporada_rangos (temporada_id, rango)
select tp.id, r.rango
from (values
  ('baja',  daterange('2025-09-01','2025-10-01','[)')),
  ('baja',  daterange('2026-04-05','2026-06-01','[)')),
  ('media', daterange('2025-10-01','2025-11-01','[)')),
  ('media', daterange('2025-12-01','2025-12-20','[)')),
  ('media', daterange('2026-03-01','2026-03-29','[)')),
  ('alta',  daterange('2025-11-01','2025-12-01','[)')),
  ('alta',  daterange('2025-12-20','2026-03-01','[)')),
  ('alta',  daterange('2026-03-29','2026-04-05','[)'))
) as r(temp_codigo, rango)
join temporadas tp on tp.codigo = r.temp_codigo;

-- ── Tipos de unidad ───────────────────────────────────────────────────────────
insert into tipos_unidad (codigo, nombre, categoria, capacidad_max, descripcion, amenities) values
  ('HOST-SINGLE',  'Single',                        'hosteria', 1, 'Habitación single con vista al Lago Argentino.',            '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-DBL-STD', 'Doble Standard',                'hosteria', 2, 'Habitación doble standard con vista al lago.',              '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-DBL-SUP', 'Doble Superior',                'hosteria', 2, 'Habitación doble superior con vista al lago.',              '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-TRIPLE',  'Triple',                        'hosteria', 3, 'Habitación triple con vista al lago.',                      '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-SUITE',   'Suite Principal',               'hosteria', 2, 'Suite principal con vista panorámica e hidromasaje.',       '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('CAB-1D-3P',    'Cabaña 1 dormitorio (3 pers.)', 'cabana',   3, 'Cabaña de 1 dormitorio, hasta 3 personas.',                 '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]'),
  ('CAB-2D-4P',    'Cabaña 2 dormitorios (4 pers.)','cabana',   4, 'Cabaña de 2 dormitorios, hasta 4 personas.',                '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]'),
  ('CAB-2D-5P',    'Cabaña 2 dormitorios (5 pers.)','cabana',   5, 'Cabaña de 2 dormitorios, hasta 5 personas.',                '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]'),
  ('CAB-3D-6P',    'Cabaña 3 dormitorios (6 pers.)','cabana',   6, 'Cabaña de 3 dormitorios, hasta 6 personas.',                '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]'),
  ('CAB-3D-7P',    'Cabaña 3 dormitorios (7 pers.)','cabana',   7, 'Cabaña de 3 dormitorios, hasta 7 personas.',                '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]');

-- ── Tarifas (Anexo A). Neto = agencia, Rack = mostrador. Montos SIN IVA. ───────
insert into tarifas (tipo_unidad_id, temporada_id, precio_neto, precio_rack)
select tu.id, tp.id, v.neto, v.rack
from (values
  -- Hostería Boutique
  ('HOST-SINGLE',  'baja',   85, 120), ('HOST-SINGLE',  'media', 110, 143), ('HOST-SINGLE',  'alta', 155, 177),
  ('HOST-DBL-STD', 'baja',   85, 120), ('HOST-DBL-STD', 'media', 110, 143), ('HOST-DBL-STD', 'alta', 155, 177),
  ('HOST-DBL-SUP', 'baja',  100, 139), ('HOST-DBL-SUP', 'media', 130, 165), ('HOST-DBL-SUP', 'alta', 170, 195),
  ('HOST-TRIPLE',  'baja',  120, 160), ('HOST-TRIPLE',  'media', 145, 180), ('HOST-TRIPLE',  'alta', 190, 215),
  ('HOST-SUITE',   'baja',  140, 190), ('HOST-SUITE',   'media', 180, 190), ('HOST-SUITE',   'alta', 220, 225),
  -- Cabañas (rack replicado de neto hasta confirmar mostrador)
  ('CAB-1D-3P',    'baja',  130, 130), ('CAB-1D-3P',    'media', 155, 155), ('CAB-1D-3P',    'alta', 200, 200),
  ('CAB-2D-4P',    'baja',  180, 180), ('CAB-2D-4P',    'media', 210, 210), ('CAB-2D-4P',    'alta', 240, 240),
  ('CAB-2D-5P',    'baja',  210, 210), ('CAB-2D-5P',    'media', 235, 235), ('CAB-2D-5P',    'alta', 280, 280),
  ('CAB-3D-6P',    'baja',  240, 240), ('CAB-3D-6P',    'media', 265, 265), ('CAB-3D-6P',    'alta', 310, 310),
  ('CAB-3D-7P',    'baja',  270, 270), ('CAB-3D-7P',    'media', 300, 300), ('CAB-3D-7P',    'alta', 340, 340)
) as v(tipo_codigo, temp_codigo, neto, rack)
join tipos_unidad tu on tu.codigo = v.tipo_codigo
join temporadas   tp on tp.codigo = v.temp_codigo;

-- ── Unidades físicas (inventario representativo, a confirmar) ──────────────────
insert into unidades (tipo_unidad_id, nombre)
select tu.id, v.nombre
from (values
  ('HOST-SINGLE',  'Hostería 101'),
  ('HOST-SINGLE',  'Hostería 102'),
  ('HOST-DBL-STD', 'Hostería 201'),
  ('HOST-DBL-STD', 'Hostería 202'),
  ('HOST-DBL-STD', 'Hostería 203'),
  ('HOST-DBL-SUP', 'Hostería 301'),
  ('HOST-DBL-SUP', 'Hostería 302'),
  ('HOST-TRIPLE',  'Hostería 401'),
  ('HOST-TRIPLE',  'Hostería 402'),
  ('HOST-SUITE',   'Suite Principal'),
  ('CAB-1D-3P',    'Cabaña Lenga'),
  ('CAB-2D-4P',    'Cabaña Ñire'),
  ('CAB-2D-5P',    'Cabaña Calafate'),
  ('CAB-3D-6P',    'Cabaña Notro'),
  ('CAB-3D-7P',    'Cabaña Coihue')
) as v(tipo_codigo, nombre)
join tipos_unidad tu on tu.codigo = v.tipo_codigo;

-- ── Política de cancelación (Tarifario) ───────────────────────────────────────
-- > 14 días: sin cargo · 14–7 días: primera noche · < 7 días: 100% · no-show: 100%.
insert into politicas_cancelacion (codigo, nombre, reembolsable, reglas) values
  ('estandar', 'Política estándar Blanca Patagonia', true,
   '[{"desde_dias":14,"cargo":"ninguno"},
     {"desde_dias":7,"cargo":"primera_noche"},
     {"desde_dias":0,"cargo":"total"}]');

-- ── Promociones de ejemplo ────────────────────────────────────────────────────
insert into promociones (codigo, nombre, tipo, valor, condiciones) values
  ('LARGA5',     'Estadía larga (5+ noches) −10%',    'porcentaje', 10, '{"min_noches":5}'),
  ('ANTICIPADA', 'Reserva anticipada (60+ días) −15%', 'porcentaje', 15, '{"anticipacion_dias":60}');
