-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0041 — Folios, departamentos y split de cuenta
-- (Modernización WinPAX, paso 8)
--
-- ── Cómo se esquivó la trampa del enum ───────────────────────────────────────
--
-- El plan decía que este paso iba a exigir DOS migraciones, porque tocar el enum
-- `categoria_producto` choca con el SQLSTATE 55P04: `alter type ... add value` y
-- el primer uso de ese valor no pueden ir en el mismo archivo (es lo que le pasó a
-- la 0032 y por eso existe la 0035).
--
-- **No hace falta tocar el enum.** El departamento/subdepartamento de WinPAX es
-- una **jerarquía**, y un enum plano de cinco valores no puede representarla por
-- más valores que se le agreguen. Va en una tabla, que además:
--
--  · la puede editar el hotel sin una migración por cada sector nuevo;
--  · admite dos niveles de verdad (Frigobar → Bebidas, Frigobar → Snacks);
--  · deja el enum `categoria_producto` intacto, así que nada de lo existente se
--    rompe y esta migración es una sola.
--
-- ── Qué es un folio y por qué hacen falta dos ────────────────────────────────
--
-- Un folio es una cuenta dentro de la estadía. Hacen falta dos porque el caso es
-- corriente: el huésped viene por una empresa que paga la habitación, y él paga
-- sus consumos. Con una sola cuenta hay que emitir una factura y después pedirle
-- al huésped que le devuelva la mitad a la empresa.
--
--  · **Folio A** — lo que paga el titular de la reserva.
--  · **Folio B** — lo que paga un tercero (empresa, agencia, acompañante).
--
-- El «split» es mover cargos de un folio al otro. Dos folios alcanzan para el caso
-- real del hotel; agregar C, D y E sería complejidad sin demanda.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Departamentos (jerarquía de dos niveles) ─────────────────────────────────
create table departamentos (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,
  nombre    text not null,
  -- Nulo = es un departamento; con valor = es un subdepartamento.
  padre_id  uuid references departamentos (id) on delete restrict,
  -- Orden de presentación en la cuenta y en el POS.
  orden     int  not null default 100,
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),

  -- Se frena la jerarquía en dos niveles a propósito. Un árbol de profundidad
  -- arbitraria obligaría a consultas recursivas en la pantalla de la cuenta, y el
  -- hotel no tiene ninguna estructura que lo necesite: WinPAX tampoco iba más allá.
  constraint departamentos_no_es_su_propio_padre check (id <> padre_id)
);

comment on table departamentos is
  'Departamentos y subdepartamentos de venta. Jerarquía de DOS niveles: padre_id nulo = departamento.';
comment on column departamentos.padre_id is
  'Nulo en un departamento; apunta al departamento en un subdepartamento. No se anidan más niveles.';

create index on departamentos (padre_id, orden);

-- El segundo nivel es el último: un subdepartamento no puede tener hijos. Se
-- verifica con un trigger porque un `check` no puede consultar otras filas.
create or replace function departamentos_dos_niveles()
returns trigger language plpgsql as $$
begin
  if new.padre_id is not null then
    if exists (select 1 from departamentos where id = new.padre_id and padre_id is not null) then
      raise exception 'Un subdepartamento no puede tener hijos: la jerarquía es de dos niveles'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger departamentos_limite_jerarquia
  before insert or update of padre_id on departamentos
  for each row execute function departamentos_dos_niveles();

alter table departamentos enable row level security;

create policy "departamentos: staff lee" on departamentos
  for select using (rol_actual() is not null);
create policy "departamentos: admin/gerencia gestionan" on departamentos
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- Catálogo inicial, alineado con las categorías que ya existen para que nada
-- quede sin clasificar.
insert into departamentos (codigo, nombre, orden) values
  ('ALOJ', 'Alojamiento',  10),
  ('AYB',  'Alimentos y bebidas', 20),
  ('FRI',  'Frigobar',     30),
  ('EXC',  'Excursiones',  40),
  ('TRA',  'Traslados',    50),
  ('OTR',  'Otros',        90);

