-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0101 — Registro de limpieza con comentario y foto (ADR 0037)
--
-- ── Qué faltaba ──────────────────────────────────────────────────────────────
--
-- `UnidadHousekeeping` (`lib/domain/housekeeping.ts`) es una vista DERIVADA en
-- tiempo real de `unidades`/`estadias`: no existe ninguna tabla que diga «esta
-- limpieza se hizo, con este comentario y con esta foto». El botón único de
-- «Mi trabajo» (`marcarLimpiaDesdeMovil`) sigue existiendo tal cual — la mucama
-- no elige entre cuatro estados, marca hecho — pero no había dónde dejar
-- constancia de un detalle puntual («falta un toallón», «se rompió la persiana»)
-- ni una foto, que es justo lo que la gobernanta necesita para no tener que
-- caminar hasta la habitación a confirmar qué pasó.
--
-- Esta tabla es un LOG, no un estado: se agrega una fila por cada registro, no
-- se edita ninguna. Por eso la RLS de abajo sólo da `select`/`insert` — ni
-- `update` ni `delete` — y coincide con el criterio ya usado en
-- `ordenes_mantenimiento`/`objetos_perdidos` (migración 0014): los mismos tres
-- roles que hoy tienen el área `housekeeping` en `lib/domain/permisos.ts`
-- (admin, gerencia, housekeeping — recepción NO la tiene).
--
-- `fotos` guarda RUTAS del bucket privado `adjuntos-operativos`
-- (`lib/storage/index.ts`), nunca URLs: la URL de lectura se firma al momento
-- de mostrarla y expira sola, así que persistir una URL dejaría un link roto
-- tarde o temprano (mismo comentario que las migraciones 0100 y 0102).
-- ─────────────────────────────────────────────────────────────────────────────

create table housekeeping_registros (
  id          uuid primary key default gen_random_uuid(),
  unidad_id   uuid not null references unidades (id),
  -- Quien lo cargó. Nullable: admin/gerencia pueden cargar un registro a mano
  -- (por ejemplo transcribiendo lo que dijo la mucama por teléfono) sin que
  -- haga falta que sea siempre la propia mucama la que quede identificada.
  mucama_id   uuid references perfiles (id),
  comentario  text not null default '',
  fotos       text[] not null default '{}',
  creado_en   timestamptz not null default now()
);

comment on table housekeeping_registros is
  'Historial de limpieza por unidad: comentario y fotos de un pase puntual. Es un log —se inserta, nunca se edita— y no reemplaza el estado de `unidades.estado`, que sigue siendo la fuente de verdad de si la habitación está lista.';
comment on column housekeeping_registros.mucama_id is
  'Quien cargó el registro. Nullable: admin/gerencia pueden cargarlo a mano sin ser ellos quienes limpiaron.';
comment on column housekeeping_registros.fotos is
  'Rutas dentro del bucket adjuntos-operativos (carpeta housekeeping/<unidad_id>), no URLs ni binarios. La URL de lectura se firma en el servidor con lib/storage.urlAdjunto al mostrarla.';

create index housekeeping_registros_unidad_id_creado_en_idx
  on housekeeping_registros (unidad_id, creado_en desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mismo criterio que `ordenes_mantenimiento`/`objetos_perdidos` (0014): los
-- roles que hoy tienen el área `housekeeping` (`lib/domain/permisos.ts`) son
-- admin, gerencia y housekeeping — recepción no la tiene.
alter table housekeeping_registros enable row level security;

create policy "housekeeping_registros: admin/gerencia/housekeeping leen" on housekeeping_registros
  for select using (rol_actual() in ('admin', 'gerencia', 'housekeeping'));

create policy "housekeeping_registros: admin/gerencia/housekeeping insertan" on housekeeping_registros
  for insert with check (rol_actual() in ('admin', 'gerencia', 'housekeeping'));

-- Sin política de update/delete a propósito: es un log de auditoría operativa,
-- no un formulario editable. `authenticated` conserva el grant de tabla que le
-- da la 0006 (`alter default privileges`), pero sin una política de RLS que lo
-- autorice, un update/delete de cualquier rol filtra cero filas.
