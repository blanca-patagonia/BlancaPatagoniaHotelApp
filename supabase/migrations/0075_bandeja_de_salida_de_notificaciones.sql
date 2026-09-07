-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0075 — Bandeja de salida de notificaciones
-- (Bloque B de la auditoría 2026-09: objetivos 6 y 7 del pedido)
--
-- ── El problema ──────────────────────────────────────────────────────────────
--
-- Hoy el sistema **no le avisa nada a nadie**. El único `EmailProvider` es
-- `consola`, que escribe metadatos en el log y devuelve `ok: true` con el detalle
-- «no se envió». Hay cuatro plantillas y cuatro call sites, y los cuatro terminan
-- ahí. Ningún huésped recibió nunca una confirmación, un recordatorio ni una
-- encuesta.
--
-- Pero el hueco más grande no es el proveedor —ése se enchufa con una variable de
-- entorno— sino que **no hay dónde anotar el envío**. Sin eso:
--
--   · No se sabe si un correo salió, falló o nunca se intentó.
--   · No hay reintentos: un fallo transitorio de la API se pierde para siempre.
--   · No hay idempotencia: reprocesar un webhook manda el correo de nuevo, y el
--     huésped recibe dos confirmaciones de la misma reserva.
--
-- Los tres se resuelven con la misma pieza: una **bandeja de salida**. Se escribe
-- la intención de enviar, y el envío es un paso aparte que puede reintentarse.
--
-- ── Por qué una tabla y no una cola ─────────────────────────────────────────
--
-- Mismo criterio que el ADR 0029 con `errores`: sin dependencias nuevas, los
-- datos del huésped no salen del sistema, y se ve desde el panel. El volumen del
-- hotel —decenas de mensajes por día— no justifica una cola de verdad, y el cron
-- de Vercel ya existe como disparador.
-- ─────────────────────────────────────────────────────────────────────────────

create table notificaciones (
  id          uuid primary key default gen_random_uuid(),

  -- Qué se comunica. Coincide con `EventoEmail` de `lib/domain/plantillas.ts`;
  -- se guarda como texto y no como enum a propósito: una plantilla nueva no
  -- debería necesitar una migración, y el enum obligaría a partirla en dos por la
  -- regla del SQLSTATE 55P04.
  evento      text        not null,

  -- Por dónde sale. Arranca en `email`; `whatsapp` y `sms` quedan previstos para
  -- no tener que migrar la tabla al enchufarlos.
  canal       text        not null default 'email'
              check (canal in ('email', 'whatsapp', 'sms')),

  /*
    La clave de idempotencia. Es la columna que evita el correo duplicado.

    La arma la aplicación con lo que identifica al mensaje de forma natural —el
    evento y la entidad, p. ej. `confirmacion_reserva:<reserva_id>`— así que
    reprocesar un webhook o reintentar una acción **encuentra la fila que ya
    está** en vez de crear otra. Es la misma idea que `pagos.external_id`.
  */
  clave       text        not null unique,

  destinatario text       not null,
  -- Variables de la plantilla, ya resueltas. Se guardan para poder reintentar sin
  -- volver a leer media base, y para saber qué se mandó realmente.
  variables   jsonb       not null default '{}'::jsonb,

  estado      text        not null default 'pendiente'
              check (estado in ('pendiente', 'enviada', 'fallida', 'cancelada')),

  intentos    int         not null default 0,
  -- Cuándo corresponde el próximo intento. El reintento con espera creciente se
  -- calcula en el dominio y se escribe acá; el cron sólo toma lo que ya venció.
  proximo_en  timestamptz not null default now(),
  enviada_en  timestamptz,
  -- Último error, para que se vea en el panel sin abrir el log.
  error       text,

  -- A quién se le mandó, cuando aplica. Sirve para el listado y para no volver a
  -- escribirle a alguien que revocó el consentimiento.
  huesped_id  uuid references huespedes(id) on delete set null,
  reserva_id  uuid references reservas(id)  on delete cascade,

  creado_en   timestamptz not null default now()
);

comment on table notificaciones is
  'Bandeja de salida: la intención de comunicar, separada del envío. Da reintentos, idempotencia y rastro de qué se mandó. Ver el encabezado de la 0075.';
comment on column notificaciones.clave is
  'Idempotencia. La arma la aplicación (evento + entidad): reprocesar un webhook no manda el mensaje dos veces.';
comment on column notificaciones.proximo_en is
  'Cuándo corresponde el próximo intento. El cron toma lo pendiente ya vencido.';

-- Lo que consulta el cron: pendientes cuyo turno llegó, más viejo primero.
create index notificaciones_por_enviar_idx
  on notificaciones (proximo_en)
  where estado = 'pendiente';

create index notificaciones_reserva_idx on notificaciones (reserva_id);
create index notificaciones_huesped_idx on notificaciones (huesped_id);
create index notificaciones_creado_idx  on notificaciones (creado_en desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table notificaciones enable row level security;

-- Lo lee el staff que atiende al huésped: si alguien llama diciendo «no me llegó
-- nada», recepción tiene que poder mirarlo sin pedirle a un admin.
create policy "notificaciones: el staff las lee"
  on notificaciones for select
  using (rol_actual() in ('admin', 'gerencia', 'recepcion'));

-- Sin políticas de escritura: las escribe `service_role` desde la aplicación,
-- igual que `errores` y `auditoria`. Que nadie pueda marcar como enviado algo que
-- no salió es el punto.
revoke insert, update, delete on notificaciones from authenticated;
revoke select, insert, update, delete on notificaciones from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Consentimiento y preferencias del huésped
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Los dos campos NO son lo mismo y el default es distinto a propósito:
--
--   · `acepta_avisos` cubre lo **transaccional** —confirmación de su propia
--     reserva, recordatorio de su check-in, su factura—. El consentimiento va
--     implícito en la transacción: el huésped dio su correo para eso. Default
--     `true`, y se puede apagar si lo pide.
--   · `acepta_promociones` cubre lo **comercial**. Eso sí exige opt-in explícito,
--     así que default `false`. Nunca se debe deducir de una reserva.
--
-- Meterlos en una sola columna sería el error caro: apagaría los avisos que el
-- huésped necesita, o mandaría publicidad sin permiso.

alter table huespedes
  add column if not exists acepta_avisos      boolean not null default true,
  add column if not exists acepta_promociones boolean not null default false;

comment on column huespedes.acepta_avisos is
  'Transaccional (su reserva, su check-in, su factura). Consentimiento implícito en la transacción: default true.';
comment on column huespedes.acepta_promociones is
  'Comercial. Exige opt-in explícito: default false. NUNCA deducirlo de una reserva.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- La clave rechaza el duplicado:
--   insert into notificaciones (evento, clave, destinatario)
--        values ('confirmacion_reserva', 'x:1', 'a@b.com');
--   insert into notificaciones (evento, clave, destinatario)
--        values ('confirmacion_reserva', 'x:1', 'a@b.com');   -- 23505
--   delete from notificaciones where clave = 'x:1';
--
--   -- anon no la ve:
--   select has_table_privilege('anon', 'notificaciones', 'select');   -- f
