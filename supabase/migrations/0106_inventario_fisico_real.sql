-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0106 — Inventario físico real (nombres reales de habitaciones y
-- cabañas), reemplazando el catálogo representativo de `seed.sql`.
--
-- ── Qué resuelve ──────────────────────────────────────────────────────────────
--
-- `seed.sql` decía desde el principio: «el inventario físico de `unidades` es
-- representativo (cantidades a confirmar con el hotel)». `CLAUDE.md` lo tenía
-- anotado como pendiente. El dueño del hotel mandó la hoja real que usa
-- recepción (nombres de las habitaciones de la hostería por planta, y las
-- cabañas con su cantidad de unidades y capacidad), y esta migración carga eso.
--
-- ── Por qué RENOMBRA en vez de borrar y crear de nuevo ──────────────────────
--
-- Seis de los `tipos_unidad` ya tenían **tarifas reales del Anexo A** cargadas
-- (`tarifas.tipo_unidad_id` referencia el `id`, no el `codigo`). Borrarlos y
-- crear tipos nuevos habría dejado esas tarifas huérfanas o habría exigido
-- volver a cargarlas a mano, con el riesgo de tipear un precio distinto al
-- oficial. Se actualiza `codigo` y `nombre` del mismo `id` —vía `update ... where
-- codigo = '<código viejo>'`— así las tarifas siguen atadas al tipo correcto sin
-- tocarlas.
--
-- ⚠️ Estos `update` son **no-op en una base local recién reseteada**: a esa
-- altura de `db reset` las migraciones ya corrieron pero `seed.sql` todavía no
-- insertó ningún `tipos_unidad`, así que no hay nada que renombrar. Por eso
-- `supabase/seed.sql` se reescribió aparte con los nombres NUEVOS directamente:
-- las dos rutas (esta migración para la base hosted, que ya tenía el catálogo
-- viejo cargado; `seed.sql` para una base local nueva) tienen que llegar al
-- mismo resultado por caminos distintos.
--
-- ── Lo que queda sin resolver, a propósito ──────────────────────────────────
--
-- 1. **Tres tipos quedan «huérfanos»**: `HOST-SINGLE` (ninguna habitación real
--    es individual — pudo haberse dejado de ofrecer, o la hoja no la incluye),
--    `CAB-2D-5P` (cabaña de 5 personas: ninguna cabaña real tiene esa capacidad)
--    y `CAB-3D-7P` (7 personas: tampoco). No se borran —tienen tarifas reales
--    del Anexo A— pero se quedan sin ninguna unidad física asignada hasta que
--    el hotel confirme si corresponden a algo.
-- 2. **Upsala y Moreno (cabañas de 2 personas) NO tienen tarifa cargada.** No
--    hay ninguna categoría de 2 personas en el Anexo A vigente, y este sistema
--    no inventa un precio (mismo criterio que la cotización de divisas o el
--    "USD 0" de la Fase 18): hasta que el hotel diga cuánto cobran, esas 6
--    cabañas existen en el inventario pero no se pueden cotizar ni reservar.
-- 3. **La configuración de cama (Twin / Matrimonial / Solo Twin / Solo
--    Matrimonial) que trae la hoja NO se carga.** No hay ningún campo para eso
--    hoy — ni en `tipos_unidad` ni en `unidades` — y agregarlo es una decisión
--    de diseño aparte (¿por tipo o por unidad? ¿afecta la disponibilidad?) que
--    no se tomó en esta pasada.
-- 4. **La categoría asignada a las habitaciones sin ninguna etiqueta en la hoja
--    (Ameghino, Caglio, Cono, Nunatak, Marconi, Bertachi) es una inferencia**:
--    se las trató como Standard por no tener «SUP», «Triple» ni «Suite»
--    anotado al lado, igual que Agassiz. Si alguna es en realidad Superior,
--    se corrige después desde el tarifario (cambiarle el `tipo_unidad_id` a la
--    unidad, no hay que tocar esta migración).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Renombrar los tipos existentes que sí tienen tarifas reales ───────────
update tipos_unidad set codigo = 'HOST-STD', nombre = 'Standard' where codigo = 'HOST-DBL-STD';
update tipos_unidad set codigo = 'HOST-SUP', nombre = 'Superior' where codigo = 'HOST-DBL-SUP';
update tipos_unidad set nombre = 'Triple'                        where codigo = 'HOST-TRIPLE';
update tipos_unidad set nombre = 'Suite'                          where codigo = 'HOST-SUITE';
update tipos_unidad set codigo = 'CAB-BOLADOS',    nombre = 'Bolados'    where codigo = 'CAB-3D-6P';
update tipos_unidad set codigo = 'CAB-ONELLI',     nombre = 'Onelli'     where codigo = 'CAB-1D-3P';
update tipos_unidad set codigo = 'CAB-SPEGAZZINI', nombre = 'Spegazzini' where codigo = 'CAB-2D-4P';

