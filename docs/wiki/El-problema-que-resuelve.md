# El problema que resuelve

Esta página es el «por qué existe» del proyecto. No describe funciones: describe
lo que estaba roto, cuánto costaba y qué mecanismo concreto lo reemplaza.

---

## El hotel

**Hotel Blanca Patagonia**, El Calafate, provincia de Santa Cruz. Es un
establecimiento mixto, y esa mezcla es la que complica la gestión:

- Una **hostería boutique** con vista al Lago Argentino — single, dobles standard
  y superior, triple y una suite.
- Un conjunto de **cabañas** de 1, 2 y 3 dormitorios, de 3 a 7 personas, con
  cocina y hogar a parrilla.

Son **15 unidades repartidas en 10 tipos**. Poco inventario y mucha variedad: cada
tipo tiene su capacidad, sus amenities y su tarifa por temporada. Es el peor caso
para una planilla y un caso chico para un PMS comercial, que se cobra por
habitación y trae funciones de hotel de cadena que acá sobran.

El destino agrega su propia forma: El Calafate vive del Glaciar Perito Moreno, con
una **estacionalidad brutal**. El tarifario del hotel (Anexo A, 2025/2026) publica
tres temporadas —baja, media y alta— **de septiembre a mayo**, y no publica tarifa
de invierno: junio, julio y agosto directamente no tienen precio de lista.

---

## Lo que había

### 1. WinPAX

Un PMS de **Oracle Forms de alrededor del año 2000**. Todavía funcionaba, y ese es
el punto: no se reemplaza porque esté roto, se reemplaza por lo que impide.

| Limitación | Lo que costaba |
|---|---|
| **Monousuario, en una sola PC del mostrador** | Para saber si una habitación estaba limpia había que ir hasta esa máquina o llamar por teléfono. La mucama no tenía forma de informar nada desde el piso |
| **Sin web propia** | Ninguna reserva entraba sin intermediario o sin que alguien la cargara a mano |
| **Sin conexión con Booking** | Las reservas de la OTA se copiaban a mano del extranet al sistema. Cada copia es una oportunidad de equivocarse con una fecha |
| **Reportes fijos** | Lo que el sistema no traía impreso, se rehacía en Excel |
| **Backup manual** | Dependía de que alguien se acordara |
| **Interfaz de 2000** | Formularios de teclado, códigos que hay que saberse. Cada persona nueva en el mostrador es una capacitación |

### 2. Excel, para todo lo demás

Cuentas corrientes de agencias, consumos del bar y del restaurante, control de
mucamas, mantenimiento, objetos perdidos, proveedores, y cada reporte que la
gerencia quisiera mirar de otra manera.

El problema del Excel no es Excel: es que **los datos quedan en otro lado**. La
cuenta de una agencia vivía en una planilla que no sabía nada de las reservas que
la habían generado, así que cuadrarlas era volver a leer las dos cosas.

### 3. Booking, con el 79 % de las reservas

Ocho de cada diez reservas entraban por una OTA. Eso significa comisión sobre casi
toda la facturación, y algo menos visible pero más caro a largo plazo: **el hotel
no es dueño de la relación con su huésped**. El correo, la preferencia, el
histórico de estadías, todo queda del lado de la plataforma.

---

## Los cinco problemas de fondo

### 1. El overbooking no lo evitaba nada, solo alguien

En El Calafate en enero, vender dos veces la misma cabaña no es un error
administrativo: es un huésped que llegó desde el otro lado del mundo y no tiene
dónde dormir, en un pueblo con todo lleno.

Con WinPAX y con Excel, lo único que lo evitaba era la atención de quien cargaba.

**Cómo lo resuelve el sistema:** la garantía **no está en la aplicación, está en la
base de datos**. La tabla de estadías tiene una restricción de exclusión GiST:
dos estadías **no pueden solapar la misma unidad** si están en un estado que ocupa
inventario. Postgres rechaza el `insert`, y da igual si el bug está en la pantalla,
en la API, en un script de importación o en una consulta escrita a mano.

Es la decisión más importante del proyecto ([ADR 0002](Decisiones-de-arquitectura))
y el motivo por el que el sistema puede confiar en su propio inventario.

### 2. La dependencia de las OTAs

**Cómo lo resuelve:** un **portal público de reservas propio** —catálogo de
alojamientos con precios por temporada, búsqueda de disponibilidad sin necesidad
de crear cuenta, checkout del huésped y cobro en línea— más la importación de lo
que llega por Booking, para que esas reservas también vivan en el sistema en vez
de copiarse a mano.

Cada reserva directa es la comisión completa que no se paga, y el dato del huésped
que queda del lado del hotel.

