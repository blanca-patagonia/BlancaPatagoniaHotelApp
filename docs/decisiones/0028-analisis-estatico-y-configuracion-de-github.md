# ADR 0028 — Análisis estático propio, y la parte de la seguridad que no vive en el repositorio

- **Estado:** Aceptada
- **Fecha:** 2026-08-26
- **Complementa:** [ADR 0018](0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md) · [ADR 0016](0016-precio-neto-fuera-del-alcance-publico.md)

## Contexto

La auditoría de seguridad del proyecto se hizo **leyendo el código**: doce fases,
cada hallazgo verificado ejecutándolo antes y después. Eso encontró cosas caras —el
precio neto expuesto a `anon`, el webhook que fallaba abierto, los tokens de socio
al alcance de housekeeping— y no se puede repetir en cada commit: son horas de
lectura por vez.

Lo que corre en cada push cubre otras tres capas y ninguna es ésta:

| Herramienta | Qué mira |
|---|---|
| `npm audit` | Vulnerabilidades **de las dependencias** |
| `tsc` | Que los **tipos** cierren |
| ESLint | **Estilo** y errores comunes de JavaScript |

Falta el análisis del **código propio buscando patrones de vulnerabilidad**: el
dato del request que llega hasta una consulta, la redirección armada con algo que
mandó el usuario, la expresión regular que se cuelga con la entrada correcta. Son
bugs con el tipo perfectamente válido y el estilo impecable; ninguna de las tres
herramientas de arriba los ve.

Al mismo tiempo apareció algo que el repositorio no puede resolver solo: el panel
**Security and quality** de GitHub tenía cinco funciones apagadas, entre ellas el
canal privado de reportes que `SECURITY.md` **ya promete por escrito**.

## Decisión

### 1. CodeQL, versionado en el repositorio y no configurado desde la web

GitHub ofrece dos caminos: el *default setup*, que es una casilla en la web, y el
*advanced setup*, que es un workflow en `.github/workflows/`. Se elige el segundo.

El motivo es el mismo por el que este proyecto documenta cada decisión en un ADR:
una casilla no explica nada, no se revisa en un PR, no queda en el historial y no
viaja con el repositorio. El workflow dice **qué consultas se corren y por qué**,
y el día que un hallazgo sea un falso positivo se puede discutir el cambio en un
diff en vez de en la memoria de alguien.

Además el análisis corre con `build-mode: none` —JavaScript y TypeScript se
analizan desde el fuente— así que **no necesita Docker, ni Supabase, ni las
variables de entorno del CI**. Es un workflow de dos minutos que no puede romperse
por las mismas razones por las que se rompe el CI.

### 2. `security-extended`, y explícitamente no `security-and-quality`

Se suman las consultas de menor certeza, porque el sistema maneja datos de
huéspedes y dinero y ahí conviene mirar de más. Lo que **no** se suma es el
paquete de calidad: son reglas de estilo y mantenibilidad que acá ya cubre ESLint,
y duplicarlas llena el panel de hallazgos que nadie va a triar.

Es el mismo criterio que fijó `npm audit --audit-level=high`: **un tablero con
ruido se deja de leer, y uno que se dejó de leer es igual a uno apagado.**

### 3. Para los secretos, lo de GitHub y no una acción de terceros

Se evaluó agregar un escáner de secretos al CI. Se descarta por dos razones.

La primera es de fondo: **el CI corre después del push**, y un secreto que llegó al
historial ya está comprometido — hay que rotarlo, no borrarlo. El *push protection*
de GitHub rechaza el push **antes**, que es el único momento en que el problema
todavía no ocurrió.

La segunda es la regla del repositorio: *no agregues dependencias sin avisar*. Una
acción de terceros en el CI es una dependencia que además corre con permisos sobre
el repositorio. `github/codeql-action` y `actions/dependency-review-action` son de
GitHub; un escáner de secretos de terceros no lo sería, y vendría a hacer peor lo
que la plataforma hace gratis en un repositorio público.

### 4. Lo que no puede vivir en el repositorio se documenta, no se deja implícito

Cinco de las funciones del panel son casillas de la web: no hay archivo que las
encienda. Antes que dejarlas como conocimiento de quien las miró una vez, se
escriben en [`docs/github.md`](../github.md), con el estado de cada una, qué pasa
si sigue apagada y cómo se activa.

El caso que lo justifica es concreto: `SECURITY.md` manda a reportar por
*Security → Report a vulnerability*, y ese botón **no existe** mientras el
*private vulnerability reporting* esté apagado. Es una promesa rota que ningún
test podía detectar, porque no está en el código.

## Consecuencias

- La pestaña Security pasa a tener hallazgos que hay que **triar**. Descartar uno
  se hace con *Dismiss* y motivo; dejarlos acumulados vacía de sentido todo esto.
- La primera corrida de `security-extended` probablemente traiga falsos positivos.
  Es el costo aceptado de la cobertura extra, y se paga una sola vez.
- CodeQL corre sobre `main`, sobre los PRs y **una vez por semana**. Lo último no
  es redundante: las consultas se actualizan, así que una corrida nueva sobre el
  mismo código encuentra lo que la anterior todavía no buscaba.
- Parte de la seguridad del repositorio queda fuera del control de versiones. Se
  asume, con el documento como contrapeso.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| *Default setup* de code scanning (la casilla) | No queda en el repositorio, no se revisa en un PR y no explica qué corre |
| `security-and-quality` | Duplica ESLint y llena el panel de hallazgos de estilo |
| Escáner de secretos de terceros en el CI | Corre después del push, cuando el secreto ya está comprometido; y suma una dependencia con permisos |
| Bajar `npm audit` a `moderate` en vez de agregar `dependency-review` | Pone rojo el CI por deuda vieja que hoy no se puede arreglar. La revisión de dependencias mira sólo **lo que agrega el PR**, que siempre se puede no contraer |
| No hacer nada y confiar en la auditoría manual | No se repite por commit: son horas de lectura por vez |
