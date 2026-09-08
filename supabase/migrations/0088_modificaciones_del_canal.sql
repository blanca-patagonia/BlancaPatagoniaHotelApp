-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0088 — Cuando el canal MODIFICA una reserva que ya se importó
--
-- ── El hueco que cierra ──────────────────────────────────────────────────────
--
-- La 0074 resolvió una mitad del problema: una reserva que **desaparece** del
-- feed queda marcada como presunta cancelación. Quedaba la otra mitad, que es
-- más frecuente y hasta ahora era completamente invisible.
--
-- El huésped entra a Booking y cambia las fechas. La reserva llega otra vez con
-- el **mismo `external_id`** y `guardarEntrantes` hace lo correcto con la fila de
-- `canal_reservas`: la actualiza. Pero si esa entrante ya se había **importado**,
-- la reserva de verdad —la de `reservas`, la que ocupa una unidad y tiene una
-- estadía con su período— **se queda con las fechas viejas**.
--
-- Y no hay ningún síntoma. La fila del canal dice una cosa, la reserva del hotel
-- dice otra, las dos parecen normales, y el sistema no las compara nunca. Se
-- descubre el día que el huésped se presenta.
--
-- ── La decisión: se detecta y se avisa, NO se reprograma solo ───────────────
--
-- Es la misma que tomó la 0074 con las cancelaciones, y por razones más fuertes
-- todavía. Reprogramar automáticamente significa mover un período contra la
-- restricción de exclusión del ADR 0002:
--
--   · si las fechas nuevas pisan otra estadía, la mudanza falla y hay que
--     resolverla igual a mano, pero ahora de madrugada y sin nadie mirando;
--   · si no pisan, se movió una reserva sin que ninguna persona lo confirmara —y
--     el precio de la estadía **no se recotiza solo**, así que quedaría cobrando
--     la tarifa de otras fechas—.
--
-- Así que se anota la divergencia y la pantalla la muestra. Lo que se gana es que
-- deje de ser invisible, que es exactamente lo que hoy no está.
-- ─────────────────────────────────────────────────────────────────────────────

alter table canal_reservas
  /*
    Cuándo se detectó que el canal dice algo distinto de lo que se importó.

    Se limpia sola si la diferencia se resuelve —el huésped vuelve a las fechas
    originales, o alguien reprograma la reserva y vuelve a sincronizar—: una
    marca que queda pegada para siempre entrena a ignorarla.
  */
  add column if not exists divergencia_desde timestamptz,

  /*
    Qué cambió, en palabras.

    No es decoración: la fila de `canal_reservas` ya quedó con los datos NUEVOS
    —es lo correcto, es lo que el canal afirma hoy— así que sin este texto no
    queda registro de qué decía antes, y quien lo mira no puede saber qué
    corregir sin abrir las dos pantallas y comparar a ojo.
  */
  add column if not exists divergencia text not null default '';

comment on column canal_reservas.divergencia_desde is
  'Cuándo se detectó que el canal cambió algo de una entrante YA IMPORTADA. Se limpia sola si la diferencia desaparece. El sistema NO reprograma solo (ver el encabezado de la 0088).';
comment on column canal_reservas.divergencia is
  'Qué cambió, en palabras, con los valores viejos. La fila ya tiene los nuevos, así que sin esto no queda rastro de qué había antes.';

/*
  El listado de divergencias.

  Parcial porque lo normal es que esté nula: el índice se mantiene chico y sirve
  exactamente para la consulta que lo usa —«qué hay para revisar»—.
*/
create index if not exists canal_reservas_divergencia_idx
  on canal_reservas (divergencia_desde desc)
  where divergencia_desde is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Las entrantes importadas que el canal cambió después:
--   select external_id, huesped_apellido, check_in, check_out, divergencia
--     from canal_reservas
--    where divergencia_desde is not null
--    order by divergencia_desde desc;
--
--   -- Tiene que dar 0 en una base recién sembrada: la divergencia sólo la
--   -- escribe una sincronización que trae datos distintos de los importados.
