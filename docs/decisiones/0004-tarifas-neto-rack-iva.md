# ADR 0004 — Estructura tarifaria: neto (agencia) vs rack (mostrador), IVA discriminado

- **Estado:** Aceptada
- **Fecha:** 2026-07-27

## Contexto

El Tarifario 2025/2026 de Hostería Boutique publica **dos precios** por (tipo ×
temporada): **Neto (Agencia)** y **Rack (Mostrador)**. Además, los montos están
expresados **sin IVA** ("IVA discriminado"), con desayuno buffet incluido. Las
cabañas solo publican tarifa neta.

## Decisión

Modelar la tabla `tarifas` con **ambas columnas** (`precio_neto`, `precio_rack`),
más `iva_pct` (default 21) y `moneda`. La reserva elige el precio según su
**canal** mediante `reservas.tarifa_tipo` (`neto` para agencias/OTA, `rack` para
venta directa/mostrador). El IVA se calcula **sobre el neto** en el motor de
precios (`lib/domain/precios.ts`), no se almacena sumado.

- Para cabañas, `precio_rack` replica `precio_neto` hasta confirmar el precio de
  mostrador con el hotel (documentado en el seed).
- El motor soporta estadías que **cruzan temporadas** (precio por noche).

## Justificación

- Refleja la realidad comercial: agencias y mostrador pagan distinto.
- Mantener el IVA discriminado permite la facturación correcta y el eventual
  **reintegro a turistas extranjeros** (RG 3971 / Res. 566), que exime el IVA del
  alojamiento pagado desde el exterior.
- Calcular el IVA en el dominio (no en la base) deja la tarifa "limpia" y
  reutilizable para distintos escenarios fiscales.

## Consecuencias

- Falta confirmar la tarifa rack real de las cabañas.
- La lógica de selección de canal → tipo de tarifa vive en la reserva; el portal
  público venderá a `rack`, la carga interna podrá elegir.
- La exención de IVA por nacionalidad/medio de pago se implementa en la
  facturación (Fase 5), no en la tarifa.
