-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0070 — Cerrar dos grants a PUBLIC que las auditorías anteriores
-- dieron por resueltos y no lo estaban (Fase 4 de la auditoría)
--
-- ── Hallazgo 1: `cotizar_estadia` seguía siendo ejecutable por `anon` ─────────
--
-- El ADR 0016 y `CLAUDE.md` afirman: «`anon` ya no puede ejecutar
-- `cotizar_estadia`». La migración 0031 hizo
-- `revoke execute on function cotizar_estadia(...) from anon`, y sonaba
-- suficiente. No lo era.
--
-- Postgres, al crear una función, le concede EXECUTE a **PUBLIC** por omisión.
-- `anon` es miembro de PUBLIC. Un `revoke` dirigido a `anon` no le quita nada
-- —nunca tuvo un grant propio— y el privilegio le sigue llegando por PUBLIC.
-- Verificado: `has_function_privilege('anon', 'cotizar_estadia(...)', 'execute')`
-- devolvía `true`.
--
-- Es el gemelo, a nivel función, de la trampa que ya está documentada en
-- `AGENTS.md` para columnas: «un `revoke select (columna)` NO recorta un `grant`
-- de tabla previo». Dos catálogos distintos, dos capas que hay que atravesar.
--
-- ⚠️ La exposición REAL de este caso era CERO, y hay que decirlo sin adornos:
-- `cotizar_estadia` es `security invoker`, `anon` no tiene grant sobre la tabla
-- `tarifas` (migración 0031), y además la 0030 metió la guarda
-- `current_user <> 'anon'` adentro de la función. Tres capas. Lo que faltaba era
-- la cuarta —la que el ADR dice tener— y la afirmación del documento, que era
-- falsa. Se corrige acá y en la doc.
--
-- ── Hallazgo 2: `anon` conservaba SELECT de tabla sobre agencias, proveedores
--    y firmas, con la columna `token` incluida ──────────────────────────────────
--
-- La migración 0060 revocó `select` sobre esas tres tablas y lo repuso por
-- columna, dejando `token` afuera. Pero lo revocó **solo a `authenticated`**.
-- Las tres tablas se crearon después de la 0006, que dejó
-- `alter default privileges ... grant select on tables to anon`, así que `anon`
-- sigue con SELECT de tabla completo —`token` incluido—.
--
-- Hoy RLS lo tapa: `rol_actual()` es NULL para `anon` y ninguna de las políticas
-- de esas tablas admite un rol nulo. Pero la capa de columna que la 0060
-- construyó no cubre al rol público, y bastaría una política `using (true)` mal
-- puesta —como las que tiene el catálogo— para que `anon` leyera un token que
-- abre `/portal/<token>` y firma contratos en nombre del socio.
--
-- `anon` no lee ninguna de las tres por ningún camino de la aplicación: el portal
-- del socio (`app/portal/[token]`, `app/firmar/[token]`) usa `crearClienteAdmin()`.
-- Así que acá se le revoca SELECT y no se repone nada.
--
-- ── Y de paso: las otras funciones nuestras con EXECUTE a PUBLIC ─────────────
--
-- Auditadas las ~40 funciones del esquema `public`. Se excluye lo que no es
-- nuestro (las de la extensión `btree_gist`: `gbt_*`, `*_dist`, `gbtreekey*`) y
-- lo que no se puede llamar de afuera (`returns trigger`). Quedan las de abajo,
-- todas hoy ejecutables por cualquiera vía PUBLIC. La más grave es
-- `siguiente_numero_comprobante`: `security definer`, incrementa el contador
-- fiscal, y con PUBLIC cualquiera podía quemar números de factura desde el
-- borde público.
--
-- ⚠️ NO se tocan `rol_actual()`, `puede_ver_canal()` ni `temporada_en()`:
--   · `rol_actual` y `puede_ver_canal` son las únicas funciones que aparecen en
--     expresiones de políticas RLS, y Postgres **sí** chequea EXECUTE del rol que
--     consulta cuando evalúa una policy (verificado con una policy de prueba).
--     Revocarles PUBLIC rompería la lectura de `anon` sobre el catálogo.
--   · `temporada_en` la llama `cotizar_estadia_publica` como `security invoker`,
--     así que corre con el rol de quien cotiza —`anon` en el portal—.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Funciones: revoke a PUBLIC + grant nominal
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Precio / disponibilidad ────────────────────────────────────────────────

-- `cotizar_estadia`: el neto es de staff. `anon` cotiza por `cotizar_estadia_publica`.
revoke execute on function cotizar_estadia(uuid, date, date, text) from public;
grant execute on function cotizar_estadia(uuid, date, date, text)
  to authenticated, service_role;

-- `cotizar_estadia_publica`: ya tenía el grant nominal a `anon`; se le saca el
-- PUBLIC redundante para que el ACL diga exactamente quién puede.
revoke execute on function cotizar_estadia_publica(uuid, date, date) from public;
grant execute on function cotizar_estadia_publica(uuid, date, date)
  to anon, authenticated, service_role;

-- Disponibilidad: la consulta el portal público (rol `anon`) y también el alta
-- de reserva desde `/reservar`, que corre con `crearClienteAdmin()` — o sea que
-- `service_role` la necesita, y hoy le llega por PUBLIC. Al revocar hay que
-- reponerle el grant a los tres o el portal deja de tomar reservas.
revoke execute on function disponibilidad_por_tipo(date, date, categoria_unidad) from public;
grant execute on function disponibilidad_por_tipo(date, date, categoria_unidad)
  to anon, authenticated, service_role;

revoke execute on function unidades_disponibles(date, date, categoria_unidad) from public;
grant execute on function unidades_disponibles(date, date, categoria_unidad)
  to anon, authenticated, service_role;

