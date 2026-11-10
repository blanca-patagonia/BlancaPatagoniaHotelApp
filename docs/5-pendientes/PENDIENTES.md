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

## Hallazgos de la auditoría de seguridad (2026-11-10) que quedan abiertos

Cerrados en código: los tokens de las rutas públicas se validan como UUID antes de
consultar (`tests/contratos/tokens-publicos-validados.test.ts`) y las fotos de
housekeeping sólo firman rutas bajo `housekeeping/`. Quedan, por orden de peso:

1. **Los tokens de `reservas` y `encuestas_satisfaccion` los lee todo el staff.**
   La política «staff lee» deja que housekeeping pida `reservas?select=token` por la
   API y abra `/reservar/factura/<token>` (documento, CUIT, consumos), justo lo que
   la migración 0045 le había quitado. Arreglo: una migración 0128 que revoque el
   `select` de tabla y lo reponga por columna sin `token` ni `tarjeta_token` (patrón
   de la 0060), pasando a `crearClienteAdmin()` las dos lecturas del panel que hoy
   usan el token (`reservas/cobros.actions.ts`, `reservas/actions.ts`) y revisando
   cada `select('*')` sobre `reservas`. **No se escribió a ciegas:** un `select` de
   más rompe pantallas enteras y hay que probarlo con `npm run test:aislado`.
2. **Reservas web sin seña retienen la unidad 5 días** (`DIAS_EXPIRACION`) y el único
   freno es el límite por IP: unas pocas conexiones bloquean las fechas. Pide una
   decisión del hotel (retención en horas, tope por correo, verificación del correo
   o un desafío anti-bot).
3. **`housekeeping` puede marcar «inspeccionada» y reasignar mucamas** por la acción
   del tablero. No se restringió porque no está definido quién es la gobernanta:
   si es un usuario con rol `housekeeping`, la regla lo dejaría sin su función.
4. **`consultas_bot` crece sin purga** y guarda la IP del visitante (el asistente
   público lo usa como contador del límite). Agregar su purga al cron de
   mantenimiento junto con una RPC `purgar_consultas_bot`.
5. **`registrar_acceso_huesped` lo ejecuta cualquier usuario autenticado**, lo que
   permite meter ruido en `auditoria_accesos`. Agregar la guarda `rol_actual() is
   not null` (migración nueva).
6. **La exportación CSV de huéspedes no deja rastro** en `auditoria_accesos`.
