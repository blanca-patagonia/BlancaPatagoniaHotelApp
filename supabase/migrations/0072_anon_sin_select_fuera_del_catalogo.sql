-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0072 — `anon` deja de tener SELECT sobre todo lo que no es catálogo
-- (Fase 4 de la auditoría, segunda parte)
--
-- ── El planteo de la auditoría ──────────────────────────────────────────────
--
-- «`anon` conserva SELECT a nivel tabla sobre reservas, huéspedes, pagos,
-- facturas, firmas, perfiles y auditoría. Es el modelo estándar de Supabase y hoy
-- funciona —lo verifiqué—, pero saber que las 91 políticas existen no es lo mismo
-- que saber qué permite cada una. Es el único control que separa datos personales
-- de internet.»
--
-- El planteo es correcto. Verificado ejecutando: `anon` lee **0 filas** de todas
-- esas tablas —`rol_actual()` es NULL para el rol público y ninguna de sus
-- políticas admite un rol nulo—. Pero eso es **una sola capa**: si algún día una
-- migración agrega una política `using (true)` a una de estas tablas —como las
-- que tiene el catálogo—, `anon` empieza a leer datos personales y nadie lo nota
-- hasta que alguien los encuentra indexados.
--
-- ── La decisión ─────────────────────────────────────────────────────────────
--
-- `anon` mantiene SELECT **solo** sobre el catálogo público, que es lo único que
-- la web sin sesión necesita leer:
--
--   tipos_unidad · tarifas (por columna, sin `precio_neto`, desde la 0031) ·
--   temporadas · temporada_rangos · politicas_cancelacion · promociones
--
-- Sobre todo lo demás se le revoca. Después de esto, para las tablas con datos de
-- huéspedes **no hay que razonar sobre las políticas en el caso `anon`**: no hay
-- grant, así que PostgREST corta antes de evaluarlas. Es la diferencia entre «RLS
-- lo tapa» y «no llega a RLS».
--
-- Ya venían sin SELECT para `anon` (migraciones 0029, 0031, 0036, 0038, 0043,
-- 0049, 0051, 0055, 0057, 0060, 0070): los `canal_*`, `cotizaciones`,
-- `respaldos`, `intentos_limitados`, `agencias`, `proveedores`, `firmas` y las
-- vistas de saldos. Esta migración cierra las 24 que quedaban.
--
-- ── Verificado: ningún camino público las lee ───────────────────────────────
--
-- El portal (`app/reservar`, `app/alojamientos`, `lib/asistente`) lee catálogo y
-- llama a `cotizar_estadia_publica` / `disponibilidad_por_tipo` /
-- `unidades_disponibles` (RPCs, no tablas). Los flujos con token
-- (`app/portal/[token]`, `app/firmar/[token]`, `/reservar/confirmacion`,
-- `/reservar/pagar`) usan `crearClienteAdmin()`. `crearReservaEnUnidadLibre`
-- también corre con el cliente privilegiado desde `/reservar`.
-- ─────────────────────────────────────────────────────────────────────────────

revoke select on auditoria             from anon;
revoke select on avisos                from anon;
revoke select on canales               from anon;
revoke select on consultas_bot         from anon;
revoke select on consumos              from anon;
revoke select on contratos             from anon;
revoke select on departamentos         from anon;
revoke select on encuestas_satisfaccion from anon;
revoke select on estadias              from anon;
revoke select on facturas              from anon;
revoke select on huespedes             from anon;
revoke select on mensajes              from anon;
revoke select on movimientos_cuenta    from anon;
revoke select on movimientos_proveedor from anon;
revoke select on objetos_perdidos      from anon;
revoke select on ordenes_mantenimiento from anon;
revoke select on pagos                 from anon;
revoke select on perfiles              from anon;
revoke select on planes_mantenimiento  from anon;
revoke select on productos_servicios   from anon;
revoke select on puntos_venta          from anon;
revoke select on reserva_huespedes     from anon;
revoke select on reservas              from anon;
revoke select on unidades              from anon;

-- El default de la 0006 —`alter default privileges ... grant select on tables to
-- anon`— sigue en pie, así que una tabla nueva nace legible para `anon`. Se ajusta
-- para que nazca cerrada: el catálogo público es la excepción y se otorga a mano.
alter default privileges in schema public revoke select on tables from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- Solo el catálogo queda legible para `anon`:
--   select c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and has_table_privilege('anon', c.oid, 'select')
--    order by 1;
--   -- esperado: politicas_cancelacion, promociones, tarifas, temporada_rangos,
--   --           temporadas, tipos_unidad
--
--   -- El portal público sigue funcionando: `/alojamientos` y `/reservar` 200.
