-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0082 — Datos fiscales del hotel (emisor)
-- (Bloque D de la auditoría 2026-09)
--
-- ── El dato que faltaba, y las dos cosas que bloqueaba ───────────────────────
--
-- **El CUIT del hotel no está en ninguna tabla.** Suena increíble en un sistema
-- que emite facturas, y sin embargo es así: `facturas` guarda el CUIT del
-- *receptor* y el punto de venta, y el emisor nunca hizo falta porque el CAE es
-- simulado.
--
-- Bloqueaba dos cosas concretas:
--
-- 1. **WSFEv1 exige el CUIT del emisor** en cada solicitud de CAE. Sin él, el
--    adapter real no puede armar un solo comprobante.
-- 2. **La advertencia «esta factura no es para el hotel»** al escanear un
--    comprobante recibido (0080). El QR trae el documento del receptor y se puede
--    contrastar, pero contra qué. Quedó escrita y **apagada**: un aviso construido
--    sobre un dato inventado es peor que no tener aviso.
--
-- ── Por qué una tabla de una sola fila ──────────────────────────────────────
--
-- El hotel es uno. La alternativa —constantes en el código— haría que cambiar la
-- razón social sea un deploy, y estos datos los cambia un contador, no un
-- programador. La alternativa opuesta —una tabla de «configuración» genérica con
-- clave y valor— pierde los tipos y los `check`, que acá importan: un CUIT mal
-- cargado hace rechazar todos los comprobantes.
--
-- ⚠️ **La fila única se impone en la base**, no por convención. Dos filas dejarían
-- al sistema eligiendo una al azar, y el comprobante saldría a nombre de quien
-- toque.
--
-- ⚠️ Esto **no** habilita a facturar de verdad: sigue faltando el certificado y el
-- adapter WSAA/WSFEv1 (ADR 0012). Es el dato, no la integración.
-- ─────────────────────────────────────────────────────────────────────────────

create table datos_fiscales (
  -- La fila única. `check` sobre una constante: es la forma más simple de que la
  -- base garantice que no puede haber una segunda.
  id             boolean primary key default true check (id),

  razon_social   text not null check (length(btrim(razon_social)) > 0),
  cuit           text not null check (cuit ~ '^[0-9]{11}$'),

  /*
    Condición del EMISOR frente al IVA.

    Determina qué comprobantes puede emitir: un responsable inscripto emite A y B;
    un monotributista emite C. Hoy `tipoComprobante()` decide la letra sólo con la
    condición del receptor, que es correcto para un responsable inscripto y no
    para un monotributista. Se guarda ahora para que ese día el dato ya esté.
  */
  condicion_iva  condicion_iva not null default 'responsable_inscripto',

  domicilio      text not null default '',
  -- Fecha de inicio de actividades: se imprime en el comprobante.
  inicio_actividades date,
  -- Ingresos brutos, tal como se imprime.
  ingresos_brutos text,

  actualizado_por uuid references perfiles(id) on delete set null,
  actualizado_en  timestamptz not null default now()
);

comment on table datos_fiscales is
  'Datos del hotel como EMISOR de comprobantes. Una sola fila, impuesta por la base. Ver el encabezado de la 0082.';
comment on column datos_fiscales.id is
  'Siempre `true`. El `check` es lo que impide una segunda fila: con dos, el sistema elegiría una al azar y el comprobante saldría a nombre de quien toque.';
comment on column datos_fiscales.cuit is
  'CUIT del hotel, sin guiones. Lo exige WSFEv1 en cada solicitud de CAE, y es contra esto que se compara el receptor de una factura recibida (0080).';
comment on column datos_fiscales.condicion_iva is
  'Condición del EMISOR. Determina qué letras puede emitir: responsable inscripto → A y B; monotributista → C.';

create index datos_fiscales_actualizado_por_idx on datos_fiscales (actualizado_por);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table datos_fiscales enable row level security;

/*
  Lo lee todo el staff y lo escribe admin.

  Que lo LEA todo el staff es deliberado: son los datos que van impresos en la
  factura que recepción le entrega al huésped, y que la pantalla de comprobantes
  recibidos necesita para avisar si una factura no es del hotel. No hay nada
  secreto: el CUIT de una empresa es público.

  Escribirlo es de admin: cambiar la razón social o el CUIT afecta todos los
  comprobantes que se emitan desde ese momento.
*/
create policy "datos_fiscales: staff lee" on datos_fiscales
  for select using (rol_actual() is not null);

create policy "datos_fiscales: admin escribe" on datos_fiscales
  for all using (rol_actual() = 'admin')
  with check (rol_actual() = 'admin');

revoke select, insert, update, delete on datos_fiscales from anon;

/*
  ⚠️ NO se siembra una fila con datos de ejemplo.

  Un CUIT inventado sería peor que la tabla vacía: el sistema arrancaría creyendo
  que ya está configurado, la advertencia de «esta factura no es para el hotel»
  compararía contra un número falso, y el día del certificado se pediría un CAE a
  nombre de nadie. Vacía, la pantalla dice que falta cargarlo.
*/

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   insert into datos_fiscales (razon_social, cuit)
--        values ('Hotel de prueba', '30712345678');           -- ok
--   insert into datos_fiscales (id, razon_social, cuit)
--        values (false, 'Otro', '30712345679');               -- 23514: id debe ser true
--   insert into datos_fiscales (razon_social, cuit)
--        values ('Otro', '30712345679');                      -- 23505: ya hay una fila
--   insert into datos_fiscales (razon_social, cuit)
--        values ('Mal', '30-71234567-8');                     -- 23514: con guiones no
--
--   select has_table_privilege('anon','datos_fiscales','select');   -- f
