-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0126 — Un contacto, varios canales
--
-- La 0125 creaba un contacto nuevo por cada identidad nueva. Pero el mismo
-- huésped escribe por el chat de la web dejando su email y después contesta la
-- copia que le llegó por correo (o escribe por WhatsApp con el teléfono que ya
-- había dado): eran dos contactos, con la historia partida en dos fichas.
--
-- Ahora, antes de crear un contacto, se busca uno que ya tenga ese email o ese
-- teléfono y se le suma la identidad nueva. Es lo que hace Chatwoot al
-- identificar un contacto por email (`ContactIdentifyAction`). Igual que con
-- los huéspedes, sólo si la coincidencia es ÚNICA: con dos candidatos no se
-- elige, porque unir mal es mostrarle a recepción la conversación de otro.
--
-- Va en una migración aparte y no editando la 0125 por la regla del proyecto:
-- una migración escrita no se toca.
-- ─────────────────────────────────────────────────────────────────────────────

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
    -- Identidad nueva. ¿Es alguien que ya escribió por OTRO canal? Se reconoce
    -- por email o por los últimos 10 dígitos del teléfono, y sólo si hay UN
    -- contacto que coincide (mismo criterio que con los huéspedes).
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

revoke execute on function crm_registrar_entrante(text, text, text, text, text, text, text, jsonb, timestamptz, text, text) from public, anon, authenticated;
grant execute on function crm_registrar_entrante(text, text, text, text, text, text, text, jsonb, timestamptz, text, text) to service_role;

create index crm_contactos_telefono_digitos_idx
  on crm_contactos (right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10));
