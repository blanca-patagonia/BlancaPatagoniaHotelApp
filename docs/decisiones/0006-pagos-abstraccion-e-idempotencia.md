# ADR 0006 — Pagos: registro manual, abstracción de pasarelas e idempotencia

- **Estado:** Aceptada
- **Fecha:** 2026-07-27

## Contexto

El hotel cobra **seña** (equivalente a la primera noche, según el Tarifario) y el
**saldo**, por distintos medios (efectivo, transferencia y, a futuro, MercadoPago
/ Stripe). No es posible integrar pasarelas reales en esta etapa (requieren
credenciales del hotel y mueven dinero real).

## Decisión

- **Modelo `pagos`** (migración 0009): `medio`, `tipo` (seña/saldo/reembolso),
  `monto`, `estado` y `external_id` **único** para idempotencia de webhooks.
- **Operación actual = pagos manuales:** recepción registra pagos desde el detalle
  de la reserva (`registrarPago`). Al saldarse (`resumenPagos` en
  `lib/domain/pagos.ts`), la reserva pasa automáticamente a `pagada`.
- **Abstracción `PaymentProvider`** (`lib/payments/`): contrato con `crearCheckout`,
  `verificarFirma` y `parsearWebhook`. Implementaciones **stub** para MercadoPago y
  Stripe con la forma correcta; se completan con las credenciales reales sin tocar
  el resto del sistema.
- **Webhook idempotente** `POST /api/webhooks/pagos/{proveedor}`: corre con
  `service_role`, normaliza el evento y lo inserta en `pagos`; un evento repetido
  choca con el `UNIQUE (external_id)` y se descarta (respuesta `duplicado`).

## Justificación

- El sistema es **operable hoy** (cobros manuales) y queda **preparado** para las
  pasarelas, cumpliendo el requisito sin exponer credenciales ni mover dinero.
- La idempotencia a nivel de base (UNIQUE) es robusta ante reintentos del webhook,
  igual criterio que el anti-overbooking: la garantía vive en la base.

## Consecuencias

- Falta completar `crearCheckout` / `verificarFirma` reales y la verificación de
  firma por secreto (`WEBHOOK_SECRET_<PROVEEDOR>`) cuando se contraten las pasarelas.
- Los **reembolsos** se registran como pago `tipo=reembolso`; su cálculo según la
  política de cancelación (Fase 2) se aplica manualmente por ahora.
