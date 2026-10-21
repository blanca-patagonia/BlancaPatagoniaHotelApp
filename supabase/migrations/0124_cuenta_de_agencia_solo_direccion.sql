-- 0124 · La cuenta corriente de una agencia la escribe sólo la dirección.
--
-- La 0012 dejó «movimientos: recepcion+ gestiona» con `for all`: recepción
-- podía insertar, modificar y BORRAR movimientos de la cuenta corriente de
-- una agencia llamando a PostgREST directo. La app nunca lo permitió —las
-- acciones de `panel/agencias` exigen `requerirRol('admin', 'gerencia')`, y el
-- portal del socio escribe con `service_role`—, así que la política era más
-- ancha que cualquier camino real. El riesgo: una recepcionista borra un cargo
-- y baja la deuda de una agencia. El trigger de auditoría de la 0061 lo
-- registraría, pero después del hecho.
--
-- Lo encontró `tests/base-de-datos/rls-escritura-por-rol.test.ts` (los dos
-- casos «HALLAZGO», que pasan a `it` con esta migración). La lectura no cambia:
-- recepción sigue viendo la cuenta («movimientos: staff lee»).

drop policy if exists "movimientos: recepcion+ gestiona" on movimientos_cuenta;

create policy "movimientos: admin/gerencia gestionan" on movimientos_cuenta
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));
