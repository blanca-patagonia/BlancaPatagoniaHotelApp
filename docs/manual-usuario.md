# Manual de usuario

Guía de uso del sistema, escrita para quien atiende el mostrador y no para quien
programó el sistema. Cada sección responde «cómo hago X».

La ayuda dentro del sistema (`/panel/ayuda`) tiene lo mismo filtrado por rol:
cada persona ve solo los capítulos de lo que puede hacer.

## Perfiles de usuario

- **Recepción:** reservas, check-in / check-out, consumos, huéspedes, punto de
  venta, agencias y canales de venta.
- **Gerencia:** todo lo de recepción, más reportes, mantenimiento, proveedores,
  contratos y configuración.
- **Administración (`admin`):** todo, más usuarios, auditoría y respaldos.
- **Housekeeping:** estado de las habitaciones, su propio trabajo del día,
  mantenimiento y avisos. **No ve** datos de huéspedes, pagos ni facturas.
- **Huésped:** reserva desde el portal público, sin cuenta.

## Canales de venta (Booking y otras OTA)

> ⚠️ **Lo primero que hay que entender.** El sistema **lee** de Booking; no le
> escribe. Nadie le informa a Booking qué habitaciones quedan libres, así que
> **Booking puede vender una unidad que el hotel ya vendió**. La sincronización
> avisa antes y mejor, pero no evita el overbooking. La única solución real es
> contratar un *channel manager*, y es una decisión del hotel.

### Cómo entra una reserva de Booking

Hay tres caminos, y los tres **dejan la reserva en la zona de recepción**, no en
el listado de reservas. Nada entra solo al inventario: siempre hay una persona
que revisa y confirma.

1. **Automático (todos los días).** Una tarea programada lee el feed iCal y deja
   lo nuevo en la zona de recepción. Corre a las 6 de la mañana. En la pantalla
   de Canales se ve cuándo fue la última sincronización.
2. **Botón «Sincronizar ahora».** Lo mismo, cuando no se quiere esperar.
3. **Informe CSV del extranet.** Es el que trae más datos (importes, comisiones).

### Importar el informe CSV

1. En el extranet de Booking, descargar el informe de reservas.
2. En **Canales → Importar informe**, subir el archivo.
3. Si el sistema no reconoce alguna columna, lleva a **mapear columnas**: se le
   indica una sola vez qué columna del archivo es cada dato. Queda guardado para
   las próximas importaciones.
4. Revisar lo que aterrizó en la zona de recepción y confirmar una por una.

### Conflicto de cupo

Si lo que trae el canal choca con una reserva que el hotel ya tiene, la fila
aparece marcada en rojo y el aviso se enciende en la pantalla de inicio. **No se
resuelve solo a propósito:** hay que decidir a mano qué se hace, porque es la
situación más cara que le puede pasar al hotel y no debe perderse en un registro
que nadie lee.

### Conciliar la factura del canal

Booking cobra su comisión aparte. En **Canales → Costos**:

1. Cargar la factura del canal.
2. El sistema compara lo que Booking dice que corresponde contra lo que el
   sistema calculó a partir de la comisión pactada.
3. Las diferencias quedan marcadas para revisar.

> «Neto de comisión» es el total **menos** la comisión. No confundirlo con
> `tarifa_tipo = 'neto'`, que es el tipo de tarifa (agencia contra mostrador).
> Restarle la comisión a un importe que ya la tenía descontada da un número más
> bajo **y no falla**.

### Importar reseñas

En **Canales → Reseñas**, subir el export de comentarios del extranet. El sistema
las vincula con la reserva cuando puede identificarla.

## Cotización del dólar

El sistema busca la cotización solo, todos los días. En **Configuración** se ve
de qué fuente salió, de cuándo es, y si el valor vigente es el automático o uno
cargado a mano.

El gerente puede **fijar un valor a mano** cuando quiera: ése le gana al
automático. Es lo que se usa si el hotel decide operar con una cotización
distinta a la del día.

> La fuente **no es el Banco Nación**: el BNA no publica un servicio para
> consultarlo. Se usa un tercero que replica su valor. La pantalla lo dice.

## Reservas

### Alta desde el mostrador

**Reservas → Nueva reserva.** Se elige tipo de alojamiento y fechas; el sistema
muestra qué hay libre y cotiza según la temporada. Si una estadía cruza dos
temporadas, cada noche se cotiza con su precio.

La ficha permite cargar: VIP, adultos / menores / bebés, camas extra, cunas,
plan, garantía, segmento, voucher, «no mover» y descuento.

> Los **bebés no ocupan plaza**: no cuentan para la capacidad de la unidad.

### Las diez vistas del listado

El listado tiene vistas rápidas para lo que se pregunta a diario: en el hotel,
llegadas de hoy, salidas de hoy, canceladas, no-show, grupos, particulares, con
saldo pendiente, sin asignar y todas. Cada una muestra el saldo y los totales al pie.

El botón **«Mostrando con / sin IVA»** cambia cómo se ven los precios. Es solo
presentación: no cambia lo que se cobra.

### Modificar una reserva

- **Cambiar de habitación** (mudanza): desde la ficha, respeta el anti-overbooking.
- **Reprogramar** fechas: recotiza.
- **Cancelar**: muestra el cargo que corresponde según la política antes de confirmar.

## Cuenta del huésped y punto de venta

**Punto de venta** carga consumos por departamento (frigobar, restaurante) con
número de comanda. Anular una comanda pide confirmación y dice cuántas líneas y
por qué importe.

La cuenta admite **folios A y B**: sirve para separar lo que paga el huésped de
lo que paga la agencia.

## Housekeeping

**Mi trabajo** muestra las habitaciones ordenadas por prioridad real —no por
número— con el motivo escrito: si una habitación tiene una llegada hoy a las 15,
se limpia antes que una vacía.

La pantalla general muestra los contadores por mucama: asignadas, limpiadas y
lo que falta.

## Respaldos

**Respaldos** exporta los datos operativos a un archivo verificable y registra
cuándo fue la última vez.

> ⚠️ **Esto NO es un backup de la base de datos.** El backup de Postgres lo hace
> la plataforma donde está alojado el sistema, no la aplicación. Esta pantalla
> exporta los datos para tenerlos afuera; no reemplaza al backup de la plataforma.

## Lo que el sistema todavía no hace

Para que nadie lo descubra en el peor momento:

- **No procesa pagos con tarjeta.** Los pagos se registran a mano.
- **No envía correos de verdad.** Quedan registrados, no salen.
- **El CAE de la factura es simulado.** No hay conexión con AFIP todavía.
- **No le informa disponibilidad a Booking** (ver la advertencia de arriba).
