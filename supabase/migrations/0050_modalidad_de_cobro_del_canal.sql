-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0050 — Quién cobra la reserva del canal
--
-- 🔴 TOCA UN MODELO EXISTENTE (`canal_reservas`). Es aditiva y con defaults, así que
-- ninguna lectura existente cambia de resultado, pero es el modelo del que cuelga
-- toda la operación de canales.
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- Booking cobra de dos formas y en este hotel **conviven las dos según la reserva**:
-- a veces el huésped paga en el mostrador y Booking sólo cobra su comisión mensual;
-- a veces Booking le cobra al huésped y después le transfiere al hotel.
--
-- El sistema no tenía dónde guardar cuál era cuál. Confundirlas cuesta plata en las
-- dos direcciones: se le cobra dos veces a un huésped que ya pagó, o se lo deja irse
-- sin cobrarle porque alguien supuso que Booking se encargaba. Lo segundo es lo que
-- no se detectaba nunca.
--
-- ── Por qué NO se agrega a `reservas` ───────────────────────────────────────
--
-- La modalidad es un dato **del canal**, no de la reserva: una reserva del mostrador
-- no tiene modalidad de cobro, la cobra el mostrador. Ponerla en `reservas` obligaría
-- a un valor sin sentido en la mayoría de las filas, y `reservas` es la tabla más
-- leída del sistema. El mostrador la ve por join desde `canal_reservas`, que ya tiene
-- índice en `reserva_id` (0038).
--
-- ── Por qué `'desconocida'` y no `null` ─────────────────────────────────────
--
-- Va a ser el valor más frecuente al principio, porque el informe del extranet no
-- siempre trae la columna y el feed iCal nunca la trae.
--
-- Un `null` se lee como «todavía no lo miramos» y **desaparece de las cuentas**: no
-- entra en un `where modalidad_cobro = 'hotel'` ni en uno con `<> 'hotel'`. Un valor
-- explícito se cuenta, se filtra y se reclama, así que la pantalla puede decir «hay
-- 14 reservas de las que no sabemos quién cobra» — que es plata en riesgo, no un dato
-- faltante.
-- ─────────────────────────────────────────────────────────────────────────────

alter table canal_reservas
  add column modalidad_cobro text not null default 'desconocida'
    check (modalidad_cobro in ('hotel', 'canal', 'desconocida')),

  -- Cuándo el canal dice que le cobró al huésped. Del informe, si lo trae.
  add column cobrado_por_canal_en date,

  -- Cuándo transfirió al hotel. Sale de la liquidación, no del informe de reservas.
  add column liquidado_en date;

comment on column canal_reservas.modalidad_cobro is
  'Quién cobra: hotel (mostrador) o canal (y después transfiere). `desconocida` es un estado REAL y frecuente —el iCal nunca lo informa— y por eso no es null: un null desaparece de las cuentas, un valor explícito se puede contar y reclamar.';
comment on column canal_reservas.cobrado_por_canal_en is
  'Fecha en que el canal dice haber cobrado al huésped. No implica que la plata haya llegado al hotel: eso es `liquidado_en`.';
comment on column canal_reservas.liquidado_en is
  'Fecha en que el canal transfirió al hotel. Sale de la liquidación del extranet, no del informe de reservas.';

-- El índice que sostiene la lista más importante de la pantalla de cobros: «cobra el
-- hotel, ya se fue, y quedó saldo». Sin él, esa consulta recorre la tabla entera cada
-- vez que alguien abre la vista.
create index canal_reservas_cobro_idx on canal_reservas (modalidad_cobro, check_out);

-- ── Backfill: nada ───────────────────────────────────────────────────────────
--
-- Deliberadamente **no** se infiere la modalidad de lo ya importado. No hay dato de
-- donde deducirla, y ponerle `'hotel'` a todo lo viejo —que es lo que uno haría por
-- comodidad— llenaría la lista de «salió sin cobrar» con reservas antiguas ya
-- cobradas en efectivo, y nadie volvería a mirar esa lista. Quedan en
-- `'desconocida'`, que es la verdad.
