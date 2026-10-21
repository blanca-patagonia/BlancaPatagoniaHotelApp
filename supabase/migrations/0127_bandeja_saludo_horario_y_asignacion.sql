-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0127 — Bandeja: saludo, fuera de horario, asignación automática,
-- informes y búsqueda en los mensajes (ADR 0044)
--
-- Todo viene de lo que Chatwoot configura POR BANDEJA (`greeting_enabled`,
-- `out_of_office_message`, `working_hours_*`, `enable_auto_assignment`) y de sus
-- informes (`first_reply_created_at`, tiempo de resolución).
--
-- ── Mensajes automáticos ────────────────────────────────────────────────────
--
-- Un saludo automático NO es una respuesta de una persona. Chatwoot lo resuelve
-- no contando como «primera respuesta» lo que no escribió un agente. Acá se
-- marca con `automatico`: si no, el saludo que sale a los dos segundos dejaría
-- la conversación como «ya respondida» (`esperando_desde = null`) y el huésped
-- esperaría horas sin que nada en la lista lo marque en rojo. Es exactamente el
-- error que más cuesta de ver: la pantalla dice que todo está atendido.
--
-- Un eco (lo que el hotel escribe desde la app del teléfono) NO es automático:
-- lo escribió una persona, aunque no tenga `autor_id`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table crm_bandejas
  add column saludo_activo            boolean not null default false,
  add column saludo_mensaje           text    not null default '¡Hola! Gracias por escribir a Blanca Patagonia. En un momento te respondemos.',
  add column fuera_horario_activo     boolean not null default false,
  add column fuera_horario_mensaje    text    not null default 'Ahora estamos fuera de horario. Te respondemos apenas volvamos a atender.',
  -- Horario de atención en la hora DEL HOTEL (America/Argentina/Rio_Gallegos).
  add column horario_desde            time    not null default '08:00',
  add column horario_hasta            time    not null default '21:00',
  -- Días ISO: 1 = lunes … 7 = domingo.
  add column dias_atencion            smallint[] not null default '{1,2,3,4,5,6,7}',
  add column asignacion_automatica    boolean not null default false,
  add constraint crm_bandejas_dias_validos
    check (dias_atencion <@ array[1,2,3,4,5,6,7]::smallint[]),
  add constraint crm_bandejas_mensajes_acotados
    check (length(saludo_mensaje) <= 1000 and length(fuera_horario_mensaje) <= 1000);

comment on column crm_bandejas.saludo_activo is
  'Manda el saludo en la PRIMERA conversación de un contacto (Chatwoot: greeting_enabled). Sólo en canales con respuesta.';
comment on column crm_bandejas.asignacion_automatica is
  'Asigna cada conversación nueva a quien de recepción tenga menos abiertas. Sin «presencia» en línea: sólo conviene si el turno es siempre de las mismas personas.';

alter table crm_mensajes
  add column automatico boolean not null default false;

comment on column crm_mensajes.automatico is
  'Saludo o mensaje fuera de horario. No cuenta como respuesta de una persona (no limpia la espera ni marca la primera respuesta).';

alter table crm_conversaciones
  add column resuelta_en timestamptz;

comment on column crm_conversaciones.resuelta_en is
  'Cuándo se resolvió por última vez (la mantiene un trigger). Insumo del informe de tiempo de resolución.';

create index crm_conversaciones_creada_idx on crm_conversaciones (creado_en);
create index crm_conversaciones_resuelta_idx on crm_conversaciones (resuelta_en) where resuelta_en is not null;

-- Búsqueda por el CONTENIDO de los mensajes (Chatwoot: search messages). Sin el
-- índice de trigramas, un `ilike '%texto%'` recorre toda la tabla en cada tecla.
create index crm_mensajes_contenido_trgm_idx
  on crm_mensajes using gin (contenido extensions.gin_trgm_ops)
  where tipo in ('entrante', 'saliente');

-- ── resuelta_en ──────────────────────────────────────────────────────────────

create or replace function crm_al_cambiar_estado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'resuelta' and old.estado is distinct from 'resuelta' then
    new.resuelta_en := now();
  elsif new.estado <> 'resuelta' and old.estado = 'resuelta' then
    -- Reabierta: deja de contar como resuelta. El informe mide hasta la
    -- ÚLTIMA resolución, no la primera.
    new.resuelta_en := null;
  end if;
  return new;
