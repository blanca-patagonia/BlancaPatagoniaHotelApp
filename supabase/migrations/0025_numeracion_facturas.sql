-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0025 — Numeración correlativa de comprobantes (Fase 12)
--
-- La emisión venía numerando con `count(*) + 1` desde la aplicación. Eso tiene
-- una condición de carrera: dos emisiones simultáneas leen el mismo total y
-- generan el MISMO número. El índice único hace fallar a una de las dos, pero
-- la correlatividad por punto de venta es una obligación formal de AFIP y no
-- puede depender de que no haya concurrencia.
--
-- Se resuelve con un contador por punto de venta, incrementado dentro de la
-- transacción con un bloqueo de fila.
-- ─────────────────────────────────────────────────────────────────────────────

create table puntos_venta (
  numero        int         primary key,
  descripcion   text        not null default '',
  ultimo_numero int         not null default 0 check (ultimo_numero >= 0),
  activo        boolean     not null default true,
  creado_en     timestamptz not null default now()
);

comment on table puntos_venta is
  'Puntos de venta habilitados y su último número emitido (correlatividad AFIP).';
comment on column puntos_venta.ultimo_numero is
  'Último comprobante emitido. Lo incrementa `siguiente_numero_comprobante()`.';

-- El hotel opera hoy con un único punto de venta.
insert into puntos_venta (numero, descripcion) values (1, 'Recepción');

/*
  Devuelve el número siguiente para un punto de venta, reservándolo.

  `update ... returning` toma un bloqueo de fila: si dos emisiones ocurren a la
  vez, la segunda espera y recibe el número siguiente, nunca el mismo. Es la
  forma correcta de generar correlativos sin huecos.

  No se usa una `sequence` de Postgres a propósito: las secuencias NO se
  revierten al hacer rollback, así que una transacción fallida dejaría un hueco
  en la numeración, y los huecos también son observados por AFIP.
*/
create or replace function siguiente_numero_comprobante(p_punto_venta int)
returns int
language plpgsql
as $$
declare
  v_numero int;
begin
  update puntos_venta
  set ultimo_numero = ultimo_numero + 1
  where numero = p_punto_venta and activo
  returning ultimo_numero into v_numero;

  if v_numero is null then
    raise exception 'El punto de venta % no existe o está inactivo', p_punto_venta;
  end if;

  return v_numero;
end;
$$;

comment on function siguiente_numero_comprobante(int) is
  'Reserva el próximo número correlativo del punto de venta, con bloqueo de fila.';

grant execute on function siguiente_numero_comprobante(int) to authenticated, service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table puntos_venta enable row level security;

create policy "puntos_venta: staff lee" on puntos_venta
  for select using (rol_actual() is not null);
create policy "puntos_venta: admin gestiona" on puntos_venta
  for all using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- El contador solo se toca a través de la función, que corre con los permisos
-- de quien la invoca pero encapsula el incremento correcto.
revoke update on puntos_venta from authenticated;

-- Alinea el contador con lo ya emitido, para no repetir números si la base
-- viene con facturas cargadas.
update puntos_venta pv
set ultimo_numero = coalesce(
  (select count(*) from facturas f where f.punto_venta = pv.numero), 0
);
