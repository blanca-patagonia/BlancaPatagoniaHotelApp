-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0055 — Rentabilidad por canal, agregada en la base
--
-- ── Las dos cosas que resuelve ──────────────────────────────────────────────
--
-- 1. **La pregunta que el sistema no podía responder.** El «ranking de canales» de
--    reportes suma `reservas.total` —bruto y con IVA— como si fuera lo que le queda al
--    hotel. La comisión, que desde la 0049 se devenga por reserva, no entraba en
--    ningún cálculo. Con eso no se puede decidir si el canal conviene.
--
-- 2. **La truncación silenciosa.** La pantalla lee las reservas y agrega en memoria,
--    y PostgREST corta en 1000 filas sin avisar (`max_rows`). Hoy hay un aviso que
--    dice «estos indicadores están calculados sobre una parte del historial», y el
--    propio comentario del código pide pasar la agregación a la base. Esto es eso.
--
-- ── Por qué se imputa por la fecha de SALIDA ────────────────────────────────
--
-- La comisión se devenga cuando se consume la estadía, y es el criterio con el que el
-- canal factura el mes siguiente. Imputar por la entrada desalinearía nuestro mes
-- contra su factura, que es justamente lo que hay que poder cotejar.
--
-- `canal_config.imputa_por` existe para poder cambiarlo, pero una vista no se puede
-- parametrizar: la vista usa la salida —el default— y si algún día el hotel necesita
-- la otra, se agrega una segunda vista en vez de complicar ésta.
--
-- ── Por qué las canceladas y los no-show quedan fuera del importe ───────────
--
-- Mismo criterio que el ranking que ya existe: son reservas que no se vendieron. Se
-- siguen contando en `reservas_totales` —el volumen que entró por el canal es
-- información— pero no suman al bruto.
--
-- ⚠️ **`comision_informada` NO es la comisión de todas las reservas.** Es la suma de
-- las que informaron una. Las que no —el feed iCal nunca informa comisión— se cuentan
-- en `sin_comision_informada`, y quien lea esta vista tiene que tratar el neto como un
-- **piso** mientras ese número sea mayor que cero. Sumar cero por las que faltan
-- afirmaría que el canal no cobró nada por ellas, que es falso.
-- ─────────────────────────────────────────────────────────────────────────────

create view resumen_canal_mes
with (security_invoker = true) as
with reservas_con_estadia as (
  select r.id,
         r.canal,
         r.estado,
         r.total,
         e.check_in,
         e.check_out,
         (e.check_out - e.check_in) as noches
    from reservas r
    join estadias e on e.reserva_id = r.id
),
comision_por_reserva as (
  -- Solo el devengo del informe: la línea de la factura mensual (`factura_comision`)
  -- se compara CONTRA esto, así que sumarlas juntas contaría la comisión dos veces.
  select reserva_id, sum(monto) as comision
    from canal_cargos
   where concepto = 'comision'
     and origen = 'informe_reservas'
     and reserva_id is not null
   group by reserva_id
)
select rce.canal,
       date_trunc('month', rce.check_out)::date as mes,

       count(*)                                             as reservas_totales,
       count(*) filter (where rce.estado not in ('cancelada', 'no_show'))
                                                            as reservas_vendidas,

       -- Solo lo vendido suma al importe.
       coalesce(sum(rce.total)   filter (where rce.estado not in ('cancelada', 'no_show')), 0)
                                                            as bruto,
       coalesce(sum(rce.noches)  filter (where rce.estado not in ('cancelada', 'no_show')), 0)
                                                            as noches,

       coalesce(sum(cpr.comision) filter (where rce.estado not in ('cancelada', 'no_show')), 0)
                                                            as comision_informada,

       -- Las que no informaron comisión. Mientras sea > 0, el neto es un piso.
       count(*) filter (
         where rce.estado not in ('cancelada', 'no_show')
           and cpr.comision is null
       )                                                    as sin_comision_informada

  from reservas_con_estadia rce
  left join comision_por_reserva cpr on cpr.reserva_id = rce.id
 group by rce.canal, date_trunc('month', rce.check_out);

comment on view resumen_canal_mes is
  'Rentabilidad por canal y mes, agregada en la base para no depender del limite de 1000 filas de PostgREST. Imputa por fecha de SALIDA, que es cuando se consume la estadia y con que criterio factura el canal. `sin_comision_informada` > 0 significa que el neto es un piso, no un dato cerrado.';

-- La 0006 dejó `alter default privileges ... grant select on tables to anon`, y una
-- vista hereda ese default igual que una tabla. Acá importa: revela cuánto vende el
-- hotel por canal y cuánto paga de comisión.
revoke select on resumen_canal_mes from anon;
grant select on resumen_canal_mes to authenticated, service_role;

-- Índices de apoyo. La vista agrupa por `check_out`, que es una columna GENERADA desde
-- `periodo` (migración 0037) y por lo tanto indexable.
create index if not exists estadias_check_out_idx on estadias (check_out);
create index if not exists reservas_canal_idx on reservas (canal);
