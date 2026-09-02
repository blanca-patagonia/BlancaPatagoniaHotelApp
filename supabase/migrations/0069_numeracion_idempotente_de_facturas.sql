-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0069 — El número correlativo es la clave de idempotencia
--
-- ── El defecto ───────────────────────────────────────────────────────────────
--
-- `emitirFactura` (app/panel/reservas/actions.ts) hace cinco viajes a la base, y
-- cada uno es **una transacción distinta**: PostgREST hace autocommit por pedido,
-- así que no hay ninguna que los abarque.
--
--   1. select id from facturas where reserva_id = X   -- ¿ya está facturada?
--   2. rpc siguiente_numero_comprobante(pv)           -- reserva el correlativo
--   3. proveedor.solicitarCae(...)                    -- pide el CAE (HTTP, AFIP)
--   4. insert into facturas (...)                     -- choca con 0045 si perdió
--   5. 23505 → se le muestra la factura que emitió la otra
--
-- Entre 1 y 4 no hay nada que serialice. Dos emisiones simultáneas de la MISMA
-- reserva —dos clics, o dos personas cerrando la reserva desde dos puestos— pasan
-- las dos por el paso 1, **las dos consumen un número en el paso 2** y **las dos
-- piden un CAE en el paso 3**. La restricción `facturas_una_por_reserva`
-- (migración 0045) impide el segundo comprobante, que era el daño grande, pero
-- la emisión que pierde la carrera **ya gastó su número**.
--
-- Con el proveedor simulado eso no se nota: el CAE es un string inventado y el
-- contador se mueve de más sin consecuencias. Con AFIP de verdad queda un CAE
-- autorizado para un número que no tiene fila en `facturas`: un **salto de
-- correlatividad**, que es una obligación formal (ADR 0015) y no se repara
-- después. El comentario de `actions.ts` lo declaraba como pendiente y
-- `docs/PENDIENTES.md` lo tenía como P1 abierto.
--
-- ── Por qué NO se resuelve «metiendo todo en una transacción SQL» ────────────
--
-- Es lo que decía el pendiente original, y no se puede: el paso 3 es una llamada
-- HTTP a un tercero. Postgres no la puede hacer, y mantener una transacción
-- abierta mientras se espera a AFIP —que tarda segundos, o no contesta— dejaría
-- bloqueada la fila del contador para todo el hotel, que es peor que el problema
-- que se quiere arreglar. Pedir el CAE después de insertar tampoco sirve: el CAE
-- va EN la fila, y `facturas` es inmutable desde la migración 0034.
--
-- ── La salida: el número ES la clave de idempotencia ─────────────────────────
--
-- Es lo que el número ya es para AFIP. WSFEv1 re-consultado sobre el mismo
-- `CbteDesde` devuelve **el CAE que ya autorizó**, no uno nuevo. Entonces alcanza
-- con garantizar que **cada reserva tenga un solo número, para siempre**: quien
-- reintente —la emisión que perdió la carrera, o alguien volviendo a apretar
-- después de un corte de red— vuelve a pedir el CAE del mismo comprobante y
-- recibe el mismo. No queda ni un número gastado ni un CAE huérfano.
--
-- Eso es la tabla de abajo: un boleto por reserva, entregado una sola vez.
--
-- ── Lo que esto NO resuelve, y hay que decirlo ───────────────────────────────
--
-- · Si una emisión se **abandona de verdad** —el CAE se rechaza por un importe
--   imposible y nadie la reintenta— el número queda reservado y nunca llega a
--   `facturas`. Sigue habiendo un hueco. Lo que cambia es que el hueco deja de
--   ser invisible: hay una fila en `facturas_numeracion` que dice qué reserva se
--   quedó con ese número, y se puede consultar. Antes el número desaparecía sin
--   rastro y el salto aparecía recién en una fiscalización.
-- · Tampoco se agrega reintento automático. Si el `insert` en `facturas` falla
--   por algo que no sea 23505, la acción sigue cortando con `?error=factura` y
--   alguien tiene que volver a emitir a mano. Lo que cambió es que **volver a
--   emitir ahora es seguro**.
-- · Y no reemplaza a `facturas_una_por_reserva`: esa restricción sigue siendo la
--   garantía de que no haya dos comprobantes. Esta migración se ocupa del
--   recurso que se gastaba en el camino, no del duplicado.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. La tabla de claims
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `reserva_id` es la clave primaria y no una columna más: la unicidad ES la
-- garantía que esta tabla existe para dar. Una reserva, un número.
--
-- ⚠️ `on delete cascade` y no `restrict`, que sería lo esperable para un dato
-- fiscal. El motivo: una reserva con factura ya no se puede borrar —`facturas`
-- la referencia con `on delete restrict` (migración 0010) y `authenticated` ni
-- siquiera tiene `delete` sobre `reservas` (migración 0061)—, así que lo único
-- que este cascade puede llegar a borrar es el claim de una reserva **sin**
-- factura, eliminada por `service_role`. Con `restrict`, en cambio, la limpieza
-- de los tests fallaría en silencio y dejaría filas colgadas: `limpiar()` no
-- revisa el error del `delete`.

