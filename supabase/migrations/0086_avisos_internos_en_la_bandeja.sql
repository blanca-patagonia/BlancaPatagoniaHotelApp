-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0086 — Los avisos internos entran por la misma bandeja
--
-- ── Qué agrega y por qué acá ─────────────────────────────────────────────────
--
-- El catálogo de avisos pasó de 4 eventos a 20, y seis de los nuevos son
-- **internos**: le avisan al hotel, no al huésped. Entró una reserva, se acreditó
-- un pago, falló la sincronización con el canal, hay una diferencia en una
-- factura, una habitación quedó lista, se abrió un incidente urgente.
--
-- La tentación era mandarlos por correo a una casilla del hotel. Se descarta por
-- dos motivos: obliga a configurar y mantener destinatarios —¿quién recibe qué,
-- y qué pasa cuando esa persona se va?— y compite con algo que **ya existe y el
-- staff ya mira**: la cartelera de `avisos` (migración 0016).
--
-- Así que los internos aterrizan ahí. Lo que cambia acá es lo mínimo para que
-- puedan convivir con los del huésped **en la misma bandeja**, que es lo que
-- permite que una sola pantalla muestre todo lo que el sistema comunicó.
--
-- ── Por qué una sola bandeja y no dos tablas ─────────────────────────────────
--
-- Porque la pregunta que alguien se hace es «¿esto se avisó?», y no «¿esto se
-- avisó por correo?». Con dos tablas hay que mirar en dos lados y acordarse de
-- cuál corresponde; con una, la pantalla filtra. Y la idempotencia, los
-- reintentos y el registro de errores ya están resueltos una vez.
-- ─────────────────────────────────────────────────────────────────────────────

/* ─────────────────────────────────── 1. el canal interno ───────────────── */

alter table notificaciones drop constraint if exists notificaciones_canal_check;

alter table notificaciones
  add constraint notificaciones_canal_check
  check (canal in ('email', 'whatsapp', 'sms', 'interno'));

comment on column notificaciones.canal is
  'Por dónde sale. `interno` no sale del sistema: aterriza en la cartelera de `avisos`, que el staff ya mira. Ver el encabezado de la 0086.';

/*
  El destinatario de un aviso interno es un ROL, no una dirección.

  «Recepción» sigue existiendo cuando cambia quien atiende el mostrador; una
  casilla personal, no. Es la misma razón por la que los permisos del sistema son
  por rol y no por persona.
*/
comment on column notificaciones.destinatario is
  'Email del huésped, o —cuando `canal = interno`— el rol del hotel al que le toca: admin, gerencia, recepcion, housekeeping.';

/* ────────────────────────── 2. los estados que faltaban ────────────────── */

/*
  El pedido original nombra cinco estados: enviado, entregado, leído, fallido y
  pendiente. Había cuatro, y dos de los que faltaban son los que sólo puede
  informar el proveedor.

  ⚠️ `enviada` NO es `entregada`. Resend acepta el mensaje y responde 200 mucho
  antes de saber si el servidor del destinatario lo aceptó: entre esas dos cosas
  está el rebote, que es exactamente el caso que el hotel necesita ver —«le
  escribimos y no le llegó»—. Tratarlas como una sola deja ese caso invisible.

  `leida` llega por el mismo camino (el pixel de apertura) y es **la más
  imprecisa de las cinco**: un cliente de correo que bloquea imágenes nunca la
  reporta, así que su ausencia no prueba nada. Se guarda igual porque su
  PRESENCIA sí prueba algo, y la pantalla lo dice con esas palabras.
*/
alter table notificaciones drop constraint if exists notificaciones_estado_check;

alter table notificaciones
  add constraint notificaciones_estado_check
  check (estado in ('pendiente', 'enviada', 'entregada', 'leida', 'fallida', 'cancelada'));

alter table notificaciones
  add column entregada_en timestamptz,
  add column leida_en     timestamptz,
  /*
    Id que le dio el proveedor al mensaje.

    Es con lo que se casa el webhook de entrega contra la fila: sin él, un aviso
    de rebote no tiene a qué imputarse. Único cuando está, porque un id del
    proveedor identifica un envío.
  */
  add column proveedor_id text;

comment on column notificaciones.entregada_en is
  'Cuándo el servidor del destinatario lo aceptó. Distinto de enviada: entre las dos está el rebote.';
comment on column notificaciones.leida_en is
  'Cuándo se abrió, si el proveedor lo informa. Su AUSENCIA no prueba nada: un cliente que bloquea imágenes nunca lo reporta.';
comment on column notificaciones.proveedor_id is
  'Id del envío en el proveedor. Es con lo que el webhook de entrega encuentra la fila.';

create unique index notificaciones_proveedor_id_idx
  on notificaciones (proveedor_id)
  where proveedor_id is not null;

-- El listado de la pantalla: lo último primero, filtrando por estado.
create index notificaciones_estado_creada_idx
  on notificaciones (estado, creado_en desc);

/* ─────────────────────────── 3. de dónde sale un aviso ─────────────────── */

