-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0087 — Restricciones por FECHA en la publicación al canal
--
-- ── El hueco ─────────────────────────────────────────────────────────────────
--
-- `canal_tipos` (0081) guarda `minimo_noches` y `cerrado` **por tipo de unidad**,
-- o sea para siempre. Con eso se puede decir «la Doble Vista pide 2 noches» pero
-- no se puede decir nada de lo que el hotel de verdad necesita decir:
--
--   · «el fin de semana largo de octubre pide 3 noches»
--   · «esas dos semanas están cerradas para Booking porque las guardo para el
--     grupo que ya reservó por teléfono»
--   · «no acepto llegadas el 24 de diciembre»
--
-- Sin esto, la única forma de imponer un mínimo para un fin de semana largo es
-- ponérselo al tipo **todo el año**, y entonces el hotel deja de vender las
-- noches sueltas de temporada baja, que es de donde sale buena parte de la
-- ocupación de El Calafate fuera de temporada.
--
-- ── Por qué un rango y no una fila por día ───────────────────────────────────
--
-- Porque lo que el hotel piensa es «del 10 al 14 de octubre», no cinco cosas
-- distintas. Una fila por día obliga a cargar cinco veces lo mismo y a
-- acordarse de borrar las cinco; y si se olvida una, la restricción queda a
-- medias y el síntoma es un canal que rechaza reservas de un solo día sin motivo
-- aparente.
--
-- El rango es `[desde, hasta)` con el **fin excluido**, igual que `estadias` y
-- que las temporadas: es la convención del sistema y mezclarlas es el error de un
-- día que después nadie encuentra.
--
-- ── ⚠️ Lo que esto NO hace ───────────────────────────────────────────────────
--
-- **No evita el overbooking**, igual que todo el resto del lado saliente. Con los
-- dos caminos disponibles sin ser Connectivity Partner —el informe CSV y el feed
-- iCal— estas restricciones **se calculan y no salen**: el proveedor responde
-- `noSoportado` y queda registrado como tal (ADR 0021, ADR 0032). El día que el
-- hotel contrate un channel manager, esto ya está.
--
-- **No es un bloqueo de inventario.** Cerrar un tipo en Booking no impide que
-- recepción venda esa noche por teléfono, y es a propósito: la venta directa no
-- paga comisión y es la que el hotel quiere proteger.
-- ─────────────────────────────────────────────────────────────────────────────

create table canal_restricciones (
  id             uuid primary key default gen_random_uuid(),

  -- Mismo dominio de canal que el resto del módulo (0081).
  canal          text not null check (canal in ('booking', 'expedia')),

  /*
    `null` = **todos** los tipos.

    Es el caso más común de lejos: «del 24 al 26 no acepto llegadas» aplica al
    hotel entero, y obligar a cargar una fila por tipo garantiza que dentro de
    seis meses alguien agregue un tipo nuevo y se olvide de restringirlo.
  */
  tipo_unidad_id uuid references tipos_unidad (id) on delete cascade,

  -- `[desde, hasta)`, fin EXCLUIDO. Misma convención que estadías y temporadas.
  periodo        daterange not null,

  /*
    Estancia mínima. `null` = no impone ninguna.

    Al resolver un día, gana **la más restrictiva** entre ésta y la del tipo: dos
    reglas que se pisan tienen que resolverse hacia el lado seguro, porque
    quedarse corto vende una noche que el hotel no quería vender y quedarse largo
    sólo pierde una venta que se puede recuperar por teléfono.
  */
  minimo_noches  integer check (minimo_noches is null or minimo_noches >= 1),

  -- Cierra la venta de esos días en ese canal.
  cerrado        boolean not null default false,

  /*
    Cerrado a la llegada / a la salida (CTA y CTD en la jerga de los canales).

    Son las dos que hacen posible un fin de semana largo de verdad: «se puede
    estar el sábado, pero no se puede LLEGAR el sábado». Sin ellas, un mínimo de
    tres noches igual deja que alguien reserve sábado-domingo-lunes y parta el
    fin de semana en dos.

    Van separadas de `cerrado` porque significan cosas distintas: cerrado no
    vende nada ese día; CTA vende el día como noche intermedia.
  */
  cerrado_llegada boolean not null default false,
  cerrado_salida  boolean not null default false,

  -- Por qué. No es decoración: dentro de tres meses nadie se acuerda de qué era
  -- el bloqueo del 12 al 19, y sin el motivo no se sabe si ya se puede levantar.
  nota           text not null default '',

  creado_por     uuid references perfiles (id),
  creado_en      timestamptz not null default now(),

  /*
    Una fila sin ninguna restricción no significa nada.

    Sin este `check`, cargar el rango y olvidarse de tildar algo deja una fila que
    parece una restricción activa en la pantalla y no restringe nada. El síntoma
    sería «cargué el bloqueo y el canal siguió vendiendo».
  */
  constraint canal_restricciones_dice_algo check (
    minimo_noches is not null
    or cerrado
    or cerrado_llegada
    or cerrado_salida
  ),

  -- Un rango vacío o invertido no restringe nada y es un error de carga.
  constraint canal_restricciones_periodo_util check (not isempty(periodo))
);

