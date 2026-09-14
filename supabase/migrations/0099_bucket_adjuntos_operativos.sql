-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0099 — Bucket de Storage para fotos operativas (ADR 0037)
--
-- Primer uso de Supabase Storage en todo el proyecto. El ADR 0013 había dejado
-- esto como trabajo futuro sin decidir, con una recomendación concreta: bucket
-- privado y acceso SIEMPRE por URL firmada generada en el servidor, nunca
-- exponiendo el bucket a un cliente autenticado directo. Este bucket es
-- deliberadamente genérico («adjuntos operativos», no uno por módulo): sirve a
-- mantenimiento, housekeeping, proveedores y agencias por igual, con la carpeta
-- de primer nivel (`mantenimiento/`, `housekeeping/`, `proveedores/`,
-- `agencias/`) como único diferenciador. Ver ADR 0037 para el porqué completo.
--
-- No se declara ninguna política RLS sobre `storage.objects` a propósito: sin
-- policy, Postgres deniega todo a `anon`/`authenticated`, y el único camino de
-- lectura o escritura es `service_role` desde `lib/storage/index.ts` (servidor),
-- después de que la Server Action que lo llama ya verificó el rol con
-- `requerirAcceso`. Es la misma garantía que ya usa `crearClienteAdmin()` en el
-- resto del sistema: la autorización vive en la app, no en una policy paralela
-- que habría que mantener sincronizada con `lib/domain/permisos.ts`.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adjuntos-operativos',
  'adjuntos-operativos',
  false,
  8388608, -- 8 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;
