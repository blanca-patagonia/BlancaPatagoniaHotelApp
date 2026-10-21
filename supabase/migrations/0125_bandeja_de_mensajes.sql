-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0125 — Bandeja de mensajes con huéspedes (CRM estilo Chatwoot)
--
-- Objetivo: que los mensajes que los huéspedes mandan por WhatsApp, Instagram,
-- Messenger, correo, Telegram y el chat de la web entren a UNA sola bandeja del
-- panel, se asignen, se respondan desde ahí y queden vinculados a la ficha del
-- huésped. Hasta acá no entraba ningún mensaje: WhatsApp sólo salía por
-- plantilla, y los mensajes de Booking se cargaban a mano (ADR 0043).
--
-- ── De dónde sale el modelo ──────────────────────────────────────────────────
--
-- Del núcleo de Chatwoot (licencia MIT; NO de `enterprise/`, que tiene otra
-- licencia). Equivalencias:
--
--   inboxes + channel_*   →  crm_bandejas         (una por canal)
--   contacts              →  crm_contactos        (+ vínculo a `huespedes`)
--   contact_inboxes       →  crm_identidades      (el id del contacto EN el canal)
--   conversations         →  crm_conversaciones   (estado, prioridad, asignación)
--   messages              →  crm_mensajes         (entrante/saliente/nota/actividad)
--   labels + taggings     →  crm_etiquetas + crm_conversacion_etiquetas
--   canned_responses      →  crm_respuestas
--
-- Lo que se deja afuera a propósito: cuentas (`account_id`: es UN hotel, mismo
-- criterio que la 0096), equipos, SLA, campañas y bots. Y las credenciales de
-- cada canal NO se guardan acá —Chatwoot las guarda en `channel_*`—: van en
-- variables de entorno, igual que el resto de las integraciones del sistema.
--
-- ── Por qué `text` + `check` y no enums ──────────────────────────────────────
--
-- Un canal nuevo (Chatwoot ya tiene LINE y TikTok) con un enum obliga a
-- `alter type ... add value`, que no puede convivir con su primer uso en la
-- misma migración (SQLSTATE 55P04, ver 0032/0035). Con un `check` se cambia la
-- lista en un solo archivo.
--
-- ── Por qué las tablas llevan el prefijo `crm_` ──────────────────────────────
--
-- `canales` y `mensajes` YA existen: son el chat interno del staff (0019, ADR
-- 0011). Y `canal_*` es de los canales de VENTA (Booking, Expedia). Sin prefijo,
-- «mensajes» significaría dos cosas distintas según la pantalla.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Bandejas: una por canal ──────────────────────────────────────────────────

create table crm_bandejas (
  id          uuid primary key default gen_random_uuid(),
  canal       text not null unique
              check (canal in ('whatsapp', 'instagram', 'messenger', 'email', 'telegram', 'web')),
  nombre      text not null,
  -- Apagar una bandeja deja de mostrarla y de aceptar entradas, sin borrar el
  -- historial. Que el canal esté CONFIGURADO (tiene sus claves) lo decide la app
  -- mirando el entorno: una bandeja activa sin claves recibe pero no responde.
  activa      boolean not null default true,
  creado_en   timestamptz not null default now()
);

comment on table crm_bandejas is
  'Una bandeja por canal de mensajería (Chatwoot: inboxes). Las credenciales NO viven acá: van en variables de entorno.';

insert into crm_bandejas (canal, nombre) values
  ('whatsapp', 'WhatsApp'),
  ('instagram', 'Instagram'),
  ('messenger', 'Facebook Messenger'),
  ('email', 'Correo'),
  ('telegram', 'Telegram'),
  ('web', 'Chat de la web');

-- ── Contactos ────────────────────────────────────────────────────────────────

create table crm_contactos (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null default '',
  email                text,
  telefono             text,
  -- Un contacto no es un huésped: la mayoría escribe ANTES de reservar (es un
  -- interesado) y muchos nunca reservan. Cuando se puede saber quién es, se
  -- vincula; si se borra el huésped, el contacto queda sin vínculo.
  huesped_id           uuid references huespedes(id) on delete set null,
  notas                text,
  bloqueado            boolean not null default false,
  ultima_actividad_en  timestamptz,
  creado_en            timestamptz not null default now()
);

