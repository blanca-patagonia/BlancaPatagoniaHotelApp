-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0038 — Canales de venta externos (Modernización WinPAX, pasos 4 y 5)
--
-- ── Contexto ─────────────────────────────────────────────────────────────────
--
-- El puerto `CanalVentaProvider` (`lib/canales/index.ts`) y sus reglas puras
-- (`lib/domain/canales.ts`, 19 tests) existían desde antes y estaban **completa-
-- mente desconectados**: cero referencias fuera de sus propios tests. El diseño
-- estaba hecho y faltaba el cableado. Esta migración es la mitad de datos de ese
-- cableado.
--
-- ⚠️ NO CONFUNDIR con la tabla `canales` (migración 0019), que son los canales de
-- **chat interno del staff**. Nombre casi igual, cosa completamente distinta. Por
-- eso todo lo de acá lleva el prefijo `canal_`.
--
-- ── La decisión de diseño central: staging, no escritura directa ──────────────
--
-- Una reserva que llega de Booking **no se inserta directamente en `reservas`**.
-- Aterriza en `canal_reservas`, que es una zona de recepción, y desde ahí alguien
-- la importa. Tres razones:
--
-- 1. **El canal manda datos que pueden no calzar.** Booking informa un tipo de
--    habitación con su propio nombre, y puede no existir del lado nuestro. Si se
--    escribiera directo, la reserva se perdería o entraría con un tipo inventado.
-- 2. **La importación puede chocar con el anti-overbooking.** Si el canal vendió
--    una unidad que nosotros ya vendimos, la restricción de exclusión (ADR 0002)
--    va a rechazar la estadía — y eso es correcto. Lo que hace falta es que
--    quede **registrado y visible** para resolverlo a mano, no que desaparezca.
-- 3. **Los canales reenvían.** Guardar el evento crudo con su `external_id`
--    permite ser idempotente y, sobre todo, auditar qué mandó el canal cuando el
--    huésped diga que reservó otra cosa.
--
-- ── Lo que estas tablas NO resuelven ─────────────────────────────────────────
--
-- Los proveedores que se implementan (CSV del extranet e iCal) son de **solo
-- lectura**: nadie le empuja el cupo a Booking. Eso significa que **NO evitan el
-- overbooking**: Booking puede seguir vendiendo lo que el hotel ya vendió. La
-- pantalla lo dice explícitamente; la solución real es un channel manager, y es
-- una decisión comercial del hotel (ver `docs/modernizacion-winpax.md`).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Reservas entrantes de un canal ───────────────────────────────────────────
create table canal_reservas (
  id                 uuid primary key default gen_random_uuid(),
  canal              text not null check (canal in ('booking', 'expedia')),
  -- Identificador en el canal. Es la clave de idempotencia, igual que
  -- `pagos.external_id`.
  external_id        text not null,
  operacion          text not null default 'nueva'
                       check (operacion in ('nueva', 'modificada', 'cancelada')),
  -- Cuándo el CANAL emitió el evento. Los canales no garantizan el orden de
  -- entrega, así que esto es lo que decide si un evento que llega pisa al
  -- guardado (ver `esEventoMasReciente` en lib/domain/canales.ts).
  emitida_en         timestamptz not null,

  -- Huésped, tal como lo manda el canal. Se guarda aparte de `huespedes` porque
  -- todavía no es un huésped nuestro: es un dato sin validar de un tercero.
  huesped_apellido   text not null,
  huesped_nombre     text not null default '',
  huesped_email      text,
  huesped_telefono   text,
  huesped_pais       text,

  -- Estadía pedida. `tipo_unidad_codigo` es el código **del canal**, que puede no
  -- coincidir con ningún `tipos_unidad.codigo` nuestro: por eso es texto y no una
  -- clave foránea. Resolver la correspondencia es parte de importar.
  tipo_unidad_codigo text not null,
  check_in           date not null,
  check_out          date not null,
  huespedes          int  not null default 1 check (huespedes > 0),
  check (check_out > check_in),

  -- Datos comerciales del canal: son **referencia**, no la cuenta del hotel. El
  -- total se recalcula con nuestro dominio y tarifa neto (ADR 0004). Guardarlos
  -- permite detectar discrepancias en la conciliación.
  importe_canal      numeric(12, 2),
  moneda_canal       char(3),
  comision           numeric(12, 2),
  notas              text not null default '',

  -- Conciliación con nuestra reserva.
  reserva_id         uuid references reservas (id) on delete set null,
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente', 'importada', 'ignorada', 'error')),
  -- Por qué quedó en `error` o `ignorada`. Es lo que hace que un choque con el
  -- anti-overbooking sea visible en vez de silencioso.
  motivo             text not null default '',
  importada_en       timestamptz,
  importada_por      uuid references perfiles (id),
  creada_en          timestamptz not null default now(),

  -- Idempotencia: un reenvío del canal no duplica. Una modificación llega con el
  -- mismo `external_id` y actualiza la fila existente si es más reciente.
  constraint canal_reservas_sin_duplicados unique (canal, external_id)
);

comment on table canal_reservas is
  'Zona de recepción de reservas que llegan de un canal externo (OTA). No es `reservas`: acá el dato todavía no está validado ni ocupa inventario.';
comment on column canal_reservas.tipo_unidad_codigo is
  'Código del tipo TAL COMO LO LLAMA EL CANAL. No es FK: puede no existir del lado nuestro.';
comment on column canal_reservas.importe_canal is
  'Lo que el canal dice haber cobrado. Es referencia para conciliar; el total del hotel se recalcula con el dominio (ADR 0004).';
comment on column canal_reservas.motivo is
  'Por qué quedó en error o ignorada. Un choque con el anti-overbooking tiene que ser visible, no silencioso.';

