-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0051 — Mapeo manual de columnas de un informe
--
-- ── El problema que resuelve ────────────────────────────────────────────────
--
-- El lector del informe de Booking adivina qué columna es cuál con un diccionario de
-- alias («Fecha de entrada», «Check-in», «Arrival»…). Cuando no acierta, la
-- importación devuelve «no se reconocieron las columnas» y ahí muere: el mensaje
-- sugiere bajar el informe «sin modificarlo», que es inútil si el export de esa cuenta
-- simplemente tiene otros encabezados.
--
-- El hotel **no sabe qué formato tiene su export**, así que el diccionario no se puede
-- calibrar contra un archivo real. Esta tabla es la red de contención: que una persona
-- diga qué columna es cuál, una sola vez por formato, y quede guardado.
--
-- ── La decisión central: por NOMBRE, no por posición ────────────────────────
--
-- `asignaciones` guarda *campo → encabezado normalizado*, nunca *campo → índice*.
--
-- Si el extranet agrega una columna en el medio, un mapeo por índice queda corrido
-- **en silencio**: las fechas empiezan a leerse de la columna de importes, el
-- importador no falla, y devuelve datos plausibles y equivocados. Es la misma clase de
-- error que las fechas `d/m/Y` que este proyecto ya persiguió. Por nombre, si la
-- columna desaparece se detecta y se avisa.
--
-- ── Por qué `tipo_informe` ya está, si todavía hay un solo lector ───────────
--
-- Los cuatro informes del extranet —reservas, reseñas, factura de comisión,
-- liquidaciones— tienen encabezados distintos, así que un mapeo único sería
-- inservible. La columna entra ahora con default `'reservas'` para que el resto del
-- trabajo no exija otra migración sobre esta tabla.
-- ─────────────────────────────────────────────────────────────────────────────

create table canal_mapeos_columnas (
  id             uuid primary key default gen_random_uuid(),
  canal          text not null check (canal in ('booking', 'expedia')),
  tipo_informe   text not null default 'reservas'
                 check (tipo_informe in ('reservas', 'resenas', 'factura_comision', 'liquidacion')),

  -- Nombre que le pone quien lo guarda, para poder distinguir dos formatos del mismo
  -- informe (por ejemplo el export viejo y el nuevo, durante una transición).
  nombre         text not null,

  -- Encabezados normalizados, ordenados y unidos por `|`. Sirve para reconocer el
  -- formato sin preguntar. Ordenados a propósito: reordenar columnas sin cambiar
  -- ninguna sigue siendo el mismo formato, porque el mapeo resuelve por nombre.
  firma_encabezados text not null default '',

  -- { "externalId": "n de reserva", "huesped": "cliente final", … }
  asignaciones   jsonb not null,

  -- Hasta tres valores de ejemplo por columna, para que la pantalla de mapeo pueda
  -- mostrarlos. Es lo que permite decidir a quien no reconoce el encabezado de su
  -- propio export: puede no saber qué es «Ref», pero reconoce 1234567890.
  muestra        jsonb,

  activo         boolean not null default true,
  creado_por     uuid references perfiles(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  unique (canal, tipo_informe, nombre)
);

comment on table canal_mapeos_columnas is
  'Qué columna del informe del extranet corresponde a cada campo del importador. Existe porque el diccionario de alias no se puede calibrar sin conocer el formato real del export del hotel.';
comment on column canal_mapeos_columnas.asignaciones is
  'campo → encabezado NORMALIZADO, nunca campo → índice: un mapeo por posición queda corrido en silencio si el extranet agrega una columna al medio.';
comment on column canal_mapeos_columnas.firma_encabezados is
  'Encabezados normalizados, ordenados y unidos por «|». Reconoce el formato para no volver a preguntar. El orden se descarta porque el mapeo resuelve por nombre.';
comment on column canal_mapeos_columnas.muestra is
  'Valores de ejemplo por columna. Sin ellos la pantalla de mapeo le pide al usuario adivinar; con ellos le pide leer.';

create index on canal_mapeos_columnas (canal, tipo_informe) where activo;
create index on canal_mapeos_columnas (firma_encabezados);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table canal_mapeos_columnas enable row level security;

-- Lo lee y lo gestiona quien importa: recepción baja el informe y es quien va a
-- descubrir que las columnas no coinciden.
create policy "canal_mapeos: staff lee" on canal_mapeos_columnas
  for select using (rol_actual() is not null);
create policy "canal_mapeos: recepcion+ gestiona" on canal_mapeos_columnas
  for all using (rol_actual() in ('admin', 'gerencia', 'recepcion'))
  with check (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- La 0006 dejó `alter default privileges ... grant select on tables to anon`, así que
-- toda tabla nueva nace legible por el rol anónimo. Acá importa: `muestra` guarda
-- valores reales del archivo, que incluyen **apellidos, emails y teléfonos** de
-- huéspedes. Es exactamente la clase de dato que `CLAUDE.md` reserva a staff.
revoke select on canal_mapeos_columnas from anon;