create index crm_contactos_huesped_idx on crm_contactos (huesped_id);
create index crm_contactos_email_idx on crm_contactos (lower(email));

comment on column crm_contactos.huesped_id is
  'Vínculo con la ficha del huésped. Se resuelve solo por email o teléfono únicos, o a mano desde la bandeja.';

-- ── Identidades: el id del contacto dentro de cada canal ─────────────────────
--
-- El mismo huésped puede escribir por WhatsApp y por Instagram: es UN contacto
-- con DOS identidades. Lo que identifica a quien escribe es este `externo_id`
-- (wa_id, IGSID, PSID, chat_id de Telegram, dirección de correo, token del chat
-- web), nunca el nombre, que cada uno pone como quiere.

create table crm_identidades (
  id           uuid primary key default gen_random_uuid(),
  contacto_id  uuid not null references crm_contactos(id) on delete cascade,
  bandeja_id   uuid not null references crm_bandejas(id),
  externo_id   text not null,
  creado_en    timestamptz not null default now(),
  unique (bandeja_id, externo_id)
);

create index crm_identidades_contacto_idx on crm_identidades (contacto_id);

-- ── Conversaciones ───────────────────────────────────────────────────────────

create table crm_conversaciones (
  id                     uuid primary key default gen_random_uuid(),
  -- El número corto que se lee en voz alta («la 152»), como el display_id de
  -- Chatwoot. Admite huecos: no es fiscal.
  numero                 bigint generated always as identity unique,
  bandeja_id             uuid not null references crm_bandejas(id),
  contacto_id            uuid not null references crm_contactos(id) on delete cascade,
  identidad_id           uuid not null references crm_identidades(id) on delete cascade,
  estado                 text not null default 'abierta'
                         check (estado in ('abierta', 'pendiente', 'resuelta', 'pospuesta')),
  prioridad              text check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  asignada_a             uuid references perfiles(id) on delete set null,
  pospuesta_hasta        timestamptz,
  -- Sólo correo: el asunto del hilo, para responder con «Re:».
  asunto                 text,
  -- La reserva de la que se está hablando, si la hay.
  reserva_id             uuid references reservas(id) on delete set null,
  -- Lo mantiene el trigger de `crm_mensajes`; nadie lo escribe a mano.
  ultima_actividad_en    timestamptz not null default now(),
  -- La ventana de 24 h de Meta se cuenta desde el último mensaje DEL HUÉSPED.
  ultimo_entrante_en     timestamptz,
  -- Desde cuándo espera respuesta (Chatwoot: waiting_since). Null = no espera.
  esperando_desde        timestamptz,
  primera_respuesta_en   timestamptz,
  no_leidos              integer not null default 0 check (no_leidos >= 0),
  creado_en              timestamptz not null default now(),
  -- Una pospuesta sin fecha no se reabre nunca: es una resuelta con otro nombre.
  constraint crm_conversaciones_pospuesta_con_fecha
    check (estado <> 'pospuesta' or pospuesta_hasta is not null)
);

create index crm_conversaciones_estado_idx on crm_conversaciones (estado, ultima_actividad_en desc);
create index crm_conversaciones_bandeja_idx on crm_conversaciones (bandeja_id);
create index crm_conversaciones_contacto_idx on crm_conversaciones (contacto_id);
create index crm_conversaciones_identidad_idx on crm_conversaciones (identidad_id);
create index crm_conversaciones_asignada_idx on crm_conversaciones (asignada_a);
create index crm_conversaciones_reserva_idx on crm_conversaciones (reserva_id);

-- ── Mensajes ─────────────────────────────────────────────────────────────────

