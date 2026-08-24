-- 0064 · El stock se descuenta de verdad
--
-- ── El bug, verificado ejecutándolo ─────────────────────────────────────────
--
-- Con una sesión de **recepción** —el rol que carga consumos todos los días— se
-- cargaron 3 unidades de un producto con stock 50:
--
--     stock inicial: 50
--     cargar consumo como recepción: OK        ← sin error
--     stock después: 50                        ← NO descontó
--
-- El consumo se cobra y el inventario queda mintiendo. **Sin un solo error.**
--
-- ── Por qué falla en silencio ───────────────────────────────────────────────
--
-- `descontar_stock_consumo()` (migración 0015) se declaró sin `security definer`,
-- así que corre con los privilegios de quien inserta el consumo. Su cuerpo hace:
--
--     update productos_servicios set stock = ... where id = new.producto_id
--
-- y la política de escritura de esa tabla es `admin/gerencia gestionan`. Con una
-- sesión de recepción, RLS **filtra la fila**: el `update` afecta cero filas y
-- Postgres lo considera un éxito. No hay excepción que capturar ni error que
-- devolver — por eso nadie lo notó.
--
-- Es el mismo defecto que la migración 0033 corrigió en
-- `siguiente_numero_comprobante`, y estaba anotado como sospecha en
-- `docs/PENDIENTES.md`. La diferencia es que aquél **fallaba ruidosamente** (no se
-- podía emitir ninguna factura) y éste no falla: descuenta cero y sigue.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
--
-- `security definer` con `search_path` fijo, igual que las otras funciones
-- privilegiadas del esquema. El descuento de stock es una **consecuencia
-- automática** de cargar un consumo, no una edición del catálogo: quien puede
-- cargar el consumo tiene que poder descontar, sin que eso le dé permiso para
-- editar precios ni nombres.
--
-- ⚠️ `set search_path = public` no es opcional en una función `definer`: sin él,
-- quien la invoca podría anteponer un esquema propio y hacer que `update
-- productos_servicios` apunte a otra tabla.

create or replace function descontar_stock_consumo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update productos_servicios
  set stock = greatest(0, stock - new.cantidad)
  where id = new.producto_id and stock is not null;
  return new;
end;
$$;

comment on function descontar_stock_consumo() is
  'Descuenta stock al cargar un consumo. SECURITY DEFINER (migración 0064): como invoker, con una sesión de recepción el update caía en la política admin/gerencia de `productos_servicios`, afectaba cero filas y NO fallaba — el consumo se cobraba y el inventario quedaba mintiendo.';

-- ── Lo que se comprobó y NO era un bug ──────────────────────────────────────
--
-- `docs/PENDIENTES.md` sospechaba del mismo defecto en `cambiar_unidad_reserva`.
-- Se probó con una sesión de recepción y **funciona correctamente**: devuelve
-- `{"ok":true,...}` y hace la mudanza. Sus tablas (`estadias`, `unidades`) sí
-- admiten la escritura que necesita. Queda anotado acá para que nadie vuelva a
-- «arreglarlo».
