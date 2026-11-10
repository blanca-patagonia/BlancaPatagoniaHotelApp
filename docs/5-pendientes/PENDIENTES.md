# Pendientes de la rama `tesis-a-presentar`

> Lista corta y vigente. La lista de trabajo del sistema completo está en `main`.

## Antes de la entrega

1. **Correr la suite completa** con una base propia: `npm run test:aislado`
   (necesita Docker). En el entorno donde se hizo la reducción solo se pudieron
   correr los tests que no tocan Postgres (typecheck, lint, build y los tests
   sin base).
2. **Redactar la tesis** sobre el sistema reducido: `docs/1-tesis/` conserva los
   borradores del sistema completo y hay que ajustarlos al alcance de la
   [ADR 0045](../decisiones/0045-version-reducida-para-la-tesis.md).
3. **Capturas y diagramas** del sistema reducido (el DER sale de las
   migraciones; las pantallas, de la app corriendo).

## Decisiones tomadas y no reversibles sin cuidado

- **La base de datos no se achicó.** Quedan las tablas de los módulos quitados
  (ver ADR 0045). Borrarlas exige una migración nueva, verificada con
  `npm run test:aislado` y **nunca aplicada a la base compartida con `main`**.
- **El simulador de pagos** (`PAGO_PROVIDER=simulado`) sirve para la demo, pero
  en un sitio público cualquiera podría marcar su reserva como pagada. Para una
  demo abierta a internet conviene usar el sandbox de Mercado Pago o Stripe.
