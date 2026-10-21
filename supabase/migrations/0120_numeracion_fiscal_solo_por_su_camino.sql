-- 0120 — La numeración fiscal sólo avanza por su camino, y con el rol que corresponde.
--
-- ── El hallazgo (auditoría de seguridad, 2026-10-20) ─────────────────────────
--
-- `siguiente_numero_comprobante` (0025/0033) y `siguiente_numero_nota_credito`
-- (0076) son SECURITY DEFINER —es el único camino para mover el contador, porque
-- `authenticated` no tiene UPDATE sobre `puntos_venta`— y NO tenían guarda de
-- rol. Las dos se podían ejecutar como `authenticated`:
--
--   Una persona con cualquier rol (housekeeping incluido) toma su token de la
--   cookie de sesión y llama por PostgREST `rpc/siguiente_numero_comprobante`.
--   Cada llamada avanza `puntos_venta.ultimo_numero`. La próxima factura real
--   sale con un SALTO en el correlativo: con ARCA real (WSFEv1), un número que
--   no es el último autorizado + 1 se rechaza, y la facturación queda trabada
--   hasta corregirla a mano. Es la obligación formal que la 0069 protege.
--
-- `reservar_numero_factura` (0069) sí tenía guarda, pero la función interna que
-- mueve el contador quedó expuesta por su cuenta.
--
-- ── El arreglo ───────────────────────────────────────────────────────────────
--
-- · `siguiente_numero_comprobante`: sólo la llama `reservar_numero_factura`, que
--   es DEFINER y corre como dueño. Se le saca el EXECUTE a `authenticated`; no
--   necesita guarda propia porque nadie más llega.
-- · `siguiente_numero_nota_credito`: la llama `emitirNotaCredito` con el cliente
--   del usuario, así que conserva el EXECUTE de `authenticated` y suma la MISMA
--   guarda que `reservar_numero_factura`, acotada a quien puede emitir una nota
--   de crédito según RLS (`notas_credito: admin y gerencia emiten`, 0076).
--   `auth.uid() is null` es `service_role` (crons, tests): pasa.

revoke execute on function siguiente_numero_comprobante(int) from public, anon, authenticated;
grant execute on function siguiente_numero_comprobante(int) to service_role;

create or replace function siguiente_numero_nota_credito(p_punto_venta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero int;
begin
  -- Sólo quien puede emitir la nota (RLS de `notas_credito`, 0076). Sin esto,
  -- cualquier sesión podía gastar números del correlativo fiscal (0120).
  if auth.uid() is not null
     and coalesce(rol_actual()::text, '') not in ('admin', 'gerencia') then
    raise exception 'Solo administración o gerencia puede emitir una nota de crédito'
      using errcode = '42501';
  end if;

  -- SECURITY DEFINER porque `authenticated` no tiene UPDATE sobre `puntos_venta`,
  -- y ése es el único camino permitido para mover el contador.
  update puntos_venta
     set ultimo_nc = ultimo_nc + 1
   where numero = p_punto_venta
  returning ultimo_nc into v_numero;

  if v_numero is null then
    raise exception 'No existe el punto de venta %.', p_punto_venta;
  end if;
  return v_numero;
end;
$$;

comment on function siguiente_numero_nota_credito(int) is
  'Avanza y devuelve el correlativo de notas de crédito. Sólo admin o gerencia (o service_role): guarda agregada en la 0120.';

revoke execute on function siguiente_numero_nota_credito(int) from public, anon;
grant execute on function siguiente_numero_nota_credito(int) to authenticated, service_role;
