# ADR 0020 — Cotización de divisas: fuente pública con respaldo, y nunca bloqueante

- **Estado:** Aceptada
- **Fecha:** 2026-08-16
- **Cierra:** [ADR 0003](0003-moneda-usd-ars.md)

## Contexto

El [ADR 0003](0003-moneda-usd-ars.md) decidió en julio de 2026 que todos los
importes se guardan en **USD** y que el peso es una capa de presentación con
«cotización configurable». Terminó con una consecuencia anotada como pendiente:

> Hace falta un mecanismo para cargar/actualizar la cotización (Fase 3/4).

Nunca se implementó. El resultado es que hasta hoy el sistema **no sabía
convertir nada**: el Tarifario 2025/2026 manda cobrar a *«la cotización oficial
de venta billete del Banco Nación del día de pago»* y ese número no existía en
ninguna parte del código. Todo el panel y todo el portal muestran USD.

Dos restricciones del contexto real:

1. **El Banco Nación no publica una API.** Su cotización se consulta por web o se
   consume a través de terceros que la replican.
2. **El hotel opera en un contexto de alta volatilidad del peso.** Una cotización
   de hace tres días no es un dato viejo: es un error de facturación.

Y una restricción de diseño que fijó el usuario del proyecto: *una caída de la API
externa nunca puede bloquear la creación de una reserva.*

## Decisión

### 1. Fuente pública de terceros, con el Banco Nación como referencia declarada

Se consume **DolarAPI** (`dolarapi.com`, gratuita, sin credenciales) como fuente
primaria, y **ArgentinaDatos** queda implementada como alternativa. El «dólar
oficial» que publican es el que los bancos públicos usan como referencia,
incluido el Banco Nación.

Se registra explícitamente, porque para una tesis la precisión importa: **esto no
es el Banco Nación hablando.** Es un tercero que replica su valor. Si en algún
momento el hotel necesita el valor con respaldo documental del banco, el camino es
la carga manual, que existe justamente para eso.

### 2. Se cobra al valor de VENTA

No al de compra, y no a un promedio. Dos razones que apuntan al mismo lado:

- Es lo que dice el Tarifario: «venta billete».
- El hotel tiene que **comprar** los dólares que va a rendir, y los compra al
  precio de venta del banco. Usar el de compra le regala el spread —hoy unos 60
  pesos por dólar, ~4 %— a cada huésped que pague en pesos.

La conversión inversa (registrar en USD un pago hecho en pesos) usa **el mismo**
valor de venta. Si una dirección usara compra y la otra venta, convertir ida y
vuelta no cerraría y aparecerían diferencias de centavos imposibles de explicar en
una conciliación.

### 3. Cadena de respaldo de cuatro niveles, y ningún camino que bloquee

```
1. caché en memoria del proceso   (30 min — evita golpear la base en cada render)
2. fuente externa                 (DolarAPI / ArgentinaDatos, timeout 3 s)
3. última guardada en la base     (sirve aunque tenga horas)
4. → si nada de eso hay: se muestran los importes en USD
```

El nivel 4 es el que cierra la garantía. `cotizacionVigente()` devuelve `null` y
eso **no es un error**: significa «no hay conversión disponible». El USD es la
moneda real del sistema, así que mostrar USD nunca es incorrecto — es apenas menos
cómodo.

### 4. Vencida no es inservible: dos umbrales, y se sigue operando

| Antigüedad | Qué pasa |
|---|---|
| < 30 min | al día |
| ≥ 30 min | `vencida`: conviene refrescar, se usa igual |
| ≥ 12 h | `requiereAdvertencia`: la pantalla pide verificar antes de cobrar |

**Ninguno de los dos rechaza la cotización.** Si la API se cae un sábado a la
tarde, la alternativa a cobrar con el valor de la mañana es *no poder cobrar*. Un
hotel que no puede tomar una reserva porque un servicio gratuito de un tercero no
responde es un sistema peor que uno que cobra con el dólar de hace seis horas y lo
dice en pantalla.

Las 12 horas cubren un turno completo más el cambio de guardia.

### 5. Un valor manual reciente le gana a uno automático viejo

