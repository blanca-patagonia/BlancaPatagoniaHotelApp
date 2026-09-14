-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0103 — Comprobante de pago de una agencia (ADR 0037)
--
-- Pedido del dueño del hotel (2026-09): una agencia tiene que abonar la
-- reserva con un mes de anticipación al check-in del huésped, y quiere poder
-- subir el comprobante de ese pago —desde el mostrador o desde su propio
-- portal (`/portal/<token>`)—.
--
-- ⚠️ El VENCIMIENTO no se guarda acá ni en ninguna otra columna, a propósito:
-- se deriva de `estadias.check_in` (columna GENERADA desde `periodo`, migración
-- 0037) menos 30 días — ver `vencimientoPagoAgencia` en `lib/domain/cuentas.ts`.
-- Guardarlo lo desincroniza en cuanto la reserva se reprograma: el vencimiento
-- quedaría apuntando a una fecha que ya no es la de esa estadía. Es el mismo
-- motivo por el que `check_in` es GENERADA y no una columna que se escribe a
-- mano.
--
-- `comprobante_ruta` es NULLABLE: la mayoría de los movimientos que se cargan
-- a mano desde el mostrador no llevan (ni necesitan) un archivo adjunto. Guarda
-- una RUTA del bucket privado `adjuntos-operativos` (carpeta
-- `agencias/<agencia_id>/…`), nunca una URL ni el archivo en sí — igual que ya
-- hacen `ordenes_mantenimiento.fotos` (0100) y `proveedores.fotos` (0102): la
-- URL de lectura se firma en el servidor con `lib/storage.urlAdjunto` al
-- mostrarla, así que persistir una URL fija tarde o temprano deja un enlace
-- roto.
--
-- No hace falta ningún GRANT ni política RLS nueva: la escritura desde el
-- panel pasa por `movimientos_cuenta` con el cliente del usuario (ya cubierto
-- por las políticas de la migración 0012), y la escritura desde el portal
-- público —sin sesión de staff— usa `crearClienteAdmin()` con `service_role`,
-- que ya bypassea RLS, igual que el resto de las escrituras de `service_role`
-- de este proyecto (webhooks, alta pública de reservas). `anon` sigue sin
-- INSERT/UPDATE sobre esta tabla (migración 0089): la única puerta de escritura
-- pública es la Server Action del portal, que verifica el token a mano antes
-- de tocar la base — igual que ya hace `app/portal/[token]/page.tsx` para leer.
-- ─────────────────────────────────────────────────────────────────────────────

alter table movimientos_cuenta
  add column comprobante_ruta text;

comment on column movimientos_cuenta.comprobante_ruta is
  'Ruta dentro del bucket privado adjuntos-operativos (carpeta agencias/<agencia_id>), no URL ni binario. La URL de lectura se firma en el servidor con lib/storage.urlAdjunto al mostrarla. Nullable: la mayoría de los movimientos cargados a mano no llevan comprobante.';
