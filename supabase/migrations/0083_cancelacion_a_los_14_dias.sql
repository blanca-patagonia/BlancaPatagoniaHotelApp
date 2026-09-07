-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0083 — Cancelar a exactamente 14 días cobra la primera noche
-- (auditoría 2026-09)
--
-- ── El Tarifario dice una cosa y la regla cargada, otra ─────────────────────
--
-- El Tarifario 2025/2026 publicado por el hotel (Anexo A) fija cuatro tramos:
--
--     · más de 14 días  → sin cargo
--     · de 14 a 7 días  → se cobra la primera noche
--     · menos de 7 días → 100 % de la estadía
--     · no-show         → 100 % de la estadía
--
-- La regla cargada era `{"desde_dias": 14, "cargo": "ninguno"}`, y
-- `cargoPorCancelacion` aplica la primera regla cuyo umbral es <= a los días de
-- anticipación (`diasAntes >= regla.desde_dias`). Con 14 en el umbral, cancelar
-- **a exactamente 14 días** cae en «sin cargo». El Tarifario lo pone del otro
-- lado: los 14 días son el primer día del tramo que **sí** cobra.
--
-- «Más de 14 días» son 15 o más. El umbral es 15.
--
-- ── Por qué importa un solo día ─────────────────────────────────────────────
--
-- Porque es plata y porque está publicado. El huésped tiene el tarifario a la
-- vista y el sistema tiene que cobrar lo que ahí dice, ni más ni menos. En el
-- borde de abajo la regla ya era correcta —a exactamente 7 días se cobra la
-- primera noche, que es lo que corresponde—; el error estaba sólo arriba.
--
-- El comentario de `lib/domain/cancelacion.ts` describía la regla **bien** desde
-- el principio: lo que no coincidía era el dato. El test tampoco lo delataba
-- porque afirmaba «no cobra si se cancela con más de 14 días» y a continuación
-- verificaba el día 14, que no es «más de 14».
--
-- ── Alcance ─────────────────────────────────────────────────────────────────
--
-- Se corrige la política `estandar` sin tocar las demás: si alguien cargó una
-- política propia, el umbral que eligió es una decisión suya.
-- ─────────────────────────────────────────────────────────────────────────────

update politicas_cancelacion
   set reglas = '[{"desde_dias":15,"cargo":"ninguno"},
                  {"desde_dias":7,"cargo":"primera_noche"},
                  {"desde_dias":0,"cargo":"total"}]'::jsonb
 where codigo = 'estandar'
   and reglas @> '[{"desde_dias":14,"cargo":"ninguno"}]'::jsonb;

comment on table politicas_cancelacion is
  'Reglas de cancelación: umbral en días antes del check-in → cargo aplicable. '
  'El umbral es inclusivo (`diasAntes >= desde_dias`), así que «más de 14 días '
  'sin cargo» del Tarifario se escribe con 15, no con 14.';
