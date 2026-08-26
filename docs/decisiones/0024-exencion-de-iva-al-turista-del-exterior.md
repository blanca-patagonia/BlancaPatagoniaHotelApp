# ADR 0024 — Exención de IVA al turista del exterior: derivada, no tildada

- **Estado:** Aceptada
- **Fecha:** 2026-08-24
- **Complementa:** [ADR 0004](0004-tarifas-neto-rack-iva.md) · [ADR 0012](0012-facturacion-electronica-argentina.md)
- **Origen:** relevamiento con el cliente del 15/08/2026 (pedido P1)

## Contexto

Franco pidió que las tarifas se vean con IVA y sin IVA «porque a los extranjeros
no se les cobra IVA». En las capturas de WinPAX se ve un departamento aparte
llamado **«Alojamiento Extranjero»** y el listado muestra las dos tarifas lado a
lado (*Tarifa con Iva USD 148.7 / Tarifa sin Iva USD 122.89*).

El sistema **no tenía la exención implementada**. El comentario de cabecera de
`lib/domain/precios.ts` decía que se resolvía «en la facturación — Fase 5» y el
ADR 0004 la mencionaba como eventual. El toggle «Mostrando con/sin IVA» del
listado de reservas es solo de presentación: cambia cómo se ve un número, no
exime a nadie.

### Lo que dice la norma, y por qué importa el detalle

**RG 3971/2016 (AFIP) y Decreto 1043/2016.** El alojamiento prestado a turistas
del exterior está exento de IVA. La condición **no es la nacionalidad ni el
pasaporte**. Son dos requisitos que van juntos:

1. el huésped **reside en el exterior**, y
2. el **pago se hace desde el exterior** — tarjeta emitida fuera del país o
   transferencia del exterior.

Un extranjero que paga en efectivo en pesos **no está exento**.

Ese es el punto entero de este ADR. Es el error más fácil de cometer a mano —el
propio Franco lo insinuó al decir «no es el que paga en efectivo»— y el más caro:
una factura exenta que no correspondía es IVA que el hotel no ingresó y que va a
tener que poner de su bolsillo cuando lo detecten.

## Decisión

### 1. La exención se DERIVA de dos hechos. No hay ninguna casilla «exento».

Es la decisión central y de ella salen todas las demás.

En ningún lado del sistema existe un campo que diga «esta reserva está exenta» y
que alguien pueda tildar. Hay dos hechos, cada uno guardado donde corresponde, y
la exención es una **función** de ellos:

```
exentoDeIva({ residenteExterior, pagoDesdeExterior })
```

`lib/domain/exencion-iva.ts` es la única puerta. Ni la pantalla ni la Server
Action pueden forzar el resultado.

**Por qué así y no con una casilla:** una casilla convierte una regla fiscal en
una decisión de quien está apurado en el mostrador. La consigna del pedido era
que el sistema **impida** el error, no que lo advierta. Una advertencia que se
puede ignorar con un clic no es una barrera.

### 2. Dónde vive cada hecho

| Hecho | Dónde | Por qué ahí |
|---|---|---|
| Reside en el exterior | `huespedes.residente_exterior` | Es una propiedad **de la persona**: quien vive afuera lo sigue haciendo entre una estadía y la siguiente. Cargarlo por reserva obligaría a repetirlo y a que las copias se contradigan |
| El pago viene del exterior | `reservas.pago_desde_exterior` | Cambia **en cada estadía**. El mismo huésped puede pagar con su tarjeta del exterior en marzo y en efectivo en diciembre |

`nacionalidad` ya existía y **no se usa** para esto, a propósito: un argentino
puede residir afuera y un extranjero puede vivir acá. Derivar la exención de la
nacionalidad sería reimplantar el error que la norma castiga.

### 3. `pago_desde_exterior` tiene tres estados, no dos

```
null   → todavía no se sabe    → NO exime
true   → tarjeta del exterior o transferencia → exime
false  → efectivo, tarjeta o transferencia local → NO exime
```

El `null` no es un detalle de implementación: **«no sé» y «pagó local» son cosas
distintas**, aunque las dos terminen cobrando IVA. Una es falta de dato y la otra
es un hecho comprobado. Distinguirlas permite que la pantalla diga «falta
confirmar de dónde sale el pago» en vez de afirmar algo que nadie verificó.

Ante un valor inesperado —incluido uno inventado en un POST directo— se cae en
`null`: **ante la duda, se cobra el impuesto.**

### 4. La exención se decide al FACTURAR, no al cotizar

Es la decisión con más consecuencias prácticas.

La forma de pago **se conoce recién al cobrar**. Cotizar exento y después recibir
efectivo dejaría un total que no cierra: el huésped vio USD 122,89 y hay que
cobrarle USD 148,70.

Entonces:

- **Al cotizar** el sistema no aplica nada. La reserva guarda su total con IVA,
  que es el máximo que el huésped podría deber.
- **En la ficha**, si el huésped reside en el exterior, se muestra qué pasaría:
  «al facturar, el alojamiento sale sin IVA: USD 122,89 en vez de USD 148,70».
  Es exactamente lo que WinPAX mostraba con las dos tarifas lado a lado, pero
  diciendo de qué depende.
