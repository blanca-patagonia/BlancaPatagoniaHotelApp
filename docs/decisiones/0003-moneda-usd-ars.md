# ADR 0003 — Moneda: USD como base, ARS a cotización configurable

- **Estado:** Aceptada
- **Fecha:** 2026-07-27

## Contexto

El Tarifario oficial 2025/2026 expresa todos los precios **en dólares
estadounidenses** y aclara: *"Se tomará la cotización oficial de venta billete
del Banco Nación del día de pago"*. El negocio opera en un contexto de alta
volatilidad del peso argentino (ARS). El brief pedía multi-moneda (ARS/USD) "si
es viable".

## Decisión

Almacenar **todos los importes en USD** (moneda base del dominio: tarifas,
totales de reserva, pagos) y mostrar el equivalente en **ARS** aplicando una
**cotización configurable** por administración (por defecto, la venta billete del
Banco Nación). El ARS es solo una capa de presentación/cobro; no se persiste como
fuente de verdad.

- Las columnas monetarias llevan `moneda char(3)` (default `'USD'`).
- La conversión a ARS se resolverá con un parámetro de cotización editable
  (tabla de configuración o variable), no incrustando el valor en cada tarifa.

## Justificación

- Evita reescribir el Tarifario y mantiene fidelidad con la fuente oficial.
- Aísla la volatilidad del ARS en un único punto (la cotización), sin duplicar
  precios ni recalcular históricos.
- Cumple el requisito multi-moneda del brief sin complejidad de doble tarifario.

## Consecuencias

- Hace falta un mecanismo para cargar/actualizar la cotización (Fase 3/4).
- Los comprobantes deben registrar la cotización usada el día de pago (trazabilidad).
- El reintegro de IVA a turistas extranjeros (RG 3971) se cruza con la moneda de
  pago; se aborda en facturación (Fase 5).
