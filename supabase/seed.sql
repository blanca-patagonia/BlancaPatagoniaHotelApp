-- ─────────────────────────────────────────────────────────────────────────────
-- Seed de datos — Hotel Blanca Patagonia
-- Datos reales del Anexo A (Tarifario Temporada 2025 / 2026, IVA discriminado).
-- Se ejecuta con `supabase db reset`.
--
-- El inventario físico de `unidades` es el real (migración 0106, hoja de
-- recepción del hotel): Agassiz/Mayo/Frías + Planta Alta/Planta Baja de la
-- hostería, y las cabañas Bolados/Onelli/Spegazzini/Upsala/Moreno. Los nombres
-- y códigos de `tipos_unidad` de acá tienen que coincidir exactamente con los
-- que esa migración deja (la renombra si ya existían, o los usa directo si
-- todavía no — ver el comentario de esa migración para el porqué de las dos
-- rutas). Upsala y Moreno **no** están en el insert de tipos de abajo: la
-- migración 0106 ya los crea, sin tarifa, y volver a insertarlos acá
-- chocaría contra el `unique` de `codigo`.
--
-- Las tarifas y temporadas SÍ son las oficiales. Para cabañas el tarifario
-- solo publica tarifa neta (agencia); se replica en rack hasta confirmar el
-- precio de mostrador.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Temporadas y sus rangos de fecha ──────────────────────────────────────────
insert into temporadas (codigo, nombre, orden) values
  ('baja',  'Temporada Baja',  1),
  ('media', 'Temporada Media', 2),
  ('alta',  'Temporada Alta',  3);

-- ⚠️ El calendario del tarifario va de SEPTIEMBRE a MAYO. Junio, julio y agosto
-- quedan sin temporada a propósito: el Anexo A no publica tarifa de invierno.
-- Consecuencia operativa, que hay que tener presente: **en esos tres meses el
-- sistema no puede cotizar** y el portal ofrece «consultar» en vez de un precio.
-- No es una falla; si el hotel decide vender el invierno, hay que cargar esos
-- rangos y sus tarifas desde Configuración → Temporadas.
--
-- ⚠️ Y el calendario CADUCA: es de un ciclo concreto, no una regla anual. Cuando
-- la fecha del sistema pasa el último rango cargado, deja de poder cotizarse
-- **cualquier** fecha futura y el alta de reservas queda bloqueada. Abajo va el
-- ciclo 2026/2027 por eso mismo. Cargar el siguiente es tarea del hotel, desde
-- esa misma pantalla.
insert into temporada_rangos (temporada_id, rango)
select tp.id, r.rango
from (values
  -- Ciclo 2025/2026 — Anexo A, tarifario oficial.
  ('baja',  daterange('2025-09-01','2025-10-01','[)')),
  ('baja',  daterange('2026-04-05','2026-06-01','[)')),
  ('media', daterange('2025-10-01','2025-11-01','[)')),
  ('media', daterange('2025-12-01','2025-12-20','[)')),
  ('media', daterange('2026-03-01','2026-03-29','[)')),
  ('alta',  daterange('2025-11-01','2025-12-01','[)')),
  ('alta',  daterange('2025-12-20','2026-03-01','[)')),
  ('alta',  daterange('2026-03-29','2026-04-05','[)')),
  -- Ciclo 2026/2027 — misma estructura, proyectada. Las tarifas asociadas son
  -- las mismas (`tarifas` cuelga de la temporada, no del rango), así que esto
  -- alcanza para que el sistema vuelva a cotizar.
  -- PENDIENTE DE CONFIRMAR CON EL HOTEL: los precios del ciclo nuevo y la
  -- semana de Semana Santa, que se corre todos los años (en 2027 cae el 28/03,
  -- así que el bloque de alta de fin de marzo probablemente haya que moverlo).
  ('baja',  daterange('2026-09-01','2026-10-01','[)')),
  ('baja',  daterange('2027-04-05','2027-06-01','[)')),
  ('media', daterange('2026-10-01','2026-11-01','[)')),
  ('media', daterange('2026-12-01','2026-12-20','[)')),
  ('media', daterange('2027-03-01','2027-03-29','[)')),
  ('alta',  daterange('2026-11-01','2026-12-01','[)')),
  ('alta',  daterange('2026-12-20','2027-03-01','[)')),
  ('alta',  daterange('2027-03-29','2027-04-05','[)'))
) as r(temp_codigo, rango)
join temporadas tp on tp.codigo = r.temp_codigo;

