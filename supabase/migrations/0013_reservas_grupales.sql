-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0013 — Reservas grupales (Fase 8)
-- Una reserva grupal se modela como varias reservas (una por unidad) que comparten
-- un `grupo_id`. Reutiliza el alta, el folio y el ciclo de estados por unidad, y
-- habilita el check-out escalonado y la facturación consolidada por grupo.
-- ─────────────────────────────────────────────────────────────────────────────

alter table reservas add column grupo_id uuid;
create index on reservas (grupo_id);
comment on column reservas.grupo_id is
  'Agrupa las reservas de un mismo grupo / familia (reserva grupal).';
