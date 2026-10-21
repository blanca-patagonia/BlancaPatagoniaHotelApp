# ADR 0041 — El asistente de IA propone acciones y una persona las confirma

- **Estado:** Aceptada
- **Fecha:** 2026-10-19
- **Origen:** pedido del usuario: «que el asistente ayude a resolver procesos».
- **Modifica:** el ADR 0039, que dejaba el asistente de solo lectura. Lo demás
  de ese ADR sigue vigente (herramientas de datos, nunca inventar números).

## Contexto

El asistente del panel ya respondía con datos reales y dudas de uso. El paso
siguiente era que también *resolviera* tareas: «avisale al equipo que mañana hay
corte de luz», «abrí una orden porque la ducha de la 12 pierde», «cargale dos
desayunos a la BP-0123».

Dejar que el modelo escriba en la base directamente tiene un problema de fondo:
un modelo de lenguaje se equivoca con seguridad. Un cargo en la reserva
equivocada o un aviso con un dato inventado son errores que alguien tiene que
ver **antes** de que existan.

## Decisión

**El asistente propone y una persona confirma.**

1. Hay herramientas `proponer_*` que **no escriben nada**. Validan lo que pidió
   el modelo, resuelven los datos contra el sistema (qué unidad, qué producto,
   si la cuenta de la reserva todavía admite cargos) y devuelven una
   **propuesta** (`lib/domain/ia-acciones.ts`).
2. La pantalla la muestra como una tarjeta con «Confirmar» y «Descartar».
3. Al confirmar, `ejecutarPropuesta` (`panel/ia/acciones.ts`) llama a la
   **misma Server Action** que usa la pantalla del módulo, con la sesión de
   quien confirma. Así los permisos (`requerirAcceso`), las validaciones, los
   avisos a la cartelera y la regla de «cuenta cerrada con la factura» son
   exactamente los de siempre y no pueden divergir. No hay lógica de escritura
   propia del asistente.
4. La propuesta vuelve del navegador, así que se **valida de nuevo** al
   confirmar, y se exige que el rol pueda usar el área de esa acción. Una
   propuesta adulterada no ejecuta nada.
5. Cada confirmación deja constancia (`ia_accion_confirmada`), con el tipo de
   acción y quién la confirmó.

**Alcance de esta primera etapa**, elegido por bajo riesgo:

- publicar un aviso;
- abrir una orden de mantenimiento;
- registrar un objeto perdido (hoy **no se ofrece**: el hotel ocultó esa área, y el asistente sólo ofrece herramientas de áreas habilitadas para el rol);
- cargar un consumo a una reserva.

Quedan **afuera, a propósito**: crear o cancelar reservas, cobrar, facturar,
emitir notas de crédito, cambiar tarifas y mudar de habitación. Tocan plata,
inventario o comprobantes fiscales. Para esos procesos el asistente guía paso a
paso con la Ayuda y deja un enlace a la pantalla (`/panel/...`, sólo rutas
internas: una URL externa sugerida por una IA es la forma más simple de llevar a
alguien a una página falsa).

## Consecuencias

- Una tarea simple pasa de varios clics a una frase y un «Confirmar».
- Sumar una acción nueva son tres pasos: el tipo y su validación en
  `ia-acciones.ts`, la herramienta `proponer_*` y un `case` que llame a la
  acción existente del módulo. Si el módulo no tiene una Server Action
  reutilizable, primero se escribe ésa.
- Nada se escribe sin una persona del otro lado. El costo es un clic por acción,
  y es deliberado.
- Una respuesta prepara como máximo tres acciones: más que eso no se revisa con
  atención.

## Adenda (2026-10-19, misma fecha) — por rol

Cada herramienta declara su área (`DefinicionHerramienta.area`) y el modelo sólo
recibe las del rol (`herramientasPara`). Con ese filtro el asistente se abrió a
**recepción** (reservas, disponibilidad, saldos, consumos, dudas de uso) y a
**housekeeping** (dudas de uso, avisos, órdenes de mantenimiento). Los datos de
plata siguen siendo herramientas del área `reportes`. La ruta rechaza además
cualquier herramienta que no se ofreció, y hay un tope de 40 consultas por hora
y por persona (`ia_consulta`).

## Adenda 2 (2026-10-19) — casi todo, salvo los cobros

A pedido del usuario («que se pueda hacer prácticamente todo con el asistente»)
el alcance se amplió a los tres grupos que eligió: **operación de reservas**
(confirmar, check-in, check-out, no-show, cancelar, mudar de habitación),
**reservas nuevas, cambios de fecha, facturas y notas de crédito**, y
**alta y actualización de huéspedes**. Los **cobros** quedaron afuera, por
decisión expresa.

**Cómo se hizo sin duplicar reglas:** el ejecutor llama a las mismas Server
Actions de las pantallas (`cambiarEstadoReserva`, `crearReservaAction`,
`emitirFactura`…). Esas acciones terminan en `redirect()`: el ejecutor atrapa
sólo ese error, lee su destino del `digest` (`destinoDeRedireccion`) y lo
traduce (`interpretarDestino`) con el MISMO mapa de mensajes de la pantalla
(`reservas/[id]/mensajes.ts`, `factura/mensajes.ts`, sacados de los `page.tsx`
para poder importarlos). Así la persona no sale del chat y la tarjeta dice
exactamente lo que diría la ficha.

