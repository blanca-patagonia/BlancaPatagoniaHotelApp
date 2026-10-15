-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0111 — Fusión de huéspedes duplicados y derecho de supresión
--
-- ── Qué faltaba ──────────────────────────────────────────────────────────────
--
-- Dos huecos del mismo módulo. Primero: `crearReservaAction` ya detecta un
-- posible duplicado AL CREAR (mismo documento o email), pero no hay forma de
-- unir dos fichas que ya quedaron separadas — el caso típico es el huésped que
-- entra por un canal externo como `Externo-xxxxxx` (sin documento) y vuelve
-- directo con sus datos reales: hoy son dos personas para el sistema, cada una
-- con su propio historial de reservas y de puntos. Segundo: no hay forma de
-- ejercer el derecho de supresión de la Ley 25.326 sobre una ficha existente.
--
-- ── Fusión: por qué una función SQL y no dos `update` sueltos ───────────────
--
-- Mismo motivo que `crear_reserva`/`cambiar_unidad_reserva`/
-- `aplicar_precio_reserva`/`avanzar_estado_reserva`: son tres escrituras sobre
-- dos tablas (reasignar `reservas`, reasignar `reserva_huespedes` sin violar su
-- clave primaria, sumar los puntos y recién al final borrar el duplicado). Si
-- el borrado final fallara después de reasignar solo una parte, quedaría un
-- huésped duplicado con el historial repartido entre los dos — exactamente el
-- problema que la fusión viene a resolver, pero peor, porque ya no se nota.
--
-- `security invoker` (como el resto): respeta el RLS de quien llama. El
-- `delete from huespedes` al final es la red de seguridad — `reservas.huesped_id`
-- es `on delete restrict` (migración 0005), así que si algún `update` de arriba
-- fue parcial (RLS bloqueó una fila sin avisar), el `delete` choca con esa
-- restricción y la función lo informa en vez de devolver éxito a medias.
--
-- `notificaciones.huesped_id` y `auditoria_accesos.huesped_id` NO se reasignan
-- a propósito: son bitácoras (quién recibió un aviso, quién abrió esta ficha),
-- no datos operativos. `notificaciones` ya es `on delete set null` y
-- `auditoria_accesos` es `on delete cascade` — se pierde el vínculo con la
-- ficha que desaparece, que es aceptable para un registro histórico y evita
-- escribir sobre dos tablas que además son de solo `service_role`
-- (migraciones 0075 y 0091): forzar `security definer` solo para esto sería
-- una superficie nueva para un caso secundario.
--
-- Los puntos de fidelidad se SUMAN, no se descartan ni se promedian: son plata
-- interna que la misma persona ya ganó bajo dos fichas separadas: juntarlas no
-- inventa nada, corrige la fragmentación.
--
-- ── Anonimización: por qué una columna y no borrar la fila ──────────────────
--
-- `huespedes` tiene `on delete restrict` desde `reservas` (0005): una ficha con
-- historial no se puede borrar sin perder ese historial, y las facturas que
-- referencian esa reserva son del contador y tienen que sobrevivir (retención
-- fiscal). El derecho de supresión de la Ley 25.326 se ejerce sobre el dato
-- personal, no sobre el registro contable: se anonimiza nombre, documento,
-- contacto y notas, y se deja el resto (reservas, pagos, facturas) intacto. Es
-- el mismo criterio que ya usa este proyecto para «borrar»: baja lógica, no
-- DELETE físico (ver migración 0061, agencias/proveedores/tarifas).
--
-- `anonimizado` es explícito y no se infiere de `nombre = 'Anonimizado'`: un
-- huésped real podría llamarse así por coincidencia, y una bandera booleana no
-- se presta a esa ambigüedad.
-- ─────────────────────────────────────────────────────────────────────────────

alter table huespedes
  add column anonimizado boolean not null default false;

comment on column huespedes.anonimizado is
  'Se ejerció el derecho de supresión (Ley 25.326): nombre, documento, contacto y notas fueron sobrescritos. El resto del historial (reservas, pagos, facturas) se conserva por retención fiscal.';

create function fusionar_huespedes(p_conservar uuid, p_descartar uuid)
returns jsonb
language plpgsql
security invoker            -- respeta el RLS de quien llama, igual que el resto
as $$
begin
  if p_conservar = p_descartar then
    return jsonb_build_object('ok', false, 'motivo', 'mismo_huesped');
  end if;

  if not exists (select 1 from huespedes where id = p_conservar)
     or not exists (select 1 from huespedes where id = p_descartar) then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  update reservas set huesped_id = p_conservar where huesped_id = p_descartar;

  -- Acompañantes: se reasignan sin violar la clave primaria (reserva_id,
  -- huesped_id) — si el conservado ya figuraba como acompañante de la misma
  -- reserva, `on conflict do nothing` evita el error y no duplica la fila.
  insert into reserva_huespedes (reserva_id, huesped_id)
  select reserva_id, p_conservar from reserva_huespedes where huesped_id = p_descartar
  on conflict (reserva_id, huesped_id) do nothing;
  delete from reserva_huespedes where huesped_id = p_descartar;

  update huespedes c set puntos = c.puntos + d.puntos
  from huespedes d
  where c.id = p_conservar and d.id = p_descartar;

  delete from huespedes where id = p_descartar;
  if not found then
    -- No debería pasar: ya se confirmó que la fila existía. Si llegó acá es
    -- porque el RLS de quien llama no autoriza el DELETE, y sin este chequeo
    -- la función devolvería éxito sin haber fusionado nada.
    return jsonb_build_object('ok', false, 'motivo', 'sin_permiso');
  end if;

  return jsonb_build_object('ok', true);
exception
  when foreign_key_violation then
    -- Alguna reasignación de arriba no llegó a cubrir todas las filas (RLS
    -- parcial): sigue habiendo algo que referencia al duplicado, y el `delete`
    -- lo frena en vez de dejarlo a medio fusionar.
    return jsonb_build_object('ok', false, 'motivo', 'referencia_pendiente');
end;
$$;

comment on function fusionar_huespedes is
  'Fusiona dos fichas de huésped: reasigna reservas y acompañantes al conservado, suma los puntos de fidelidad, y borra el duplicado. Atómica: revierte entera si el borrado final choca con una referencia que no se pudo reasignar.';

revoke execute on function fusionar_huespedes(uuid, uuid) from public;
grant execute on function fusionar_huespedes(uuid, uuid) to authenticated, service_role;