-- La pantalla lista por estado y por fecha de llegada; el detalle busca por reserva.
create index on canal_reservas (estado, check_in);
create index on canal_reservas (canal, emitida_en desc);
create index on canal_reservas (reserva_id);

-- ── Registro de cada sincronización ──────────────────────────────────────────
-- Sin esto no hay forma de responder «¿cuándo se importó por última vez?», que es
-- la primera pregunta cuando falta una reserva que el huésped dice haber hecho.
create table canal_sincronizaciones (
  id            bigint generated always as identity primary key,
  canal         text not null check (canal in ('booking', 'expedia')),
  -- Qué proveedor la corrió: `csv`, `ical` o `simulado`.
  proveedor     text not null,
  -- Archivo o URL de origen, para poder rastrear de dónde salió cada fila.
  origen        text not null default '',
  leidas        int not null default 0,
  nuevas        int not null default 0,
  actualizadas  int not null default 0,
  -- Filas que el dominio rechazó por inválidas. Se cuentan aparte porque un
  -- número distinto de cero significa que el formato del canal cambió.
  rechazadas    int not null default 0,
  detalle       text not null default '',
  corrida_por   uuid references perfiles (id),
  corrida_en    timestamptz not null default now()
);

comment on table canal_sincronizaciones is
  'Historial de importaciones desde canales externos. Responde «cuándo se sincronizó por última vez y qué entró».';

create index on canal_sincronizaciones (canal, corrida_en desc);

-- ── Mensajes y peticiones del huésped en el canal ────────────────────────────
create table canal_mensajes (
  id               uuid primary key default gen_random_uuid(),
  canal            text not null check (canal in ('booking', 'expedia')),
  external_id      text,
  canal_reserva_id uuid references canal_reservas (id) on delete cascade,
  reserva_id       uuid references reservas (id) on delete set null,
  autor            text not null default 'huesped' check (autor in ('huesped', 'hotel')),
  cuerpo           text not null,
  recibido_en      timestamptz not null default now(),
  -- Si ya se resolvió. Un pedido de cuna sin atender es una queja en la reseña.
  atendido         boolean not null default false,
  atendido_por     uuid references perfiles (id),
  creado_en        timestamptz not null default now()
);

comment on table canal_mensajes is
  'Mensajes y peticiones del huésped llegados por el canal (cuna, llegada tardía, etc.). Hoy se cargan a mano: ni el CSV ni el iCal los traen.';

create index on canal_mensajes (atendido, recibido_en desc);
create index on canal_mensajes (canal_reserva_id);

-- ── Reseñas ──────────────────────────────────────────────────────────────────
create table canal_resenas (
  id            uuid primary key default gen_random_uuid(),
  canal         text not null check (canal in ('booking', 'expedia')),
  external_id   text,
  reserva_id    uuid references reservas (id) on delete set null,
  autor         text not null default '',
  pais          text,
  -- Booking puntúa de 1 a 10 con un decimal. Se guarda en esa escala y no
  -- normalizado a 5 o a 100: convertir perdería fidelidad con lo que el huésped
  -- ve publicado, y el número tiene que poder cotejarse con el extranet.
  puntaje       numeric(3, 1) check (puntaje >= 0 and puntaje <= 10),
  titulo        text not null default '',
  -- Booking separa lo bueno de lo malo en dos campos distintos, y conviene
  -- conservar esa separación: son dos cosas distintas de leer y de responder.
  positivo      text not null default '',
  negativo      text not null default '',
  publicada_en  date,
  respondida    boolean not null default false,
  respuesta     text not null default '',
  creada_en     timestamptz not null default now()
);

comment on table canal_resenas is
  'Reseñas publicadas en el canal. Hoy se cargan a mano; el NPS propio vive aparte en `encuestas_satisfaccion`.';

create index on canal_resenas (canal, publicada_en desc);
create index on canal_resenas (respondida);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table canal_reservas          enable row level security;
alter table canal_sincronizaciones  enable row level security;
alter table canal_mensajes          enable row level security;
alter table canal_resenas           enable row level security;

-- Lectura: todo el staff. Recepción trabaja con esto todos los días y gerencia
-- necesita ver el volumen por canal.
create policy "canal_reservas: staff lee" on canal_reservas
  for select using (rol_actual() is not null);
create policy "canal_reservas: recepcion+ gestiona" on canal_reservas
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "canal_sincro: staff lee" on canal_sincronizaciones
  for select using (rol_actual() is not null);
create policy "canal_sincro: recepcion+ registra" on canal_sincronizaciones
  for insert with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "canal_mensajes: staff lee" on canal_mensajes
  for select using (rol_actual() is not null);
create policy "canal_mensajes: recepcion+ gestiona" on canal_mensajes
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "canal_resenas: staff lee" on canal_resenas
  for select using (rol_actual() is not null);
create policy "canal_resenas: recepcion+ gestiona" on canal_resenas
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- La migración 0006 dejó `alter default privileges ... grant select ... to anon`,
-- así que toda tabla nueva nace legible por el rol anónimo. Acá sería grave:
-- `canal_reservas` tiene nombre, email, teléfono y país de huéspedes, y
-- `canal_mensajes` tiene lo que el huésped escribió. Es exactamente la clase de
-- dato que `CLAUDE.md` reserva a staff. Las políticas ya lo bloquean (para `anon`,
-- `rol_actual()` es null); se revoca igual, para no depender de que nadie escriba
-- mal una política nueva más adelante.
revoke select on canal_reservas         from anon;
revoke select on canal_sincronizaciones from anon;
revoke select on canal_mensajes         from anon;
revoke select on canal_resenas          from anon;
