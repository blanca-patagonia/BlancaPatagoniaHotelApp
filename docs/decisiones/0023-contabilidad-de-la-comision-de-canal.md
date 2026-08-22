# ADR 0023 — La comisión del canal, en dos capas

- **Fecha:** 2026-08-17
- **Estado:** aceptado
- **Contexto de negocio:** el hotel vende por Booking, que cobra una comisión por
  reserva y emite una factura mensual por el total. Hasta acá el sistema no podía
  responder *cuánto me dejó Booking neto de comisión*, que es la pregunta que decide
  si el canal conviene.
- **Relacionado:** [ADR 0004](0004-tarifas-neto-rack-iva.md) (el precio lo pone el
  hotel) · [ADR 0021](0021-canales-de-venta-solo-lectura.md) (la integración es de
  solo lectura) · [ADR 0003](0003-moneda-usd-base.md) y
  [ADR 0020](0020-cotizacion-de-divisas.md) (moneda)

## El problema

`canal_reservas.comision` se leía del informe del extranet, se guardaba y se
mostraba en una columna de la pantalla. Y ahí moría: `importarEntrante` **ni la
seleccionaba** de la base. Era el único dato del canal que entraba al sistema y no
llegaba a ninguna cuenta.

Consecuencias concretas: no se podía imputar el costo a la venta que lo generó, no
se podía conciliar contra la factura mensual, y el «ranking de canales» de reportes
sumaba `reservas.total` —bruto y con IVA— como si fuera lo que le quedaba al hotel.

## La decisión

Dos capas, y ninguna de las dos sola alcanzaba.

### Capa 1 — libro auxiliar por reserva: `canal_cargos`

Cada reserva que aterriza devenga su comisión en una tabla propia, con el vínculo a
la entrante y, cuando se importa, a la reserva. Es lo que permite decir «esta venta
me costó esto».

**El origen forma parte de la clave de idempotencia**, y es la decisión central del
ADR. La misma reserva puede tener dos filas de comisión: la que informó el archivo
de reservas y la que después cobró la factura mensual. **No se pisan.** Si
compartieran clave, la segunda borraría a la primera y la conciliación sería
imposible, porque el dato con el que hay que comparar ya no estaría. Compararlas sale
de la estructura y no de un reporte armado aparte.

`canal_reserva_id` es **nullable a propósito**: una línea de la factura que no se
puede atribuir a ninguna reserva significa que el canal cobró algo que no
reconocemos, y eso es exactamente lo que hay que ver. Si la columna fuera
obligatoria, esa línea habría que descartarla.

### Capa 2 — libro mayor: `proveedores` + `movimientos_proveedor`, sin tocarlas

Booking es una fila de `proveedores` y la factura mensual entra como un `cargo` con
su comprobante y su vencimiento. Con eso hereda gratis la antigüedad de saldos
(`lib/domain/antiguedad.ts`), la vista `saldos_proveedores` (0026) y el vencimiento
automático (0022). No se reimplementa nada de eso.

## Alternativas descartadas

- **Solo el libro mayor.** `movimientos_proveedor` **no tiene `reserva_id`**, así que
  la comisión no se puede imputar a la venta; y su RLS es admin/gerencia, mientras
  que quien importa los informes es **recepción**.
- **Booking como agencia, en `movimientos_cuenta`.** Era tentador porque esa tabla
  sí tiene `reserva_id`. Falla porque su `monto` tiene `check (monto >= 0)` y la
  semántica fijada es «saldo positivo → la agencia adeuda al hotel»: acá la deuda va
  al revés y no hay signo negativo posible, así que habría que invertirle el
  significado a la columna `tipo` solo para estas filas. Además `agencias` arrastra
  el pipeline comercial (`etapa`) y Booking no es un convenio que se negocie.
- **Un cargo en la cuenta del huésped.** `reservas.total` alimenta `resumenPagos` y
  `saldarSiCorresponde`, así que inflarlo con la comisión haría que la reserva
  **nunca se salde** y el huésped apareciera debiendo en el mostrador. Y como
  `facturas.reserva_id` es único (0045), la comisión terminaría facturada al huésped,
  que es fiscalmente falso: no le vendimos nada a él.
- **Devengar automáticamente un movimiento de proveedor por cada reserva.** La
  comisión de una cancelada o un no-show puede ser cero, parcial o total y no se
  adivina; se generarían cientos de movimientos de USD 12 que arruinan el aging; y
  recepción no puede escribir en esa tabla.

## Consecuencias

- El devengo por reserva lo escribe **recepción** al importar. El asiento contable lo
  crea **gerencia** con un botón cuando llega la factura, y ese botón **muestra la
  conciliación antes de crear nada**. Registrar la factura **no marca nada como
  conciliado**: decidir si una diferencia es aceptable es una decisión, no un efecto
  secundario de cargar un número.
- `canal_reservas.comision` **se conserva**. Es el dato crudo del staging, igual que
  `importe_canal`, y sirve para cotejar contra el archivo original.
- Una reserva **sin comisión informada no devenga cero**: se cuenta aparte. El feed
  iCal nunca informa comisión, así que este caso es normal, y devengar cero
  afirmaría que el canal no cobró nada. La pantalla dice «el devengado es **al
  menos** esto y faltan N por informar».
- `monto_usd` queda nulo si no había cotización al importar, y los reportes cuentan
  esas filas aparte en vez de sumarlas como cero. Una caída de la API de divisas
  **nunca** bloquea una importación (ADR 0020).

## ⚠️ El error que este ADR existe para evitar

`reservas.tarifa_tipo = 'neto'` (ADR 0004) es un **tipo de tarifa** —la de agencia,
contra la `rack` de mostrador— y **no** significa «importe al que ya se le descontó
la comisión». Son dos cosas distintas que comparten una palabra:

```
total de la reserva  = lo que paga el huésped   (con IVA)
comisión             = lo que se queda el canal (gasto del hotel)
neto de comisión     = total − comisión
```

Restarle la comisión a un total que alguien creyó «ya neto» da un número más bajo que
el real, y **no falla**: se publica como si estuviera bien. Por eso la frase está en
la pantalla de costos, en el encabezado de `lib/domain/canales-costos.ts` y acá.
