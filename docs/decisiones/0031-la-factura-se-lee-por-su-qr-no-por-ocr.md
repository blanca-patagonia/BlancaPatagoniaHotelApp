# ADR 0031 — La factura se lee por su QR, no por OCR

- **Estado:** Aceptada
- **Fecha:** 2026-09-07
- **Complementa:** [ADR 0030](0030-conciliacion-de-lo-que-de-verdad-entro.md)
  (los comprobantes recibidos alimentan la cuenta del proveedor y el gasto del mes)
- **Origen:** Objetivo 9 del pedido — *«que se le saque una foto a una factura y
  que se carguen los datos de esa factura a un excel»*.

## Contexto

El hotel recibe facturas de proveedores en papel y las carga a mano, una por una,
en la cuenta corriente. Es trabajo repetitivo y es donde se cuelan los errores de
tipeo que después descuadran el saldo.

El pedido nombra el gesto —sacar una foto— y no la tecnología. Eso deja abierta
la pregunta de qué se hace con la foto.

## La opción obvia, y por qué se descartó

**Reconocimiento de texto (OCR) sobre la imagen.** Tres problemas, en orden de
gravedad:

1. **El OCR adivina, y acá adivinar cuesta plata.** Un `8` leído como `3` en el
   importe da una factura **plausible y equivocada**. Nadie la revisa, porque el
   sistema «ya la cargó»: el error entra al saldo del proveedor y se descubre
   meses después, cuando alguien reclama. Un dato que parece correcto y no lo es
   es peor que un campo vacío.
2. **Saca datos fiscales del sistema.** Todos los servicios de OCR con precisión
   suficiente son de terceros y de pago: la imagen de la factura —CUIT del hotel,
   CUIT del proveedor, importes— viaja a un servidor ajeno.
3. **Cuesta por página, para siempre.** Un costo recurrente atado al volumen de
   facturas, para resolver algo que resulta que ya está resuelto.

## Decisión

**Se lee el código QR obligatorio de la factura electrónica argentina.**

Desde 2021 (RG 4892/2020) toda factura electrónica argentina lleva un QR que
codifica los datos del comprobante en JSON, en base64, dentro de una URL:

```
https://www.arca.gob.ar/fe/qr/?p=<JSON en base64>
```

Con los campos, en la versión 1 del formato: `ver`, `fecha`, `cuit` (el del
emisor), `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda`, `ctz`, `tipoDocRec`,
`nroDocRec`, `tipoCodAut` y `codAut` (el CAE).

Es decir: **exactamente los datos que había que cargar**, informados por el propio
emisor a ARCA. Leer el QR no adivina nada. Y el gesto para quien usa el sistema es
el mismo que pidió el cliente: apuntar la cámara a la factura.

### Cuatro consecuencias de esta elección

**1. El QR se lee en el navegador; la imagen no viaja ni se guarda.**

`BarcodeDetector` decodifica la foto en el dispositivo y al servidor llega sólo el
texto del código. Guardar fotos de facturas es gestión documental —Storage,
retención, permisos por campo— y tiene su propio ADR pendiente (0013); meterlo por
la puerta de atrás dejaría archivos con datos fiscales sin ninguna política de
acceso.

**2. El navegador que no puede se dice, no se esconde.**

`BarcodeDetector` existe en Chrome y Edge, también en Android, y **no** en Safari
ni en Firefox. Cuando falta, la pantalla lo declara y ofrece las dos salidas que
funcionan en todos lados: pegar el enlace que devuelve la cámara del sistema, o
cargar los datos a mano. Lo que no se hace es mostrar un botón que nunca responde.

**3. La carga manual queda, y se distingue en la lista.**

El QR no cubre todo: un ticket, un remito, una factura anterior a 2021, un papel
arrugado. Esos se cargan a mano y quedan marcados `origen_dato = 'manual'`.

Esa distinción **se muestra**, y no es decorativa: un número tipeado puede estar
mal y uno leído del QR no. Quien revise el cierre del mes tiene que poder separar
unos de otros sin preguntarle a nadie.

**4. Cargar y imputar son dos pasos.**

Escanear registra que el comprobante existe. Imputarlo dice que el hotel lo debe,
y crea el asiento en `movimientos_proveedor`. Son cosas distintas: una factura
puede llegar con un error, estar en discusión, o corresponder a otra sucursal.
Imputar sola cada factura escaneada metería en el libro mayor todo lo que alguien
apuntó con la cámara.

⚠️ **Una nota de crédito se imputa como pago, no como cargo.** Devuelve plata;
cargarla como un gasto más inflaría lo que el hotel debe, que es justo al revés.
Lo decide `esNotaDeCredito()` a partir del código de comprobante (3, 8, 13, 53),
no la pantalla.

### La idempotencia

`CUIT del emisor · tipo · punto de venta · número` identifica un comprobante de
forma única en todo el país, y es la clave `unique` de la tabla.

Pasa de verdad: la primera foto sale movida, se vuelve a intentar. Sin esa
restricción el gasto entraría dos veces y el mes cerraría mal. Con ella, el
segundo intento devuelve un mensaje que dice qué comprobante ya estaba.

### El «excel»

Es la segunda mitad del objetivo y se resuelve con lo que el panel ya tenía: el
punto único de exportación (`/panel/exportar/[recurso]`), que verifica el permiso
del área y pagina con `traerTodo` para no salir truncado en la fila 1001. Se suma
el recurso `comprobantes`, con las columnas que sirven para conciliar contra el
papel y para pasarle el archivo al contador.

## Consecuencias

**A favor**

- Los datos que entran son **autoritativos**, no probables.
- Cero dependencias nuevas y cero costo por página.
- Ninguna imagen sale del dispositivo.
- El circuito cierra con lo que ya existía: cuenta corriente del proveedor,
  antigüedad de saldos y —por el ADR 0030— el gasto del mes.

**En contra, y asumido**

- **No cubre lo que no tiene QR.** Tickets, remitos y facturas viejas se cargan a
  mano. Es una minoría del volumen, y la alternativa era que *todo* se cargara con
  un margen de error.
- **Depende del navegador.** Chrome y Edge sí; Safari y Firefox no. Se declara.
- **La foto no queda archivada.** Si el hotel necesita el respaldo digital de la
  factura, eso es el ADR 0013 y todavía no está.

## Lo que este ADR NO resuelve

- **Verificar el CAE contra ARCA.** Leer el QR dice qué informó el emisor, no que
  ARCA lo haya autorizado. Verificarlo es otro trabajo y necesita certificado
  (Bloque D de la auditoría).
- **El CUIT del hotel.** No está en ninguna tabla —es parte del mismo Bloque D—,
  así que la advertencia «esta factura no es para el hotel» queda escrita y
  apagada. **No se inventa un CUIT para encenderla**: un aviso construido sobre un
  dato inventado es peor que no tener aviso.
- **El desglose de IVA por alícuota.** El QR trae el total, no las bases
  imponibles. Para el libro de IVA compras hace falta más que esto.