-- ── Tipos de unidad ───────────────────────────────────────────────────────────
-- ⚠️ Upsala y Moreno NO van acá: los crea la migración 0106 (sin tarifa).
-- ⚠️ No hay cabaña de 5 ni de 7 personas: la migración 0107 borró esos dos
-- tipos (tenían tarifa real pero ninguna cabaña de la hoja de recepción
-- tiene esa capacidad — lo confirmó el dueño del hotel).
insert into tipos_unidad (codigo, nombre, categoria, capacidad_max, descripcion, amenities) values
  ('HOST-SINGLE',  'Single',                        'hosteria', 1, 'Habitación single con vista al Lago Argentino.',            '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-STD',     'Standard',                      'hosteria', 2, 'Habitación doble standard con vista al lago.',              '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-SUP',     'Superior',                      'hosteria', 2, 'Habitación doble superior con vista al lago.',              '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-TRIPLE',  'Triple',                        'hosteria', 3, 'Habitación triple con vista al lago.',                      '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('HOST-SUITE',   'Suite',                         'hosteria', 2, 'Suite con vista panorámica e hidromasaje.',                 '["Vista al Lago Argentino","Hidromasaje","Desayuno buffet","WiFi"]'),
  ('CAB-ONELLI',      'Onelli',      'cabana', 3, 'Cabaña Onelli, hasta 3 personas.',      '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]'),
  ('CAB-SPEGAZZINI',  'Spegazzini',  'cabana', 4, 'Cabaña Spegazzini, hasta 4 personas.',  '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]'),
  ('CAB-BOLADOS',  'Bolados',       'cabana', 6, 'Cabaña Bolados, hasta 6 personas.',       '["Hogar a parrilla","Cocina equipada","Desayuno buffet","WiFi"]');

-- ── Tarifas (Anexo A). Neto = agencia, Rack = mostrador. Montos SIN IVA. ───────
insert into tarifas (tipo_unidad_id, temporada_id, precio_neto, precio_rack)
select tu.id, tp.id, v.neto, v.rack
from (values
  -- Hostería Boutique
  ('HOST-SINGLE',  'baja',   85, 120), ('HOST-SINGLE',  'media', 110, 143), ('HOST-SINGLE',  'alta', 155, 177),
  ('HOST-STD',     'baja',   85, 120), ('HOST-STD',     'media', 110, 143), ('HOST-STD',     'alta', 155, 177),
  ('HOST-SUP',     'baja',  100, 139), ('HOST-SUP',     'media', 130, 165), ('HOST-SUP',     'alta', 170, 195),
  ('HOST-TRIPLE',  'baja',  120, 160), ('HOST-TRIPLE',  'media', 145, 180), ('HOST-TRIPLE',  'alta', 190, 215),
  ('HOST-SUITE',   'baja',  140, 190), ('HOST-SUITE',   'media', 180, 190), ('HOST-SUITE',   'alta', 220, 225),
  -- Cabañas (rack replicado de neto hasta confirmar mostrador)
  ('CAB-ONELLI',      'baja',  130, 130), ('CAB-ONELLI',      'media', 155, 155), ('CAB-ONELLI',      'alta', 200, 200),
  ('CAB-SPEGAZZINI',  'baja',  180, 180), ('CAB-SPEGAZZINI',  'media', 210, 210), ('CAB-SPEGAZZINI',  'alta', 240, 240),
  ('CAB-BOLADOS',  'baja',  240, 240), ('CAB-BOLADOS',  'media', 265, 265), ('CAB-BOLADOS',  'alta', 310, 310)
) as v(tipo_codigo, temp_codigo, neto, rack)
join tipos_unidad tu on tu.codigo = v.tipo_codigo
join temporadas   tp on tp.codigo = v.temp_codigo;

-- ── Unidades físicas (inventario real, hoja de recepción — ver migración 0106) ──
-- Upsala y Moreno ya están cargadas por la migración 0106 (sus `unidades`
-- se insertan ahí junto con sus `tipos_unidad`, porque no dependen de nada
-- de este archivo). El resto se carga acá porque sí depende de los
-- `tipos_unidad` que este archivo acaba de insertar arriba.
insert into unidades (tipo_unidad_id, nombre, bloque, piso, orden)
select tu.id, v.nombre, v.bloque, v.piso, v.orden
from (values
  -- Sueltas.
  ('HOST-STD',    'Agassiz', 'Hostería', '', 0),
  ('HOST-TRIPLE', 'Mayo',    'Hostería', '', 0),
  ('HOST-SUITE',  'Frías',   'Hostería', '', 0),
  -- Planta Alta.
  ('HOST-SUP',    'Gorra Blanca', 'Hostería', 'PA', 1),
  ('HOST-SUP',    'Murallón',     'Hostería', 'PA', 2),
  ('HOST-SUP',    'Heim',         'Hostería', 'PA', 3),
  ('HOST-STD',    'Ameghino',     'Hostería', 'PA', 4),
  ('HOST-STD',    'Caglio',       'Hostería', 'PA', 5),
  ('HOST-SUITE',  'Torre',        'Hostería', 'PA', 6),
  -- Planta Baja.
  ('HOST-TRIPLE', 'Peineta',  'Hostería', 'PB', 1),
  ('HOST-STD',    'Cono',     'Hostería', 'PB', 2),
  ('HOST-SUP',    'Viedma',   'Hostería', 'PB', 3),
  ('HOST-STD',    'Marconi',  'Hostería', 'PB', 4),
  ('HOST-STD',    'Bertachi', 'Hostería', 'PB', 5),
  ('HOST-STD',    'Nunatak',  'Hostería', 'PB', 6),
  -- Cabañas.
  ('CAB-BOLADOS', 'Bolados 1', 'Cabañas', '', 1), ('CAB-BOLADOS', 'Bolados 2', 'Cabañas', '', 2),
  ('CAB-BOLADOS', 'Bolados 3', 'Cabañas', '', 3), ('CAB-BOLADOS', 'Bolados 4', 'Cabañas', '', 4),
  ('CAB-BOLADOS', 'Bolados 5', 'Cabañas', '', 5), ('CAB-BOLADOS', 'Bolados 6', 'Cabañas', '', 6),
  ('CAB-BOLADOS', 'Bolados 7', 'Cabañas', '', 7),
  ('CAB-ONELLI',  'Onelli 1',  'Cabañas', '', 1), ('CAB-ONELLI',  'Onelli 2',  'Cabañas', '', 2),
  ('CAB-ONELLI',  'Onelli 3',  'Cabañas', '', 3), ('CAB-ONELLI',  'Onelli 4',  'Cabañas', '', 4),
  ('CAB-SPEGAZZINI', 'Spegazzini 1', 'Cabañas', '', 1), ('CAB-SPEGAZZINI', 'Spegazzini 2', 'Cabañas', '', 2),
  ('CAB-SPEGAZZINI', 'Spegazzini 3', 'Cabañas', '', 3), ('CAB-SPEGAZZINI', 'Spegazzini 4', 'Cabañas', '', 4),
  ('CAB-SPEGAZZINI', 'Spegazzini 5', 'Cabañas', '', 5)
) as v(tipo_codigo, nombre, bloque, piso, orden)
join tipos_unidad tu on tu.codigo = v.tipo_codigo
where not exists (select 1 from unidades u where u.nombre = v.nombre);

-- ── Política de cancelación (Tarifario) ───────────────────────────────────────
-- > 14 días: sin cargo · 14–7 días: primera noche · < 7 días: 100% · no-show: 100%.
insert into politicas_cancelacion (codigo, nombre, reembolsable, reglas) values
  ('estandar', 'Política estándar Blanca Patagonia', true,
   -- 15 y no 14: el umbral es inclusivo y el Tarifario dice «MÁS de 14 días sin
   -- cargo», así que el día 14 ya cobra la primera noche (migración 0083).
   '[{"desde_dias":15,"cargo":"ninguno"},
     {"desde_dias":7,"cargo":"primera_noche"},
     {"desde_dias":0,"cargo":"total"}]');

-- ── Promociones de ejemplo ────────────────────────────────────────────────────
insert into promociones (codigo, nombre, tipo, valor, condiciones) values
  ('LARGA5',     'Estadía larga (5+ noches) −10%',    'porcentaje', 10, '{"min_noches":5}'),
  ('ANTICIPADA', 'Reserva anticipada (60+ días) −15%', 'porcentaje', 15, '{"anticipacion_dias":60}');
