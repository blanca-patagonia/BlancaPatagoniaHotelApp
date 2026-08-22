-- Migracion 0057 -- Las vistas de saldos, fuera del alcance de `anon`
--
-- Hallazgo de la propia auditoria, apenas la 0056 le enseño a mirar las vistas:
-- `saldos_agencias` y `saldos_proveedores` (migracion 0026) tenian el `grant select`
-- a `anon` que la 0006 concede por omision, y que las demas vistas si revocaban.
--
-- ── Alcance real: es defensa en profundidad, no una fuga ────────────────────
--
-- Verificado contra la base con datos sembrados: las dos son `security_invoker`, asi
-- que RLS de `agencias` y `proveedores` aplica igual y `anon` ve CERO filas mientras
-- `service_role` ve las que hay. O sea que el grant estaba, pero no exponia nada.
--
-- Se revoca por el mismo criterio que ya documenta la 0038: no depender de que nadie
-- escriba mal una politica mas adelante. Una vista de saldos revela cuanto le debe
-- cada agencia al hotel y cuanto debe el hotel a cada proveedor; si un dia alguien
-- agrega una politica de lectura amplia sobre `agencias` para el portal publico, esta
-- vista se convertiria en la puerta sin que nadie la mire.
--
-- ── Por que no se toca `security_invoker` ───────────────────────────────────
--
-- Es lo que las hace seguras. Sin el, la vista correria con los permisos de su dueño y
-- saltearia RLS por completo -que es exactamente el agujero que este proyecto ya
-- persiguio en `cotizar_estadia` (ADR 0016)-.

revoke select on saldos_agencias    from anon;
revoke select on saldos_proveedores from anon;