end;
$$;

create trigger crm_conversaciones_resuelta
  before update of estado on crm_conversaciones
  for each row execute function crm_al_cambiar_estado();

revoke execute on function crm_al_cambiar_estado() from public, anon;

-- ── El trigger de mensajes: lo automático no es una respuesta ────────────────

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
  elsif new.tipo = 'saliente' and not new.automatico then
    update crm_conversaciones
       set ultima_actividad_en  = greatest(ultima_actividad_en, new.creado_en),
           esperando_desde      = null,
           primera_respuesta_en = coalesce(primera_respuesta_en, new.creado_en)
     where id = new.conversacion_id;
  elsif new.tipo = 'saliente' then
    -- Automático: mueve la actividad, pero el huésped SIGUE esperando a una persona.
    update crm_conversaciones
       set ultima_actividad_en = greatest(ultima_actividad_en, new.creado_en)
     where id = new.conversacion_id;
  end if;
  return new;
end;
$$;

-- ── Entrada atómica: con asignación automática ───────────────────────────────
--
-- Igual que la 0126, más: si la bandeja la tiene activada, la conversación NUEVA
-- se asigna a quien de recepción tenga menos conversaciones abiertas (empate: la
-- persona con la asignación más vieja). Se decide ACÁ, dentro del candado del
-- contacto y en la misma transacción: hecho desde la app, dos conversaciones
-- que entran juntas verían la misma carga y irían a la misma persona.
--
-- Sólo recepción: admin y gerencia ven todo y no son quienes atienden el chat,
-- y housekeeping no ve la bandeja.

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
  v_primera       boolean := false;
  v_agente        uuid;
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
    if p_email is not null and position('@' in p_email) > 1 then
      select case when count(*) = 1 then min(id::text)::uuid end into v_contacto
        from crm_contactos
       where lower(email) = lower(trim(p_email));
    end if;
    v_digitos := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10);
    if v_contacto is null and length(v_digitos) = 10 then
      select case when count(*) = 1 then min(id::text)::uuid end into v_contacto
        from crm_contactos
       where right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10) = v_digitos;
    end if;

    if v_contacto is not null then
      insert into crm_identidades (contacto_id, bandeja_id, externo_id)
      values (v_contacto, v_bandeja.id, p_externo_contacto)
      returning id into v_identidad;
    end if;
  end if;

  if v_identidad is null then
    v_primera := true;
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
    update crm_contactos set nombre = trim(p_nombre)
     where id = v_contacto and nombre = '';
  end if;

  if exists (select 1 from crm_contactos where id = v_contacto and bloqueado) then
    return jsonb_build_object('ignorado', 'contacto_bloqueado');
  end if;

  select id into v_conversacion
    from crm_conversaciones
   where identidad_id = v_identidad
     and (estado <> 'resuelta' or ultima_actividad_en > now() - interval '7 days')
   order by ultima_actividad_en desc
   limit 1;

  if not found then
    -- Sólo una conversación iniciada por el HUÉSPED se asigna sola: un eco (el
    -- hotel escribió primero desde el teléfono) ya tiene quien la atiende.
    if v_bandeja.asignacion_automatica and p_tipo = 'entrante' then
      select p.id into v_agente
        from perfiles p
       where p.rol = 'recepcion' and p.activo
       order by (select count(*) from crm_conversaciones c
                  where c.asignada_a = p.id and c.estado in ('abierta', 'pendiente')),
                coalesce((select max(c.creado_en) from crm_conversaciones c where c.asignada_a = p.id),
                         'epoch'::timestamptz),
                p.id
       limit 1;
    end if;

    insert into crm_conversaciones (bandeja_id, contacto_id, identidad_id, asunto, asignada_a)
    values (v_bandeja.id, v_contacto, v_identidad, p_asunto, v_agente)
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
    -- El contacto es nuevo para la BANDEJA entera (no sólo la conversación): el
    -- saludo es para quien escribe por primera vez, no para cada hilo nuevo.
    'primera_vez', v_primera,
    'asignada_a', v_agente,
    'duplicado', v_mensaje is null
  );
end;
$$;

revoke execute on function crm_registrar_entrante(text, text, text, text, text, text, text, jsonb, timestamptz, text, text) from public, anon, authenticated;
grant execute on function crm_registrar_entrante(text, text, text, text, text, text, text, jsonb, timestamptz, text, text) to service_role;
