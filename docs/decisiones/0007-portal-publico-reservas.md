# ADR 0007 — Portal público de reservas

- **Estado:** Aceptada
- **Fecha:** 2026-07-27

## Contexto

El huésped final debe poder reservar online sin cuenta, reduciendo la dependencia
de las OTA. El portal reutiliza el motor de disponibilidad, la cotización y la
capa de pagos ya construidos.

## Decisión

- **Rutas públicas** (`/reservar`, `/reservar/checkout`, `/reservar/confirmacion/[codigo]`)
  sin autenticación. La búsqueda usa `disponibilidad_por_tipo` (SECURITY DEFINER) y
  `cotizar_estadia` (ambas accesibles por `anon`); el público paga tarifa **rack**.
- **Creación de la reserva** vía **Server Action con `service_role`**
  (`crearReservaPublica`): el visitante es anónimo y RLS no le permite escribir
  reservas. La acción valida disponibilidad, asigna una unidad libre, cotiza y crea
  la reserva en estado **`pendiente`** (canal `web`), que **bloquea el inventario**
  por la restricción de exclusión (anti-overbooking en tiempo real). La reserva se
  confirma con el pago de la seña.
- **Confirmación** por `codigo` (actúa como token), consultada con `service_role`.
- **Email de confirmación**: `lib/email/confirmacion.ts` (stub, ver ADR 0006 para el
  mismo criterio de "preparado, no enviado").

## Justificación

- Sin credenciales de pasarela ni servidor de email, el flujo es **completo y
  demostrable**: la reserva se registra y bloquea la unidad al instante.
- Toda la escritura pública pasa por un único punto controlado (`service_role` en el
  servidor); el resto del sistema y su RLS quedan intactos.

## Consecuencias

- Las reservas `pendiente` retienen inventario: hace falta una **expiración de seña**
  (job que cancele las no señadas a los 5 días) — Fase 5/7.
- Falta rate-limiting / anti-abuso en el endpoint público y el envío real de email.
- El pago de la seña online se habilita cuando se integren las pasarelas (ADR 0006).