-- ── 2. Dos cabañas nuevas, sin tarifa (ver el punto 2 de arriba) ─────────────
insert into tipos_unidad (codigo, nombre, categoria, capacidad_max, descripcion)
select 'CAB-UPSALA', 'Upsala', 'cabana', 2,
       'Cabaña para 2 personas. Sin tarifa cargada: pendiente de confirmar con el hotel.'
where not exists (select 1 from tipos_unidad where codigo = 'CAB-UPSALA');

insert into tipos_unidad (codigo, nombre, categoria, capacidad_max, descripcion)
select 'CAB-MORENO', 'Moreno', 'cabana', 2,
       'Cabaña para 2 personas. Sin tarifa cargada: pendiente de confirmar con el hotel.'
where not exists (select 1 from tipos_unidad where codigo = 'CAB-MORENO');

-- ── 3. Unidades físicas reales ────────────────────────────────────────────────
-- `where not exists (... where nombre = v.nombre)` en vez de una restricción
-- única: `unidades.nombre` no tiene `unique` (dos unidades podrían llamarse
-- igual en teoría) y esta migración tiene que poder re-ejecutarse sin duplicar
-- filas si alguna vez se corre dos veces contra la misma base.
insert into unidades (tipo_unidad_id, nombre, bloque, piso, orden)
select tu.id, v.nombre, v.bloque, v.piso, v.orden
from (values
  -- Sueltas: no están en ninguna de las dos plantas de la hostería principal.
  ('HOST-STD',   'Agassiz', 'Hostería', '', 0),
  ('HOST-TRIPLE','Mayo',    'Hostería', '', 0),
  ('HOST-SUITE', 'Frías',   'Hostería', '', 0),
  -- Planta Alta (P.A.), en el orden de la hoja.
  ('HOST-SUP',   'Gorra Blanca', 'Hostería', 'PA', 1),
  ('HOST-SUP',   'Murallón',     'Hostería', 'PA', 2),
  ('HOST-SUP',   'Heim',         'Hostería', 'PA', 3),
  ('HOST-STD',   'Ameghino',     'Hostería', 'PA', 4),
  ('HOST-STD',   'Caglio',       'Hostería', 'PA', 5),
  ('HOST-SUITE', 'Torre',        'Hostería', 'PA', 6),
  -- Planta Baja (P.B.), en el orden de la hoja.
  ('HOST-TRIPLE','Peineta',  'Hostería', 'PB', 1),
  ('HOST-STD',   'Cono',     'Hostería', 'PB', 2),
  ('HOST-SUP',   'Viedma',   'Hostería', 'PB', 3),
  ('HOST-STD',   'Marconi',  'Hostería', 'PB', 4),
  ('HOST-STD',   'Bertachi', 'Hostería', 'PB', 5),
  ('HOST-STD',   'Nunatak',  'Hostería', 'PB', 6),
  -- Cabañas: 7 + 4 + 5 + 3 + 3 = 22 unidades físicas.
  ('CAB-BOLADOS', 'Bolados 1', 'Cabañas', '', 1), ('CAB-BOLADOS', 'Bolados 2', 'Cabañas', '', 2),
  ('CAB-BOLADOS', 'Bolados 3', 'Cabañas', '', 3), ('CAB-BOLADOS', 'Bolados 4', 'Cabañas', '', 4),
  ('CAB-BOLADOS', 'Bolados 5', 'Cabañas', '', 5), ('CAB-BOLADOS', 'Bolados 6', 'Cabañas', '', 6),
  ('CAB-BOLADOS', 'Bolados 7', 'Cabañas', '', 7),
  ('CAB-ONELLI',  'Onelli 1',  'Cabañas', '', 1), ('CAB-ONELLI',  'Onelli 2',  'Cabañas', '', 2),
  ('CAB-ONELLI',  'Onelli 3',  'Cabañas', '', 3), ('CAB-ONELLI',  'Onelli 4',  'Cabañas', '', 4),
  ('CAB-SPEGAZZINI', 'Spegazzini 1', 'Cabañas', '', 1), ('CAB-SPEGAZZINI', 'Spegazzini 2', 'Cabañas', '', 2),
  ('CAB-SPEGAZZINI', 'Spegazzini 3', 'Cabañas', '', 3), ('CAB-SPEGAZZINI', 'Spegazzini 4', 'Cabañas', '', 4),
  ('CAB-SPEGAZZINI', 'Spegazzini 5', 'Cabañas', '', 5),
  ('CAB-UPSALA', 'Upsala 1', 'Cabañas', '', 1), ('CAB-UPSALA', 'Upsala 2', 'Cabañas', '', 2),
  ('CAB-UPSALA', 'Upsala 3', 'Cabañas', '', 3),
  ('CAB-MORENO', 'Moreno 1', 'Cabañas', '', 1), ('CAB-MORENO', 'Moreno 2', 'Cabañas', '', 2),
  ('CAB-MORENO', 'Moreno 3', 'Cabañas', '', 3)
) as v(tipo_codigo, nombre, bloque, piso, orden)
join tipos_unidad tu on tu.codigo = v.tipo_codigo
where not exists (select 1 from unidades u where u.nombre = v.nombre);