**Corresponde declararlo explícitamente:** la integración con Booking es de **sólo
lectura**, y no evita el overbooking. Ver [abajo](#lo-que-el-sistema-no-resuelve).

### 3. El precio nunca era un solo número

Acá se juntan tres complicaciones que en la mayoría de los hoteles vienen de a una:

- **Doble precio.** Cada tipo y temporada tiene tarifa **neto** (la que se le da a
  la agencia) y **rack** (la del mostrador). Confundirlas es venderle a un
  particular al precio mayorista.
- **IVA discriminado.** Las tarifas se guardan **sin IVA** y el impuesto se calcula
  en el dominio. Y hay una exención real: el turista del exterior que paga desde el
  exterior no paga IVA — pero **el mismo extranjero pagando en efectivo sí**, que
  es el error caro y el motivo de que la exención se **derive** de los datos y no
  sea una casilla que alguien tilda.
- **Dos monedas.** El precio de lista está en **dólares** y el cobro suele ser en
  pesos, a una cotización que se mueve.

**Cómo lo resuelve:** las reglas viven en módulos de dominio puros y testeados
—`precios`, `catalogo`, `exencion-iva`, `moneda`, `divisas`— y las pantallas sólo
las muestran. El sistema calcula, no la persona.

### 4. La información encerrada en una máquina

**Cómo lo resuelve:** es una aplicación web con **cuatro roles** —admin, gerencia,
recepción, housekeeping— donde cada uno ve lo suyo. La mucama marca la habitación
como limpia desde el teléfono, en una pantalla ordenada por prioridad, y recepción
lo ve en el momento. Las 38 pantallas están hechas para andar en un celular.

### 5. Todo lo que no era una reserva vivía en Excel

**Cómo lo resuelve:** los módulos que estaban en planillas ahora comparten la base
con las reservas. La cuenta corriente de una agencia se arma con los movimientos
que generan sus propias reservas; el consumo del bar entra a la cuenta del huésped
y sale en su factura; el reporte de ocupación sale de las estadías reales.

---

## Y algo que WinPAX hacía y no se podía perder

Reemplazar un sistema viejo tiene una trampa: el sistema nuevo suele ser más lindo
y hacer menos. Por eso hubo un trabajo específico —**la modernización WinPAX**, de
once pasos— dedicado a cubrir lo que el sistema anterior sí hacía y el nuevo
todavía no:

- La **ficha de reserva completa**: VIP, adultos / menores / bebés por separado,
  cunas, plan de comidas, tipo de garantía, segmento, voucher, el «no mover» y el
  desglose fiscal.
- **Folios A y B** con división de cuenta y jerarquía de departamentos: lo que
  permite que en una habitación de tres, uno pague lo suyo y los otros lo suyo.
- El **punto de venta** con grilla por departamento y número de comanda.
- Las **vistas operativas** del listado de reservas —las diez que se usan de verdad
  en un mostrador: las que llegan hoy, las que se van, las que registran saldo
pendiente.
- **Piso y bloque** en las unidades, que es como el personal se refiere a ellas.

El plan completo, con el porqué de cada paso, está en
[`docs/modernizacion-winpax.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/modernizacion-winpax.md).

---

## Lo que el sistema NO resuelve

Un documento que sólo enumera aciertos no sirve para decidir si confiar. Estas son
las limitaciones reales, todas documentadas en el código y en la pantalla donde
corresponde:

| Límite | Por qué |
|---|---|
| **La sincronización con Booking no evita el overbooking** | Los dos caminos posibles sin ser *Connectivity Partner* —el informe CSV y el feed iCal— son de **sólo lectura**: nadie le informa a Booking qué quedó libre. La solución real es un *channel manager*, y es una contratación del hotel, no código ([ADR 0021](Decisiones-de-arquitectura)) |
| **El feed iCal de salida angosta la ventana, no la cierra** | Publica la ocupación para que la OTA la lea, pero no hay acuse ni intervalo garantizado ([ADR 0022](Decisiones-de-arquitectura)) |
| **La facturación fiscal está preparada, no conectada** | El desglose, la letra del comprobante y la validación de CUIT están hechos y probados; el CAE de ARCA/AFIP es simulado hasta que se integre el servicio real |
| **Las pasarelas de pago están escritas, faltan contratarse** | Los adaptadores de MercadoPago y Stripe están implementados y testeados. Enchufarlos es cargar credenciales, no tocar código ([ADR 0027](Decisiones-de-arquitectura)) |
| **No se envía correo real** | El adaptador de correo existe con un simulador detrás, y **falla al arrancar en producción** si no se configura de verdad, para que nadie confunda un envío simulado con uno real |
| **En junio, julio y agosto el sistema no cotiza** | El tarifario del hotel no publica tarifa de invierno. El portal ofrece «consultar» en vez de inventar un precio |
| **La aplicación no hace backups de Postgres** | Eso lo hace la plataforma. Lo que hay en el panel es una **exportación de datos operativos**, y la pantalla lo dice con todas las letras |

---

## En una línea

**Reemplaza un PMS del año 2000 y un montón de planillas por un sistema donde el
overbooking lo impide la base de datos, el precio lo calcula el sistema y el hotel
tiene un canal de venta propio** — sin prometer lo que todavía depende de una
contratación del hotel.
