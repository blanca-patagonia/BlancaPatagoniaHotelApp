-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0076 — Notas de crédito
-- (Bloque D de la auditoría 2026-09, defecto P0-5)
--
-- ── El problema ──────────────────────────────────────────────────────────────
--
-- Una factura mal emitida **no tenía ningún camino de corrección**. Tres cosas se
-- combinaban para eso:
--
--   · `facturas` es inmutable desde la 0034 (`revoke update, delete`).
--   · Es una por reserva desde la 0045 (`facturas_una_por_reserva`).
--   · El enum `tipo_comprobante` sólo tenía `A`, `B` y `C`: no existía la nota de
--     crédito, ni tabla, ni acción, ni pantalla.
--
-- Con el simulador es un inconveniente. Con CAE real es un problema fiscal: el
-- comprobante ya está informado a ARCA y la única forma de anularlo o corregirlo
-- es emitir una nota de crédito. Sin eso, un error de importe queda para siempre.
--
-- ── Por qué una tabla nueva y no una fila más en `facturas` ──────────────────
--
-- Por `facturas_una_por_reserva`: una segunda fila sobre la misma reserva no
-- entra, y relajar esa restricción reabriría la doble facturación que la 0045
-- vino a cerrar. Además una nota de crédito **no es una factura**: no salda la
-- cuenta, la revierte; y una factura puede tener varias.
--
-- ── Numeración ──────────────────────────────────────────────────────────────
--
-- ⚠️ Deuda conocida que esta migración NO resuelve: ARCA exige una secuencia por
-- **(punto de venta, tipo de comprobante)**, y el sistema tiene un único contador
-- por punto de venta (`puntos_venta.ultimo_numero`, migración 0025) compartido
-- por A, B y C. Acá se agrega un segundo contador para las notas —así al menos no
-- colisionan con las facturas— pero al enchufar WSFEv1 de verdad hay que partirlo
-- por tipo. Queda anotado en `docs/PENDIENTES.md`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table puntos_venta
  add column if not exists ultimo_nc int not null default 0;

comment on column puntos_venta.ultimo_nc is
  'Correlativo de notas de crédito, separado del de facturas. ⚠️ ARCA pide una secuencia por (PV, tipo): esto es una aproximación, ver el encabezado de la 0076.';

create table notas_credito (
  id                uuid primary key default gen_random_uuid(),

  -- Qué comprobante corrige. `restrict` y no `cascade`: una nota de crédito es un
  -- documento fiscal por derecho propio y no puede desaparecer porque alguien
  -- borre la factura.
  factura_id        uuid not null references facturas(id) on delete restrict,

  numero            text not null unique
                    default ('NC-' || to_char(now(), 'YYYYMMDD') || '-' ||
                             upper(substr(md5(random()::text), 1, 4))),

  /*
    La letra la hereda de la factura, no se elige.

    Una nota de crédito que corrige una factura A es una NC-A. Dejarlo a criterio
    de quien la emite es exactamente el error que después hay que corregir con
    otra nota. Lo impone el trigger de más abajo.
  */
  tipo_comprobante  tipo_comprobante not null,
  punto_venta       int,

  total             numeric(12,2) not null check (total > 0),
  neto              numeric(12,2),
  iva               numeric(12,2),
  alicuota_iva      numeric(5,2) not null default 21,
  exento            numeric(12,2) not null default 0,
  moneda            character(3) not null default 'USD',

  -- Sin motivo no se emite. Una nota de crédito sin explicación es un agujero en
  -- la contabilidad que después nadie puede reconstruir.
  motivo            text not null check (length(btrim(motivo)) >= 5),

  cae               text,
  cae_vto           date,
  numero_fiscal     text,
  cae_solicitado_en timestamptz,

  emitida_por       uuid references perfiles(id) on delete set null,
  emitida_en        timestamptz not null default now(),

  constraint notas_credito_cae_completo check ((cae is null) = (cae_vto is null))
);

comment on table notas_credito is
  'Notas de crédito. El único camino de corrección de una factura, que es inmutable (0034). Ver el encabezado de la 0076.';

create unique index notas_credito_numero_fiscal_idx
  on notas_credito (numero_fiscal) where numero_fiscal is not null;
create index notas_credito_factura_idx    on notas_credito (factura_id);
create index notas_credito_emitida_por_idx on notas_credito (emitida_por);

