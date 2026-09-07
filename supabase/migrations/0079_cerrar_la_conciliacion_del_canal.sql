-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0079 — Cerrar la conciliación de un cargo del canal
-- (Bloque C de la auditoría 2026-09, hallazgo P1-4)
--
-- ── El defecto ───────────────────────────────────────────────────────────────
--
-- `canal_cargos.estado_conciliacion` existe desde la 0049 con tres valores
-- ('devengado', 'conciliado', 'en_disputa'), tiene su índice parcial, su etiqueta
-- en el dominio y su columna en la pantalla.
--
-- **No hay una sola escritura en toda la aplicación.** Verificado: las únicas
-- apariciones fuera de tests son lecturas. Todos los cargos quedan `devengado`
-- para siempre, así que la pantalla de costos muestra devengado, facturado y
-- diferencia —hace bien la comparación— y después no hay forma de **cerrar** la
-- revisión. Al mes siguiente, quien mira la lista no puede distinguir lo que ya
-- se revisó de lo que no.
--
-- ── Qué agrega ───────────────────────────────────────────────────────────────
--
-- El estado ya está; lo que falta es el rastro de quién decidió y por qué. Una
-- diferencia que se acepta es una decisión de plata: sin nombre y sin motivo, en
-- la revisión siguiente nadie puede reconstruir si se aceptó por buena o por
-- cansancio.
--
-- ⚠️ Deliberadamente NO se agrega ningún automatismo que concilie solo. El
-- comentario de `registrarFacturaComision` ya lo dice y sigue valiendo: decidir
-- que una diferencia es aceptable no puede ser un efecto secundario de cargar un
-- número.
-- ─────────────────────────────────────────────────────────────────────────────

alter table canal_cargos
  add column conciliado_por  uuid references perfiles(id) on delete set null,
  add column conciliado_en   timestamptz,
  add column nota_conciliacion text;

comment on column canal_cargos.conciliado_por is
  'Quién cerró la revisión de este cargo. Aceptar una diferencia es una decisión de gerencia y tiene que tener nombre.';
comment on column canal_cargos.conciliado_en is
  'Cuándo se cerró. Nulo mientras el cargo sigue `devengado`.';
comment on column canal_cargos.nota_conciliacion is
  'Por qué. Obligatoria para marcar «en disputa»: una disputa sin motivo escrito es un reclamo que después nadie puede sostener ante el canal.';

create index canal_cargos_conciliado_por_idx on canal_cargos (conciliado_por);

/*
  Una disputa sin motivo escrito no entra.

  Es la misma regla que `notas_credito` (0076) impone sobre `motivo`, y por la
  misma razón: el estado que reclama plata es el que hay que poder justificar
  meses después, cuando el canal responda.

  `conciliado` no exige nota —lo normal es que la diferencia sea cero y no haya
  nada que explicar— pero sí exige firma y fecha: son las que permiten decir
  «esto ya se revisó» sin creerle a la memoria de nadie.
*/
alter table canal_cargos
  add constraint canal_cargos_disputa_con_motivo
  check (
    estado_conciliacion <> 'en_disputa'
    or (nota_conciliacion is not null and length(btrim(nota_conciliacion)) >= 5)
  );

comment on constraint canal_cargos_disputa_con_motivo on canal_cargos is
  'Marcar un cargo en disputa exige escribir por qué: es el reclamo que después hay que sostener ante el canal.';

alter table canal_cargos
  add constraint canal_cargos_cierre_con_firma
  check (
    estado_conciliacion = 'devengado'
    or (conciliado_por is not null and conciliado_en is not null)
  );

comment on constraint canal_cargos_cierre_con_firma on canal_cargos is
  'Un cargo que salió de «devengado» tiene que decir quién lo movió y cuándo.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificación posterior (correr a mano tras aplicar)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   update canal_cargos set estado_conciliacion = 'en_disputa'
--    where id = '<uno>';                                  -- 23514: falta motivo
--
--   update canal_cargos
--      set estado_conciliacion = 'conciliado'
--    where id = '<uno>';                                  -- 23514: falta firma
--
--   update canal_cargos
--      set estado_conciliacion = 'conciliado',
--          conciliado_por = '<perfil>', conciliado_en = now()
--    where id = '<uno>';                                  -- ok
