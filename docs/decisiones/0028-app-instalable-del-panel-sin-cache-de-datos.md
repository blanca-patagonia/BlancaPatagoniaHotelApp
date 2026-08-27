# ADR 0028 — La app instalable es el panel, y no cachea datos

- **Fecha:** 2026-08-27
- **Estado:** aceptada
- **Contexto:** Fase de conversión a PWA

## Contexto

El staff usa el sistema desde el teléfono —housekeeping tiene vista móvil propia
desde la modernización WinPAX— y hoy tiene que abrir el navegador y buscar la URL
cada vez. Convertirlo en una aplicación instalable (PWA) resuelve eso: se abre
desde un ícono, a pantalla completa.

Una PWA trae de fábrica una segunda capacidad, el **funcionamiento sin conexión**
por medio de un service worker. Es la parte que hay que decidir con cuidado,
porque en este sistema no es gratis.

## Decisión

### 1. Se instala el panel, no el portal público

`scope` e `id` del manifiesto son `/panel`. El navegador solo ofrece instalar
dentro de ese alcance, así que desde `/alojamientos` o `/reservar` el cartel no
aparece.

**Por qué.** El panel es la herramienta de uso diario, la que ya tiene vista
móvil y la que se abre veinte veces por turno. Un huésped, en cambio, reserva una
vez: no instala una aplicación para eso, y ofrecérselo agrega ruido a la pantalla
donde queremos que haga una sola cosa.

No hacen falta dos manifiestos. Next enlaza el manifiesto desde el `<head>` de
todas las páginas y no hay forma de emitirlo solo para algunas, pero **quien
decide dónde se ofrece instalar es `scope`**, así que con uno alcanza.

### 2. El service worker no cachea datos. Ninguno.

Se guardan únicamente los assets estáticos de Next y una pantalla de «sin
conexión». La política es una **lista blanca** en `lib/domain/pwa.ts`: lo que no
está declarado no se guarda.

**Por qué lista blanca y no lista negra.** Una lista negra («no cachear `/api`,
no cachear `/panel`») deja pasar todo lo que nadie previó: una ruta agregada
mañana se cachearía sola, y el error se descubriría cuando un dato viejo aparezca
en pantalla. Con lista blanca, agregar algo obliga a pensarlo.

**Por qué no se cachea el panel**, que es lo que uno esperaría de una PWA:

- **Una tablet de recepción es un dispositivo compartido.** Guardar el HTML de
  una pantalla autenticada deja nombres de huéspedes, números de documento y
  datos de pago en el disco del equipo, legibles después de cerrar sesión. No es
  un riesgo teórico: es el mismo criterio por el que la migración 0060 sacó los
  tokens de socio del alcance del staff.
- **Una ocupación vieja miente.** Una grilla cacheada muestra libre una unidad ya
  vendida. La base rechaza el overbooking igual —la restricción de exclusión GiST
  del ADR 0002 no depende de la app—, pero quien la usa ve un fallo
  incomprensible en lugar de la realidad. El sistema entero está construido sobre
  que la verdad la tiene la base; una copia local la contradice por diseño.

Los assets estáticos sí se cachean, y es seguro: Next les pone un hash en el
nombre, así que un contenido nuevo es una URL nueva y no hay forma de servir una
versión vieja de algo que se actualizó.

### 3. Cero escrituras diferidas

Sin background sync, sin cola de pedidos, sin `periodicsync`. El service worker
no interviene en nada que no sea un `GET`.

**Por qué.** Encolar un check-in, un consumo o un cobro para reproducirlo cuando
vuelva la red va en contra de todo el diseño: el estado de una reserva lo decide
la máquina de estados sobre la base, y una escritura reproducida diez minutos
después se aplicaría sobre una realidad distinta de la que la originó. Si no hay
red, el sistema lo dice y no finge.

### 4. El interruptor de apagado se escribe antes de encender

`public/sw.js` documenta, en su encabezado, el service worker vacío que hay que
desplegar para desregistrarlo; y `next.config.ts` le pone `Cache-Control:
no-store`.

**Por qué desde el día uno.** Un service worker roto **no se arregla con un
deploy**: queda instalado en el dispositivo de cada persona e intercepta los
pedidos con la versión vieja. Es el error clásico de las PWA. Y si además el
navegador cacheara `/sw.js`, ni siquiera se podría publicar el reemplazo que lo
apaga. El `no-store` es lo que mantiene abierta la única puerta de salida.

## Consecuencias

- El panel se instala en Android y en iOS. En iOS hay que explicar el
  procedimiento en pantalla: Safari no implementa `beforeinstallprompt` y no
  existe forma de disparar la instalación por código.
- **Sin conexión el sistema no funciona, y eso es a propósito.** Se muestra una
  pantalla que lo explica y aclara que lo ya guardado está en el servidor.
- El service worker **solo se registra en producción**. En desarrollo Next
  recompila los chunks a cada cambio sin hash estable, y una caché «primero lo
  guardado» devolvería JavaScript viejo: la pantalla dejaría de reflejar el
  código que se está editando.
- La regla vive duplicada —`lib/domain/pwa.ts` y `public/sw.js`— porque un
  service worker no pasa por el bundler y no se puede importar. Lo sostiene un
  **test-contrato** que lee el archivo y falla si las dos listas se separan,
  mismo patrón que `tests/garantia-tarjeta.test.ts`.

## Alternativas descartadas

**Cachear el panel con estrategia «stale-while-revalidate».** Es lo que hace la
mayoría de las PWA y lo que sugieren las librerías del rubro. Se descartó por los
dos motivos del punto 2: filtra datos en un equipo compartido y publica
disponibilidad vencida.

**Usar `next-pwa` o Serwist.** Resuelven bien el caso general, pero traen una
dependencia y una configuración de estrategias de caché cuyo comportamiento por
defecto es justamente el que acá no queremos. El service worker que necesita este
sistema son ochenta líneas que se leen enteras; es preferible tenerlas a la vista.

**`experimental.useOffline` de Next 16.** Da UI consciente de la conectividad y
reintento automático de Server Actions sin cachear nada, así que es compatible con
este ADR. Queda afuera por ahora **porque es experimental**, y esto es un sistema
que el hotel va a usar en producción. Vale revisarlo cuando se estabilice.

**Notificaciones push.** Quedan para una fase propia: piden claves VAPID, una
tabla de suscripciones y decidir qué eventos ameritan interrumpir a alguien.

## Referencias

- `lib/domain/pwa.ts` — la política, pura y testeable
- `public/sw.js` — el service worker, con el procedimiento de apagado
- `app/manifest.ts` — el manifiesto
- `tests/pwa.test.ts` — 20 tests, incluido el contrato entre los dos archivos
- ADR 0002 (anti-overbooking en la base) y ADR 0026 (paleta azul y blanca)
