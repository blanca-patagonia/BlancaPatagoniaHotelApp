-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0090 — Estado de entrega real, no solo "se lo mandé al proveedor"
--
-- Patrón de referencia: Evolution API (WhatsApp) — arquitectura basada en
-- webhooks/eventos, no en sondear al proveedor.
--
-- `notificaciones.estado` (migración 0075) solo sabía lo que el propio sistema
-- hizo: `enviada` significa «se lo entregamos a Meta/Resend», no que el
-- destinatario lo haya recibido. Entre las dos hay un salto real: un teléfono
-- apagado, un número mal cargado, un mensaje que rebota. WhatsApp y Resend
-- avisan eso por webhook, y hasta ahora nadie lo escuchaba.
--
-- `id_externo` es lo que permite correlacionar ese aviso con la fila: el
-- mismo criterio que `pagos.external_id`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table notificaciones add column id_externo text;
comment on column notificaciones.id_externo is
  'Id del mensaje del lado del proveedor (Meta, Resend). Lo usa el webhook de entrega para encontrar la fila.';

-- Único cuando existe, no en general: la mayoría de las filas todavía no
-- tienen id_externo (no llegó la respuesta del proveedor, o el proveedor es
-- el simulador, que no genera ninguno).
create unique index notificaciones_id_externo_key on notificaciones (id_externo) where id_externo is not null;

alter table notificaciones drop constraint notificaciones_estado_check;
alter table notificaciones add constraint notificaciones_estado_check
  check (estado in ('pendiente', 'enviada', 'entregada', 'leida', 'fallida', 'cancelada'));
comment on column notificaciones.estado is
  'pendiente/enviada las decide este sistema; entregada/leida las informa el proveedor por webhook.';