/*
  `avisos` (0016) no sabía distinguir lo que escribió una persona de lo que
  generó el sistema, y ahora van a convivir. Sin esta columna, la cartelera
  mezclaría «Mañana viene el técnico del ascensor» con «Pago acreditado: USD 120»
  sin que se pueda filtrar ni saber cuál es cuál.
*/
alter table avisos
  add column automatico boolean not null default false,
  add column evento     text,
  /*
    A qué rol le toca. `null` = a todos, que es lo que eran hasta hoy **todos**
    los avisos y por eso es el default: las filas existentes no cambian de
    visibilidad.

    Sin esta columna, el `destinatario` de la notificación interna sería una
    etiqueta decorativa: la fila diría «recepcion» y la cartelera se la mostraría
    igual a housekeeping. Un aviso de «pago acreditado: USD 120» no le sirve a
    quien está limpiando una habitación, y el ruido es lo que hace que después
    nadie mire la cartelera.
  */
  add column rol text check (rol in ('admin', 'gerencia', 'recepcion', 'housekeeping'));

comment on column avisos.automatico is
  'true = lo generó el sistema desde la bandeja de avisos (0086). false = lo escribió una persona.';
comment on column avisos.evento is
  'Qué evento lo originó, cuando es automático. Sirve para filtrar la cartelera y para no repetir el mismo aviso.';
comment on column avisos.rol is
  'A qué rol le toca. null = a todos (los avisos escritos por una persona). Es RUTEO, no un secreto: admin y gerencia ven todo.';

create index avisos_automatico_idx on avisos (automatico, creado_en desc);

/*
  La política de lectura, con el ruteo adentro.

  ⚠️ **Esto es ruteo, no un límite de seguridad.** No hay nada en un aviso
  automático que housekeeping no pueda ver —los datos de la reserva ya los ve en
  su propia pantalla—; lo que se evita es el ruido. Y admin y gerencia siguen
  viendo todo, porque supervisan.

  Los avisos de siempre (`rol is null`) los sigue viendo todo el staff: la
  condición está escrita para que las filas existentes no cambien de
  comportamiento.
*/
drop policy "avisos: staff lee" on avisos;

/*
  ⚠️ `rol_actual()` devuelve el enum `rol_usuario` y `avisos.rol` es `text`, así
  que la comparación necesita el cast explícito: sin él Postgres corta con
  «operator does not exist: text = rol_usuario» y la migración no aplica.

  La columna es `text` con `check` y no el enum a propósito. `rol_usuario`
  incluye `sin_rol` (0032), que existe para que un alta sin aprovisionar no
  habilite nada: un aviso ruteado a `sin_rol` no lo vería nadie, y el enum lo
  aceptaría sin protestar. El `check` de arriba nombra los cuatro roles reales.
*/
create policy "avisos: staff lee los suyos"
  on avisos for select
  using (
    rol_actual() in ('admin', 'gerencia')
    or (rol_actual() is not null and (rol is null or rol = rol_actual()::text))
  );

/*
  Las tres columnas nuevas entran en el trigger que congela el aviso.

  `solo_fijar_aviso` (0017) existe porque `authenticated` tiene UPDATE a nivel de
  tabla desde la 0006: la restricción por columna se impone con el trigger, no
  con un grant. Su lista nombraba `mensaje`, `autor_id` y `creado_en` — las
  únicas que había entonces.

  Sin agregar las de acá, cualquier integrante del staff podría:
    · cambiarle el `rol` a un aviso y sacárselo de encima mandándoselo a otro,
    · o desmarcar `automatico` y hacer pasar un aviso del sistema por uno escrito
      por una persona.

  Ninguna de las dos rompe nada grave, pero las dos rompen lo que la cartelera
  promete: que se pueda distinguir quién dijo qué. El staff sigue pudiendo fijar
  y desfijar, que es lo único para lo que se le dio el UPDATE.
*/
create or replace function solo_fijar_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if rol_actual() is distinct from 'admin'
     and (new.mensaje    is distinct from old.mensaje
       or new.autor_id   is distinct from old.autor_id
       or new.creado_en  is distinct from old.creado_en
       or new.automatico is distinct from old.automatico
       or new.evento     is distinct from old.evento
       or new.rol        is distinct from old.rol) then
    raise exception 'Solo se puede fijar o desfijar un aviso';
  end if;
  return new;
end;
$$;

comment on function solo_fijar_aviso() is
  'Impide que un UPDATE del staff altere algo distinto de avisos.fijado. Desde la 0086 protege también automatico, evento y rol.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   -- El canal interno se acepta:
--   insert into notificaciones (evento, canal, clave, destinatario)
--        values ('interno_nuevo_pago', 'interno', 'x1', 'recepcion');   -- ok
--
--   -- Un canal inventado, no:
--   ... canal = 'paloma'                                                -- 23514
--
--   -- Los cinco estados del pedido existen:
--   update notificaciones set estado = 'entregada' where clave = 'x1';  -- ok
--   update notificaciones set estado = 'leida'     where clave = 'x1';  -- ok
--
--   -- Un id de proveedor no se repite:
--   --   dos filas con el mismo `proveedor_id` → 23505
--
--   -- El ruteo de la cartelera: un aviso de recepción no le sale a housekeeping,
--   -- y los avisos escritos por una persona (rol null) los siguen viendo todos.
--   insert into avisos (mensaje, automatico, evento, rol)
--        values ('Pago acreditado', true, 'interno_nuevo_pago', 'recepcion');
--   --   como housekeeping → no aparece
--   --   como recepcion / gerencia / admin → aparece
