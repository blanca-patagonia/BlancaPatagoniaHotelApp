-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0043 — Registro de respaldos (Modernización WinPAX, paso 11)
--
-- ── Qué es y qué NO es ───────────────────────────────────────────────────────
--
-- Esta tabla **no guarda respaldos**. Guarda el registro de cuándo se exportaron
-- los datos y qué se llevó cada exportación.
--
-- La aclaración importa porque el pedido original decía «backups (o al menos un
-- botón que dispare/verifique el backup automático)». Los backups de Postgres los
-- hace la plataforma (Supabase: copias diarias y, según el plan, PITR) y **no hay
-- forma de dispararlos desde la aplicación**. Un botón que dijera «Hacer backup»
-- sin hacerlo sería la peor función del sistema: alguien lo apretaría, vería
-- «listo», y se enteraría de la verdad el día que necesite restaurar.
--
-- Lo que la aplicación sí puede hacer, y hace, es exportar los datos operativos a
-- un archivo que el hotel se baja y guarda donde quiera. Esta tabla responde la
-- pregunta que hace falta: **«¿cuándo fue la última vez?»**. Sin registro, la
-- respuesta depende de que alguien se acuerde.
-- ─────────────────────────────────────────────────────────────────────────────

create table respaldos (
  id           bigint generated always as identity primary key,
  -- Cuántas tablas y filas se llevó. Sirve para detectar una exportación que
  -- «funcionó» pero salió vacía por un problema de permisos.
  tablas       int not null default 0,
  filas        int not null default 0,
  bytes        bigint not null default 0,
  -- Nombre del archivo entregado, para poder cotejarlo con lo que el hotel tenga
  -- guardado.
  archivo      text not null default '',
  generado_por uuid references perfiles (id),
  generado_en  timestamptz not null default now()
);

comment on table respaldos is
  'Registro de exportaciones de datos. NO guarda los respaldos: los backups de la base los hace la plataforma y no se disparan desde la app.';
comment on column respaldos.filas is
  'Total de filas exportadas. Un número sospechosamente bajo delata una exportación vacía por permisos.';

create index on respaldos (generado_en desc);

alter table respaldos enable row level security;

-- Todo el staff puede VER cuándo fue el último respaldo: es información operativa
-- y saber que hace 40 días que nadie exporta le sirve a cualquiera.
create policy "respaldos: staff lee" on respaldos
  for select using (rol_actual() is not null);

-- Exportar es otra cosa: el archivo contiene los datos personales de todos los
-- huéspedes del hotel. Solo admin.
create policy "respaldos: admin registra" on respaldos
  for insert with check (rol_actual() = 'admin');

-- Sin update ni delete: es un registro, no un dato editable. Si se borrara, la
-- respuesta a «cuándo fue el último» dejaría de ser confiable, que es justamente
-- lo único que esta tabla existe para garantizar.

revoke select on respaldos from anon;