create table facturas_numeracion (
  reserva_id  uuid        primary key references reservas (id) on delete cascade,
  punto_venta int         not null references puntos_venta (numero),
  numero      int         not null check (numero > 0),
  creado_en   timestamptz not null default now(),

  -- El mismo par no puede pertenecer a dos reservas. Si esto llegara a fallar,
  -- el contador de `puntos_venta` se desincronizó de los claims y hay que
  -- revisarlo a mano ANTES de seguir emitiendo.
  constraint facturas_numeracion_unica unique (punto_venta, numero)
);

comment on table facturas_numeracion is
  'Número correlativo reservado para cada reserva, ANTES de pedir el CAE. Es la clave de idempotencia de la emisión: quien reintenta recibe el mismo número, así que no gasta otro ni deja un CAE huérfano (migración 0069).';
comment on column facturas_numeracion.numero is
  'Correlativo entregado por `siguiente_numero_comprobante`. Que exista acá no significa que la factura se haya emitido: significa que ese número ya no es de nadie más.';
comment on column facturas_numeracion.creado_en is
  'Cuándo se reservó. Un claim viejo sin fila en `facturas` es una emisión abandonada, y es la única forma de detectar un salto de numeración antes de una fiscalización.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. `reservar_numero_factura`
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Devuelve `jsonb` con `{ok, motivo}`, igual que `cambiar_unidad_reserva`
-- (migración 0028): la aplicación distingue primero el error de Postgres y
-- después el motivo de negocio.
--
-- ── SECURITY DEFINER, y no invoker ──────────────────────────────────────────
--
-- `cambiar_unidad_reserva` es `security invoker` porque escribe en `estadias` y
-- `unidades`, que recepción sí puede escribir. Ésta **no puede serlo**: la tabla
-- de arriba no tiene política de INSERT (a propósito, para que el número no se
-- pueda reservar a mano desde PostgREST), así que como invoker el `insert`
-- moriría con 42501 para todo rol que no sea el dueño — o sea que la emisión de
-- facturas volvería a estar rota para todo el hotel, que es exactamente lo que
-- la migración 0033 tuvo que arreglar en `siguiente_numero_comprobante` y lo que
-- la 0064 encontró en `descontar_stock_consumo`.
--
-- `set search_path = public` no es opcional en una función `definer`: sin él,
-- quien la invoque podría anteponer un esquema propio con una tabla `facturas`
-- de mentira y hacer que la comprobación del principio devuelva lo que quiera.
--
-- Efecto lateral buscado: la lectura de `facturas` también se hace como dueño,
-- así que RLS no la filtra. Si la filtrara, un rol sin acceso vería «no hay
-- factura» y se le entregaría un número para una reserva ya facturada.
--
-- ── La guarda de rol va ADENTRO ─────────────────────────────────────────────
--
-- Un `grant` no distingue un admin de una mucama: los dos son `authenticated`.
-- Es el mismo criterio que `tablas_publicas()` (migración 0046).
--
-- ⚠️ La guarda se escribe con `rol_actual()`, NUNCA con `current_user`: en una
-- función `definer`, `current_user` es el dueño y la comprobación quedaría
-- siempre en verdadero. Es el error que el ADR 0016 documenta para
-- `cotizar_estadia`.
--
-- ⚠️ Y se saltea cuando no hay usuario autenticado, que con los `grant` de abajo
-- solo puede ser `service_role` (a `anon` se le revoca el execute). Sin eso, el
-- servidor privilegiado y los tests de integración —que usan esa clave— no
-- podrían emitir.

