-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0044 — Una sola clasificación en los consumos
--
-- ── Qué se está arreglando, y que fue error propio ───────────────────────────
--
-- La migración 0040 (paso 7, punto de venta) agregó `consumos.punto`: un texto con
-- check sobre cinco valores —recepción, frigobar, room service, restaurante,
-- excursiones— para saber dónde se vendió cada línea. Su comentario decía que
-- el paso 8 iba a «formalizar la jerarquía departamento/subdepartamento».
--
-- La 0041 (paso 8) hizo exactamente eso: creó `departamentos`, con dos niveles y
-- editable por el hotel, y agregó `consumos.departamento_id`. **Pero no eliminó
-- `punto`.** Quedaron las dos columnas clasificando la misma cosa, y el punto de
-- venta escribiendo ambas.
--
-- Dos clasificaciones para el mismo dato no es un detalle estético: es la
-- condición para que se contradigan. Nada impide hoy una línea con
-- `punto = 'frigobar'` y `departamento_id` apuntando a «Restaurante», y en cuanto
-- eso pase los reportes por sector van a dar dos números distintos según cuál de
-- las dos columnas mire quien los escriba.
--
-- ── Por qué gana `departamento_id` ───────────────────────────────────────────
--
-- · Tiene **jerarquía** (Frigobar → Bebidas), que es lo que pedía el checklist y
--   `punto` no puede representar.
-- · La **puede editar el hotel** sin una migración por cada sector nuevo. `punto`
--   es un `check` en la base: sumar «Spa» pediría una migración.
-- · Es lo que usa la **cuenta del huésped** para agrupar, o sea el consumidor real
--   del dato.
--
-- ── Qué se hace con lo ya cargado ───────────────────────────────────────────
--
-- Se rellena `departamento_id` en las filas que lo tengan nulo, derivándolo de
-- `punto`. No al revés: `punto` es el que se va.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Correspondencia de los cinco valores de `punto` a departamentos ──────────
-- Room service es subdepartamento de Alimentos y bebidas; recepción no tiene
-- departamento propio y cae en «Otros», que es donde iba de todos modos.
update consumos c
   set departamento_id = d.id
  from departamentos d
 where c.departamento_id is null
   and d.codigo = case c.punto
                    when 'frigobar'     then 'FRI-BEB'
                    when 'room_service' then 'AYB-RS'
                    when 'restaurante'  then 'AYB-REST'
                    when 'excursiones'  then 'EXC-GLA'
                    else 'OTR'
                  end;

-- ── Se va la columna redundante ──────────────────────────────────────────────
-- Con ella se van también su índice y su restricción `check`. No queda nada que
-- pueda contradecir a `departamento_id`.
drop index if exists consumos_punto_fecha_idx;

alter table consumos drop column punto;

-- El índice equivalente, ahora sobre la clasificación que quedó. Cubre la consulta
-- de los reportes por sector y por período.
create index consumos_departamento_fecha_idx on consumos (departamento_id, fecha desc);

comment on column consumos.departamento_id is
  'Departamento o subdepartamento al momento de la venta. Se copia, no se deriva: la línea cobrada no puede cambiar de sector después. ÚNICA clasificación (la 0044 eliminó `punto`, que era redundante).';
