-- ════════════════════════════════════════════════════════════════════════════
-- 0116 · Reponer stock en un solo paso
-- ════════════════════════════════════════════════════════════════════════════
--
-- La acción de Configuración → Inventario leía el stock y escribía
-- «leído + cantidad». Un consumo que entrara en el medio —el trigger
-- `consumos_descuenta_stock` resta en la base— quedaba pisado y el stock
-- terminaba inflado: el sistema creía que había botellas que ya se habían
-- vendido. Con `stock = stock + n` no hay lectura que pueda quedar vieja.
--
-- Devuelve el stock nuevo, o `null` si el producto no existe o no lleva
-- inventario (servicios con `stock` nulo), para que la acción lo diga.

create function reponer_stock(p_producto_id uuid, p_cantidad int)
returns int
language plpgsql
security invoker            -- respeta el RLS de quien llama
set search_path = public
as $$
declare
  v_stock int;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a reponer tiene que ser mayor que cero'
      using errcode = '22023';
  end if;

  update productos_servicios
  set stock = stock + p_cantidad
  where id = p_producto_id
    and stock is not null
  returning stock into v_stock;

  -- Sin fila: el producto no existe, no lleva inventario, o el RLS no dejó
  -- escribir (un `update` bloqueado no lanza: afecta cero filas).
  if not found then
    return null;
  end if;
  return v_stock;
end;
$$;

comment on function reponer_stock is
  'Suma stock en un solo UPDATE (sin lectura previa que pueda quedar vieja frente a un consumo simultáneo). Devuelve el stock nuevo, o null si el producto no existe o no lleva inventario.';

-- Una función nace con EXECUTE para PUBLIC (tests/contratos funciones-sin-public).
revoke execute on function reponer_stock(uuid, int) from public;
grant execute on function reponer_stock(uuid, int) to authenticated, service_role;