create or replace function reservar_numero_factura(
  p_reserva_id  uuid,
  p_punto_venta int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero      int;
  v_punto_venta int;
begin
  if auth.uid() is not null
     and coalesce(rol_actual()::text, '') not in ('admin', 'gerencia', 'recepcion') then
    raise exception 'Solo recepción o superior puede reservar la numeración de un comprobante'
      using errcode = '42501';
  end if;

  -- ── 1. ¿Ya está facturada? ─────────────────────────────────────────────────
  -- Se responde antes que nada: si la factura existe, no hay número que
  -- entregar y la acción tiene que mostrar el comprobante, no un error.
  if exists (select 1 from facturas where reserva_id = p_reserva_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ya_facturada');
  end if;

  -- ── 2. ¿Ya hay un número reservado? (camino rápido, sin bloqueo) ───────────
  -- Éste es el caso del reintento normal: alguien vuelve a emitir después de un
  -- error de red o de un CAE rechazado. Recibe SU número, no uno nuevo.
  select numero, punto_venta into v_numero, v_punto_venta
    from facturas_numeracion
   where reserva_id = p_reserva_id;

  if v_numero is not null then
    return jsonb_build_object(
      'ok', true, 'numero', v_numero, 'punto_venta', v_punto_venta, 'reusado', true
    );
  end if;

  -- ── 3. Serializar por reserva ─────────────────────────────────────────────
  -- El bloqueo es sobre la RESERVA, no sobre el punto de venta: dos emisiones de
  -- reservas distintas no tienen por qué esperarse. `pg_advisory_xact_lock` se
  -- libera solo al terminar la transacción, y PostgREST envuelve cada RPC en una,
  -- así que no hay forma de olvidarse de soltarlo.
  --
  -- No sirve `select ... for update` sobre `facturas_numeracion`: la fila que
  -- habría que bloquear todavía no existe.
  perform pg_advisory_xact_lock(hashtextextended(p_reserva_id::text, 0));

  -- ── 4. Re-chequear ────────────────────────────────────────────────────────
  -- Mientras se esperaba el bloqueo, la otra emisión pudo terminar y hacer
  -- commit. En READ COMMITTED cada sentencia toma una instantánea nueva, así que
  -- estas dos consultas SÍ ven lo que aquélla dejó. Sin este paso, la que espera
  -- pediría un segundo número al soltarse el bloqueo: el bug entero, movido de
  -- lugar.
  select numero, punto_venta into v_numero, v_punto_venta
    from facturas_numeracion
   where reserva_id = p_reserva_id;

  if v_numero is not null then
    return jsonb_build_object(
      'ok', true, 'numero', v_numero, 'punto_venta', v_punto_venta, 'reusado', true
    );
  end if;

  -- También la factura: una emisión anterior pudo haber insertado la fila por un
  -- camino que no dejó claim (facturas cargadas antes de esta migración).
  if exists (select 1 from facturas where reserva_id = p_reserva_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ya_facturada');
  end if;

  -- ── 5. Recién acá se consume el correlativo ───────────────────────────────
  -- Es el ÚNICO `siguiente_numero_comprobante` de toda la función, y está
  -- después del bloqueo y de los dos re-chequeos. Ésa es la propiedad que hay
  -- que preservar si alguien reescribe esto: por cada reserva, el contador se
  -- mueve una sola vez.
  --
  -- ⚠️ NO se toca `siguiente_numero_comprobante`. Sigue siendo SECURITY DEFINER
  -- con `search_path` fijo (migración 0033): sin eso, con el
  -- `revoke update on puntos_venta` de la 0025, la emisión se rompe para todo
  -- rol que no sea el dueño.
  v_numero := siguiente_numero_comprobante(p_punto_venta);

  insert into facturas_numeracion (reserva_id, punto_venta, numero)
  values (p_reserva_id, p_punto_venta, v_numero);

  return jsonb_build_object(
    'ok', true, 'numero', v_numero, 'punto_venta', p_punto_venta, 'reusado', false
  );
end;
$$;

comment on function reservar_numero_factura(uuid, int) is
  'Entrega el número correlativo de una reserva, siempre el mismo. Serializa con pg_advisory_xact_lock y re-chequea después de tomarlo, así que `siguiente_numero_comprobante` se invoca UNA vez por reserva: quien reintenta o pierde una carrera no gasta otro número (migración 0069).';

-- Postgres concede EXECUTE a PUBLIC por omisión, y `anon` es miembro de PUBLIC:
-- revocarle solo a `anon` no alcanzaría, porque el privilegio le seguiría
-- llegando por ahí. Se revoca a PUBLIC y se concede de nuevo, nominalmente.
revoke execute on function reservar_numero_factura(uuid, int) from public;
grant execute on function reservar_numero_factura(uuid, int) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. RLS
-- ═════════════════════════════════════════════════════════════════════════════

alter table facturas_numeracion enable row level security;

-- Misma línea que `facturas` desde la migración 0045: housekeeping no ve la
-- facturación. Acá no hay importes, pero sí qué reserva se quedó con qué número
-- de comprobante, que es información fiscal del hotel.
create policy "facturas_numeracion: recepcion+ lee" on facturas_numeracion
  for select using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- Sin políticas de INSERT, UPDATE ni DELETE: sin política, RLS deniega. El único
-- camino para escribir acá es `reservar_numero_factura`. Un `insert` a mano desde
-- PostgREST podría reservarle a una reserva un número que el contador todavía no
-- entregó, y el próximo comprobante real chocaría contra
-- `facturas_numeracion_unica`.
--
-- El `revoke` es defensa en profundidad sobre el mismo punto: la migración 0006
-- concede DML sobre toda tabla nueva a `authenticated` por `alter default
-- privileges`, así que el GRANT existe aunque la política no.
revoke insert, update, delete on facturas_numeracion from authenticated;

-- El público no tiene nada que hacer acá. `anon` recibe `select` por el mismo
-- default de la 0006.
revoke select on facturas_numeracion from anon;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Alineación con lo ya emitido
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Las facturas que ya existen no tienen claim. Se les crea uno con el número que
-- efectivamente llevan, para que `facturas_numeracion` sea desde el día uno la
-- respuesta completa a «qué número tiene cada reserva» — si no, un hueco viejo
-- sería indistinguible de uno nuevo.
--
-- `numero_fiscal` es 'PPPP-NNNNNNNN' (`numeroComprobante` en
-- lib/domain/facturacion.ts). Se toman solo las filas que lo tienen con esa
-- forma y con `punto_venta` cargado: las facturas internas anteriores a la
-- facturación fiscal (migración 0021) no lo traen, y no hay número que declarar.
--
-- `on conflict do nothing` por si dos facturas viejas comparten par, que no
-- debería pasar pero no está garantizado por ninguna restricción anterior:
-- abortar la migración por un dato histórico no ayudaría a nadie.
insert into facturas_numeracion (reserva_id, punto_venta, numero, creado_en)
select f.reserva_id,
       f.punto_venta,
       split_part(f.numero_fiscal, '-', 2)::int,
       f.emitida_en
  from facturas f
 where f.punto_venta is not null
   and f.numero_fiscal ~ '^\d{4}-\d{8}$'
   and split_part(f.numero_fiscal, '-', 2)::int > 0
on conflict do nothing;


-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- La función tiene que ser DEFINER con search_path fijo, igual que
--   -- `siguiente_numero_comprobante`, que NO debe haber cambiado:
--   select p.proname, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('reservar_numero_factura', 'siguiente_numero_comprobante');
--
--   -- Idempotencia: dos llamadas seguidas sobre la misma reserva tienen que
--   -- devolver el MISMO número, y el contador moverse una sola vez.
--   select ultimo_numero from puntos_venta where numero = 1;      -- antes
--   select reservar_numero_factura('<uuid-reserva>', 1);          -- {"reusado": false, ...}
--   select reservar_numero_factura('<uuid-reserva>', 1);          -- {"reusado": true,  ...}
--   select ultimo_numero from puntos_venta where numero = 1;      -- +1, no +2
--
--   -- Saltos de numeración: claims sin factura. Esperado, cero filas.
--   select n.punto_venta, n.numero, n.reserva_id, n.creado_en
--     from facturas_numeracion n
--     left join facturas f on f.reserva_id = n.reserva_id
--    where f.id is null
--    order by n.punto_venta, n.numero;
--
--   -- Nadie puede reservar un número a mano. Con una sesión de recepción:
--   insert into facturas_numeracion (reserva_id, punto_venta, numero)
--        values ('<uuid>', 1, 999999);   -- esperado: 42501
