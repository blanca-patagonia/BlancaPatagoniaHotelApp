# ADR 0029 — Los errores del servidor se guardan en Postgres, no en un tercero

- **Estado:** Aceptada
- **Fecha:** 2026-09-01
- **Complementa:** [ADR 0018](0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md)
- **Origen:** Fase 2 de la auditoría técnica. La auditoría externa marcó como
  riesgo de severidad alta que «sin observabilidad, la primera falla la reporta el
  hotel».

## Contexto

El diagnóstico de la auditoría —«cero logging estructurado, cero trazas»— estaba
**desactualizado**. `lib/registro.ts` ya existía: una línea JSON por evento, con
id de petición y ocultamiento de datos sensibles en dos capas. Lo que faltaba era
otra cosa, más concreta:

| Qué | Estado real antes de este ADR |
|---|---|
| `lib/registro.ts` | Existía y funcionaba. **Lo usaban 2 de ~67** call sites |
| Dónde queda una línea logueada | En el stdout de Vercel. Nadie del hotel abre esa consola |
| Excepciones no manejadas | Los 3 error boundaries las muestran con su `digest` y **no lo mandan a ningún lado** |
| `/api/salud` | Existe. **Nadie lo consulta** en un schedule |
| Ramas donde se pierde plata | El webhook de pagos y el cron de canales reportan por `console.error` |

Con siete integraciones externas —dos pasarelas, AFIP, correo, OTAs, cotización,
firma—, la pregunta no es *si* algo va a fallar de noche, sino *cuánto* va a
tardar alguien en enterarse. La respuesta era: hasta que un huésped se queja.

## Decisión

### 1. El destino de los errores es una tabla de Postgres, no Sentry

Migración 0068: tabla `errores` con `evento`, `nivel`, `detalle`, `pedido` (el id
de correlación), `digest`, `ruta`, `usuario_id`, `rol`, `datos jsonb`. RLS
activada, lectura para `admin`/`gerencia`, **sin política de INSERT** —la escribe
`service_role`, igual que `auditoria` se escribe sola desde un trigger—. Purga a
los 90 días.

**Por qué Postgres y no un servicio de terceros:**

- **Los datos de huéspedes no salen del sistema.** Un mensaje de error arrastra
  con frecuencia el dato que lo causó: un nombre, un número de reserva, a veces
  el cuerpo de una consulta. Mandar eso a un tercero es exportar datos personales
  a un procesador que el hotel no eligió ni declaró.
- **Sin dependencias nuevas.** `AGENTS.md` pide avisar antes de sumar una, y lo
  que Sentry aporta —agrupar, alertar— acá se reduce a una tabla y una pantalla.
- **Se ve desde el panel.** El hotel no depende de que alguien abra el log de una
  plataforma ni de tener una cuenta más.

### 2. `errores` NO es `auditoria`, y no hay que confundirlas

| | `auditoria` (0020) | `errores` (0068) |
|---|---|---|
| Qué registra | Operaciones **exitosas** en tablas de dinero | Lo que **falló** |
| Quién escribe | Triggers de Postgres | `lib/registro.ts` vía `service_role` |
| Para qué sirve | Expediente del hotel: quién cambió qué | Diagnóstico: por qué se rompió algo |
| Backup | Incluida | Excluida (se purga sola) |

Un error no es una operación sensible y una operación sensible no es un error.
La observabilidad es **aditiva** a `auditoria`.

### 3. `instrumentation.ts` captura lo que nadie manejó

El gancho `onRequestError` de Next se dispara cuando el servidor captura una
excepción, con el mismo `digest` que se le muestra al usuario en la pantalla de
error. Ese digest es **el único hilo** entre «me salió un error» y el stack del
servidor: los boundaries ya lo mostraban y era de solo escritura.

Cubre lo que **no** se maneja. Los errores que el código sí maneja —una escritura
rechazada, una pasarela que dice que no— siguen yendo por `lib/acciones.ts` y
`lib/registro.ts`, que tienen mucho más contexto. Los dos caminos terminan en la
misma tabla.

### 4. El sink nunca rompe la petición que estaba registrando

Tres reglas en `lib/registro.ts`:

- **Nunca lanza.** Un logger que rompe la operación que estaba logueando es peor
  que no tener logger. Todo va envuelto; el fallo del sink se reporta por stdout.
- **Nunca bloquea de más.** Corte a 2 s: es un log, no la operación.
- **El stdout va primero, el sink después.** Si la base es justamente lo que
  falla, la línea ya salió.

`registrarErrorSync` —que usa `cortarSiFalla`, que lanza `redirect`— escribe el
sink con `after()`, el mecanismo de Next para trabajo posterior a la respuesta.

### 5. `/api/salud` se monitorea, pero no se toca

Se agrega una entrada de cron en `vercel.json` que lo golpea. El handler **no**
cambia: su comentario explica bien por qué no consulta las 7 integraciones —«un
monitor que le pega a AFIP cada treinta segundos es un problema, no una
solución»—.

## Alternativas descartadas

- **Sentry / un APM.** Estándar de la industria, alertas listas. Pero suma una
  dependencia, exige una cuenta y un DSN, y —lo que decide— manda datos de
  huéspedes a un tercero que el hotel no eligió.
- **Solo adoptar `registro.ts` en los ~65 call sites y dejar todo en stdout.** Lo
  más liviano, pero si el hotel no mira los logs de Vercel, un error de la
  madrugada sigue sin avisarle a nadie.
- **Un canal de alertas (correo, WhatsApp) por cada error.** Ruidoso: un sistema
  en uso siempre registra algo. Con la pantalla y el KPI «hoy», quien administra
  ve si hay algo pasando sin recibir cien notificaciones.

## Consecuencias

- Una falla del servidor queda registrada donde el hotel la puede ver, con el
  código que vio quien se la topó.
- La tabla se purga sola: no se vuelve el objeto más grande de la base.
- Adoptar `registrarError`/`registrarAviso` en los ~65 `console.*` crudos que
  quedan es trabajo pendiente, priorizando las ramas donde se pierde plata.
- Sigue sin haber tests E2E ni captura del lado del cliente (`instrumentation-client`).
