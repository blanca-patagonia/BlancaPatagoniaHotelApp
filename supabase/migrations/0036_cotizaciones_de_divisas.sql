-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0036 — Cotizaciones de divisas (Modernización WinPAX, paso 1)
--
-- Cierra la tarea que el ADR 0003 dejó abierta en julio. Ese ADR decidió que
-- todos los importes se guardan en USD y que el peso es una capa de
-- presentación con «cotización configurable», y terminó anotando: «Hace falta un
-- mecanismo para cargar/actualizar la cotización (Fase 3/4)». Nunca se hizo, así
-- que hasta ahora el sistema no sabía convertir nada: el Tarifario manda cobrar
-- a «la cotización oficial de venta billete del Banco Nación del día de pago» y
-- ese número no existía en ninguna parte del código.
--
-- ⚠️ No confundir con `0008_cotizacion.sql`, que **cotiza una estadía** (calcula
-- un precio). Son dos cosas distintas con nombres casi iguales; por eso esta
-- tabla se llama `cotizaciones` (de divisas) y la función de allá
-- `cotizar_estadia`.
--
-- ── Por qué se guarda el historial y no un único valor vigente ───────────────
--
-- El propio ADR 0003 lo pide: «Los comprobantes deben registrar la cotización
-- usada el día de pago (trazabilidad)». Una fila por publicación permite
-- reconstruir con qué valor se cobró una reserva de hace seis meses, que es
-- exactamente lo que se necesita cuando un huésped discute el importe o cuando
-- hay que rendir cuentas. Un único registro mutable perdería esa historia en el
-- primer refresco.
--
-- El volumen no es un problema: con la ventana de 30 minutos son ~48 filas por
-- día y por moneda. No se purga a propósito — es dato contable, no caché.
-- ─────────────────────────────────────────────────────────────────────────────

create table cotizaciones (
  id          bigint generated always as identity primary key,
  -- Sin enum a propósito: agregar una moneda no debería exigir dos migraciones
  -- separadas por la trampa del SQLSTATE 55P04 (ver 0032 + 0035). El conjunto
  -- válido lo impone `lib/domain/divisas.ts` y el check de abajo.
  moneda      char(3) not null check (moneda in ('ARS', 'BRL', 'EUR')),
  -- Cuántas unidades de `moneda` paga el banco por un dólar.
  compra      numeric(14, 4) not null check (compra > 0),
  -- Cuántas unidades cuesta comprar un dólar. **Es la que se cobra** (Tarifario).
  venta       numeric(14, 4) not null check (venta > 0),
  fuente      text not null check (fuente in ('dolarapi', 'argentinadatos', 'manual')),
  -- Momento en que la FUENTE publicó el valor, no cuando lo guardamos. La
  -- diferencia importa: si la API estuvo caída dos horas, lo que interesa para
  -- decidir si el número sirve es cuándo se publicó.
  obtenida_en timestamptz not null,
  -- Solo para las cargas manuales: quién la hizo. Es la razón por la que esta
  -- tabla no se expone a `anon` (ver el revoke más abajo).
  cargada_por uuid references perfiles (id),
  creada_en   timestamptz not null default now(),

  -- Un banco nunca vende más barato de lo que compra. Si una fuente empieza a
  -- mandar los campos invertidos, esto lo frena en la base y no después de
  -- haberle regalado el spread a unos cuantos huéspedes.
  constraint cotizaciones_venta_no_menor_que_compra check (venta >= compra),

  -- Idempotencia por clave natural, mismo criterio que `pagos.external_id`.
  -- Mientras la fuente no publique un valor nuevo, su timestamp no cambia: sin
  -- esto, cada refresco insertaría una fila idéntica y el historial se llenaría
  -- de duplicados que no aportan nada.
  constraint cotizaciones_sin_duplicados unique (moneda, fuente, obtenida_en)
);

comment on table cotizaciones is
  'Historial de cotizaciones de divisas frente al USD. El USD es la moneda base y no se cotiza (ADR 0003).';
comment on column cotizaciones.venta is
  'Valor de venta: es el que se usa para cobrar, según el Tarifario (venta billete del Banco Nación).';
comment on column cotizaciones.obtenida_en is
  'Cuándo la fuente publicó el valor, no cuándo se guardó. Es lo que define si la cotización sirve.';

-- Cubre la consulta que hace el servicio en cada pedido: la última de cada
-- moneda. Sin esto, cada carga de pantalla recorrería el historial completo.
create index on cotizaciones (moneda, obtenida_en desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table cotizaciones enable row level security;

-- Todo el staff lee: recepción necesita el valor para cobrar, gerencia para los
-- reportes, y housekeeping no le molesta a nadie.
create policy "cotizaciones: staff lee" on cotizaciones
  for select using (rol_actual() is not null);

-- Cargar un valor manual es fijar a qué precio cobra el hotel. Es decisión de
-- administración, no de mostrador: un valor mal tipeado en recepción se traduce
-- en cobrar de menos a todos los que paguen en pesos ese día.
create policy "cotizaciones: admin/gerencia cargan" on cotizaciones
  for insert with check (rol_actual() in ('admin', 'gerencia'));

-- Sin políticas de update ni delete a propósito: es dato contable. Corregir una
-- cotización equivocada se hace cargando la correcta, que por ser más reciente
-- gana automáticamente en `resolverVigente`. Así queda el rastro de las dos, que
-- es lo que hace falta si hubo que rectificar un cobro.

-- La migración 0006 dejó `alter default privileges ... grant select ... to anon`,
-- así que toda tabla nueva nace legible por el rol anónimo. Acá no corresponde:
-- `cargada_por` expone identificadores de `perfiles`, o sea qué usuarios internos
-- existen. La política de arriba ya lo bloquea (para `anon`, `rol_actual()` es
-- null), pero se revoca igual: dos capas, y la de privilegios no depende de que
-- nadie se equivoque escribiendo una política nueva más adelante.
revoke select on cotizaciones from anon;
