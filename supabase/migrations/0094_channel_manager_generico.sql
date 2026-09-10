-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0094 — Preparación para un channel manager genérico
--
-- ── Por qué esto NO toca `canal_tipos`/`canal_config`/`canal_reservas` ───────
--
-- Esas cuatro tablas (0038, 0049, 0081) están hardcodeadas a
-- `check (canal in ('booking', 'expedia'))` a propósito: resuelven un problema
-- concreto de esos dos canales —el informe CSV de reservas de Booking, el feed
-- de reseñas de su extranet, el iCal de salida— y hasta la propia pantalla del
-- panel tiene el canal fijo (`app/panel/canales/page.tsx` filtra
-- `.eq('canal', 'booking')` en cada consulta). Generalizar ESO sería reescribir
-- un módulo que funciona y está probado, para un formato de CSV que un channel
-- manager de verdad (Beds24, Hotelrunner, RateGain) no manda: esos hablan por
-- su propia API/webhook, no por el informe del extranet de Booking.
--
-- Lo que hace falta para un channel manager es algo más chico y genuinamente
-- nuevo: un catálogo de conexiones (no dos valores fijos) y un mapeo de tipos
-- de unidad que cualquier fila de ese catálogo pueda usar. Eso es lo que sigue.
--
-- ── Las dos tablas ────────────────────────────────────────────────────────────
--
-- `canales_externos` es el catálogo. Agregar un proveedor el día de mañana es
-- un INSERT, no una migración — es la diferencia concreta entre esto y el
-- `check (canal in (...))` que tienen las tablas de arriba.
--
-- `canal_externo_tipos` es el mapeo que pide el punto 1 de la Fase 7: nuestro
-- `tipo_unidad_id` contra el código con el que ESE proveedor conoce a esa
-- categoría. Mismo problema que `canal_tipos` (0081) resuelve para Booking/
-- Expedia, mismo motivo de fondo (PostgREST no expone un `join` por texto
-- libre), pero sin el hardcodeo.
--
-- ── El webhook receptor (punto 2) ────────────────────────────────────────────
--
-- Vive en código, no en esta migración: `app/api/canales/externos/[token]/
-- route.ts`. El `token` de acá es su credencial — mismo patrón que
-- `canal_config.ical_token` (0049) y el portal de socios (0024): un secreto al
-- portador en la URL, porque el otro lado es un servidor que no puede iniciar
-- sesión.
--
-- ── La lógica de inventario (punto 3) ────────────────────────────────────────
--
-- Ya es agnóstica al origen: `crearReservaEnUnidadLibre` (`lib/reservas/
-- crear.ts`) es la única puerta de alta y ya la llaman el portal público, el
-- alta de mostrador Y la importación de canal (`lib/canales/servicio.ts`). El
-- webhook de este bloque es un tercer llamador más, no lógica nueva — es
-- exactamente lo que permite que conectar un canal sea agregar un adaptador y
-- no reescribir el sistema.
-- ─────────────────────────────────────────────────────────────────────────────

create table canales_externos (
  id             uuid primary key default gen_random_uuid(),

  -- Identificador corto y estable ('beds24', 'hotelrunner'...). Es lo que se
  -- guarda en `reservas.canal` para las reservas que entren por acá, así que
  -- no se puede reciclar entre proveedores distintos.
  codigo         text not null unique check (length(btrim(codigo)) > 0),
  nombre         text not null check (length(btrim(nombre)) > 0),

  -- Apagar un canal sin borrar su mapeo ni su historial: las reservas ya
  -- creadas siguen apuntando a este catálogo.
  activo         boolean not null default true,

  -- Credencial del webhook. Igual que `canal_config.ical_token`: un uuid
  -- generado acá, nunca elegido a mano, para que no sea adivinable.
  token          uuid not null default gen_random_uuid(),

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table canales_externos is
  'Catálogo de conexiones a un channel manager externo (Beds24, Hotelrunner, RateGain...). A diferencia de `canal_config`, no está atado a un canal fijo: agregar un proveedor es un INSERT.';
comment on column canales_externos.token is
  'Credencial de `POST /api/canales/externos/<token>`. Va en la URL, así que es el único secreto de esta tabla y por eso su RLS es admin/gerencia (mismo criterio que `canal_config.ical_token`).';
comment on column canales_externos.codigo is
  'Se guarda tal cual en `reservas.canal`. Esa columna es `text` libre (migración 0005, sin `check`): agregar un canal nuevo no exige tocar ningún enum de la base, solo el catálogo de `lib/domain/reservas.ts` si se quiere una etiqueta linda en los reportes.';

create table canal_externo_tipos (
  id               uuid primary key default gen_random_uuid(),
  canal_externo_id uuid not null references canales_externos(id) on delete cascade,
  tipo_unidad_id   uuid not null references tipos_unidad(id) on delete cascade,

  -- El código con el que ESE proveedor conoce a este tipo de unidad. Mismo rol
  -- que `canal_tipos.codigo_canal` (0081).
  codigo_externo   text not null check (length(btrim(codigo_externo)) > 0),
  activo           boolean not null default true,
  actualizado_en   timestamptz not null default now(),

  -- Un tipo, un mapeo por canal; un código, un tipo por canal. Sin el segundo
  -- único, dos tipos podrían competir por el mismo código externo y el webhook
  -- no tendría forma de saber a cuál de los dos asignar la reserva entrante.
  unique (canal_externo_id, tipo_unidad_id),
  unique (canal_externo_id, codigo_externo)
);

comment on table canal_externo_tipos is
  'Mapeo tipo de unidad ↔ código del canal externo (Fase 7, punto 1). Lo usa el webhook para traducir la habitación que vendió el channel manager a nuestro `tipo_unidad_id`.';

create index on canal_externo_tipos (canal_externo_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Mismo nivel que `canal_config` (0049): admin/gerencia, no todo el staff. El
-- token es un secreto y el mapeo es estrategia comercial (con qué proveedores
-- se trabaja), no algo que housekeeping o recepción necesiten ver.

alter table canales_externos enable row level security;
alter table canal_externo_tipos enable row level security;

create policy "canales_externos: gerencia+ lee" on canales_externos
  for select using (rol_actual() in ('admin', 'gerencia'));
create policy "canales_externos: gerencia+ gestiona" on canales_externos
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

create policy "canal_externo_tipos: gerencia+ lee" on canal_externo_tipos
  for select using (rol_actual() in ('admin', 'gerencia'));
create policy "canal_externo_tipos: gerencia+ gestiona" on canal_externo_tipos
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- La 0006 dejó `alter default privileges ... grant select on tables to anon`,
-- así que toda tabla nueva nace legible por el rol anónimo. Acá sería grave:
-- expondría el token del webhook. Las políticas ya lo bloquean (para `anon`,
-- `rol_actual()` es null); se revoca igual, mismo criterio que la 0049.
revoke select on canales_externos from anon;
revoke select on canal_externo_tipos from anon;
