# ADR 0008 — Consumos y factura interna (con AFIP preparado)

- **Estado:** Aceptada
- **Fecha:** 2026-07-28

## Contexto

Durante la estadía el huésped genera **consumos extra** (frigobar, desayuno,
excursiones, traslados) que se cargan a su cuenta. Al check-out hay que
**consolidar** alojamiento + consumos y emitir un comprobante. La facturación
electrónica (AFIP/CAE) es un requisito de una etapa posterior (Fase 8).

## Decisión

- **Catálogo** `productos_servicios` (frigobar, desayuno, excursiones, traslados) y
  **`consumos`** cargados a la reserva con **precio congelado** (`precio_unitario`
  snapshot), de modo que un cambio de catálogo no altere cuentas ya cargadas.
- **Cuenta consolidada** en el dominio (`lib/domain/consumos.ts`): alojamiento +
  consumos. Se muestra en el detalle de la reserva y se puede cargar/quitar consumos.
- **Factura interna** (`facturas`): registro con número propio y total consolidado,
  más un **comprobante imprimible** (`/panel/reservas/[id]/factura`, `window.print()`
  → PDF del navegador). Las **columnas AFIP** (`cae`, `cae_vto`, `punto_venta`,
  `tipo_comprobante`, `pdf_url`) quedan **preparadas** pero vacías.
- **Check-in / check-out**: se resuelven con la máquina de estados ya existente
  (`confirmada`/`pagada` → `in_house` → `checkout`).

## Justificación

- El comprobante es **operable hoy** (imprimible / PDF) sin depender de la
  integración fiscal, que se agrega sobre las columnas ya previstas.
- Congelar el precio del consumo es la práctica correcta para la trazabilidad contable.

## Consecuencias

- Falta la **generación server-side de PDF y su subida a Storage** (`pdf_url`), y la
  **facturación electrónica AFIP** (CAE) — Fase 8.
- La consolidación al check-out es manual (botón "Emitir factura"); se puede
  automatizar disparándola en la transición a `checkout`.