create table crm_mensajes (
  id                uuid primary key default gen_random_uuid(),
  conversacion_id   uuid not null references crm_conversaciones(id) on delete cascade,
  -- `nota` es la nota privada de Chatwoot: la ve el staff, nunca sale al huésped.
  -- `actividad` es el renglón del sistema («Laura asignó la conversación a…»).
  tipo              text not null check (tipo in ('entrante', 'saliente', 'nota', 'actividad')),
  contenido         text not null default '',
  -- [{ tipo, url?, nombre?, mime? }]. Sólo referencias: los archivos no se bajan
  -- (ver ADR 0043, «adjuntos»).
  adjuntos          jsonb not null default '[]'::jsonb,
  autor_id          uuid references perfiles(id) on delete set null,
  estado            text not null default 'enviado'
                    check (estado in ('pendiente', 'enviado', 'entregado', 'leido', 'fallido')),
  -- El id del mensaje en el canal (wamid, mid, Message-ID…). Es la clave de
  -- idempotencia: Meta reintenta el webhook y el mismo mensaje llega dos veces.
  externo_id        text,
  error             text,
  creado_en         timestamptz not null default now()
);

create unique index crm_mensajes_externo_idx on crm_mensajes (externo_id) where externo_id is not null;
create index crm_mensajes_conversacion_idx on crm_mensajes (conversacion_id, creado_en);
create index crm_mensajes_autor_idx on crm_mensajes (autor_id);

comment on column crm_mensajes.externo_id is
  'Id del mensaje en el canal. Único: un webhook reintentado no duplica el mensaje.';

-- ── Etiquetas y respuestas guardadas ─────────────────────────────────────────

create table crm_etiquetas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique check (length(trim(nombre)) > 0),
  -- Uno de los tonos del panel, no un hexadecimal libre: la paleta es la de
  -- marca (ADR 0026) y un color arbitrario puede quedar ilegible.
  color      text not null default 'lago'
             check (color in ('lago', 'calafate', 'lenga', 'exito', 'alerta', 'peligro', 'neutro')),
  creado_en  timestamptz not null default now()
);

create table crm_conversacion_etiquetas (
  conversacion_id  uuid not null references crm_conversaciones(id) on delete cascade,
  etiqueta_id      uuid not null references crm_etiquetas(id) on delete cascade,
  primary key (conversacion_id, etiqueta_id)
);

create index crm_conversacion_etiquetas_etiqueta_idx on crm_conversacion_etiquetas (etiqueta_id);

create table crm_respuestas (
  id         uuid primary key default gen_random_uuid(),
  -- Se invoca escribiendo «/atajo» en la caja de respuesta, como en Chatwoot.
  atajo      text not null unique check (atajo ~ '^[a-z0-9_-]{2,30}$'),
  contenido  text not null check (length(trim(contenido)) > 0),
  creado_en  timestamptz not null default now()
);

insert into crm_etiquetas (nombre, color) values
  ('Consulta de disponibilidad', 'lago'),
  ('Reserva confirmada', 'exito'),
  ('Reclamo', 'peligro'),
  ('Agencia', 'lenga');

insert into crm_respuestas (atajo, contenido) values
  ('saludo', '¡Hola! Gracias por escribir a Blanca Patagonia. ¿En qué te podemos ayudar?'),
  ('checkin', 'El check-in es a partir de las 15:00 y el check-out hasta las 10:00.'),
  ('ubicacion', 'Estamos en El Calafate, Santa Cruz. Te pasamos la ubicación exacta cuando confirmes la reserva.');

-- ── Trigger: la conversación se actualiza sola con cada mensaje ──────────────
--
-- Lo hace la base y no la app por lo mismo que `crear_reserva` deriva las
-- plazas: hay tres caminos que insertan mensajes (los webhooks, la respuesta del
-- staff y el chat de la web), y repetir la regla en cada uno es la forma segura
-- de que un día uno se olvide de reabrir una conversación resuelta.
--
-- Reglas (las de Chatwoot):
--  · Un ENTRANTE reabre una resuelta o pospuesta, suma un no leído y marca desde
--    cuándo espera respuesta (si no esperaba ya).
--  · Un SALIENTE deja de esperar y registra la primera respuesta.
--  · Una NOTA o una ACTIVIDAD no cambian el estado ni la espera.

