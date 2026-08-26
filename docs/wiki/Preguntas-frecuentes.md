# Preguntas frecuentes y trampas conocidas

Dos partes: **por qué está hecho así** —las preguntas que se repiten al mirar el
proyecto— y **las trampas**, que son errores reales que costaron tiempo o plata y
quedaron escritos para no repetirlos.

---

## Por qué está hecho así

### ¿Por qué el anti-overbooking está en la base y no en la aplicación?

Porque una comprobación en la aplicación protege del error, y una en la base
protege además del **bug**, de la consulta escrita a mano, del script de
importación y del endpoint que alguien agregue mañana sin acordarse de la regla.

Vender dos veces la misma cabaña en El Calafate en enero es un huésped que llegó
desde el otro lado del mundo y no tiene dónde dormir, en un pueblo con todo lleno.
No es un caso para confiar en que la app esté bien.

### ¿Por qué la integración con Booking no evita el overbooking?

Porque para publicarle disponibilidad a Booking hay que ser **Connectivity
Partner**, y eso es una contratación del hotel, no código. Los dos caminos que
quedan sin serlo —el informe CSV y el feed iCal— son de **sólo lectura**.

Se declara en tres lugares: en `capacidades()`, en el resultado de envío (que
distingue «no puedo» de «fallé») y en la pantalla. **Esas advertencias no se
quitan**: la solución real es un *channel manager*
([ADR 0021](Decisiones-de-arquitectura)).

### ¿Por qué el asistente del portal no usa un modelo de lenguaje?

Porque un modelo que inventa una política de cancelación le crea al hotel una
obligación que nadie escribió. El asistente responde lo que sabe y **deriva lo que
no** ([ADR 0011](Decisiones-de-arquitectura)).

### ¿Por qué está todo en español, incluidos los nombres de las funciones?

Es un requisito de la tesis, y tiene una ventaja práctica: el código se lee igual
que la documentación y que el vocabulario del hotel. `cargoPorCancelacion` y
`rol_actual()` se entienden sin traducir.

### ¿Por qué la exportación de datos no se llama «backup»?

Porque **la aplicación no puede hacer un backup de Postgres** — eso lo hace la
plataforma. Un botón que dijera «hacer backup» daría por cubierto lo que no está,
y sería la peor función del sistema. La pantalla explica exactamente qué exporta.

### ¿Por qué hay funciones apagadas en vez de borradas?

Tres áreas —Auditoría, Conversaciones y Objetos perdidos— están apagadas por
decisión del hotel. El código, las tablas, las políticas y los tests siguen
enteros: borrar tres módulos que funcionan para reescribirlos si el hotel cambia
de idea sería tirar trabajo verificado. Se reactivan sacando el nombre de una
lista.

### ¿Por qué el sistema no cotiza en invierno?

Porque el tarifario del hotel no publica precio para junio, julio y agosto. El
portal ofrece «consultar» en vez de inventar un número.

---

## Trampas conocidas

### De la base de datos

**Un filtro sobre una tabla embebida sólo acota la fila madre si el embed es
`!inner`.** Con un embed normal, PostgREST devuelve **todas** las filas madre con
el array vacío: un filtro que no filtra y no falla. Es la trampa más silenciosa de
este stack.

**PostgREST corta en 1000 filas**, sin error y sin aviso. Toda lectura sobre una
tabla entera tiene que ir por el helper de paginado, y **contar es
`count: 'exact', head: true`** — contar en JavaScript da un número equivocado a
partir de la fila 1001 y nada falla.

**`alter type ... add value` y el primer uso de ese valor no van en la misma
migración.** Postgres corta con SQLSTATE 55P04 y el `db reset` **no aplica nada de
lo que sigue**. En cambio `create type` sí puede usarse en el archivo que lo crea.

**Dos migraciones con el mismo número no conviven.** Supabase registra la versión
por el prefijo, da la segunda por aplicada y **la saltea en silencio**.

**Un `revoke select (columna)` no recorta un `grant` de tabla previo.** Postgres lo
acepta sin error y no tiene efecto: son dos catálogos distintos. Hay que revocar el
de tabla y reponer por columna.

**PostgREST no sigue una clave foránea auto-referencial hacia el padre.** Un embed
anidado de padre devuelve los **hijos**, no el padre. La jerarquía de departamentos
se resuelve en la aplicación.

