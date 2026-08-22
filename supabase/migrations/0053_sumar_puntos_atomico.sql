-- Migracion 0053 -- Sumar puntos de fidelidad sin leer primero
--
-- El bug que cierra, anotado como P1 en la bitacora: «cambiarEstadoReserva pisa los
-- puntos de fidelidad en vez de sumarlos si falla la lectura previa».
--
-- El codigo hacia read-then-write y descartaba el error de la lectura:
--
--     const { data: h } = await supabase.from('huespedes').select('puntos')...
--     const previos = h?.puntos ?? 0        -- si la lectura fallo, esto es 0
--     update huespedes set puntos = previos + nuevos
--
-- Con la lectura fallada, el update escribe SOLO los puntos de esta estadia y
-- **borra todo lo acumulado**. El huesped pierde su historial y nadie se entera: el
-- check-out se completa igual.
--
-- ── Por que en la base y no revisando el error en la app ────────────────────
--
-- Revisar el error tapaba el sintoma pero dejaba una segunda carrera abierta: dos
-- check-outs simultaneos del mismo huesped -dos reservas, dos personas en el
-- mostrador- leen los dos el mismo valor previo y el segundo update pisa al primero.
-- Se pierden los puntos de una de las dos estadias.
--
-- `update ... set puntos = puntos + $2` lo resuelve de raiz: no hay lectura que pueda
-- fallar y no hay valor previo que pueda quedar viejo. Postgres serializa los dos
-- updates sobre la misma fila.
--
-- ── Por que devuelve el total ───────────────────────────────────────────────
--
-- La pantalla necesita saber el total nuevo para decidir si el huesped CAMBIO de
-- nivel de fidelidad y avisarlo. Si la funcion no lo devolviera, habria que volver a
-- leer -y estariamos en la misma carrera que se acaba de cerrar-.

create or replace function sumar_puntos_huesped(p_huesped uuid, p_puntos int)
returns int
language plpgsql
-- `security invoker`: la politica de `huespedes` ya restringe quien puede escribir, y
-- esta funcion no tiene ninguna razon para prestar privilegios. Housekeeping no llega
-- aca porque no tiene el area de reservas ni la politica de escritura.
set search_path = public
as $$
declare
  v_total int;
begin
  if p_puntos <= 0 then
    -- Sumar cero o negativo no es un caso valido de esta funcion: se devuelve el
    -- total actual sin escribir, en vez de hacer un update inutil.
    select puntos into v_total from huespedes where id = p_huesped;
    return coalesce(v_total, 0);
  end if;

  update huespedes
     set puntos = puntos + p_puntos
   where id = p_huesped
  returning puntos into v_total;

  -- Nulo significa que la fila no existe o que RLS la oculto. Se distingue de cero
  -- -que es un total valido- para que el llamador pueda avisar en vez de creer que
  -- sumo sobre un huesped sin puntos.
  if v_total is null then
    raise exception 'No se pudo sumar puntos: el huesped % no existe o no es accesible', p_huesped
      using errcode = 'no_data_found';
  end if;

  return v_total;
end;
$$;

comment on function sumar_puntos_huesped(uuid, int) is
  'Suma puntos de fidelidad de forma atomica y devuelve el total. Reemplaza un read-then-write que borraba lo acumulado si la lectura fallaba, y que perdia puntos con dos check-outs simultaneos del mismo huesped.';

revoke execute on function sumar_puntos_huesped(uuid, int) from public;
grant execute on function sumar_puntos_huesped(uuid, int) to authenticated, service_role;
