-- 0062 · Los índices que le faltan al listado, y el canal acotado
--
-- Dos cosas chicas y sin relación entre sí más que ser de la misma tabla.

-- ── 1. Índices del listado de reservas ──────────────────────────────────────
--
-- La pantalla más usada del panel (`app/panel/reservas`) ordena por `creada_en`
-- y filtra por `estado`, y **ninguna de las dos columnas tenía índice**. Postgres
-- no indexa nada automáticamente salvo la clave primaria y los `unique`.
--
-- Medido con EXPLAIN (ANALYZE, BUFFERS) sobre 30.000 reservas sembradas:
--
--     SIN índice   Seq Scan + top-N heapsort   2,599 ms   755 páginas
--     CON índice   Index Scan                  0,101 ms    27 páginas
--
--     count(*) sin índice   Seq Scan          1,628 ms
--     count(*) con índice   Index Only Scan   0,439 ms
--
-- 26× en el listado y 3,7× en el conteo que lo acompaña. Hoy, con la tabla casi
-- vacía, no se nota; el costo crece lineal con el histórico y esta consulta corre
-- en **cada carga** de esa pantalla. Se hace ahora porque crear un índice sobre
-- una tabla grande en producción duele bastante más que sobre una vacía.
--
-- El compuesto cubre los tres casos de una sola vez: filtrar por estado, ordenar
-- por fecha, y las dos juntas.

create index reservas_estado_creada_idx on reservas (estado, creada_en desc);

comment on index reservas_estado_creada_idx is
  'Listado principal del panel: filtra por estado y ordena por `creada_en desc`. Medido: 2,6 ms → 0,1 ms sobre 30k filas.';

-- `estadias.tipo_unidad_id` se usa en el filtro por tipo del listado
-- (`app/panel/reservas/consulta.ts`). `unidad_id` ya tenía índice desde la 0034;
-- éste quedó afuera.
create index estadias_tipo_unidad_idx on estadias (tipo_unidad_id);

-- `pagos.estado` lo recorre el reporte de ingresos, que filtra por 'aprobado'
-- sobre la tabla entera.
create index pagos_estado_idx on pagos (estado);

-- ── 2. `reservas.canal` deja de ser texto libre ─────────────────────────────
--
-- La columna nació como `text not null default 'directo'` (0005:19) y su
-- comentario enumera `directo|web|booking|expedia`, pero **no había CHECK**.
--
-- Es la columna por la que agrupa `resumen_canal_mes` (0055) y de la que cuelga
-- toda la conciliación de comisiones. Un typo —«Booking» con mayúscula— crea un
-- canal fantasma que aparece como fila propia en el reporte de rentabilidad y
-- queda fuera de la conciliación. No falla: publica un número incompleto, que es
-- la clase de error que el propio equipo se cuidó de evitar en otros lados.
--
-- Otras 63 columnas del esquema ya usan `text` + `check`; ésta se había quedado
-- sin la segunda mitad.
--
-- La lista es EXACTAMENTE la de `CANALES` en `lib/domain/reservas.ts:38`, que es
-- la fuente de verdad y lo que ofrece el formulario. No se agregan valores «por
-- si acaso»: un CHECK más ancho que el dominio no protege de nada y hace creer
-- que sí.

do $$
declare v_raros text;
begin
  -- Si hay datos que no encajan, se corta con la lista en vez de fallar con un
  -- mensaje genérico a mitad de la migración.
  select string_agg(distinct canal, ', ')
    into v_raros
    from reservas
   where canal not in ('directo', 'web', 'booking', 'expedia');

  if v_raros is not null then
    raise exception 'Hay reservas con canales fuera de la lista: %', v_raros
      using hint = 'Normalizalos a mano o sumalos al CHECK antes de aplicar esta migración.';
  end if;
end $$;

alter table reservas
  add constraint reservas_canal_valido
  check (canal in ('directo', 'web', 'booking', 'expedia'));

comment on constraint reservas_canal_valido on reservas is
  'Sin esto, un typo creaba un canal fantasma en `resumen_canal_mes` y en la conciliación de comisiones, sin fallar. Al sumar un canal nuevo hay que ampliar esta lista y `segmentoDeCanal()` en `lib/domain/reservas.ts`.';
