-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0110 — Auditoría de la edición de ficha de reserva
--
-- ── Qué faltaba ──────────────────────────────────────────────────────────────
--
-- Hasta ahora una reserva no se podía corregir después de creada: solo
-- reprogramar, mudar de unidad o cancelar y volver a crear. Al sumar la
-- edición de plan, segmento, voucher, notas, cunas, «no mover» y la
-- composición (adultos/menores/bebés) —`editarFichaReserva` en
-- `app/panel/reservas/actions.ts`— hacía falta dejar rastro de ese cambio,
-- igual que ya pasa con el estado de la reserva (migración 0020) y con la
-- mudanza de unidad (migración 0028).
--
-- ── Por qué un `when` acotado y no auditar cada UPDATE ──────────────────────
--
-- El propio comentario de la 0020 lo explica: «Auditar cada UPDATE llenaría la
-- tabla de ruido». `reservas` y `estadias` ya cambian por otros caminos que no
-- hace falta auditar acá —`aplicar_precio_reserva` (0085) al reprogramar,
-- `avanzar_estado_reserva` (0109) al cambiar de estado— y cada uno tiene (o no
-- necesita) su propia bitácora. Estos dos triggers solo reaccionan a los
-- campos que `editarFichaReserva` puede tocar.
--
-- ── Por qué `estadias` entra a la tabla de `auditoria` recién ahora ─────────
--
-- La 0028 ya audita `estadias` pero solo el cambio de `unidad_id` (una
-- mudanza). La composición y «no mover» son datos distintos —no mueven
-- inventario— así que es un trigger aparte, no una ampliación de aquél: un
-- `when` con las dos condiciones mezcladas haría que mudar de unidad sin
-- tocar la composición generara la misma fila que antes, y viceversa, en vez
-- de poder leer cada cambio por separado.
-- ─────────────────────────────────────────────────────────────────────────────

create trigger reservas_ficha_auditoria
  after update on reservas
  for each row
  when (
    old.plan is distinct from new.plan
    or old.segmento is distinct from new.segmento
    or old.voucher is distinct from new.voucher
    or old.notas is distinct from new.notas
  )
  execute function registrar_auditoria();

comment on trigger reservas_ficha_auditoria on reservas is
  'Audita la edición de ficha (plan, segmento, voucher, notas), aparte del cambio de estado que ya audita reservas_estado_auditoria (0020).';

create trigger estadias_ficha_auditoria
  after update on estadias
  for each row
  when (
    old.adultos is distinct from new.adultos
    or old.menores is distinct from new.menores
    or old.bebes is distinct from new.bebes
    or old.cunas is distinct from new.cunas
    or old.no_mover is distinct from new.no_mover
  )
  execute function registrar_auditoria();

comment on trigger estadias_ficha_auditoria on estadias is
  'Audita la composición y "no mover" editadas desde la ficha, aparte del cambio de unidad que ya audita estadias_unidad_auditoria (0028).';