`resolverVigente` elige **por frescura, sin privilegiar la fuente**. La
consecuencia es buscada: si administración cargó un valor a mano hace diez minutos
porque la API venía dando cualquier cosa, ese valor le gana a uno automático de
hace dos horas. La carga manual es una corrección deliberada de una persona que
está mirando el pizarrón del banco; tratarla como último recurso incondicional la
volvería inútil justo cuando más sirve.

### 6. Historial, no valor único mutable

Una fila por publicación, con idempotencia por clave natural
(`unique (moneda, fuente, obtenida_en)` — mismo criterio que `pagos.external_id`).
Lo pide el propio ADR 0003: *«Los comprobantes deben registrar la cotización usada
el día de pago (trazabilidad)»*. Un registro mutable perdería esa historia en el
primer refresco.

No hay `update` ni `delete` en las políticas RLS: corregir una cotización
equivocada se hace **cargando la correcta**, que por ser más reciente gana
automáticamente. Así queda el rastro de las dos, que es lo que hace falta si hubo
que rectificar un cobro.

### 7. Tres monedas: ARS, BRL, EUR

El Calafate recibe turismo brasileño y europeo, y en temporada alta el mostrador
cobra en las tres. No se agregan más de las que el hotel usa: cada moneda es una
fila más que alguien tiene que mantener a mano el día que la fuente no responda.

El **ARS sale de una consulta directa**. El real y el euro son **cotizaciones
cruzadas**: la fuente cotiza todo contra el peso, así que
`EUR por USD = (ARS por USD) / (ARS por EUR)`. Eso implica dos llamadas y arrastra
el error de las dos — aceptable para cobros ocasionales, y la razón por la que el
peso, que se usa todos los días, no pasa por un cruce.

## Justificación

- **Cierra una decisión abierta hace un año** sin reabrir el ADR 0003: el USD
  sigue siendo la moneda base y el peso sigue siendo presentación.
- **La disponibilidad del negocio pesa más que la exactitud del número.** Cobrar
  con el dólar de hace seis horas y avisarlo es peor que cobrar con el de ahora,
  pero mucho mejor que no cobrar.
- **La entrada externa se valida en un solo punto.** Todo lo que llega de una API
  ajena pasa por `validarCotizacion`, que rechaza ceros, `null`, negativos y pares
  invertidos. Un cero que llegue hasta el cobro convierte una cuenta de USD 400 en
  «$ 0»; es el escenario que justifica la validación.
- **El adapter sigue el patrón de los otros cinco**, así que cambiar de fuente —o
  enchufar un día una API con respaldo del banco— no toca ni el dominio ni las
  pantallas.

## Consecuencias

- Aparece `COTIZACION_PROVIDER`. Por el [ADR 0018](0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md),
  **en producción es obligatoria**: si falta, el sistema falla al arrancar en lugar
  de quedar sirviendo sólo valores manuales sin que nadie se entere.
- `DOLARAPI_URL` y `ARGENTINADATOS_URL` son opcionales, para apuntar a un proxy o
  a otra instancia sin recompilar.
- El endpoint `/api/cotizacion` **exige sesión de staff**. El valor en sí es
  público, pero el servicio lee con `service_role` (saltea RLS) y un endpoint
  anónimo dejaría sin efecto la política «staff lee» de la migración 0036 por la
  puerta de atrás. Además, un endpoint público que dispara llamadas a un tercero es
  un amplificador gratis para abusar de DolarAPI en nombre del hotel.
- La tabla `cotizaciones` **no se expone a `anon`** (se revoca el `select` que la
  migración 0006 concede por defecto): `cargada_por` referencia `perfiles`, o sea
  que revelaría qué usuarios internos existen.
- El caché en memoria es **best-effort**: en serverless cada instancia tiene el
  suyo. No importa, porque el respaldo real es la tabla, que sí es compartida.
- **Queda pendiente** mostrar el equivalente en pesos en el portal público. Exige
  decidir si el huésped ve el precio convertido (y con qué advertencia), que es una
  definición de producto, no técnica.
- **No se cambió ningún importe almacenado.** Nada de esto toca `tarifas`,
  `reservas.total`, `pagos.monto` ni `facturas.total`: siguen en USD.
