# ADR 0026 — Interfaz azul y blanca, del registro de las plataformas de reserva

- **Estado:** Aceptada
- **Fecha:** 2026-08-25
- **Reemplaza:** [ADR 0009](0009-sistema-de-diseno-del-panel.md) en lo que hace a la paleta y la tipografía. El resto de ese ADR —los componentes compartidos, la regla de usarlos siempre— **sigue vigente**.

## Contexto

El ADR 0009 fijó una identidad visual propia tomada del entorno de El Calafate:
turquesa glaciar (`lago`), violeta de la baya (`calafate`) y naranja de la lenga
(`lenga`), con Fraunces —una serif— para los títulos.

El pedido del usuario es que la aplicación tenga **el azul y el blanco, la
tipografía y el diseño de las plataformas de reserva**, y que el login siga el
mismo registro.

Es un cambio de criterio, no un ajuste: contradice un ADR aceptado y una regla
explícita de `CLAUDE.md` («paleta de marca `lago`/`calafate`/`lenga`/`stone`; no
usar `sky` ni `amber`»). Por eso va documentado en vez de aplicado en silencio.

## Decisión

### 1. La paleta pasa a azul de acción, azul marino y ámbar

| Token | Antes | Ahora | Para qué |
|---|---|---|---|
| `lago` | turquesa glaciar | **azul de acción** (`#0071c2` en el 600) | botones, enlaces, foco, todo lo que se toca |
| `calafate` | violeta | **azul marino** (`#003580` en el 700) | encabezados y jerarquía |
| `lenga` | naranja | **ámbar** (`#febb02` en el 400) | pendientes y avisos que no son errores |
| `stone` | — | sin cambios | texto y superficies |

Los rojos de error y los verdes de éxito **no se tocan**: son convenciones que
significan lo mismo en cualquier interfaz, y cambiarlas por estética le quitaría
información a quien la lee rápido.

### 2. Los nombres de los tokens NO cambian, y es la decisión más importante

`lago`, `calafate` y `lenga` tienen **244, 15 y 98 usos** en el código.
Renombrarlos a `azul`/`marino`/`ambar` habría sido un diff de cientos de líneas
en decenas de pantallas que no se estaban tocando.

El riesgo no es el tamaño del diff sino su naturaleza: **Tailwind resuelve las
clases por texto**. Un `bg-azul-600` mal tipeado no rompe el typecheck ni el
linter — simplemente no pinta, y el elemento queda transparente. Un renombre
masivo mete decenas de oportunidades de error que ninguna herramienta detecta.

Cambiar el **valor** de cada token repinta la aplicación entera desde un solo
archivo (`app/globals.css`), deja el diff revisable de una sentada y no puede
romper una clase que antes funcionaba.

Los nombres además siguen teniendo sentido: el Lago Argentino es azul.

### 3. Una sola familia tipográfica, sin serif

Las plataformas de reserva son sans-serif de punta a punta, también en los
títulos. Fraunces daba un aire editorial que ya no corresponde, y era una familia
entera cargada para unos pocos encabezados.

Se usa **Inter**: es la sans de licencia abierta más cercana a ese registro
—grotesca neutra, muy legible en tamaños chicos, que es donde vive un panel de
gestión—.

> ⚠️ **La tipografía de Booking.com es propietaria y no se usa.** Inter es una
> alternativa libre con un aire parecido, no una copia. Lo mismo vale para el
> resto: esto toma el *registro visual* de una categoría de producto, no los
> activos de una marca.

`--font-display` sigue existiendo y ahora apunta a la misma sans, para no tocar
las decenas de `font-display` repartidas por las pantallas. La jerarquía la dan
el peso y el interletrado.

## Alternativas descartadas

**Renombrar los tokens.** Ver el punto 2: todo el riesgo, ningún beneficio
funcional.

**Mantener el turquesa y sumar el azul como acento.** Da una paleta de dos
familias frías compitiendo, que es peor que cualquiera de las dos sola.

**Copiar los activos de Booking** (su tipografía, su logotipo, sus iconos). No se
hace: son de su propiedad. Se toma el registro —azul y blanco, sans-serif, densidad
alta, mucho blanco— que es de la categoría y no de una empresa.

## Consecuencias

**A favor:**

- La aplicación queda en un registro que el huésped y el staff ya conocen de las
  plataformas donde reservan.
- Un solo archivo gobierna la paleta: cambiarla de nuevo es volver a tocar ahí.
- Se cargó una familia tipográfica menos.

**En contra, y conviene decirlo:**

- **Se pierde la identidad propia** que el ADR 0009 había construido a partir del
  entorno del hotel. Era un diferencial para una tesis, y parecerse a la
  plataforma de la que el proyecto busca **reducir la dependencia** tiene algo de
  contradictorio. Es una decisión del dueño del producto y queda registrada como tal.
- Los nombres de los tokens ya no describen su color. El comentario de
  `globals.css` lo aclara, pero alguien que lea `lenga` esperando naranja va a
  encontrar ámbar.

## Verificación

Repintado comprobado en el navegador sobre el panel, la ayuda y el login. Los
contrastes de texto sobre los nuevos fondos se revisaron contra WCAG AA en la
misma pasada, junto con el resto del relevamiento de interfaz.
