# ADR 0025 — Verificar la tarjeta de garantía sin guardar el número

- **Estado:** Aceptada
- **Fecha:** 2026-08-24
- **Complementa:** [ADR 0006](0006-pagos-abstraccion-e-idempotencia.md) · [ADR 0018](0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md) · [ADR 0021](0021-canales-de-venta-solo-lectura.md)
- **Origen:** relevamiento con el cliente del 15/08/2026 (pedido P2)

## Contexto

Franco, textual: «que el sistema pruebe si la tarjeta es válida o no, porque hay
veces que ponen una tarjeta cualquiera y después cuando la querés ir a cobrar
porque no aparecieron o porque te dejaron una cena sin pagar, ya no es válida».

Es un problema real y caro: el hotel se entera de que la garantía no sirve
justo cuando la necesita, que es cuando ya no puede hacer nada.

### El pedido choca con una decisión ya tomada

En las capturas del formulario de WinPAX se ven cuatro campos: **Nro Tarjeta ·
Vto Tarjeta · Autorizacion · Pin**.

Este sistema no guarda nada de eso, y no es un olvido. La bitácora del
16/08/2026 lo dice: «WinPAX guardaba PAN, vencimiento, autorización y PIN. Este
sistema no guarda nada de eso y no se agregó — el trabajo era *no agregarlo*».
Hay un test en el lector de CSV de Booking que lo fija como contrato.

**Por qué importa.** Guardar un PAN saca al hotel del alcance **SAQ-A** de
PCI-DSS —el más liviano, para comercios que no tocan datos de tarjeta— y lo pone
en uno que exige auditoría anual, escaneo trimestral de vulnerabilidades,
segmentación de red y cifrado certificado. Un hotel de 15 unidades no puede
sostener eso. Y guardar un **PIN** no está permitido en ninguna circunstancia,
para nadie: PCI-DSS lo prohíbe explícitamente incluso cifrado.

## Decisión

### 1. Se resuelve la necesidad, no el pedido literal

La necesidad de Franco no es *tener el número*: es **saber si la tarjeta sirve
para cobrar**. Son cosas distintas y la segunda se resuelve sin la primera.

El camino es la **preautorización tokenizada**: la pasarela valida la tarjeta
contra el emisor y devuelve un token. El sistema guarda el token, los últimos
cuatro dígitos, la marca, el vencimiento y el resultado. Con el token se puede
cobrar después; con lo demás, el huésped reconoce cuál tarjeta dejó.

**Nada de eso permite reconstruir el número.**

| WinPAX guardaba | Este sistema guarda |
|---|---|
| Número completo (PAN) | Token opaco de la pasarela |
| — | Últimos 4 dígitos |
| Vencimiento | Vencimiento (MM/AA) |
| Autorización | Resultado + fecha de la verificación |
| **PIN** | **nada — está prohibido guardarlo** |

Es el argumento para el tribunal cuando pregunte por qué el sistema nuevo «tiene
menos campos» que el que reemplaza: tiene menos campos **y responde mejor la
pregunta**. WinPAX guardaba cuatro datos y no sabía si la tarjeta servía; esto
guarda menos y lo sabe.

### 2. El simulador declara que NO puede verificar. No inventa un «válida».

Es la decisión más importante del ADR.

`ProveedorStub.capacidades()` devuelve `{ verificaTarjeta: false }`, y
`verificarTarjeta` responde `{ ok: false, noSoportado: true }`.

Un stub que devolviera «válida» generaría exactamente la confianza falsa que el
ADR 0021 evitó con el overbooking de Booking: recepción dejaría pasar un
check-in confiando en una garantía que **nadie comprobó**, y el hotel se
enteraría el día que intente cobrar un no-show. Sería peor que no tener la
función, porque la función existe para dar certeza.

Por eso `ResultadoVerificacionTarjeta` tiene un campo `noSoportado` separado de
`ok`, igual que `ResultadoEnvio` en canales:

- `ok: false` sin `noSoportado` → **el emisor la rechazó**. Pedile otra tarjeta.
- `ok: false` con `noSoportado` → **no hay con qué probarla**. No sabemos nada.

Confundirlos haría que recepción le pida otra tarjeta a un huésped cuya tarjeta
está perfecta.

### 3. La verificación caduca a los 30 días

Una preautorización dice que la tarjeta servía **en ese momento**. El emisor
puede bloquearla, el titular denunciarla y el límite agotarse cualquier día
después. Una verificación de junio no dice nada en septiembre.

**Treinta días** (`DIAS_VIGENCIA_VERIFICACION`), porque cubre la ventana en que
se hace la mayoría de las reservas y porque volver a verificar es barato. Es un
número elegido, no una constante de la industria: si el hotel prefiere otro, se
cambia en un lugar.

