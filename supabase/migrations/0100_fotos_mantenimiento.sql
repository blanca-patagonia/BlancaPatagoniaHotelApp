-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0100 — Fotos de una orden de mantenimiento (ADR 0037)
-- Agrega el arreglo de adjuntos a `ordenes_mantenimiento`. Guarda RUTAS del
-- bucket privado `adjuntos-operativos` (ver `lib/storage/index.ts`), nunca
-- URLs ni el archivo en sí: la URL de lectura se firma al momento de mostrarla
-- y expira sola, así que persistirla dejaría un link roto tarde o temprano.
-- ─────────────────────────────────────────────────────────────────────────────

alter table ordenes_mantenimiento
  add column fotos text[] not null default '{}';

comment on column ordenes_mantenimiento.fotos is
  'Rutas dentro del bucket adjuntos-operativos (carpeta mantenimiento/<id>), no URLs. La URL de lectura se firma en el servidor con lib/storage.urlAdjunto al mostrarla.';
