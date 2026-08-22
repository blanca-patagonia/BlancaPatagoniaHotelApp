-- Migracion 0052 -- Detectar el choque de cupo al aterrizar, no al importar
--
-- 🔴 TOCA UN MODELO EXISTENTE (canal_reservas). Aditiva, con default.
--
-- El problema: hoy el choque con el anti-overbooking se descubre en
-- importarEntrante, o sea cuando alguien aprieta «Importar». Eso pueden ser dias
-- despues de que la reserva entro, y en el peor caso se descubre en el check-in con
-- el huesped en la puerta.
--
-- La correccion NO es evitar el overbooking: no se puede sin publicar
-- disponibilidad, y eso exige un channel manager (ADR 0021). Lo que si se puede es
-- verlo el mismo dia en que el informe entra, que es la diferencia entre reacomodar
-- con tiempo y no tener nada que ofrecer.
--
-- ⚠️ NO se cambia `estado` a 'error'. La entrante sigue siendo importable: el
-- conflicto puede resolverse moviendo otra reserva o habilitando una unidad, y
-- pisar el estado romperia el flujo de la pantalla y la accion «Importar».
-- El conflicto es una ADVERTENCIA, no un rechazo.

alter table canal_reservas
  add column conflicto boolean not null default false,
  add column conflicto_detectado_en timestamptz;

comment on column canal_reservas.conflicto is
  'El canal vendio mas unidades de ese tipo que las libres. NO impide importar: se resuelve moviendo otra reserva o habilitando una unidad. Es una advertencia temprana, no un rechazo (ADR 0021: la sincronizacion de solo lectura no evita el overbooking).';

-- Indice parcial: solo interesan las que tienen conflicto, y son pocas. Un indice
-- completo sobre un booleano casi siempre falso no lo usaria el planificador.
create index canal_reservas_conflicto_idx on canal_reservas (conflicto) where conflicto;