create or replace function crm_al_insertar_mensaje()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo = 'entrante' then
    update crm_conversaciones
       set ultima_actividad_en = new.creado_en,
           ultimo_entrante_en  = greatest(coalesce(ultimo_entrante_en, new.creado_en), new.creado_en),
           esperando_desde     = coalesce(esperando_desde, new.creado_en),
           no_leidos           = no_leidos + 1,
           estado              = case when estado in ('resuelta', 'pospuesta') then 'abierta' else estado end,
           pospuesta_hasta     = case when estado in ('resuelta', 'pospuesta') then null else pospuesta_hasta end
     where id = new.conversacion_id;

    update crm_contactos c
       set ultima_actividad_en = new.creado_en
      from crm_conversaciones cv
     where cv.id = new.conversacion_id and c.id = cv.contacto_id;
  elsif new.tipo = 'saliente' then
    update crm_conversaciones
       set ultima_actividad_en  = greatest(ultima_actividad_en, new.creado_en),
           esperando_desde      = null,
           primera_respuesta_en = coalesce(primera_respuesta_en, new.creado_en)
     where id = new.conversacion_id;
  end if;
  return new;
end;
$$;

create trigger crm_mensajes_actualizan_conversacion
  after insert on crm_mensajes
  for each row execute function crm_al_insertar_mensaje();

revoke execute on function crm_al_insertar_mensaje() from public, anon;

-- ── Función atómica de entrada ───────────────────────────────────────────────
--
-- Encontrar-o-crear la identidad, el contacto y la conversación, y guardar el
-- mensaje, en UNA transacción. Hecho desde la app en cuatro pasos tenía dos
-- carreras reales:
--
--  · Meta manda dos mensajes seguidos («hola» y «quería consultar») en dos
--    webhooks casi simultáneos: los dos ven «no hay conversación abierta» y
--    crean una cada uno. El huésped queda partido en dos hilos.
--  · El mismo mensaje llega dos veces (Meta reintenta si tardamos en responder):
--    la segunda copia tiene que ser un no-op, no un mensaje repetido.
--
-- El candado de asesoría serializa por (bandeja, contacto externo): dos
-- webhooks del MISMO huésped se ordenan; de huéspedes distintos no se esperan.
--
-- Vinculación al huésped: sólo si hay UNO que coincide por email o por los
-- últimos 10 dígitos del teléfono (así «+54 9 2902 12-3456» de WhatsApp casa con
-- «2902 123456» de la ficha). Con dos candidatos no se elige: vincular mal es
-- mostrarle a recepción las reservas y el saldo de otra persona.
--
-- `security definer` + sólo `service_role`: la llaman los webhooks, que no
-- tienen sesión. El staff no la necesita (escribe salientes con su propio RLS).

