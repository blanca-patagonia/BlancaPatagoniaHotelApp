-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0098 — El desayuno está siempre incluido: se elimina el plan
-- «solo_alojamiento»
--
-- Decisión del dueño del hotel (2026-09-14): el desayuno se incluye SIEMPRE en
-- la tarifa, sin excepción. `reservas.plan` (migración 0039) permitía elegir
-- `solo_alojamiento`, lo que dejaba cargar (y filtrar) reservas que prometían
-- menos de lo que el hotel en verdad da. Se saca esa opción del check y del
-- dominio (`lib/domain/reservas.ts`); quedan `desayuno` (plan base),
-- `media_pension` y `pension_completa` (que lo incluyen y suman comidas).
--
-- Las filas existentes con `solo_alojamiento` se migran a `desayuno` antes de
-- endurecer el check: si no se hiciera, el `alter table` fallaría contra
-- cualquier fila vieja con ese valor.
-- ─────────────────────────────────────────────────────────────────────────────

update reservas set plan = 'desayuno' where plan = 'solo_alojamiento';

alter table reservas
  drop constraint reservas_plan_check;

alter table reservas
  add constraint reservas_plan_check
    check (plan in ('desayuno', 'media_pension', 'pension_completa'));

comment on column reservas.plan is
  'Plan de comidas. El desayuno está SIEMPRE incluido (no existe «solo alojamiento»); «desayuno» es el plan base del Tarifario.';
