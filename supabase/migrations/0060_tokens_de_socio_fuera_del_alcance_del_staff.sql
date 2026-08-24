-- 0060 · Los tokens de socio, fuera del alcance del staff
--
-- ── El agujero, verificado ejecutándolo ─────────────────────────────────────
--
-- Con una sesión de **housekeeping** —el rol de menor privilegio, que ni siquiera
-- tiene las áreas `agencias` ni `proveedores` en `lib/domain/permisos.ts`— se
-- pudo leer por PostgREST:
--
--     agencias    : LEYÓ 1 fila → tokens visibles: 1
--     proveedores : LEYÓ 1 fila → tokens visibles: 1
--
-- La causa son dos políticas escritas como `rol_actual() is not null`, es decir
-- «cualquiera que tenga sesión»:
--
--     agencias    | agencias: staff lee    | SELECT | (rol_actual() IS NOT NULL)
--     proveedores | proveedores: staff lee | SELECT | (rol_actual() IS NOT NULL)
--
-- Y el token no es un dato más: es la credencial de `/portal/<token>`, que se
-- sirve con `service_role` y muestra CUIT, email, la cuenta corriente completa
-- del socio y sus contratos. Desde ahí el portal enlaza a `/firmar/<token>`, y
-- `firmarContrato` **no exige sesión**: le alcanza el token.
--
-- O sea: una mucama podía firmar un contrato en nombre de una agencia.
--
-- Es exactamente el escenario que la migración 0034 describe como motivo de su
-- existencia («un token no es un dato: es una credencial»), alcanzado por otra
-- puerta que quedó abierta.

-- ── 1. Las políticas, alineadas con la matriz de permisos ───────────────────
--
-- `drop` + `create` y no `alter policy`: dejar el nombre «staff lee» describiendo
-- algo que ya no es todo el staff sería peor que renombrarla. Mismo criterio que
-- la 0045.
--
-- Recepción SÍ lee agencias: `app/panel/reservas/nueva/page.tsx` necesita la
-- lista para vincular una reserva a un convenio, y la matriz de permisos le da
-- el área. Proveedores es de administración: no está en su lista.

drop policy "agencias: staff lee" on agencias;
create policy "agencias: recepcion+ lee" on agencias
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

drop policy "proveedores: staff lee" on proveedores;
create policy "proveedores: gerencia+ lee" on proveedores
  for select using (rol_actual() in ('admin', 'gerencia'));

-- ── 2. El token, fuera del alcance de TODO cliente de usuario ───────────────
--
-- ⚠️ POR QUÉ ESTO SE HACE ASÍ Y NO CON UN `revoke select (token)` A SECAS.
--
-- La migración 0034 intentó exactamente eso sobre `firmas.token`:
--
--     revoke select (token) on firmas from authenticated;
--
-- y **no tuvo ningún efecto**. Se comprobó contra la base:
--
--     has_column_privilege('authenticated','firmas','token','SELECT') = true
--
-- La causa es `0006_grants_api.sql`, que hace un `grant select ... on all tables
-- in schema public to authenticated`. En Postgres el privilegio de tabla
-- (`relacl`) y el de columna (`attacl`) viven en catálogos distintos: un REVOKE
-- de columna **no puede recortar** un GRANT de tabla. Postgres lo acepta sin
-- error, y por eso el arreglo parecía aplicado.
--
-- La forma que sí funciona es quitar el grant de tabla y reponerlo columna por
-- columna, omitiendo el token.
--
-- Efecto secundario buscado: cualquier columna que se agregue en el futuro a
-- estas tablas **no será legible** hasta que se la agregue acá. Es incómodo a
-- propósito — en tablas que guardan credenciales, que el default sea «no se ve»
-- es la postura correcta.

revoke select on agencias from authenticated;
grant select (
  id, nombre, tipo, cuit, email, telefono, descuento_pct, activo, creado_en,
  condicion_iva, etapa, notas_comerciales
) on agencias to authenticated;

revoke select on proveedores from authenticated;
grant select (
  id, nombre, rubro, cuit, email, telefono, activo, creado_en
) on proveedores to authenticated;

-- `firmas`: se completa lo que la 0034 quiso hacer y no pudo.
revoke select on firmas from authenticated;
grant select (
  id, contrato_id, firmante_nombre, firmante_email, hash_documento, ip,
  user_agent, fecha_firma, creado_en
) on firmas to authenticated;

comment on column agencias.token is
  'Credencial de /portal/<token>. NO legible con el cliente del usuario (grant por columna, migración 0060): para mostrarlo hay que usar `crearClienteAdmin()`. No alcanza con revocarlo por columna sin quitar antes el grant de tabla — ver el comentario de esa migración.';

comment on column proveedores.token is
  'Credencial de /portal/<token>. Mismo tratamiento que `agencias.token` (migración 0060).';

-- ── 3. Lo que NO se toca, y por qué ─────────────────────────────────────────
--
-- Las políticas de ESCRITURA de las dos tablas ya estaban acotadas a
-- `('admin','gerencia')` desde su migración original, así que no hacía falta
-- cambiarlas. Se deja anotado para que quien audite no salga a buscarlas.
--
-- El `service_role` no se ve afectado por nada de esto: saltea RLS y conserva
-- sus grants. Es lo que permite que `/portal/<token>` siga funcionando y que la
-- ficha del socio pueda mostrar el enlace usando `crearClienteAdmin()`.