create or replace function crm_registrar_entrante(
  p_canal                text,
  p_externo_contacto     text,
  p_nombre               text,
  p_email                text,
  p_telefono             text,
  p_externo_mensaje      text,
  p_contenido            text,
  p_adjuntos             jsonb default '[]'::jsonb,
  p_creado_en            timestamptz default now(),
  p_tipo                 text default 'entrante',
  p_asunto               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bandeja       crm_bandejas%rowtype;
  v_identidad     uuid;
  v_contacto      uuid;
  v_conversacion  uuid;
  v_mensaje       uuid;
  v_huesped       uuid;
  v_nueva         boolean := false;
  v_digitos       text;
begin
  if p_tipo not in ('entrante', 'saliente') then
    raise exception 'tipo de mensaje externo inválido: %', p_tipo;
  end if;
  if coalesce(trim(p_externo_contacto), '') = '' then
    raise exception 'falta el id del contacto en el canal';
  end if;

  select * into v_bandeja from crm_bandejas where canal = p_canal;
  if not found then
    raise exception 'no existe la bandeja del canal %', p_canal;
  end if;
  if not v_bandeja.activa then
    return jsonb_build_object('ignorado', 'bandeja_inactiva');
  end if;

  -- Duplicado: el mismo mensaje ya entró. No-op, y se informa cuál era.
  if p_externo_mensaje is not null then
    select id, conversacion_id into v_mensaje, v_conversacion
      from crm_mensajes where externo_id = p_externo_mensaje;
    if found then
      return jsonb_build_object('duplicado', true, 'mensaje_id', v_mensaje,
                                'conversacion_id', v_conversacion);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_bandeja.id::text || ':' || p_externo_contacto));

  select id, contacto_id into v_identidad, v_contacto
    from crm_identidades
   where bandeja_id = v_bandeja.id and externo_id = p_externo_contacto;

  if not found then
    -- Contacto nuevo. Antes de crearlo se busca a qué huésped corresponde.
    if p_email is not null and position('@' in p_email) > 1 then
      select case when count(*) = 1 then min(id::text)::uuid end into v_huesped
        from huespedes
       where lower(email) = lower(trim(p_email)) and not coalesce(anonimizado, false);
    end if;

    v_digitos := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10);
    if v_huesped is null and length(v_digitos) = 10 then
      select case when count(*) = 1 then min(id::text)::uuid end into v_huesped
        from huespedes
       where right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_digitos
         and not coalesce(anonimizado, false);
    end if;

    insert into crm_contactos (nombre, email, telefono, huesped_id)
    values (coalesce(nullif(trim(p_nombre), ''), ''), nullif(trim(p_email), ''),
            nullif(trim(p_telefono), ''), v_huesped)
    returning id into v_contacto;

    insert into crm_identidades (contacto_id, bandeja_id, externo_id)
    values (v_contacto, v_bandeja.id, p_externo_contacto)
    returning id into v_identidad;
  elsif coalesce(trim(p_nombre), '') <> '' then
    -- Completa el nombre si estaba vacío; nunca pisa uno que el staff corrigió.
    update crm_contactos set nombre = trim(p_nombre)
     where id = v_contacto and nombre = '';
  end if;

  -- Si el contacto está bloqueado, el mensaje no se guarda.
  if exists (select 1 from crm_contactos where id = v_contacto and bloqueado) then
    return jsonb_build_object('ignorado', 'contacto_bloqueado');
  end if;

  -- La conversación vigente de esa identidad: la más reciente que no esté
  -- resuelta. Como en Chatwoot con «lock to single conversation» apagado, una
  -- resuelta NO se reabre si ya pasaron 7 días: se abre una nueva, porque el
  -- huésped que escribe un mes después está hablando de otra cosa.
  select id into v_conversacion
    from crm_conversaciones
   where identidad_id = v_identidad
     and (estado <> 'resuelta' or ultima_actividad_en > now() - interval '7 days')
   order by ultima_actividad_en desc
   limit 1;

  if not found then
    insert into crm_conversaciones (bandeja_id, contacto_id, identidad_id, asunto)
    values (v_bandeja.id, v_contacto, v_identidad, p_asunto)
    returning id into v_conversacion;
    v_nueva := true;
  end if;

  insert into crm_mensajes (conversacion_id, tipo, contenido, adjuntos, estado, externo_id, creado_en)
  values (v_conversacion, p_tipo, coalesce(p_contenido, ''), coalesce(p_adjuntos, '[]'::jsonb),
          case when p_tipo = 'entrante' then 'entregado' else 'enviado' end,
          p_externo_mensaje, coalesce(p_creado_en, now()))
  on conflict (externo_id) where externo_id is not null do nothing
  returning id into v_mensaje;

  return jsonb_build_object(
    'conversacion_id', v_conversacion,
    'mensaje_id', v_mensaje,
    'contacto_id', v_contacto,
    'nueva', v_nueva,
    'duplicado', v_mensaje is null
  );
end;
$$;

comment on function crm_registrar_entrante is
  'Entrada atómica de un mensaje externo (webhooks y chat web): identidad, contacto, conversación y mensaje en una transacción, idempotente por externo_id. Sólo service_role.';

