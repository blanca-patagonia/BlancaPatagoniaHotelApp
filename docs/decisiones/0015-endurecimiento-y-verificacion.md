# ADR 0015 — Endurecimiento: qué se verifica y qué se garantiza

- **Estado:** aceptada
- **Fecha:** 2026-08-03
- **Fase:** 12

## Contexto

Con el sistema funcionalmente completo se hizo una revisión crítica buscando no
funcionalidades faltantes sino **riesgos**: qué puede fallar en producción y qué
está mal verificado. Aparecieron problemas de tres clases distintas, y conviene
separarlas porque exigen respuestas distintas.

## 1. Verificación: el CI daba una garantía falsa

El workflow corría `npm test` sin credenciales de base. Los tests de integración
usan `describe.skipIf(!hayDB)`, así que **se salteaban en silencio**: el badge
quedaba verde habiendo probado 22 de 26 archivos, y los 4 que faltaban eran
justamente los que verifican el **anti-overbooking** (ADR 0002), que es la
garantía central del sistema. `typecheck` tampoco corría.

**Decisión.** El CI levanta Supabase y corre todo contra una base real. Y se
introduce `EXIGIR_DB=1`: en ese modo, la ausencia de base **lanza un error** en
lugar de saltear.

El matiz importa: sin ese interruptor, si `supabase start` fallara en CI los
tests volverían a saltearse y el pipeline quedaría verde. Un test que se saltea
en silencio es peor que un test que no existe, porque **transmite una confianza
que no corresponde**.

Localmente sigue funcionando `npm test` sin Docker: los de integración se
saltean, que es el comportamiento útil para el día a día.

## 2. Reglas de negocio ausentes

Se podía **emitir la factura de una reserva pendiente o cancelada**. No era un
problema de interfaz: la regla «solo se factura una estadía consumida» no existía
en ningún lado.

**Decisión.** `motivoNoFacturable(estado, yaTieneFactura)` en el dominio, con sus
tests. Se factura `pagada`, `in_house` o `checkout`; nunca una anulada, nunca dos
veces. La usan la acción **y** la pantalla: el botón no se ofrece cuando no
corresponde, y en su lugar se explica el motivo.

El criterio general: **si la acción va a rechazar algo, la interfaz no debería
ofrecerlo**. Mostrar un botón que falla es peor que no mostrarlo.

## 3. Concurrencia y volumen

**Numeración de comprobantes.** Se emitía con `count(*) + 1`: dos emisiones
simultáneas leen el mismo total y generan el mismo número. El índice único hace
fallar a una, pero la correlatividad por punto de venta es una obligación formal
de AFIP.

Se resolvió con un contador en tabla (`puntos_venta.ultimo_numero`) incrementado
con `update ... returning`, que toma bloqueo de fila.

**Por qué no una `sequence` de Postgres**, que sería lo obvio: las secuencias
**no se revierten en un rollback**. Una transacción fallida dejaría un hueco en
la numeración, y los huecos también son observados por AFIP. El contador con
bloqueo es más lento y es lo correcto acá.

**Saldos.** Los listados traían todos los movimientos a memoria para sumarlos en
JavaScript. Se movió a vistas agregadas con `security_invoker = true`, para que
**RLS siga aplicando**: una vista sin esa opción corre con los permisos de su
dueño y sería un agujero por el que ver datos vedados.

## 4. Operación

- **Tareas programadas** a `pg_cron`, con el bloque de creación tolerante a que
  la extensión no exista: la migración no rompe y las funciones siguen
  disponibles a mano. El recordatorio de llegadas queda manual porque envía
  correos **desde la aplicación**, no desde la base.
- **Límite de escrituras públicas** en el asistente: 5 por IP y por minuto.
  Pasado el tope **sigue respondiendo** y deja de registrar. Degradar el
  servicio de un huésped real por proteger una tabla sería el intercambio
  equivocado.
- **Validación de entorno con zod**: fallar al arrancar con un mensaje claro en
  lugar de fallar tarde como un error de red.

## Consecuencias

**A favor**

- El CI ahora respalda la afirmación «el anti-overbooking está verificado».
- La numeración correlativa es correcta bajo concurrencia, con evidencia: 10
  llamadas simultáneas devolvieron 10 números distintos.
- Los listados de cuentas dejan de degradarse con el historial.

**Limitaciones que persisten**

- **No hay tests sobre las Server Actions.** El patrón que se repitió tres veces
  en este proyecto —dominio construido y testeado que ninguna pantalla llama—
  sigue siendo invisible para la suite. Es la siguiente deuda a saldar.
- El límite del asistente es por IP: no frena a un atacante distribuido, solo
  el abuso trivial.
- `pg_cron` corre en la base: las tareas que necesitan enviar correos siguen
  dependiendo de la aplicación.
