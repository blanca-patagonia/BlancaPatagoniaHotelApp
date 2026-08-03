-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0024 — Portal de agencias y proveedores (Fase 11)
--
-- Cierra el requisito de que «cada agencia o proveedor vea solo sus propios
-- contratos». No se les crea cuenta de usuario: se les entrega una URL con un
-- token opaco, el mismo mecanismo ya usado en la confirmación de reserva
-- (0011), la firma de contratos (0018) y la encuesta de satisfacción (0023).
--
-- Decisión: darles cuenta real implicaría un rol nuevo, un alta pública y
-- políticas RLS que mapeen usuario → entidad. Para el alcance de la tesis el
-- token es suficiente y consistente con el resto del sistema (ver ADR 0014).
-- ─────────────────────────────────────────────────────────────────────────────

alter table agencias    add column token uuid not null default gen_random_uuid();
alter table proveedores add column token uuid not null default gen_random_uuid();

comment on column agencias.token is
  'Token opaco para el portal del socio (/portal/[token]). Funciona como credencial.';
comment on column proveedores.token is
  'Token opaco para el portal del proveedor (/portal/[token]). Funciona como credencial.';

create unique index agencias_token_idx    on agencias (token);
create unique index proveedores_token_idx on proveedores (token);

-- El portal se resuelve en el servidor con `service_role` tomando el token como
-- credencial: `anon` no recibe ninguna política de lectura nueva. Se deja
-- explícito para que no se agregue por error más adelante.
