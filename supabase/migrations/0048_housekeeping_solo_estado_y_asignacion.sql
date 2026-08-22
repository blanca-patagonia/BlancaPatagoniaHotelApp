-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0048 — Housekeeping toca el estado de una unidad, no el inventario
--
-- Hallazgo de la auditoría de escritura (`tests/rls-escritura-por-rol.test.ts`).
--
-- ── Qué encontró ────────────────────────────────────────────────────────────
--
-- La política de la unidad dice, entera:
--
--     create policy "unidades: housekeeping actualiza" on unidades
--       for update using (rol_actual() = 'housekeeping')
--                  with check (rol_actual() = 'housekeeping');
--
-- **RLS filtra filas, no columnas.** Así que eso no autoriza «marcar limpia»:
-- autoriza cualquier `update` sobre cualquier columna de la tabla. Verificado
-- contra la base local, con una sesión de rol `housekeeping`:
--
--     tipo_unidad_id → cambiado    (de ahí salen la capacidad y la tarifa)
--     activo         → false       (la unidad deja de venderse)
--     nombre         → cambiado
--     piso           → cambiado
--
-- Reclasificar una single como suite cambia lo que el sistema cobra, y
-- `activo = false` la saca de la disponibilidad.
--
-- ── Por qué no es teórico ───────────────────────────────────────────────────
--
-- La app nunca escribe esas columnas desde el área de housekeeping: sus dos
-- acciones ponen `estado` y `asignada_a`, y nada más. Pero PostgREST está expuesto
-- al navegador —la clave publicable viaja en el cliente— así que cualquiera con una
-- sesión válida manda un `PATCH /rest/v1/unidades?id=eq.X` sin pasar por ninguna
-- pantalla ni por ninguna Server Action. Lo que se puede escribir lo decide la
-- política, no el formulario.
--
-- ── Por qué un trigger y no una política ────────────────────────────────────
--
-- Porque no hay forma de hacerlo con RLS:
--
-- 1. RLS no distingue columnas. `using` y `with check` evalúan la **fila**.
-- 2. `with check` no puede mirar la fila vieja: no hay `old` en una política, así
--    que no se puede expresar «que esta columna no haya cambiado».
-- 3. Los `grant` de columna (`grant update (estado) on unidades to …`) sí acotan
--    columnas, pero se conceden al rol de **Postgres**, y en Supabase todo el que
--    inicia sesión es `authenticated`. Acotar ahí acotaría también a admin y a
--    gerencia, que sí tienen que poder editar el inventario.
--
-- El trigger es el único lugar donde se ven `old` y `new` a la vez y donde
-- `rol_actual()` sigue diciendo quién es la persona.
--
-- ── Por qué la lista es de columnas PERMITIDAS ──────────────────────────────
--
-- La comprobación no enumera lo prohibido, sino que compara la fila entera menos
-- las dos columnas permitidas. La diferencia importa para el futuro: con una lista
-- de prohibidas, la columna que alguien agregue el mes que viene nace **escribible**
-- por housekeeping y nadie se enteraría. Así nace protegida, y para abrirla hay que
-- venir a este archivo a decirlo.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function unidades_housekeeping_solo_operacion()
returns trigger
language plpgsql
-- `security invoker` (la omisión) a propósito: el trigger tiene que evaluarse con la
-- identidad de quien escribe. `rol_actual()` sale del JWT y no de `current_user`, así
-- que funcionaría igual como definer, pero pedir privilegios que no hacen falta es
-- justamente lo que el ADR 0016 dejó anotado que no se hace.
set search_path = public
as $$
begin
  -- Solo aplica a housekeeping. Admin y gerencia escriben por la política `all`, y
  -- `service_role` no tiene perfil: para los dos `rol_actual()` no es 'housekeeping'
  -- y el trigger no se interpone.
  if rol_actual() is distinct from 'housekeeping' then
    return new;
  end if;

  -- `to_jsonb(fila) - 'columna'` quita la clave del objeto. Si lo que queda difiere,
  -- cambió algo que no era ni el estado ni la asignación.
  if (to_jsonb(new) - 'estado' - 'asignada_a')
     is distinct from
     (to_jsonb(old) - 'estado' - 'asignada_a')
  then
    raise exception
      'Housekeeping puede cambiar el estado de limpieza y la asignación, no los datos de la unidad'
      using errcode = '42501',
            hint = 'El inventario (tipo, nombre, activo, piso, bloque, orden) lo edita administración o gerencia.';
  end if;

  return new;
end;
$$;

comment on function unidades_housekeeping_solo_operacion() is
  'Acota el update de housekeeping sobre unidades a estado y asignada_a. Existe porque RLS filtra filas y no columnas, y `with check` no puede mirar la fila vieja (ver 0048).';

create trigger unidades_housekeeping_solo_operacion
  before update on unidades
  for each row
  execute function unidades_housekeeping_solo_operacion();

comment on trigger unidades_housekeeping_solo_operacion on unidades is
  'Hallazgo de la auditoría de escritura: la política de housekeeping autorizaba cualquier columna, incluidos tipo_unidad_id y activo.';