**Antes de confirmar, la tarjeta muestra lo que importa:** el cargo de una
cancelación o un no-show calculado con `lib/reservas/cancelacion.ts` (el mismo
que la ficha), el precio estimado de una reserva nueva, si la unidad de destino
está libre, y un aviso explícito en lo que no tiene vuelta atrás (facturar,
nota de crédito, cancelar, no-show, check-out).

**Privacidad:** el email, el teléfono y el documento de un huésped se completan
en campos de la tarjeta y viajan directo al servidor al confirmar: nunca pasan
por la IA. La propuesta entera se retira del resultado antes de devolvérselo al
modelo. Para editar un huésped, la tarjeta no trae los datos actuales: un campo
vacío significa «no cambia» y el servidor conserva el resto de la ficha.

**Tokens:** con 27 herramientas cada llamada pesaba unos 5.000 tokens y agotaba
el cupo por minuto del plan gratuito de Groq. Se manda sólo el subconjunto
relevante a la conversación (`herramientasRelevantes`), siempre dentro de las
del rol.

## Adenda 3 (2026-10-19) — automatizaciones

- **Motor compartido** (`panel/ia/motor.ts`): la conversación con herramientas
  salió de la ruta del chat. La ruta queda con la sesión, el permiso, el cupo y
  la validación.
- **Consultas rápidas del tablero** («Resumen del día», «¿Qué necesita
  atención hoy?», `panel/ia/rapidas.ts`). El sistema junta los datos llamando a
  las mismas herramientas, dentro de los permisos del rol, y hace UNA sola
  llamada al modelo, sin herramientas, para redactarlos. Por el chat, el mismo
  resumen eran tres o cuatro vueltas que agotaban el cupo por minuto. Así,
  además, el modelo no puede citar un número que no recibió. Sólo leen.
- **Mensajes a huéspedes** (`proponer_mensaje_huesped`). La IA redacta el
  cuerpo, la persona lo corrige en la tarjeta y al confirmar entra a la bandeja
  con una plantilla nueva del catálogo, «Mensaje del hotel» (saludo, referencia
  y firma fijos). Se mantiene la regla de que nada sale «armado a mano» fuera
  del catálogo, y la bandeja aplica el consentimiento (`acepta_avisos`) y deja
  registro. El email y el nombre del huésped se leen en el servidor al
  confirmar: la IA nunca los conoce.

## Adenda 4 (2026-10-20) — buscar y consultar todo el sistema, y orden del código

- **Diez herramientas nuevas.** De consulta: `buscar_en_sistema` (el buscador
  global del panel, el mismo `buscarGlobal`, con `sinPersonas: true`: no lee
  huéspedes ni usuarios, ni el nombre del huésped de una reserva),
  `cuenta_de_reserva` (cada consumo y cada pago, con la misma cuenta consolidada
  de la ficha), `ordenes_mantenimiento`, `objetos_perdidos`, `avisos_internos`,
  `cuentas_agencias` y `cuentas_proveedores` (las vistas `saldos_*` de la 0026)
  y `salud_del_sistema` (errores, avisos fallidos y tareas atrasadas, sólo
  nombres de evento y conteos). De acción: `proponer_estado_orden` y
  `proponer_objeto_devuelto`, que al confirmar reusan `cambiarEstadoOrden` y
  `marcarDevuelto` tal cual.
- **Los textos libres del personal** (título de una orden, descripción de un
  objeto, un aviso) pasan por `enmascararDatosPersonales` antes de volver al
  modelo: alguien pudo anotar un teléfono.
- **Objetos perdidos sigue apagada** (`AREAS_OCULTAS`): sus dos herramientas
  existen pero `herramientasPara` no las ofrece y `ejecutarPropuesta` rechaza la
  tarjeta, igual que el resto del módulo. Se encienden solas al reactivarlo.
- **El código se reordenó.** `panel/ia/herramientas.ts` (1.157 líneas, un
  `switch` de 30 casos) pasó a la carpeta `panel/ia/herramientas/`, un archivo
  por tema (`comun`, `informes`, `reservas`, `operacion`, `administracion`,
  `propuestas`) y una tabla `IMPLEMENTACIONES` en `index.ts`. El contrato
  `ia-herramientas-implementadas.test.ts` compara esa tabla con el catálogo: una
  herramienta declarada sin código (el modelo la llamaría y recibiría
  «desconocida») o al revés hace fallar el test. Del lado del dominio,
  `ia-herramientas.ts` (835 líneas) se separó en catálogo (`ia-herramientas`),
  prompt (`ia-prompt`), formato de respuesta (`ia-respuesta`) y datos que
  salen al modelo (`ia-datos`). Se unificaron tres copias de «unidad por
  nombre» y dos de «huéspedes por nombre».

