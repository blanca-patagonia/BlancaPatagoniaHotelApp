-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0074 — Detectar que una reserva DESAPARECIÓ del feed del canal
-- (Bloque A de la auditoría 2026-09, defecto P0-1, segunda mitad)
--
-- ── El problema ──────────────────────────────────────────────────────────────
--
-- En un feed iCal de Booking, **una cancelación no llega como un evento: llega
-- como la ausencia de un evento**. El VEVENT simplemente deja de estar.
--
-- `lib/canales/ical.ts` fija `operacion: 'nueva'` en todo lo que lee —no tiene con
-- qué distinguir— y nada en `lib/canales/` miraba lo que *no* vino. Resultado: por
-- el único proveedor real que tiene el sistema, las cancelaciones eran
-- estructuralmente invisibles. La unidad quedaba vendida para siempre.
--
-- ── La decisión: se detecta y se avisa, NO se cancela solo ───────────────────
--
-- Es la decisión importante de esta migración y conviene que quede escrita.
--
-- Cancelar automáticamente por ausencia es peligroso: un feed que devuelve 200 con
-- el cuerpo vacío, una URL que caducó, un parseo que falla a mitad o un cambio de
-- formato del extranet **se verían exactamente igual que 40 cancelaciones**. Con
-- auto-cancelación, una corrida mala del cron le vacía el inventario al hotel de
-- madrugada y libera habitaciones que están vendidas.
--
-- Así que se marca `ausente_desde` y la pantalla lo muestra como **presunta
-- cancelación**, para que una persona confirme. Es el mismo criterio que ya rige
-- el cron (`app/api/cron/canales/route.ts`): aterriza, no importa. Lo que se gana
-- es que la ausencia **se vea**, que hoy no se ve.
--
-- ⚠️ La ausencia solo significa algo si el lote es una **foto completa** del canal
-- para un rango. El feed iCal lo es; el informe CSV del extranet **no** —es una
-- exportación filtrada por fechas—, y por eso `guardarEntrantes` solo evalúa
-- ausencias cuando quien la llama declara el rango con `instantanea`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table canal_reservas
  -- Última vez que la fuente confirmó que esta reserva sigue existiendo. Se
  -- escribe en cada corrida que la trae, sea alta o actualización.
  add column if not exists visto_en timestamptz,
  -- Primera corrida (de una foto completa) en la que la reserva NO vino. Se
  -- limpia sola si reaparece: un feed intermitente no deja rastro permanente.
  add column if not exists ausente_desde timestamptz;

comment on column canal_reservas.visto_en is
  'Última corrida que confirmó la reserva en la fuente. Sirve para distinguir «no vino» de «nunca vino».';
comment on column canal_reservas.ausente_desde is
  'Primera foto completa del canal que NO la trajo. Presunta cancelación: la confirma una persona, el sistema NO cancela solo (ver el encabezado de la 0074).';

-- El listado de presuntas cancelaciones filtra por esta columna y ordena por
-- fecha. Parcial porque lo normal es que esté nula: el índice se mantiene chico.
create index if not exists canal_reservas_ausentes_idx
  on canal_reservas (ausente_desde desc)
  where ausente_desde is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Las dos columnas existen y arrancan nulas:
--   select count(*) filter (where visto_en is null)      as sin_ver,
--          count(*) filter (where ausente_desde is null) as presentes
--     from canal_reservas;
--
--   -- El índice parcial quedó:
--   select indexname from pg_indexes
--    where tablename = 'canal_reservas' and indexname = 'canal_reservas_ausentes_idx';