**`rangoISO(hoy, hoy)` es un rango VACÍO** y no se solapa con nada. «La noche de
hoy» se escribe `rangoISO(hoy, sumarDias(hoy, 1))`. El punto de venta salía siempre
en cero por esto y decía «no hay nadie alojado hoy».

### De Next.js 16

**No es el Next.js que conocés.** `cookies()` y `headers()` son **async**; `params`
y `searchParams` son **Promise**; `middleware` se llama `proxy.ts`. Antes de tocar
APIs de Next hay que leer `node_modules/next/dist/docs/`.

**El builder de PostgREST es *thenable*:** una función `async` no debe devolverlo
pelado, o el `await` de quien la llama ejecuta la consulta.

**`next/font/google` descarga las tipografías en el build.** Si se borra `.next` y
la descarga falla, el error se cachea y **toda la app da 500**, incluido `/login`.
Se arregla reiniciando el servidor de desarrollo.

### De la interfaz

**`truncate` no achica: agranda el ancho mínimo.** Incluye `white-space: nowrap`,
así que si algún ancestro es ítem de grilla o de flex, la caja se estira hasta que
la línea entre y el truncado **no se activa nunca**. En el hub, un apellido
compuesto estiraba una tarjeta a 557 px dentro de una pantalla de 320.

**Una celda `sticky` dentro de un contenedor con scroll se escapa del recorte** y
hace que la **página** arrastre de lado hacia espacio vacío. No se ve nada cortado,
así que es difícil de atribuir. Se resuelve con `contain-paint` en el scrollport.

**`overflow-x: auto` convierte al elemento en scrollport de los dos ejes.** Un
`sticky bottom-0` adentro se ancla a ese scrollport, no a la ventana — y si el div
no tiene altura acotada, no se pega nunca.

**Una tabla en dos columnas puede ser MÁS ALTA que en una**: la grilla alinea por
fila, y con textos desparejos se desperdicia más de lo que se ahorra. Conviene
**medir** las variantes antes de elegir.

**Los importes van por `formatearUSD`, nunca por `toLocaleString`.** Éste usa entre
0 y 3 decimales, así que la misma columna publica «USD 726», «USD 290,4» y
«USD 40,11»: el segundo parece un número cortado.

### De configuración

**`[auth.email].enable_signup` no es «no dejes que se registren»: es «habilitá el
proveedor de email».** En `false` desactiva **también el inicio de sesión con
contraseña**, que es el único camino de acceso del staff — o sea que nadie entra al
panel. Y no se nota en local, porque un contenedor que ya está corriendo conserva
la configuración con la que arrancó: el síntoma aparece recién en un entorno nuevo.
Lo destapó el CI.

**`npm run check` devuelve 0 con tests en rojo** si faltan las variables de la base.
Leé la salida, no el exit code.

### De las pasarelas de pago

**Stripe cuenta en centavos.** Mandarle `145.2` cobra un dólar cuarenta y cinco
**sin ningún error**.

**MercadoPago firma un manifiesto**, no el cuerpo crudo. Firmar lo que no
corresponde rechaza todos los eventos, y el síntoma es «el hotel dejó de enterarse
de los pagos».

**Un webhook que responde 400 a un evento que no le interesa termina
deshabilitado.** Las pasarelas mandan decenas de tipos de evento, acumulan fallos y
cortan el endpoint — y ahí se pierden también los cobros buenos. Por eso el
resultado distingue *ignorar* (200), *inválido* (400) y *reintentar* (500).

**La URL de retorno de una pasarela no es prueba de pago:** se puede abrir a mano
sin haber pagado. Quien confirma es el webhook; la pantalla lee el estado de la
base.

**`rechazado` no es un estado final de un pago.** La tarjeta se rechaza por fondos,
el huésped pone otra y aprueba, todo bajo la misma referencia externa. Si el
rechazo trabara la fila, la reserva no se saldaría nunca con la plata ya cobrada.

---

## La lista completa

Ésta es una selección. El inventario entero vive en
[`AGENTS.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/AGENTS.md),
en la sección «Trampas conocidas», y se actualiza cada vez que aparece una nueva.

Es, probablemente, el documento más útil del repositorio: cada línea es un error
que ya se cometió una vez.
