-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0104 — Payway como tercera pasarela (ADR 0038)
--
-- Suma 'payway' al enum `medio_pago` (creado en la 0009 con 'mercadopago' y
-- 'stripe'). Solo el `alter type ... add value`: el primer uso de este valor
-- en una fila vive en runtime (un `insert` de la app, no de una migración), así
-- que no hace falta partirlo en dos archivos como exige la regla del proyecto
-- para un uso DENTRO de una migración (ver 0032/0035).
-- ─────────────────────────────────────────────────────────────────────────────

alter type medio_pago add value 'payway';
