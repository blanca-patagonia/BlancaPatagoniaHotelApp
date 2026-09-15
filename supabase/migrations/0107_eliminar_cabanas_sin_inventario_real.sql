-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0107 — Elimina las cabañas que no están en la hoja real
--
-- La migración 0106 dejó `CAB-2D-5P` (cabaña de 2 dormitorios, 5 personas) y
-- `CAB-3D-7P` (3 dormitorios, 7 personas) sin ninguna unidad física asignada,
-- a propósito: tenían tarifa real del Anexo A y ninguna cabaña de la hoja de
-- recepción tiene esa capacidad, así que quedaron «huérfanas» por si el hotel
-- confirmaba que correspondían a algo. El dueño del hotel pidió directamente
-- que se borren: la hoja que mandó es la lista completa de cabañas reales
-- (Bolados, Onelli, Spegazzini, Upsala, Moreno) y no hay una sexta o séptima.
--
-- `tarifas.tipo_unidad_id` es `on delete cascade` (migración 0003): borrar el
-- tipo se lleva sus tres filas de tarifa (baja/media/alta) solo. No hace falta
-- borrarlas aparte, y no hay ninguna `unidad` que referencie estos dos tipos
-- —la 0106 nunca llegó a crear una—, así que tampoco hay nada que reasignar.
-- ─────────────────────────────────────────────────────────────────────────────

delete from tipos_unidad where codigo in ('CAB-2D-5P', 'CAB-3D-7P');