-- ── Contadores ─────────────────────────────────────────────────────────────

-- El contador fiscal. Con PUBLIC, cualquiera desde el borde público podía
-- llamarlo y dejar un salto de correlatividad — la misma obligación formal que
-- la migración 0069 acaba de blindar del lado de la carrera.
revoke execute on function siguiente_numero_comprobante(int) from public;
grant execute on function siguiente_numero_comprobante(int)
  to authenticated, service_role;

-- El numerador de comandas admite huecos (0040), así que quemar uno no es grave,
-- pero tampoco hay motivo para que lo mueva alguien sin sesión.
revoke execute on function siguiente_comanda() from public;
grant execute on function siguiente_comanda()
  to authenticated, service_role;

-- ── Límite de tasa: nunca fue para el borde, es la maquinaria del borde ─────

-- `registrar_intento` inserta y devuelve si todavía se permite. Con PUBLIC,
-- alguien podía llamarla a mano contra una IP de otro y agotarle el cupo, o
-- inflar la tabla. Solo el servidor la invoca (`lib/domain/limites.ts`).
revoke execute on function registrar_intento(inet, text, int, int) from public;
grant execute on function registrar_intento(inet, text, int, int) to service_role;

-- Filtra cuántas consultas hizo una IP: es rastreo, no un dato público.
revoke execute on function consultas_recientes_de_ip(inet, int) from public;
grant execute on function consultas_recientes_de_ip(inet, int) to service_role;

revoke execute on function purgar_intentos(int) from public;
grant execute on function purgar_intentos(int) to service_role;

-- ── Tareas de mantenimiento (las corre el cron o un admin, nunca el público) ─

revoke execute on function expirar_reservas_pendientes(int) from public;
grant execute on function expirar_reservas_pendientes(int)
  to authenticated, service_role;

revoke execute on function generar_mantenimiento_preventivo() from public;
grant execute on function generar_mantenimiento_preventivo()
  to authenticated, service_role;

revoke execute on function vencer_comprobantes_proveedor() from public;
grant execute on function vencer_comprobantes_proveedor()
  to authenticated, service_role;

-- ── Operaciones de reserva (RLS ya las acota; el grant nominal lo confirma) ──

revoke execute on function cambiar_unidad_reserva(uuid, uuid, text) from public;
grant execute on function cambiar_unidad_reserva(uuid, uuid, text)
  to authenticated, service_role;

revoke execute on function crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text,
  integer, integer, integer, integer, integer, boolean,
  text, text, text, text, uuid, numeric, numeric, numeric, numeric
) from public;
grant execute on function crear_reserva(
  uuid, uuid, uuid, date, date, integer, numeric, numeric,
  text, text, estado_reserva, uuid, uuid, text,
  integer, integer, integer, integer, integer, boolean,
  text, text, text, text, uuid, numeric, numeric, numeric, numeric
) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. `anon` deja de tener SELECT sobre las tablas con token de socio
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Se completa lo que la 0060 hizo para `authenticated`. No hay `grant` de
-- reposición: el portal del socio usa el cliente privilegiado, y `anon` no tiene
-- ninguna razón para leer estas tablas.

revoke select on agencias from anon;
revoke select on proveedores from anon;
revoke select on firmas from anon;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Helper de auditoría: funciones nuestras ejecutables por PUBLIC
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Existe para que `tests/funciones-sin-public.test.ts` detecte una función nueva
-- que nazca con el EXECUTE a PUBLIC y sin el `revoke` — que es exactamente lo que
-- pasó con `cotizar_estadia` y nadie vio durante cuatro auditorías. Misma idea y
-- mismas restricciones que `tablas_publicas()` (migración 0046).
--
-- Filtra lo que NO cuenta: las funciones de `btree_gist` (no son nuestras) y las
-- de trigger (no se pueden invocar de afuera). Lo que devuelve es la lista que
-- el test compara contra una allowlist chica y explícita.

create or replace function funciones_expuestas_a_publico()
returns table (firma text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prorettype <> 'trigger'::regtype
     and p.proname !~ '^(gbt_|gbtreekey)'
     and p.proname !~ '_(dist)$'
     and (
       p.proacl is null
       or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     )
   order by 1;
$$;

comment on function funciones_expuestas_a_publico() is
  'Funciones propias (no de extensión, no de trigger) que PUBLIC puede ejecutar. Insumo del test de contrato que evita que una función nazca abierta, como pasó con cotizar_estadia. Solo service_role; devuelve firmas, nunca contenido.';

revoke execute on function funciones_expuestas_a_publico() from public;
grant execute on function funciones_expuestas_a_publico() to service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Ninguna función nuestra ejecutable por PUBLIC, salvo las de policy:
--   set role anon;
--   select has_function_privilege('cotizar_estadia(uuid,date,date,text)', 'execute');  -- f
--   select has_function_privilege('siguiente_numero_comprobante(int)', 'execute');     -- f
--   select has_function_privilege('cotizar_estadia_publica(uuid,date,date)','execute');-- t (portal)
--   select has_function_privilege('rol_actual()', 'execute');                          -- t (policy)
--   reset role;
--
--   -- `anon` ya no ve el token de socio ni por tabla:
--   select has_column_privilege('anon','firmas','token','select');   -- f
--   select has_table_privilege('anon','agencias','select');          -- f
--
--   -- Lo que ve el test de contrato:
--   select * from funciones_expuestas_a_publico();
--   -- esperado: solo rol_actual, puede_ver_canal, temporada_en (+ tablas_publicas
--   -- y las nuevas de 0068/0069, que ya vienen con revoke).