comment on table canal_restricciones is
  'Restricciones de venta por FECHA para un canal (mínimo de noches, cerrado, CTA/CTD). Complementa `canal_tipos`, que las guarda por tipo y para siempre. Ver el encabezado de la 0087.';
comment on column canal_restricciones.tipo_unidad_id is
  'null = todos los tipos. Es el caso más común: un bloqueo de fechas suele ser del hotel entero.';
comment on column canal_restricciones.periodo is
  'Rango [desde, hasta) con el fin EXCLUIDO, igual que estadias.periodo y los rangos de temporada.';
comment on column canal_restricciones.cerrado_llegada is
  'CTA: se puede estar ese día, pero no se puede empezar la estadía. Es lo que hace posible un fin de semana largo sin que alguien lo parta al medio.';
comment on column canal_restricciones.cerrado_salida is
  'CTD: se puede estar ese día, pero no se puede terminar la estadía ahí.';

/*
  El índice que usa la consulta del cron: las restricciones de un canal que se
  solapan con la ventana que se está por publicar.

  GiST porque el operador es `&&` (solapamiento de rangos), que un índice B-tree
  no puede resolver.
*/
create index canal_restricciones_periodo_idx
  on canal_restricciones using gist (periodo);

create index canal_restricciones_canal_idx
  on canal_restricciones (canal, tipo_unidad_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table canal_restricciones enable row level security;

/*
  Lee el staff que trabaja con canales; escribe sólo quien decide comercialmente.

  Cerrar fechas en una OTA es una decisión de venta —cuánto inventario se le deja
  al canal y cuándo—, no una tarea de mostrador. Es el mismo criterio con el que
  `guardarMapeoCanal` (0081) restringe el mapeo a admin y gerencia, aunque el área
  `canales` sí alcance a recepción para lo operativo.
*/
create policy "restricciones: staff lee"
  on canal_restricciones for select
  using (rol_actual() is not null);

create policy "restricciones: admin/gerencia gestionan"
  on canal_restricciones for all
  using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- El portal público no tiene nada que ver acá: son decisiones comerciales
-- internas y decirle a `anon` qué fechas guarda el hotel es información de más.
revoke select, insert, update, delete on canal_restricciones from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Una fila que no restringe nada se rechaza:
--   insert into canal_restricciones (canal, periodo)
--        values ('booking', '[2027-10-10,2027-10-14)');        -- 23514
--
--   -- Un rango vacío también:
--   insert into canal_restricciones (canal, periodo, cerrado)
--        values ('booking', '[2027-10-10,2027-10-10)', true);  -- 23514
--
--   -- Un fin de semana largo del hotel entero:
--   insert into canal_restricciones (canal, periodo, minimo_noches, cerrado_llegada, nota)
--        values ('booking', '[2027-10-09,2027-10-13)', 3, false,
--                'Fin de semana largo: 3 noches mínimo.');     -- ok
--
--   -- anon no la ve:
--   select has_table_privilege('anon', 'canal_restricciones', 'select');   -- f
