# Manual de usuario

Guía de uso del sistema, escrita para quien atiende el mostrador y no para quien
programó el sistema. Cada sección responde «cómo hago X».

La ayuda dentro del sistema (`/panel/ayuda`) tiene lo mismo filtrado por rol:
cada persona ve solo los capítulos de lo que puede hacer.

## Perfiles de usuario

- **Recepción:** inicio, ocupación, reservas (check-in / check-out), punto de
  venta y consumos, huéspedes y ayuda.
- **Gerencia:** todo lo de recepción, más housekeeping, reportes, configuración
  y los errores del sistema.
- **Administración (`admin`):** todo, más usuarios y auditoría.
- **Housekeeping:** inicio, el estado de las habitaciones, su propio trabajo del
  día y ayuda. **No ve** datos de huéspedes, pagos ni facturas.
- **Huésped:** reserva desde el portal público, sin cuenta.

Es la matriz de `src/lib/domain/permisos.ts`: el panel tiene 12 áreas (inicio,
ocupación, punto de venta, reservas, huéspedes, housekeeping, auditoría, errores,
reportes, configuración, usuarios y ayuda).

## Cotización del dólar

El sistema busca la cotización solo, todos los días. En **Configuración →
Divisas** se ve de qué fuente salió, de cuándo es, y si el valor vigente es el automático o uno
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
lo que paga un tercero (una empresa, por ejemplo).

## Housekeeping

**Mi trabajo** muestra las habitaciones ordenadas por prioridad real —no por
número— con el motivo escrito: si una habitación tiene una llegada hoy a las 15,
se limpia antes que una vacía.

La pantalla general muestra los contadores por mucama: asignadas, limpiadas y
lo que falta.

## Lo que el sistema todavía no hace

Para que nadie lo descubra en el peor momento:

- **No procesa pagos con tarjeta de verdad.** Los adaptadores de Mercado Pago,
  Stripe y Payway están escritos, pero ninguna cuenta está contratada: hasta
  entonces los pagos se registran a mano o con el pago simulado.
- **No envía correos de verdad.** Quedan anotados en la bandeja de salida, no salen.
- **El CAE de la factura es simulado.** No hay conexión con ARCA/AFIP todavía.
- **No hace backups de la base de datos.** Los hace la plataforma donde está
  alojado el sistema, no la aplicación.
