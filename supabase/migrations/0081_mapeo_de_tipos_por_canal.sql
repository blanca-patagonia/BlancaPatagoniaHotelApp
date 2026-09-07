-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0081 — Mapeo de tipos de unidad por canal, y sus restricciones
-- (Bloque E de la auditoría 2026-09, hallazgo P1-1)
--
-- ── El defecto ───────────────────────────────────────────────────────────────
--
-- `importarEntrante` (lib/canales/servicio.ts) resuelve el tipo de unidad así:
--
--     .from('tipos_unidad').eq('codigo', e.tipo_unidad_codigo)
--
-- con un comentario que dice, textual, «el código del canal puede no ser el
-- nuestro». **Pero el código asume que sí lo es.** Si Booking llama «DBL-LAGO» a
-- lo que el sistema llama «DOBLE_VISTA», la importación falla con «ese tipo no
-- existe» y hay que renombrar el tipo del hotel para que coincida con el nombre
-- que eligió una OTA. Es la cola moviendo al perro.
--
-- ── Y el lado que directamente no existía ────────────────────────────────────
--
-- El puerto `CanalVentaProvider` declara `publicarDisponibilidad` desde la
-- modernización WinPAX y **no tiene un solo llamador**. El ADR 0021 promete que
-- enchufar un channel manager es configuración; sin esta tabla no lo era, porque
-- no había dónde decir con qué código publicar cada tipo ni con qué reglas.
--
-- ── Qué agrega ───────────────────────────────────────────────────────────────
--
-- Una fila por (canal, tipo de unidad) con:
--   · el código del canal —los dos sentidos: importar y publicar—;
--   · `tope_cupo`, para reservarse inventario para la venta directa;
--   · `minimo_noches` y `cerrado`, las restricciones que se publican.
--
-- ⚠️ **Esto NO evita el overbooking por sí solo.** Con los dos caminos
-- disponibles hoy (informe CSV y feed iCal, ambos de solo lectura) las filas se
-- calculan y el proveedor responde `noSoportado`. Eso no es una falla: es la
-- verdad, y se registra como tal. **No convertir esta tabla en una promesa de
-- sincronización bidireccional en la pantalla.**
-- ─────────────────────────────────────────────────────────────────────────────

create table canal_tipos (
  id             uuid primary key default gen_random_uuid(),

  -- Se usa el mismo dominio de canal que el resto del módulo.
  canal          text not null check (canal in ('booking', 'expedia')),
  tipo_unidad_id uuid not null references tipos_unidad(id) on delete cascade,

  /*
    El código con el que ESE canal conoce a este tipo.

    Es el dato que hoy falta. Puede coincidir con `tipos_unidad.codigo` —y en ese
    caso la fila igual sirve, porque además lleva las restricciones— o ser
    completamente distinto.
  */
  codigo_canal   text not null check (length(btrim(codigo_canal)) > 0),

  /*
    Tope de unidades a publicar. Nulo = todas las activas.

    Un hotel que publica todo su inventario en una OTA se queda sin nada que
    vender por teléfono en temporada alta, y encima paga comisión por el 100 % de
    lo que vende. Reservarse dos unidades es una decisión comercial corriente y
    hasta ahora no había dónde expresarla.
  */
  tope_cupo      integer check (tope_cupo is null or tope_cupo >= 0),

  -- Estancia mínima que el hotel impone en ese tipo, para publicarla al canal.
  minimo_noches  integer check (minimo_noches is null or minimo_noches >= 1),

  -- Cierra la venta de ese tipo en ese canal sin dar de baja el mapeo.
  cerrado        boolean not null default false,

  activo         boolean not null default true,
  actualizado_por uuid references perfiles(id) on delete set null,
  creado_en      timestamptz not null default now(),

  -- Un tipo se publica una sola vez por canal, y un código del canal apunta a un
  -- solo tipo: las dos direcciones tienen que ser unívocas o la importación no
  -- sabría a cuál resolver.
  constraint canal_tipos_unico_por_tipo   unique (canal, tipo_unidad_id),
  constraint canal_tipos_unico_por_codigo unique (canal, codigo_canal)
);

