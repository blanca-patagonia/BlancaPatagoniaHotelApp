-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0042 — Piso y bloque de las unidades
-- (Modernización WinPAX, paso 10)
--
-- ── Por qué hacen falta ──────────────────────────────────────────────────────
--
-- La grilla de ocupación de WinPAX filtraba por piso y por bloque, y `unidades` no
-- tiene ninguno de los dos: sólo `nombre`, `estado`, `activo` y `asignada_a`.
--
-- No es un filtro cosmético. En Blanca Patagonia hay dos cosas físicamente
-- separadas —la hostería y las cabañas— y dentro de la hostería, plantas distintas.
-- Eso decide dos operaciones concretas:
--
--  1. **El recorrido de limpieza.** Una mucama hace un piso, no unidades salteadas
--     por todo el predio. Sin el dato, el orden de trabajo sale del nombre de la
--     habitación y funciona por casualidad.
--  2. **La asignación por accesibilidad.** «Planta baja» es un pedido corriente de
--     huéspedes con movilidad reducida, y hoy hay que sabérselo de memoria.
--
-- ── Por qué son texto y no números ni enums ──────────────────────────────────
--
-- `piso` es texto porque no siempre es un número: «PB», «Entrepiso», «Altillo». Un
-- `int` obligaría a codificar la planta baja como 0 y a traducirlo en cada pantalla.
--
-- `bloque` es texto por lo mismo y además porque el conjunto lo define el hotel
-- («Hostería», «Cabañas del bosque», «Cabañas del lago»). Un enum exigiría una
-- migración cada vez que se agregue un sector — y la trampa del SQLSTATE 55P04 de
-- por medio.
--
-- Ambos admiten cadena vacía, que significa «no cargado». No se usa `null` para que
-- las comparaciones y los `order by` no tengan que tratar el caso aparte.
-- ─────────────────────────────────────────────────────────────────────────────

alter table unidades
  add column piso text not null default '',
  add column bloque text not null default '',
  -- Orden dentro del piso, para que el recorrido de limpieza siga el pasillo y no
  -- el orden alfabético del nombre (donde «10» va antes que «9»).
  add column orden int not null default 0;

comment on column unidades.piso is
  'Planta. Texto porque no siempre es número: «PB», «1», «Entrepiso». Vacío = no cargado.';
comment on column unidades.bloque is
  'Sector o edificio («Hostería», «Cabañas»). Texto y no enum: el conjunto lo define el hotel y cambiaría con cada sector nuevo.';
comment on column unidades.orden is
  'Orden dentro del piso, para el recorrido de limpieza. El alfabético pone «10» antes que «9».';

-- La grilla filtra por bloque y piso, y ordena por el recorrido.
create index unidades_bloque_piso_idx on unidades (bloque, piso, orden);

-- ── Clasificación inicial de lo que ya existe ───────────────────────────────
-- Se deriva de la categoría del tipo de unidad, que es el único dato disponible.
-- No se inventa el piso: queda vacío y la pantalla lo muestra como «sin asignar»,
-- que es honesto. Poner «1» en todas sería un dato falso que nadie corregiría
-- porque parecería cargado.
update unidades u
   set bloque = case t.categoria
                  when 'cabana' then 'Cabañas'
                  else 'Hostería'
                end
  from tipos_unidad t
 where t.id = u.tipo_unidad_id
   and u.bloque = '';
