-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0018 — Contratos y firma electrónica (Fase 10)
--
-- Inspirada en la app "Firma" de Odoo, adaptada al hotel: contratos con
-- agencias, proveedores y empleados, firmados desde una URL pública con token
-- (mismo mecanismo que la confirmación de reserva, migración 0011).
--
-- ⚠️ La firma que se registra acá NO tiene validez legal: es una constancia de
-- aceptación con trazabilidad (hash del texto, IP, fecha). Ver ADR 0010.
-- ─────────────────────────────────────────────────────────────────────────────

create type tipo_contrato as enum ('agencia', 'proveedor', 'empleado');
create type estado_contrato as enum ('borrador', 'enviado', 'firmado', 'rechazado', 'vencido');

create table contratos (
  id             uuid primary key default gen_random_uuid(),
  tipo           tipo_contrato   not null,
  -- Referencia polimórfica: apunta a agencias, proveedores o perfiles según
  -- `tipo`. No puede declararse como FK; la valida el trigger de más abajo.
  entidad_id     uuid            not null,
  titulo         text            not null,
  contenido      text,
  documento_url  text,
  estado         estado_contrato not null default 'borrador',
  fecha_envio    timestamptz,
  fecha_firma    timestamptz,
  vigencia_desde date,
  vigencia_hasta date,
  creado_por     uuid references perfiles (id),
  creado_en      timestamptz     not null default now(),

  -- Un contrato necesita texto propio o un documento externo al que apuntar.
  constraint contratos_con_documento
    check (contenido is not null or documento_url is not null),
  constraint contratos_vigencia_coherente
    check (vigencia_hasta is null or vigencia_desde is null or vigencia_hasta >= vigencia_desde)
);

comment on table contratos is
  'Contratos con agencias, proveedores y empleados, con ciclo de firma electrónica.';
comment on column contratos.entidad_id is
  'Id de la agencia, proveedor o perfil según `tipo` (referencia polimórfica validada por trigger).';

create index on contratos (estado, vigencia_hasta);
create index on contratos (tipo, entidad_id);

-- ── Validación de la referencia polimórfica ──────────────────────────────────
-- Sin esto, `entidad_id` podría apuntar a cualquier UUID inexistente. La
-- integridad crítica del proyecto vive en la base, no solo en la aplicación.
create or replace function validar_entidad_contrato()
returns trigger
language plpgsql
as $$
declare
  v_existe boolean;
begin
  case new.tipo
    when 'agencia'   then select exists (select 1 from agencias    where id = new.entidad_id) into v_existe;
    when 'proveedor' then select exists (select 1 from proveedores where id = new.entidad_id) into v_existe;
    when 'empleado'  then select exists (select 1 from perfiles    where id = new.entidad_id) into v_existe;
  end case;

  if not v_existe then
    raise exception 'La entidad % no existe para un contrato de tipo %', new.entidad_id, new.tipo;
  end if;
  return new;
end;
$$;

comment on function validar_entidad_contrato() is
  'Verifica que contratos.entidad_id exista en la tabla que corresponde a contratos.tipo.';

create trigger contratos_validar_entidad
  before insert or update of tipo, entidad_id on contratos
  for each row execute function validar_entidad_contrato();

-- ── Firmas ───────────────────────────────────────────────────────────────────
-- Una fila por invitación a firmar. Se crea al enviar el contrato (con su token
-- opaco) y se completa cuando el firmante acepta.
create table firmas (
  id              uuid primary key default gen_random_uuid(),
  contrato_id     uuid        not null references contratos (id) on delete cascade,
  token           uuid        not null default gen_random_uuid(),
  firmante_nombre text,
  firmante_email  text,
  -- SHA-256 del texto tal como se mostró al firmar: si alguien edita el
  -- contrato después, el hash deja de coincidir y la manipulación es evidente.
  hash_documento  text,
  ip              inet,
  user_agent      text,
  fecha_firma     timestamptz,
  creado_en       timestamptz not null default now()
);

comment on table firmas is
  'Invitación a firmar y constancia de aceptación (hash, IP, fecha). Sin validez legal: ver ADR 0010.';
comment on column firmas.token is
  'Token opaco para la URL pública de firma; funciona como credencial de acceso.';

create unique index firmas_token_idx on firmas (token);
create index on firmas (contrato_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table contratos enable row level security;
alter table firmas    enable row level security;

-- Todo el staff puede consultar los contratos (recepción necesita saber qué
-- agencias tienen convenio vigente), pero solo admin y gerencia los gestionan.
create policy "contratos: staff lee" on contratos
  for select using (rol_actual() is not null);
create policy "contratos: admin/gerencia gestionan" on contratos
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "firmas: staff lee" on firmas
  for select using (rol_actual() is not null);
create policy "firmas: admin/gerencia gestionan" on firmas
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- Nota: la pantalla pública `/firmar/[token]` NO usa estas políticas. Igual que
-- la confirmación de reserva, resuelve el acceso con `service_role` desde el
-- servidor tomando el token como credencial, de modo que `anon` nunca recibe
-- permiso de lectura sobre contratos ni firmas.