comment on table canal_tipos is
  'Cómo se llama cada tipo de unidad en cada canal, y con qué restricciones se publica. Sirve para los DOS sentidos: resolver una reserva entrante y armar el ARI de salida. Ver el encabezado de la 0081.';
comment on column canal_tipos.codigo_canal is
  'El código del canal, que puede no ser el nuestro. Antes se asumía que coincidía con tipos_unidad.codigo y había que renombrar el tipo del hotel para que la importación funcionara.';
comment on column canal_tipos.tope_cupo is
  'Cuántas unidades como máximo publicar. Nulo = todas. Es lo que permite reservarse inventario para la venta directa.';
comment on column canal_tipos.cerrado is
  'Cierra la venta de ese tipo en ese canal. Se publica como cupo 0 + cerrado; NO se omite la fila, porque omitirla deja al canal con el valor anterior.';

create index canal_tipos_canal_idx on canal_tipos (canal) where activo;
create index canal_tipos_tipo_idx on canal_tipos (tipo_unidad_id);
create index canal_tipos_actualizado_por_idx on canal_tipos (actualizado_por);

/* ─────────────────────────── el rastro de la corrida saliente ──────────── */

/*
  `canal_sincronizaciones` ya registra las corridas de ENTRADA (0038). Se le suma
  el sentido, para que una corrida de salida no se confunda con una importación
  al mirar la pantalla.

  Nace en 'entrada' para todo lo que ya está: era lo único que existía.
*/
alter table canal_sincronizaciones
  add column sentido text not null default 'entrada'
  check (sentido in ('entrada', 'salida'));

comment on column canal_sincronizaciones.sentido is
  'entrada = se trajeron reservas del canal. salida = se le publicó disponibilidad (ARI). Nace en «entrada» porque era lo único que había.';

/*
  Qué significa cada contador cuando `sentido = 'salida'`.

  Se reusan las columnas que ya existen en vez de agregar cuatro nuevas que
  quedarían nulas en la mitad de las filas. La equivalencia, escrita acá para que
  nadie tenga que deducirla:

    leidas       → filas de ARI calculadas
    actualizadas → filas que el canal aceptó
    rechazadas   → días sin tarifa cargada, que NO se publican (publicar 0 sería
                   publicar una noche gratis: es el bug «USD 0» de la Fase 18)
    nuevas       → sin uso en salida; queda en 0
*/
create index canal_sincronizaciones_sentido_idx
  on canal_sincronizaciones (sentido, corrida_en desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table canal_tipos enable row level security;

/*
  Quién la ve: admin y gerencia, igual que `canal_config`.

  Lleva el porcentaje de inventario que el hotel se reserva y qué tipos tiene
  cerrados en cada OTA: es estrategia comercial, no operación de mostrador.
  Recepción importa reservas y atiende mensajes, y para eso no necesita esto.
*/
create policy "canal_tipos: admin y gerencia leen" on canal_tipos
  for select using (rol_actual() in ('admin', 'gerencia'));

create policy "canal_tipos: admin y gerencia gestionan" on canal_tipos
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

revoke select, insert, update, delete on canal_tipos from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Un tipo no se puede mapear dos veces al mismo canal:
--   insert into canal_tipos (canal, tipo_unidad_id, codigo_canal)
--   select 'booking', id, 'X1' from tipos_unidad limit 1;
--   insert into canal_tipos (canal, tipo_unidad_id, codigo_canal)
--   select 'booking', id, 'X2' from tipos_unidad limit 1;   -- 23505
--
--   -- Ni dos tipos al mismo código:
--   ... codigo_canal = 'X1' para otro tipo                  -- 23505
--
--   select has_table_privilege('anon','canal_tipos','select');  -- f
