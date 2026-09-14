-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0102 — Documentación con foto de un proveedor (ADR 0037)
-- Agrega el arreglo de adjuntos a `proveedores`. Guarda RUTAS del bucket
-- privado `adjuntos-operativos` (ver `lib/storage/index.ts`), nunca URLs ni el
-- archivo en sí: la URL de lectura se firma al momento de mostrarla y expira
-- sola, así que persistirla dejaría un link roto tarde o temprano.
-- ─────────────────────────────────────────────────────────────────────────────

alter table proveedores
  add column fotos text[] not null default '{}';

comment on column proveedores.fotos is
  'Rutas dentro del bucket adjuntos-operativos (carpeta proveedores/<id>), no URLs ni binarios. Documentación del proveedor (habilitación, seguro, lo que corresponda). La URL de lectura se firma en el servidor con lib/storage.urlAdjunto al mostrarla.';
