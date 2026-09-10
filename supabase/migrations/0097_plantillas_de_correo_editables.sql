-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0097 — Plantillas de correo editables desde el panel
--
-- ── Por qué una tabla de OVERRIDE y no mover el catálogo entero a la base ────
--
-- `lib/domain/plantillas.ts` define, por cada evento, cinco cosas: `nombre`,
-- `disparador` (metadatos de UI), `variables`/`opcionales` (contrato que usa
-- `variablesFaltantes()` para no mandar un correo con un dato sin reemplazar)
-- y `asunto`/`cuerpo` (el contenido). Las primeras cuatro son lógica —de ellas
-- depende que el sistema sepa qué datos pedirle a quien dispara el aviso—, y
-- moverlas a una tabla las volvería editables por accidente: alguien podría
-- borrar una variable que el código sigue exigiendo y ROMPER el envío, no
-- solo cambiar cómo se lee.
--
-- Esta tabla guarda SOLO lo que es contenido —`asunto`/`cuerpo`— por evento.
-- Si no hay fila, `renderizar()` usa el texto de `PLANTILLAS` (el original);
-- si hay fila, la reemplaza. El catálogo de código sigue siendo la fuente de
-- verdad para todo lo demás, y sigue siendo el respaldo si esta tabla está
-- vacía o si alguien la deja con una fila a medio completar.
--
-- `evento` es `text` libre, sin `check` contra un enum — mismo criterio que
-- `notificaciones.evento` (migración 0075): agregar un evento nuevo en código
-- no debería exigir tocar esta tabla.

create table plantillas_email (
  evento         text primary key check (length(btrim(evento)) > 0),
  asunto         text,
  cuerpo         text,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references perfiles(id) on delete set null
);

comment on table plantillas_email is
  'Override editable del asunto/cuerpo de una plantilla de email. Sin fila para un evento, se usa el texto original de lib/domain/plantillas.ts.';
comment on column plantillas_email.asunto is
  'null = usar el asunto original de PLANTILLAS. No hay fila "vacía a propósito": si se borra el texto, se borra la fila (ver `restaurarPlantillaOriginal`).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Lectura para todo el staff (como `planes_mantenimiento`): cualquiera puede
-- necesitar ver qué dice el correo que le llega a un huésped. Escritura solo
-- admin/gerencia, como el resto de lo que define contenido y comunicación
-- (plantillas de contrato, tarifario).

alter table plantillas_email enable row level security;

create policy "plantillas_email: staff lee" on plantillas_email
  for select using (rol_actual() is not null);
create policy "plantillas_email: gerencia+ gestiona" on plantillas_email
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- La 0006 dejó `alter default privileges ... grant select on tables to anon`.
-- El contenido de un correo transaccional no es del catálogo público.
revoke select on plantillas_email from anon;
