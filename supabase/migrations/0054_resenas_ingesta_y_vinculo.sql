-- Migracion 0054 -- Reseñas: sin duplicados y ligadas a su reserva
--
-- 🔴 TOCA UN MODELO EXISTENTE (`canal_resenas`). Aditiva salvo el unique parcial, que
-- puede fallar si ya hay duplicados: se limpian antes.
--
-- ── Que estaba mal ──────────────────────────────────────────────────────────
--
-- `canal_resenas` existia con las columnas correctas, pero sin ningun camino de
-- ingesta: solo un formulario manual que escribia cinco campos. `external_id`,
-- `reserva_id`, `pais` y `titulo` **nunca se escribian**, asi que una reseña cargada
-- a mano no quedaba ligada a ninguna reserva. Servia para leerla y nada mas.
--
-- ── Por que el unique tiene que ser PARCIAL ─────────────────────────────────
--
-- `external_id` es nullable porque el export del extranet no siempre trae un
-- identificador. Un `unique (canal, external_id)` a secas **no impide duplicados**: en
-- Postgres cada `null` es distinto de todos los demas, asi que diez reseñas sin id
-- entran diez veces sin que la restriccion diga nada.
--
-- De ahi las dos piezas: el unique parcial para las que traen id, y `huella` para las
-- que no. La huella se construye con autor + fecha + texto: si esos coinciden es la
-- misma reseña, no dos huespedes que escribieron lo mismo el mismo dia.

-- ── Limpieza previa ──────────────────────────────────────────────────────────
--
-- El unique parcial falla si ya hay dos filas con el mismo `external_id`. Puede pasar
-- si alguien cargo la misma reseña dos veces a mano. Se conserva la mas antigua -que
-- es la que probablemente tenga la respuesta escrita- y se borran las demas.
delete from canal_resenas r
 where r.external_id is not null
   and exists (
     select 1 from canal_resenas otra
      where otra.canal = r.canal
        and otra.external_id = r.external_id
        and otra.creada_en < r.creada_en
   );

alter table canal_resenas
  -- Identifica una reseña sin `external_id`. Se llena desde la app con `huellaResena`.
  add column huella text,

  add column vinculo text not null default 'sin_vincular'
    check (vinculo in ('automatico', 'manual', 'sin_vincular')),

  -- Por que no se pudo ligar, para mostrarlo en pantalla en vez de dejar el hueco sin
  -- explicacion.
  add column motivo_sin_vinculo text not null default '',

  add column respondida_en timestamptz;

comment on column canal_resenas.huella is
  'autor|fecha|positivo|negativo normalizado. Evita duplicados de las reseñas SIN external_id, que el unique parcial no puede cubrir porque en Postgres cada null es distinto.';
comment on column canal_resenas.vinculo is
  'Como se ligo a su reserva. `automatico` solo cuando no habia ambiguedad: una reseña mal ligada ensucia el historial de un huesped que no dijo eso, y eso es peor que una sin ligar.';
comment on column canal_resenas.motivo_sin_vinculo is
  'Por que quedo sin ligar. Se muestra en pantalla: un hueco sin explicacion no se resuelve.';

-- Las que traen identificador del canal.
create unique index canal_resenas_external_unico
  on canal_resenas (canal, external_id)
  where external_id is not null;

-- Las que no. Tambien parcial: las que tienen `external_id` ya estan cubiertas arriba.
create unique index canal_resenas_huella_unica
  on canal_resenas (canal, huella)
  where huella is not null and external_id is null;

-- Para la pantalla: las que hay que ligar a mano y las que esperan respuesta.
create index canal_resenas_sin_vincular_idx on canal_resenas (vinculo) where vinculo = 'sin_vincular';
create index canal_resenas_reserva_idx on canal_resenas (reserva_id);
