# ADR 0032 — El lado saliente del canal: se calcula y se declara que no sale

- **Estado:** Aceptada
- **Fecha:** 2026-09-07
- **Complementa:** [ADR 0021](0021-canales-de-venta-solo-lectura.md) (la
  limitación) y [ADR 0022](0022-feed-ical-saliente.md) (el paliativo parcial)
- **Origen:** Bloque E de `docs/auditoria-pms-2026-09.md`, hallazgo **P1-1**.
  Objetivos 1, 2 y 3 del pedido.

## Contexto

El ADR 0021 dice, textualmente, que el hotel puede resolver el overbooking de OTAs
contratando un channel manager y que **enchufarlo sería configuración**, porque el
puerto `CanalVentaProvider` ya declara `publicarDisponibilidad`.

**Eso no era cierto.** La auditoría lo verificó con `rg`: ese método aparece en
`lib/canales/index.ts`, en `lib/canales/booking-ical.ts` y en los tests. **Cero
llamadores.** Nadie calculaba qué publicar, nadie leía las tarifas para armarlo,
nadie lo disparaba y nadie registraba el resultado. El día que el hotel contratara
un channel manager habría que escribir todo eso además del adapter.

Y había un segundo problema, más chico y más inmediato. `importarEntrante`
resuelve el tipo de unidad así:

```ts
.from('tipos_unidad').eq('codigo', e.tipo_unidad_codigo)
```

con un comentario al lado que dice «el código del canal puede no ser el nuestro».
**Pero el código asume que sí lo es.** Si Booking llama `DBL-LAGO` a lo que el
sistema llama `DOBLE_VISTA`, la importación falla con «ese tipo no existe» y la
salida era renombrar el tipo del hotel para que coincidiera con el nombre que
eligió una OTA.

## Decisión

### 1. Se calcula el ARI aunque no se pueda publicar

`lib/domain/ari.ts` calcula, para cada tipo mapeado y cada noche de un año hacia
adelante: cupo, precio, mínimo de noches y si está cerrado. `lib/canales/ari.ts`
lo arma contra la base y llama a `publicarDisponibilidad`.

Con los proveedores disponibles hoy —informe CSV y feed iCal, ambos de solo
lectura— ese llamado devuelve `noSoportado`, y **la corrida queda registrada
diciendo exactamente eso** en `canal_sincronizaciones` con `sentido = 'salida'`.

**Por qué calcular algo que no sale a ningún lado.** Porque el trabajo real no es
el adapter: es decidir qué precio se publica, cómo se cuenta el cupo, qué pasa con
un día sin tarifa y dónde queda el rastro. Eso ya está hecho y probado. Contratar
el channel manager pasa a ser escribir su cliente HTTP, que es lo que el ADR 0021
prometía.

**Y porque el rastro sirve desde hoy.** «El canal no se está actualizando» y
«nadie corrió el proceso» son dos problemas distintos con soluciones distintas, y
sin registrar la corrida no se distinguen.

### 2. «No puedo» no es «fallé», y el cron devuelve 200

El cron `/api/cron/ari` responde **200** cuando el proveedor no puede publicar.

Con 500, el cron quedaría marcado como fallando **para siempre** —porque esa es la
situación normal hoy— y el día que sí haya un channel manager un fallo real se
perdería entre un año de rojo. El cuerpo lleva `noSoportado: true` para que ese 200
no se lea como «salió todo bien».

Es la misma distinción que `ResultadoEnvio.noSoportado` hace en el puerto y que el
cron de canales ya hacía cuando el proveedor no sondea.

### 3. Se publica el precio **rack con IVA**

Las dos mitades de esa frase son decisiones:

- **Rack y no neto.** El neto es la tarifa de agencia (ADR 0004). Publicarlo en una
  OTA rompería la paridad tarifaria que los propios contratos de OTA exigen, y le
  regalaría al canal el margen de la comisión.
- **Con IVA.** `tarifas.precio_rack` se guarda sin IVA. Publicar la columna cruda
  anunciaría un precio más bajo del que después se cobra — exactamente el bug que
  `conIva()` existe para evitar del lado público.

### 4. Un día sin tarifa **no se publica**

Las dos alternativas son peores:

- Publicar `0` es publicar **una noche gratis**. Ya pasó en este sistema, del lado
  público: el «USD 0 al reservar» de la Fase 18 fue exactamente esto.
- Publicar el precio de otro día es inventar una tarifa.

Se omite y se cuenta aparte, para que la pantalla pueda decir «faltan tarifas en 12
de los 60 días» en vez de mostrar un envío que parece completo.

### 5. Cupo cero **sí** se publica, como cerrado

Omitir un día deja al canal con el valor anterior, que es justamente el que hay que
corregir. Y un cupo 0 sin la marca de cerrado puede seguir aceptando reservas «en
lista de espera» en algunos canales.

### 6. El hotel puede guardarse inventario

`canal_tipos.tope_cupo` limita cuántas unidades se le ofrecen al canal. Un hotel
que publica todo su inventario en una OTA se queda sin nada que vender por teléfono
en temporada alta, y paga comisión por el 100 % de lo que vende. Es una decisión
comercial corriente y hasta ahora no había dónde expresarla.

### 7. El mapeo es unívoco en los dos sentidos

`unique (canal, tipo_unidad_id)` y `unique (canal, codigo_canal)`. Si dos tipos
compartieran el código del canal, `importarEntrante` no sabría a cuál resolver y la
reserva entrante caería en el tipo equivocado — con otra capacidad y otra tarifa.

## Consecuencias

**A favor**

- La promesa del ADR 0021 pasa a ser verdadera: falta el adapter, no el sistema.
- La importación deja de exigir que el hotel se llame como quiere la OTA.
- El hotel puede reservarse inventario para la venta directa.
- Queda rastro diario de que el proceso corre, con o sin efecto.

**En contra, y asumido**

- **Sigue sin evitar el overbooking.** Esto no cambia nada de eso hoy, y la
  pantalla lo dice **antes** de la tabla y no después: alguien que entra a una
  pantalla titulada «Publicación al canal» asume, con razón, que el sistema está
  informando, y esa conclusión hay que desarmarla primero.
- **Se corre un cálculo de un año todos los días para nada.** Es barato —dos
  lecturas y aritmética— y el rastro que deja vale más que lo que cuesta.

## Lo que este ADR NO resuelve

- **El adapter de channel manager.** Requiere contratarlo (~USD 50–150/mes) y
  elegir cuál. SiteMinder, Cloudbeds y Beds24 tienen API para PMS.
- **Restricciones por fecha.** El mínimo de noches y el cierre son por tipo, no por
  día. Un calendario de restricciones es otra funcionalidad; hoy publicar
  «mínimo 3 noches en el finde largo» no se puede expresar.
- **Moneda distinta de la del tarifario.** Se publica en la moneda de las tarifas.
  Convertir 365 días con una cotización que se mueve haría que el canal y el sitio
  del hotel muestren precios distintos el mismo día.
- **Paridad verificada.** Nadie comprueba que lo publicado coincida con lo que la
  OTA muestra. Eso se ve en el extranet.