Además, la pregunta que responde el dominio no es «¿sirve hoy?» sino **«¿va a
servir el día que haya que cobrar?»**: la fecha de referencia es la del
check-in. Una tarjeta que vence el mes que viene no sirve para una estadía de
dentro de dos meses, y el sistema lo dice antes y no después.

### 4. Las barreras contra el PAN son de la base, no del código

Los comentarios se ignoran y las convenciones se olvidan. La migración `0059`
tiene restricciones que **rechazan** un número de tarjeta:

- `reservas_tarjeta_token_no_parece_pan` — el token no puede contener 12 o más
  dígitos seguidos. Un token real lleva prefijo y letras (`tok_…`); un PAN son
  13-19 dígitos. Corta el caso concreto: que alguien pegue el número ahí.
- `reservas_tarjeta_detalle_sin_pan` — lo mismo para el texto del motivo.
- `reservas_tarjeta_ultimos4_son_4_digitos` — exactamente cuatro.
- `reservas_tarjeta_verificacion_fechada` — una verificación sin fecha no se
  puede vencer, y entonces valdría para siempre.

Verificadas ejecutándolas contra Postgres, no asumiendo que andan.

### 5. Un test-contrato que falla si alguien agrega una columna de tarjeta

`tests/garantia-tarjeta.test.ts` recorre las 59 migraciones y falla si alguna
define una columna llamada `tarjeta_numero`, `pan`, `cvv`, `codigo_seguridad`,
`tarjeta_pin` o similar.

**Se comprobó que falla:** se agregó `alter table reservas add column
tarjeta_numero text;` a la migración 0059 y la suite se puso en rojo con el
mensaje «Se agregó una columna que puede contener datos de tarjeta. Eso saca al
hotel del alcance SAQ-A de PCI-DSS». Después se revirtió. Un test-contrato que
nunca se vio fallar no protege nada.

El test distingue las líneas de definición de columna de los comentarios: este
mismo archivo y la migración mencionan «PAN» y «CVV» muchas veces, y tienen que
poder seguir haciéndolo — justamente explican por qué no se guardan.

### 6. El número viaja pero no queda

`verificarTarjetaGarantia` recibe el PAN y el CVV porque hay que pasárselos a la
pasarela. **No se guardan, no se loguean, no se devuelven y no van a la URL.** La
Server Action los usa para una llamada y los descarta.

En la pantalla, los campos del número y del código llevan `autoComplete="off"`:
un puesto de recepción es compartido y no tiene por qué quedar el número en el
autocompletado del navegador.

## Alternativas descartadas

**Guardar el número como WinPAX.** Saca al hotel de SAQ-A. Y el PIN no se puede
guardar ni cifrado.

**Guardar el número cifrado.** Suena a solución y no lo es: sigue siendo
almacenamiento de PAN a efectos de PCI-DSS, con las mismas obligaciones, más la
gestión de claves. Todo el costo, ningún beneficio.

**Un simulador que devuelva «válida» para que la función «se vea andar».** Es la
tentación de una entrega de tesis y es lo peor que se podía hacer: una garantía
falsamente verificada es peor que ninguna.

**Validar el número con el algoritmo de Luhn y llamarlo «verificación».** Luhn
detecta un dígito mal tipeado, nada más. Una tarjeta inventada que pase Luhn
—son fáciles de generar— quedaría marcada como válida. Sería exactamente el
problema que Franco describe, con un sello de aprobación encima.

## Consecuencias

**A favor:**

- Se resuelve la necesidad real sin salir de SAQ-A.
- La imposibilidad de verificar es **visible**, no silenciosa.
- El día que el hotel contrate una pasarela, se implementa `verificarTarjeta` en
  el adapter y **no se toca nada más**: ni el dominio, ni la pantalla, ni la base.
- La decisión queda protegida por restricciones de base y un test-contrato.

**En contra, y hay que decirlo:**

- **Hoy la función no verifica nada**, porque no hay pasarela contratada. Lo que
  se entregó es el mecanismo completo y la honestidad sobre su estado. Que el
  hotel pueda cobrar un no-show depende de una contratación, no de código — igual
  que el channel manager del ADR 0021.
- Los datos que se cargan sin pasarela quedan registrados como
  `no_soportado`: sirven para que el huésped reconozca su tarjeta, no como
  garantía.
- **Falta confirmar con el hotel** si tienen pasarela contratada y si la garantía
  es para cobrar no-shows o solo para «tener algo anotado». Si es lo segundo, con
  los últimos cuatro dígitos alcanza y la verificación es innecesaria.

## Verificación

`tests/garantia-tarjeta.test.ts` — 20 casos: la vigencia de la verificación, el
vencimiento al final del mes impreso (incluido febrero bisiesto), la distinción
entre rechazo y falta de pasarela, que el simulador no miente, que el resultado
serializado no contiene el número, y el test-contrato de PCI sobre las 59
migraciones.
