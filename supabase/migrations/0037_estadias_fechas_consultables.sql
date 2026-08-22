-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0037 — Fechas de la estadía consultables (Modernización WinPAX, paso 3)
--
-- ── El problema ──────────────────────────────────────────────────────────────
--
-- WinPAX tenía filtros rápidos que son el día a día de recepción: «en el hotel»,
-- «llegadas hoy», «salidas hoy». Los dos últimos no se podían escribir contra
-- esta base.
--
-- `estadias.periodo` es un `daterange` `[check_in, check_out)`, y eso es correcto:
-- es lo que hace posible la restricción de exclusión GiST del ADR 0002, que es la
-- garantía anti-overbooking del sistema. Pero PostgREST no expone `lower()` ni
-- `upper()`, así que «las estadías que empiezan hoy» había que escribirlo
-- combinando operadores de rango negados:
--
--     periodo=nxl.[hoy,hoy] & periodo=not.nxl.[mañana,mañana]
--
-- Eso funciona y es ilegible. Nadie que lea la consulta dentro de seis meses va a
-- saber que dice «llega hoy», y un signo cambiado da un resultado plausible pero
-- equivocado, que es la peor clase de error en un filtro operativo.
--
-- ── La solución ──────────────────────────────────────────────────────────────
--
-- Dos columnas **generadas** que exponen los extremos del rango como fechas
-- planas. No son datos nuevos: son el mismo dato que ya está en `periodo`, en un
-- formato que se puede filtrar e indexar.
--
-- Por qué generadas y no columnas comunes mantenidas por trigger: `generated
-- always as ... stored` las calcula Postgres y **no se pueden escribir**. Así es
-- imposible que se desincronicen de `periodo`, que sigue siendo la única fuente
-- de verdad. Un trigger, en cambio, se puede olvidar en un `update` futuro y
-- dejar `check_in` diciendo una cosa y el rango otra.
--
-- ── Qué NO cambia ────────────────────────────────────────────────────────────
--
-- · `periodo` sigue siendo la fuente de verdad y no se toca.
-- · La restricción `estadias_sin_solape` (ADR 0002) opera sobre `periodo` y queda
--   intacta: agregar columnas no la afecta.
-- · Las políticas RLS de `estadias` no cambian.
-- · Nada que inserte en `estadias` se rompe: las cuatro escrituras del sistema
--   (`crear_reserva` en 0007, la mudanza de 0028 y dos en los tests) usan listas
--   de columnas explícitas, y una columna generada no admite valor de todos modos.
-- · Ninguna consulta hace `select *` sobre `estadias`, así que no aparecen
--   columnas inesperadas en ningún resultado.
-- ─────────────────────────────────────────────────────────────────────────────

alter table estadias
  add column check_in  date generated always as (lower(periodo))  stored,
  add column check_out date generated always as (upper(periodo)) stored;

comment on column estadias.check_in is
  'Fecha de entrada. Columna GENERADA desde `periodo`: no se escribe, no puede desincronizarse.';
comment on column estadias.check_out is
  'Fecha de salida (excluida del período: esa noche la unidad está libre). Columna GENERADA.';

-- Índices para los filtros operativos. Compuestos con `estado` porque los
-- toggles siempre combinan las dos cosas: «llegadas de hoy» son las de hoy que
-- además están activas, no las canceladas.
create index estadias_estado_check_in_idx  on estadias (estado, check_in);
create index estadias_estado_check_out_idx on estadias (estado, check_out);