revoke execute on function crm_registrar_entrante(text, text, text, text, text, text, text, jsonb, timestamptz, text, text) from public, anon, authenticated;
grant execute on function crm_registrar_entrante(text, text, text, text, text, text, text, jsonb, timestamptz, text, text) to service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- La bandeja la atienden admin, gerencia y recepción: los mismos roles que
-- `huespedes` (0045). Housekeeping NO: los mensajes traen datos personales,
-- teléfonos y a veces pagos, y no es quien contesta.
--
-- Borrar: sólo admin y gerencia, y sólo lo que es configuración (etiquetas,
-- respuestas). Un mensaje o una conversación no se borran desde el panel: son
-- el registro de lo que se le dijo al huésped.

alter table crm_bandejas enable row level security;
alter table crm_contactos enable row level security;
alter table crm_identidades enable row level security;
alter table crm_conversaciones enable row level security;
alter table crm_mensajes enable row level security;
alter table crm_etiquetas enable row level security;
alter table crm_conversacion_etiquetas enable row level security;
alter table crm_respuestas enable row level security;

create policy "crm_bandejas: atencion lee" on crm_bandejas
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_bandejas: direccion edita" on crm_bandejas
  for update using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "crm_contactos: atencion lee" on crm_contactos
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_contactos: atencion edita" on crm_contactos
  for update using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "crm_identidades: atencion lee" on crm_identidades
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "crm_conversaciones: atencion lee" on crm_conversaciones
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_conversaciones: atencion edita" on crm_conversaciones
  for update using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "crm_mensajes: atencion lee" on crm_mensajes
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
-- El staff sólo escribe salientes, notas y actividad, y siempre a su nombre. Un
-- `entrante` escrito por el staff sería poner palabras en boca del huésped.
create policy "crm_mensajes: atencion escribe" on crm_mensajes
  for insert with check (
    rol_actual() in ('admin', 'gerencia', 'recepcion')
    and tipo in ('saliente', 'nota', 'actividad')
    and autor_id = auth.uid()
  );
-- Actualizar: sólo el estado de entrega de lo que salió (lo hace la acción de
-- responder después de llamar al canal).
create policy "crm_mensajes: atencion actualiza salientes" on crm_mensajes
  for update using (rol_actual() in ('admin', 'gerencia', 'recepcion') and tipo = 'saliente')
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion') and tipo = 'saliente');

create policy "crm_etiquetas: atencion lee" on crm_etiquetas
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_etiquetas: direccion gestiona" on crm_etiquetas
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "crm_conversacion_etiquetas: atencion lee" on crm_conversacion_etiquetas
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_conversacion_etiquetas: atencion etiqueta" on crm_conversacion_etiquetas
  for insert with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_conversacion_etiquetas: atencion desetiqueta" on crm_conversacion_etiquetas
  for delete using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "crm_respuestas: atencion lee" on crm_respuestas
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));
create policy "crm_respuestas: direccion gestiona" on crm_respuestas
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- `anon` no toca nada de esto: el chat de la web entra por una Server Action con
-- `service_role` y un token propio, nunca por PostgREST.
revoke all on crm_bandejas, crm_contactos, crm_identidades, crm_conversaciones,
              crm_mensajes, crm_etiquetas, crm_conversacion_etiquetas, crm_respuestas
  from anon;

-- En local hay que declarar los grants (ver 0006); en hosted los aplica la
-- plataforma. La seguridad real la impone RLS.
grant select, insert, update, delete on crm_bandejas, crm_contactos, crm_identidades,
  crm_conversaciones, crm_mensajes, crm_etiquetas, crm_conversacion_etiquetas, crm_respuestas
  to authenticated;
grant all on crm_bandejas, crm_contactos, crm_identidades, crm_conversaciones,
  crm_mensajes, crm_etiquetas, crm_conversacion_etiquetas, crm_respuestas
  to service_role;

-- ── Tiempo real ──────────────────────────────────────────────────────────────
-- La bandeja escucha mensajes y conversaciones nuevas sin recargar. Realtime
-- respeta RLS, así que housekeeping no recibe nada.
alter publication supabase_realtime add table crm_mensajes;
alter publication supabase_realtime add table crm_conversaciones;
