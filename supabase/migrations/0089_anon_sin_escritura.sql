-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0089 — `anon` deja de tener INSERT, UPDATE y DELETE
--
-- ── Cómo apareció ────────────────────────────────────────────────────────────
--
-- Escribiendo `tests/anon-no-escribe.test.ts`, que audita el borde público en
-- escritura tabla por tabla. El test encontró que `anon` conserva el grant de
-- **UPDATE y DELETE sobre las seis tablas del catálogo** —`tipos_unidad`,
-- `tarifas`, `temporadas`, `temporada_rangos`, `promociones` y
-- `politicas_cancelacion`—, que son justamente las que la 0072 dejó legibles
-- para que el portal público funcione.
--
-- ── De dónde salía ese grant ────────────────────────────────────────────────
--
-- No de una migración de este proyecto. La 0006 le da a `anon` **sólo** `select`,
-- y su `alter default privileges` también. El grant de escritura viene de los
-- privilegios por omisión que la **plataforma** deja puestos en el esquema
-- `public`, y ninguna migración lo tocó porque nadie lo miró: la 0072 revocó
-- `select` sobre lo que no es catálogo y ahí se detuvo.
--
-- ⚠️ Y es peor de lo que se ve: sobre el resto de las tablas el grant de
-- escritura **probablemente siga estando también**. No se nota porque, sin
-- `select`, PostgREST no expone la tabla al rol y responde «no existe» antes de
-- llegar a la base. La barrera que actúa ahí no es el permiso: es que el cliente
-- no encuentra la puerta.
--
-- ── Qué exposición real había ────────────────────────────────────────────────
--
-- **Ninguna, hoy.** Las seis tablas tienen políticas RLS de escritura acotadas a
-- `admin` y `gerencia`, y `rol_actual()` es NULL para el rol público: un `update`
-- de `anon` filtra cero filas. Verificable.
--
-- Pero es exactamente la misma forma que tuvo el hallazgo de `cotizar_estadia`
-- (0070): **la capa que la documentación daba por puesta no estaba**, y la
-- protección efectiva dependía de una sola política. El día que una migración
-- agregue una política de escritura `using (true)` a una tabla de catálogo —o que
-- alguien copie una de las públicas de lectura sin mirar el `for all`—, `anon`
-- pasa a poder editar las tarifas del hotel desde internet.
--
-- ── La decisión ─────────────────────────────────────────────────────────────
--
-- `anon` no escribe **nada**, en ninguna tabla, y se revoca en bloque en vez de
-- tabla por tabla. Es seguro comprobarlo: en este sistema **ninguna escritura
-- pública usa el rol `anon`**. Las tres que existen —reservar desde el portal,
-- responder la encuesta y firmar un contrato— resuelven con `service_role` desde
-- el servidor, con el token de la URL como credencial. Está escrito en el
-- encabezado de cada una de esas acciones.
--
-- El único uso del cliente del navegador es el chat interno del panel
-- (`app/panel/conversaciones/chat.tsx`), que corre con sesión de staff, o sea con
-- el rol `authenticated`. Ése no se toca.
-- ─────────────────────────────────────────────────────────────────────────────

revoke insert, update, delete on all tables in schema public from anon;

/*
  Y las tablas que todavía no existen.

  Sin esto, la próxima migración crea una tabla y la plataforma le vuelve a dar
  escritura a `anon`: el arreglo duraría hasta el próximo `create table`, que es
  la peor clase de arreglo — el que parece hecho.

  ⚠️ `alter default privileges` sólo alcanza a los objetos que cree **este** rol.
  Las migraciones corren como `postgres`, que es el mismo que ejecuta esta línea,
  así que las cubre. Una tabla creada a mano desde el panel de Supabase con otro
  usuario no queda cubierta, y por eso el test de contrato sigue haciendo falta.
*/
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;

-- Las secuencias, por lo mismo: `usage` sobre una secuencia permite consumir
-- números aunque el insert no entre, y no hay ningún motivo para que `anon` lo
-- tenga.
revoke usage on all sequences in schema public from anon;
alter default privileges in schema public revoke usage on sequences from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- El helper de auditoría
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Mismo patrón que `funciones_expuestas_a_publico()` (0070) y `tablas_publicas()`
-- (0046): la pregunta se le hace al **catálogo de Postgres**, no a PostgREST.
--
-- ⚠️ Es la lección de esta migración. La primera versión del test sondeaba con un
-- `insert` vacío y leía el código de error, y eso tiene dos falsos negativos que
-- no se ven: una **vista** responde 55000 («no se puede insertar en una vista») y
-- una tabla con **trigger BEFORE INSERT** responde lo que lance el trigger. En los
-- dos casos el error no es de permiso y el test lo leía como si la barrera hubiera
-- actuado. Preguntar por el grant no tiene ambigüedad.

/*
  Recibe el rol en vez de fijar `anon`.

  El caso que importa es `anon`, pero el test necesita también el contrapeso: que
  `authenticated` **siga** pudiendo escribir. Un `revoke` mal dirigido —a `public`,
  por ejemplo, que es un grupo del que los dos son miembros— dejaría al hotel sin
  poder cargar una reserva, y sin este parámetro esa comprobación no se puede
  escribir sin montar una sesión real. Un test que no puede fallar es peor que
  ninguno.
*/
create or replace function privilegios_de_escritura(p_rol text default 'anon')
returns table (tabla text, privilegio text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.relname::text, p.priv::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
   where n.nspname = 'public'
     -- Tablas y vistas: los dos son alcanzables por PostgREST.
     and c.relkind in ('r', 'v', 'm', 'p')
     and has_table_privilege(p_rol, c.oid, p.priv)
   order by 1, 2;
$$;

comment on function privilegios_de_escritura(text) is
  'Tablas y vistas sobre las que un rol conserva INSERT, UPDATE o DELETE. Insumo del test de contrato que evita que una tabla nueva nazca con escritura pública. Solo service_role; devuelve nombres, nunca contenido.';

/*
  El grant de la propia función.

  Una función nace con EXECUTE para PUBLIC, y `tests/funciones-sin-public.test.ts`
  falla si alguna queda abierta. Sería especialmente irónico acá: una función que
  audita permisos, ejecutable por el rol que audita.
*/
revoke execute on function privilegios_de_escritura(text) from public;
grant execute on function privilegios_de_escritura(text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Tiene que devolver CERO filas:
--   select * from privilegios_de_escritura('anon');
--
--   -- Y ésta, muchas: el staff escribe.
--   select count(*) from privilegios_de_escritura('authenticated');
--
--   -- El catálogo sigue siendo legible, que es lo que el portal necesita:
--   select has_table_privilege('anon', 'tarifas', 'select');       -- t
--   select has_table_privilege('anon', 'tipos_unidad', 'select');  -- t
--
--   -- Y el staff sigue escribiendo:
--   select has_table_privilege('authenticated', 'reservas', 'update');  -- t