-- ── La letra sigue a la factura ──────────────────────────────────────────────
create or replace function nota_credito_hereda_letra()
returns trigger
language plpgsql
as $$
declare
  v_tipo tipo_comprobante;
begin
  select tipo_comprobante into v_tipo from facturas where id = new.factura_id;

  -- Una factura sin letra es del simulador viejo: se acepta lo que venga.
  if v_tipo is null then return new; end if;

  if new.tipo_comprobante is distinct from v_tipo then
    raise exception
      'La nota de crédito de una factura % tiene que ser %, y se pidió %.',
      v_tipo, v_tipo, new.tipo_comprobante
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger notas_credito_hereda_letra
  before insert on notas_credito
  for each row execute function nota_credito_hereda_letra();

-- ── No se puede acreditar más de lo facturado ────────────────────────────────
/*
  La regla fiscal que más caro sale si falta: la suma de las notas de crédito de
  una factura no puede superar su total. Si lo superara, el hotel estaría
  devolviendo IVA que nunca cobró.

  Va en la base y no en la aplicación por lo de siempre en este proyecto: dos
  emisiones simultáneas leerían el mismo total acumulado y las dos pasarían la
  comprobación. Acá se bloquea la fila de la factura primero.
*/
create or replace function nota_credito_no_supera_factura()
returns trigger
language plpgsql
as $$
declare
  v_total     numeric(12,2);
  v_acreditado numeric(12,2);
begin
  -- `for update` serializa contra otra emisión sobre la misma factura.
  select total into v_total from facturas where id = new.factura_id for update;
  if v_total is null then
    raise exception 'No existe la factura %.', new.factura_id using errcode = 'foreign_key_violation';
  end if;

  select coalesce(sum(total), 0) into v_acreditado
    from notas_credito where factura_id = new.factura_id;

  if v_acreditado + new.total > v_total + 0.001 then
    raise exception
      'Las notas de crédito de esta factura suman % y la factura es de %: no se puede acreditar de más.',
      v_acreditado + new.total, v_total
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger notas_credito_no_supera_factura
  before insert on notas_credito
  for each row execute function nota_credito_no_supera_factura();

-- ── Correlativo propio ───────────────────────────────────────────────────────
create or replace function siguiente_numero_nota_credito(p_punto_venta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero int;
begin
  -- Mismo patrón que `siguiente_numero_comprobante` (0025/0033): SECURITY DEFINER
  -- porque `authenticated` no tiene UPDATE sobre `puntos_venta`, y ése es el
  -- único camino permitido para mover el contador.
  update puntos_venta
     set ultimo_nc = ultimo_nc + 1
   where numero = p_punto_venta
  returning ultimo_nc into v_numero;

  if v_numero is null then
    raise exception 'No existe el punto de venta %.', p_punto_venta;
  end if;
  return v_numero;
end;
$$;

comment on function siguiente_numero_nota_credito(int) is
  'Avanza y devuelve el correlativo de notas de crédito del punto de venta. Separado del de facturas para que no colisionen.';

revoke execute on function siguiente_numero_nota_credito(int) from public, anon;
grant execute on function siguiente_numero_nota_credito(int) to authenticated, service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table notas_credito enable row level security;

-- Misma línea que `facturas`: la ve quien factura.
create policy "notas_credito: el staff que factura las lee"
  on notas_credito for select
  using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

create policy "notas_credito: admin y gerencia emiten"
  on notas_credito for insert
  with check (rol_actual() in ('admin', 'gerencia'));

/*
  Inmutable, igual que `facturas` (0034).

  Una nota de crédito con CAE ya está informada a ARCA: corregirla se hace con
  otro comprobante, no con un `update`. Y borrarla dejaría un hueco en la
  correlatividad.
*/
revoke update, delete on notas_credito from authenticated;
revoke select, insert, update, delete on notas_credito from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- La letra no se puede cambiar:
--   insert into notas_credito (factura_id, tipo_comprobante, total, motivo)
--   values ('<id de una factura A>', 'B', 1, 'prueba');   -- check_violation
--
--   -- No se puede acreditar de más:
--   insert into notas_credito (factura_id, tipo_comprobante, total, motivo)
--   values ('<factura de 100>', 'A', 101, 'prueba');      -- check_violation
--
--   select has_table_privilege('anon','notas_credito','select');       -- f
--   select has_table_privilege('authenticated','notas_credito','update'); -- f
