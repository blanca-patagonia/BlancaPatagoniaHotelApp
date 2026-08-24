-- 0063 · Los enlaces del portal se pueden cerrar
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- `agencias.token` y `proveedores.token` (migración 0024) **no caducan ni se
-- revocan**. Se generan una vez al crear el socio y sirven para siempre.
--
-- La consecuencia concreta, verificada leyendo `app/portal/[token]/page.tsx`: el
-- portal resuelve el socio por token y **no mira `activo`**. O sea que dar de
-- baja una agencia en el panel **no le cierra el portal**: sigue viendo su cuenta
-- corriente, sus contratos y el enlace para firmarlos.
--
-- Y como el token no se puede rotar, un enlace filtrado —un reenvío de correo, el
-- historial de un navegador compartido, un ex empleado de la agencia— sirve para
-- siempre y no hay forma de invalidarlo salvo tocando la base a mano.
--
-- ── Lo que se agrega ────────────────────────────────────────────────────────
--
-- Una marca de revocación, y nada más. No se agrega fecha de expiración
-- automática: un enlace que se apaga solo a los N días obligaría a reenviarlo
-- cada vez que el socio quiere ver su cuenta, y terminaría desactivado o con la
-- ventana estirada hasta volverla inútil. Lo que faltaba era poder **cerrarlo
-- cuando hace falta**, no que se cierre solo.
--
-- La baja del socio (`activo = false`) también cierra el portal, y eso se resuelve
-- en la consulta —no acá— porque es una condición que ya existe.

alter table agencias    add column token_revocado_en timestamptz;
alter table proveedores add column token_revocado_en timestamptz;

comment on column agencias.token_revocado_en is
  'Cuándo se dio de baja el enlace del portal. Con valor, el token deja de servir aunque siga en la fila. Se completa al regenerarlo: así el enlace viejo muere en el mismo momento en que nace el nuevo.';

comment on column proveedores.token_revocado_en is
  'Ídem `agencias.token_revocado_en`.';

-- ── Índice ──────────────────────────────────────────────────────────────────
-- El portal busca por token en cada carga. Ya había un `unique` sobre la columna
-- que resuelve esa búsqueda; no hace falta uno nuevo. Se deja anotado para que
-- nadie lo agregue de más al leer la consulta.

-- ── Lo que NO se toca, y por qué ────────────────────────────────────────────
--
-- `reservas.token` y `encuestas_satisfaccion.token` tampoco caducan, y se dejan
-- así a propósito:
--
--   · El de la reserva abre la confirmación del huésped. Que siga andando meses
--     después es una función, no un defecto: la gente vuelve a buscar ese correo.
--   · El de la encuesta se responde una vez y `respondida_en` ya la cierra.
--
-- `firmas.token` sí tiene un caso —un contrato enviado y nunca firmado queda
-- abierto para siempre—, pero su ciclo de vida es del contrato y no del token:
-- lo correcto ahí es que el estado del contrato lo cierre. Queda anotado en
-- `docs/PENDIENTES.md` en vez de resolverlo a medias acá.