- **Al emitir la factura** se evalúa la condición y se aplica si corresponde.

El sentido del error importa: cotizar de más y facturar de menos es una
corrección a favor del huésped. Al revés sería una discusión en el mostrador.

La ficha y `emitirFactura` llaman a **la misma función**. Si la pantalla
reimplantara la regla, un cambio en una sola de las dos copias haría que la ficha
prometiera una exención que la factura después no aplica.

### 5. Alcance: el alojamiento sí, el frigobar no

La exención alcanza al **alojamiento y al desayuno incluido en la tarifa** (van
juntos en el precio de la noche). **No** alcanza al frigobar, las excursiones,
los traslados ni a un desayuno vendido suelto: son servicios aparte y siguen
gravados.

Por eso `desglosarConExencion` recibe el alojamiento y los consumos por separado
y solo desgrava el primero.

### 6. Cómo se representa en la factura sin romper `neto + iva = total`

El sistema garantiza en todos lados que `neto + iva = total`, y hay tests que lo
fijan. Un comprobante con parte exenta y parte gravada podría romper esa igualdad
si el monto exento se sumara aparte.

La solución: **`exento` es un subconjunto de `neto`, no un tercer sumando.**

```
neto   = alojamiento sin IVA + consumos sin IVA   (todo lo no impositivo)
exento = la parte de `neto` que no tributa        (el alojamiento)
iva    = impuesto sobre (neto − exento)
total  = neto + iva                               ← la garantía se mantiene
```

Es además cómo lo modela AFIP: `ImpNeto` (gravado), `ImpOpEx` (operaciones
exentas) e `ImpIVA` viajan separados en el comprobante electrónico. `neto` los
agrupa y `exento` dice cuánto corresponde a `ImpOpEx`.

Dos restricciones en la base lo sostienen, porque una garantía que solo vive en
el código se pierde en el próximo camino de alta:

- `facturas_exento_dentro_del_neto` — `exento >= 0 and exento <= neto`. Sin esto
  un exento mayor que el neto daría una base imponible negativa.
- `facturas_exencion_fundada` — `(exento > 0) = (motivo_exencion is not null)`.
  Una exención sin la norma citada no es oponible ante una inspección, y un
  fundamento sin exención es ruido. Mismo patrón que `facturas_cae_completo`.

El fundamento va **impreso** en el comprobante, no solo guardado.

### 7. Una reserva por agencia no se exime

Si la reserva entró por convenio, el receptor del comprobante es la agencia y no
el turista, así que la exención del huésped no aplica. Está contemplado tanto en
la ficha como en `emitirFactura`.

## Alternativas descartadas

**Un departamento «Alojamiento Extranjero» aparte, como WinPAX.** Modela la
exención como una categoría de producto, y entonces aplicarla es elegir el
departamento correcto — es decir, una decisión de quien carga, exactamente lo que
hay que evitar. Además duplicaría el tarifario.

**Una casilla «exento de IVA» en la reserva.** Un campo, cero lógica y todo el
riesgo: nada impide tildarla para un huésped que paga en efectivo.

**Decidir la exención al cotizar.** Es lo que pide la intuición —el huésped
quiere saber cuánto va a pagar— pero la forma de pago no se conoce en ese
momento. Se resuelve mostrando ambos importes y diciendo de qué depende.

**Guardar solo la nacionalidad y derivar de ahí.** Es el error que la norma
castiga. La nacionalidad no determina la residencia ni el origen del pago.

## Consecuencias

**A favor:**

- El error caro —eximir a quien pagó en efectivo— es imposible desde la interfaz.
- La regla vive en un módulo puro, probado sin base ni sesión.
- El comprobante queda fiscalmente completo, con el monto exento y su fundamento.
- La garantía `neto + iva = total` sigue en pie.

**En contra, y hay que saberlo:**

- **Depende de que alguien cargue los dos datos.** Si nadie marca al huésped como
  residente en el exterior, no hay exención y el sistema no puede adivinarlo.
  Es deliberado: la alternativa es inventarla.
- **El sistema no verifica** que la tarjeta haya sido emitida en el exterior:
  registra lo que recepción declara. Verificarlo exige la pasarela real y es lo
  que habilita el [ADR 0025](0025-verificar-la-tarjeta-sin-guardar-el-numero.md).
- **Falta confirmar con el hotel** cómo operan hoy: si facturan sin IVA
  directamente o cobran y tramitan reintegro. El modelo soporta lo primero, que
  es lo que la norma prevé.

## Verificación

`tests/exencion-iva.test.ts` (15 casos, dominio puro) y seis casos de integración
en `tests/acciones/reservas.test.ts`, que emiten la factura de verdad contra
Postgres. El primero de todos, y el que da sentido al módulo:

> **un extranjero que paga en EFECTIVO local NO queda exento**

Los dos últimos verifican que las restricciones de la base rechazan un exento
mayor que el neto y una exención sin fundamento — o sea, que la garantía es de la
base y no del código que la llama.
