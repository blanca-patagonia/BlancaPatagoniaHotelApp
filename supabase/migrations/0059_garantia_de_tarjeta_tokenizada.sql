-- 0059 · Garantía de tarjeta: verificar sin guardar el número
--
-- Pedido del cliente (relevamiento del 15/08/2026), textual: «que el sistema
-- pruebe si la tarjeta es válida o no, porque hay veces que ponen una tarjeta
-- cualquiera y después cuando la querés ir a cobrar porque no aparecieron o
-- porque te dejaron una cena sin pagar, ya no es válida».
--
-- ── Este pedido choca con una decisión ya tomada, y se resuelve al revés ────
--
-- WinPAX guardaba **número de tarjeta, vencimiento, autorización y PIN**. Este
-- sistema deliberadamente no guarda nada de eso; la bitácora del 16/08/2026 dice
-- que «el trabajo era no agregarlo».
--
-- Guardar un PAN sacaría al hotel del alcance SAQ-A de PCI-DSS y lo pondría en
-- uno que exige auditoría anual, escaneo de vulnerabilidades y cifrado
-- certificado. Un hotel de 15 unidades no puede sostener eso, y no hace falta:
-- la necesidad real de Franco no es *tener el número*, es **saber si la tarjeta
-- sirve para cobrar un no-show**. Son cosas distintas y la segunda se resuelve
-- sin la primera.
--
-- ── Lo que sí se guarda ─────────────────────────────────────────────────────
--
-- La preautorización tokenizada: la pasarela valida contra el emisor y devuelve
-- un token. Acá quedan el token, los últimos 4 dígitos, la marca, el vencimiento
-- en MM/AA y el resultado. **Nada de eso permite reconstruir el número.**
--
-- Decisiones y su porqué: ADR 0025.

-- ── 1. Estado de la verificación ────────────────────────────────────────────
-- Es un enum y no texto libre porque de estos valores depende si recepción puede
-- confiar en la garantía. Un typo que cree un estado fantasma haría que una
-- tarjeta sin verificar se vea igual que una verificada.
--
-- ⚠️ Se crea el tipo en ESTA migración y sus valores se usan en las columnas de
-- más abajo. Eso es válido: la regla del SQLSTATE 55P04 aplica a `alter type ...
-- add value` sobre un enum YA EXISTENTE, no a un `create type` nuevo.

create type estado_verificacion_tarjeta as enum (
  'sin_verificar',   -- nadie la probó todavía
  'verificada',      -- el emisor la aceptó
  'rechazada',       -- el emisor la rechazó: no sirve para cobrar
  'no_soportado'     -- no hay pasarela capaz de verificar (hoy, siempre)
);

comment on type estado_verificacion_tarjeta is
  'Resultado de la preautorización. `no_soportado` NO es un fallo: es «no hay con qué verificar», que es distinto de «se intentó y falló» y se muestra distinto.';

-- ── 2. Las columnas, en la reserva ──────────────────────────────────────────
-- Van en `reservas` y no en una tabla aparte porque la garantía es de la
-- estadía: la misma persona puede dejar una tarjeta distinta en cada visita, y
-- una tabla propia obligaría a un join para el dato más consultado de la ficha.

alter table reservas
  add column tarjeta_token           text,
  add column tarjeta_ultimos4        char(4),
  add column tarjeta_marca           text,
  add column tarjeta_vencimiento     char(5),
  add column tarjeta_verificacion    estado_verificacion_tarjeta not null default 'sin_verificar',
  add column tarjeta_verificada_en   timestamptz,
  add column tarjeta_detalle         text;

comment on column reservas.tarjeta_token is
  'Token opaco que devuelve la pasarela. Es lo ÚNICO con lo que se puede intentar un cobro; no permite reconstruir el número. Si la pasarela cambia, este token deja de servir y hay que volver a pedir la tarjeta.';

comment on column reservas.tarjeta_ultimos4 is
  'Últimos cuatro dígitos, para que el huésped reconozca cuál dejó. PCI-DSS los permite: cuatro dígitos no identifican una tarjeta.';

comment on column reservas.tarjeta_marca is
  'Visa, Mastercard, Amex… Sirve para mostrar y para saber si el emisor es del exterior (RG 3971, ADR 0024).';

