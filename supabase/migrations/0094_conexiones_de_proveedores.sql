-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0094 — Conexiones de proveedores (OAuth2 e iCal), un solo hotel
--
-- Objetivo: que vincular Mercado Pago, el correo de Google, Booking y Expedia
-- sea un botón que abre una ventana del propio proveedor —o pegar un link,
-- cuando el proveedor no ofrece OAuth—, nunca pegar una clave a mano.
--
-- ── Por qué NO lleva `hotel_id` ──────────────────────────────────────────────
--
-- El pedido original traía la tabla pensada para varios hoteles a la vez. Este
-- sistema es de UN hotel: no hay `hotel_id` en ninguna de las 93 migraciones
-- anteriores, y agregar multi-tenencia acá tocaría RLS, permisos y facturación
-- muy por fuera de esto. `proveedor` alcanza como clave: solo puede existir UNA
-- conexión vigente por proveedor, igual que `canal_config.canal` (migración
-- 0049) es clave primaria por el mismo motivo — un solo hotel, una fila por
-- canal.
--
-- ── Por qué los tokens van cifrados y no en texto plano ──────────────────────
--
-- Los tokens de socio existentes (`agencias.token`, `proveedores.token`,
-- `firmas.token`) son UUIDs sin cifrar, protegidos con RLS y revocación por
-- columna (migración 0060) — les alcanza porque son credenciales DE ESTE
-- sistema hacia un socio, generadas acá. Un `access_token`/`refresh_token` de
-- OAuth es lo opuesto: es una credencial de un tercero (Mercado Pago, Google)
-- que, si se filtra, permite operar esa cuenta ajena desde afuera. RLS protege
-- la fila contra `authenticated`; el cifrado (ver ADR 0036,
-- `lib/seguridad/cifrado.ts`) protege el valor si alguna vez alguien lee la
-- tabla con `service_role` sin deber hacerlo, o si un volcado de la base
-- termina en el lugar equivocado.
--
-- ── El link de iCal es una credencial, aunque no lo parezca ──────────────────
--
-- `ical_url_importacion` no se cifra: es un link con un token opaco que el
-- propio Booking/Expedia generaron, no una contraseña. Pero SÍ es sensible —
-- cualquiera con el link ve la disponibilidad del hotel— así que su RLS es la
-- misma que la de los tokens de OAuth, y `lib/registro.ts` nunca debe
-- recibirlo en un `detalle` (ver el comentario de la 0060 sobre credenciales).
-- ─────────────────────────────────────────────────────────────────────────────

create table conexiones_proveedores (
  proveedor               text primary key
                          check (proveedor in ('mercadopago', 'google_mail', 'booking', 'expedia')),

  tipo_conexion           text not null check (tipo_conexion in ('oauth2', 'ical')),

  estado                  text not null default 'desconectado'
                          check (estado in ('conectado', 'desconectado', 'expirado',
                                             'requiere_cuenta_partner')),

  -- Solo OAuth2. Cifrados (AES-256-GCM, ver `lib/seguridad/cifrado.ts`); nunca
  -- se leen con el cliente del usuario.
  access_token_cifrado    text,
  refresh_token_cifrado   text,
  expira_en               timestamptz,

  -- Solo iCal. El link que el usuario pegó (de Booking/Expedia hacia acá) y el
  -- token de NUESTRO feed de salida (de acá hacia Booking/Expedia) — mismo
  -- patrón que `canal_config.ical_token` (0049), reusado y no reinventado.
  ical_url_importacion    text,
  ical_token_exportacion  uuid,

  conectado_por           uuid references perfiles(id),
  conectado_en            timestamptz,
  sincronizado_en         timestamptz,
  actualizado_en          timestamptz not null default now()
);

comment on table conexiones_proveedores is
  'Conexión de este hotel con un proveedor externo (Mercado Pago, correo de Google, Booking, Expedia). Una fila por proveedor — sistema de un solo hotel, sin hotel_id.';
comment on column conexiones_proveedores.access_token_cifrado is
  'AES-256-GCM (lib/seguridad/cifrado.ts, ADR 0036). Es la credencial de la cuenta del PROVEEDOR, no una nuestra: un access_token de Mercado Pago filtrado opera la cuenta de cobro del hotel desde afuera.';
comment on column conexiones_proveedores.ical_url_importacion is
  'Es una credencial aunque no lo parezca: cualquiera con el link ve la disponibilidad del hotel. Nunca va en un log (lib/registro.ts).';

create unique index conexiones_proveedores_ical_token_exportacion_idx
  on conexiones_proveedores (ical_token_exportacion)
  where ical_token_exportacion is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Mismo nivel que `canal_config`: admin/gerencia, no todo el staff. Acá el
-- motivo es más fuerte todavía — la fila puede contener tokens cifrados de
-- cuentas de terceros.

alter table conexiones_proveedores enable row level security;

create policy "conexiones_proveedores: gerencia+ lee" on conexiones_proveedores
  for select using (rol_actual() in ('admin', 'gerencia'));
create policy "conexiones_proveedores: gerencia+ gestiona" on conexiones_proveedores
  for all using (rol_actual() in ('admin', 'gerencia'))
  with check (rol_actual() in ('admin', 'gerencia'));

-- La 0006 dejó `alter default privileges ... grant select on tables to anon`,
-- así que toda tabla nueva nace legible por el rol anónimo. Acá sería grave:
-- expondría tokens cifrados y el link de iCal. Las políticas ya lo bloquean
-- (para `anon`, `rol_actual()` es null); se revoca igual, mismo criterio que
-- las migraciones anteriores que tocan credenciales.
revoke select on conexiones_proveedores from anon;
