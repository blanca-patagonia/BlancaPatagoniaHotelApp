-- ════════════════════════════════════════════════════════════════════════════
-- 0123 · Una nota de crédito se puede emitir desde el panel
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── El bug (auditoría RLS de escritura, 2026-10-20) ──────────────────────────
--
-- El trigger `nota_credito_no_supera_factura` (0076) bloquea la fila de la
-- factura con `select ... for update`, para que dos emisiones simultáneas no
-- acrediten de más. Pero `for update` exige el privilegio UPDATE sobre la
-- tabla, y la 0034 se lo revocó a `authenticated` para que las facturas sean
-- inmutables. La función era `security invoker`, así que corría como el
-- usuario del panel y el `insert` de la nota de crédito fallaba SIEMPRE:
--
--   permission denied for table facturas (42501)
--
-- Admin y gerencia —los únicos a los que la política deja emitir— no podían
-- emitir ninguna. No se vio porque todos los tests que crean notas de crédito
-- lo hacen con `service_role`, que tiene todos los privilegios.
--
-- ── El arreglo ───────────────────────────────────────────────────────────────
--
-- La función pasa a `security definer` con `search_path` fijo. Es segura así:
-- no escribe nada, sólo lee la factura y lo ya acreditado y, si no cierra,
-- corta. Quién puede insertar lo sigue decidiendo la política de
-- `notas_credito` (0076), que se evalúa antes que el trigger.
--
-- De paso la suma de lo acreditado deja de depender de qué filas ve quien
-- emite: corriendo como el usuario, RLS podía ocultarle notas de crédito y la
-- comprobación de «no acreditar de más» habría sumado de menos.
--
-- No se le devuelve UPDATE sobre `facturas` a `authenticated`: eso reabriría la
-- mutabilidad que cerró la 0034.

create or replace function nota_credito_no_supera_factura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total     numeric(12,2);
  v_acreditado numeric(12,2);
begin
  -- `for update` serializa contra otra emisión sobre la misma factura.
  select total into v_total from facturas where id = new.factura_id for update;
  if v_total is null then
    raise exception 'No existe la factura %.', new.factura_id using errcode = 'foreign_key_violation';
  end if;

  select coalesce(sum(total), 0) into v_acreditado
    from notas_credito where factura_id = new.factura_id;

  if v_acreditado + new.total > v_total + 0.001 then
    raise exception
      'Las notas de crédito de esta factura suman % y la factura es de %: no se puede acreditar de más.',
      v_acreditado + new.total, v_total
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Una función de trigger no necesita EXECUTE para dispararse: se le quita a
-- todos para que nadie la llame suelta.
revoke all on function nota_credito_no_supera_factura() from public, anon, authenticated;