insert into departamentos (codigo, nombre, padre_id, orden)
select v.codigo, v.nombre, d.id, v.orden
from (values
  ('AYB-DES',  'Desayuno',        'AYB', 10),
  ('AYB-REST', 'Restaurante',     'AYB', 20),
  ('AYB-RS',   'Room service',    'AYB', 30),
  ('FRI-BEB',  'Bebidas',         'FRI', 10),
  ('FRI-SNK',  'Snacks',          'FRI', 20),
  ('EXC-GLA',  'Glaciares',       'EXC', 10),
  ('EXC-TREK', 'Trekking',        'EXC', 20),
  ('TRA-AER',  'Aeropuerto',      'TRA', 10)
) as v(codigo, nombre, padre, orden)
join departamentos d on d.codigo = v.padre;

-- ── Productos: a qué departamento pertenecen ─────────────────────────────────
alter table productos_servicios
  add column departamento_id uuid references departamentos (id);

comment on column productos_servicios.departamento_id is
  'Departamento o subdepartamento que lo vende. Nulo = sin clasificar; la cuenta lo agrupa en «Otros».';

create index on productos_servicios (departamento_id);

-- Se clasifica lo que ya existe según su categoría, para que ninguna línea vieja
-- aparezca sin departamento en la cuenta.
update productos_servicios p
   set departamento_id = d.id
  from departamentos d
 where d.codigo = case p.categoria
                    when 'desayuno'  then 'AYB-DES'
                    when 'frigobar'  then 'FRI-BEB'
                    when 'excursion' then 'EXC-GLA'
                    when 'traslado'  then 'TRA-AER'
                    else 'OTR'
                  end;

-- ── Folios y detalle fiscal en los consumos ──────────────────────────────────
alter table consumos
  -- Folio al que se carga. `A` por omisión: es el del titular, y es lo que era
  -- todo lo cargado hasta ahora.
  add column folio char(1) not null default 'A' check (folio in ('A', 'B')),
  -- Número de comprobante externo, si hay (ticket del restaurante, voucher de la
  -- excursión). WinPAX lo mostraba en la línea de la cuenta.
  add column comprobante text not null default '',
  -- Departamento de la línea. Se copia del producto al cargar y NO se deriva en la
  -- consulta: si mañana el producto cambia de departamento, la línea ya cobrada
  -- tiene que seguir diciendo dónde se vendió.
  add column departamento_id uuid references departamentos (id),

  -- ── Cargos en otra moneda ──────────────────────────────────────────────────
  -- `precio_unitario` sigue siendo SIEMPRE en USD, que es la moneda base del
  -- dominio (ADR 0003). Estas dos columnas registran en qué moneda se cobró de
  -- verdad y a qué cotización, que es lo que pide la trazabilidad del ADR 0003
  -- («los comprobantes deben registrar la cotización usada el día de pago»).
  --
  -- Nulas significa «se cobró en USD», que es el caso normal.
  add column moneda_origen char(3),
  add column importe_origen numeric(12, 2),
  add column cotizacion_usada numeric(14, 4);

comment on column consumos.folio is
  'Folio al que se carga: A = titular, B = tercero (empresa, agencia). El split mueve líneas entre folios.';
comment on column consumos.departamento_id is
  'Departamento al momento de la venta. Se copia, no se deriva: la línea cobrada no puede cambiar de sector después.';
comment on column consumos.moneda_origen is
  'Moneda en que se cobró, si no fue USD. `precio_unitario` está SIEMPRE en USD (ADR 0003).';
comment on column consumos.cotizacion_usada is
  'Cotización aplicada para convertir a USD. Exigencia de trazabilidad del ADR 0003.';

create index on consumos (reserva_id, folio);

-- ── Folio del alojamiento ────────────────────────────────────────────────────
-- El cargo por alojamiento no es una fila de `consumos`: sale de `reservas.total`.
-- Para poder ponerlo en el folio B —el caso típico, la empresa paga la habitación
-- y el huésped sus consumos— hace falta decir a qué folio pertenece.
alter table reservas
  add column folio_alojamiento char(1) not null default 'A'
    check (folio_alojamiento in ('A', 'B'));

comment on column reservas.folio_alojamiento is
  'Folio que paga el alojamiento. Separarlo de los consumos es el caso típico: la empresa paga la habitación, el huésped sus extras.';

-- ── Titular del folio B ──────────────────────────────────────────────────────
-- Sin esto el folio B es una cuenta sin dueño, y al facturarla no habría a nombre
-- de quién emitirla.
alter table reservas
  add column folio_b_titular text not null default '',
  add column folio_b_agencia_id uuid references agencias (id);

comment on column reservas.folio_b_titular is
  'A nombre de quién se factura el folio B, si es un tercero sin cuenta de agencia.';