comment on column reservas.tarjeta_vencimiento is
  'MM/AA. NO es dato de tarjeta sensible por sí solo, y hace falta para saber si la garantía sigue viva en la fecha del check-in.';

comment on column reservas.tarjeta_verificada_en is
  'Cuándo se verificó. Una verificación de junio no dice nada en septiembre: la vigencia la calcula `lib/domain/garantia-tarjeta.ts`.';

comment on column reservas.tarjeta_detalle is
  'Motivo legible del rechazo o de la imposibilidad de verificar. NUNCA el número ni el CVV.';

-- ── 3. Las restricciones que impiden guardar un número de tarjeta ───────────
--
-- Esto es lo más importante del archivo. Los comentarios se ignoran y las
-- convenciones se olvidan; una restricción de la base no.
--
-- Un PAN tiene entre 13 y 19 dígitos. `tarjeta_ultimos4` acepta exactamente 4 y
-- solo dígitos, así que ahí no entra uno. El token es alfanumérico y lo emite la
-- pasarela, pero nada impedía que alguien —o un adapter mal escrito— metiera el
-- número ahí, que es justo el error que hay que hacer imposible.

alter table reservas
  add constraint reservas_tarjeta_ultimos4_son_4_digitos
  check (tarjeta_ultimos4 is null or tarjeta_ultimos4 ~ '^[0-9]{4}$');

alter table reservas
  add constraint reservas_tarjeta_vencimiento_mm_aa
  check (tarjeta_vencimiento is null or tarjeta_vencimiento ~ '^(0[1-9]|1[0-2])/[0-9]{2}$');

-- El token NO puede ser una tirada de 12 o más dígitos seguidos. Un token real
-- de pasarela lleva prefijo y letras (`tok_...`, `card_...`); un PAN es solo
-- dígitos. Esta comprobación no es infalible, pero corta el caso concreto que se
-- quiere evitar: que alguien pegue el número en el campo del token.
alter table reservas
  add constraint reservas_tarjeta_token_no_parece_pan
  check (tarjeta_token is null or tarjeta_token !~ '[0-9]{12,}');

comment on constraint reservas_tarjeta_token_no_parece_pan on reservas is
  'Impide guardar un número de tarjeta en el campo del token. Un PAN son 13-19 dígitos seguidos; un token de pasarela lleva letras. Es la barrera que sostiene el alcance SAQ-A cuando el comentario ya no se lee (ADR 0025).';

-- El detalle es texto libre que escribe el adapter: mismo criterio.
alter table reservas
  add constraint reservas_tarjeta_detalle_sin_pan
  check (tarjeta_detalle is null or tarjeta_detalle !~ '[0-9]{12,}');

-- Coherencia: si hay un resultado de verificación distinto del inicial, tiene
-- que constar cuándo se obtuvo. Sin la fecha no se puede calcular la vigencia, y
-- una garantía «verificada» sin fecha se leería como verificada para siempre.
alter table reservas
  add constraint reservas_tarjeta_verificacion_fechada
  check (
    tarjeta_verificacion = 'sin_verificar' or tarjeta_verificada_en is not null
  );

comment on constraint reservas_tarjeta_verificacion_fechada on reservas is
  'Una verificación sin fecha no se puede vencer, y entonces valdría para siempre. Mismo patrón que `facturas_cae_completo`.';

-- ── 4. Índice para el operativo del día ─────────────────────────────────────
-- «Qué llegadas de hoy tienen garantía que no sirve» es la consulta que hace
-- recepción a la mañana.

create index reservas_tarjeta_sin_garantia_idx on reservas (tarjeta_verificacion)
  where tarjeta_verificacion in ('rechazada', 'sin_verificar');

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Las columnas viven en `reservas`, que ya tiene RLS y cuyas políticas cubren la
-- fila entera. Housekeeping no lee `reservas`, así que no ve nada de esto.
--
-- No se agregan grants por columna: la migración 0034 intentó ese mecanismo
-- sobre `firmas.token` y NO tuvo efecto, porque un `revoke` de columna no recorta
-- un `grant` de tabla previo (el de `0006_grants_api.sql`). Queda anotado acá
-- para que nadie lo vuelva a intentar creyendo que protege algo.
