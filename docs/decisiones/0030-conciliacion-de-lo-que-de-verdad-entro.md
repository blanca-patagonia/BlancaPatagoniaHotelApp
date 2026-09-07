# ADR 0030 — Conciliación: de dónde salen los movimientos y qué se cierra solo

- **Estado:** Aceptada
- **Fecha:** 2026-09-06
- **Complementa:** [ADR 0027](0027-cobro-en-linea-dos-pasarelas-y-una-sola-moneda-de-saldo.md)
  (la invariante de moneda), [ADR 0021](0021-canales-de-venta-solo-lectura.md)
  (declarar lo que una integración **no** puede hacer)
- **Origen:** Bloque C de la auditoría `docs/auditoria-pms-2026-09.md`. Cierra los
  objetivos 4 («análisis y conciliación de facturas») y 10 («que se conecte a
  Mercado Pago y Santander y ver los gastos mensuales») del pedido.

## Contexto

El sistema sabía lo que **debería** haber cobrado y no tenía ninguna forma de
contrastarlo contra lo que de verdad entró a la cuenta. Tres consecuencias, todas
de plata:

| Situación | Qué pasaba antes |
|---|---|
| El webhook de la pasarela se pierde | El sistema dice impago y el dinero está en la cuenta. Nadie se entera |
| MercadoPago descuenta más comisión de la pactada | No se detecta: no hay contra qué comparar |
| Gastos del mes | No existen en el sistema. Se cargan de a uno a mano, o no se cargan |

La migración 0067 había agregado `cupon` y `ultimos4` «para conciliar contra la
liquidación», y esa conciliación nunca se escribió. `canal_cargos.estado_conciliacion`
existía desde la 0049 con sus tres valores, su índice parcial y su columna en
pantalla, y **ninguna parte de la aplicación lo escribía**: todos los cargos
quedaban `devengado` para siempre.

## Decisión

### 1. Una sola tabla para las dos fuentes, con el importe **con signo**

Migración 0077: `movimientos_externos`, con `origen` (`banco` / `mercadopago` /
`stripe`), `external_id`, `fecha`, `monto`, `moneda`, `estado` y `pago_id`.

El extracto del banco y la liquidación de la pasarela son la misma clase de cosa:
una lista de movimientos con fecha, importe y una referencia. Lo que cambia entre
ellas es el importador, no el dato; dos tablas duplicarían la conciliación y el
listado sin ganar nada.

**El importe va con signo** —positivo lo que entró, negativo lo que salió— y **no**
hay una columna `tipo`. Un `tipo` aparte obliga a recordar el signo en cada suma, y
ése es el error que aparece después como un total que no cierra.

**La idempotencia la impone la base**: `unique (origen, external_id)`. Nadie se
acuerda de si ya subió el extracto del mes; sin esa restricción, subirlo dos veces
duplica todo y el mes cierra al doble sin ningún error. Cuando la fuente no trae un
id propio, el importador arma uno determinístico con fecha+importe+descripción **y
un ordinal**: dos movimientos idénticos el mismo día son legítimos —dos cafés de
$3.500— y sin el ordinal el segundo se perdería en silencio, que es exactamente el
fallo que la idempotencia venía a evitar.

### 2. El banco entra por archivo. **No se raspa el home banking.**

Santander Argentina **no publica una API de movimientos para clientes**. No hay
banca abierta obligatoria en el país como en Brasil o el Reino Unido; el Home
Banking de empresas exporta el extracto en CSV, XLS y PDF y ahí termina la oferta.

La forma disponible es que alguien baje ese archivo y lo suba, y eso es lo que hace
`lib/conciliacion/extracto-csv.ts`.

**No se automatiza con las credenciales del hotel.** Guardar la clave del home
banking para raspar la web sería a la vez una violación de los términos del banco y
el peor secreto que este sistema podría almacenar. El día que el hotel contrate un
agregador bancario con API, se escribe otra implementación del puerto.

El puerto `ExtractoProvider` declara esto en el tipo y no en un comentario: el
proveedor de banco devuelve `puedeConsultar: false` y su `consultar()` responde
`noSoportado`, que **distingue «el banco no tiene API» de «la API del banco no
respondió»**. Es la misma separación que `ResultadoEnvio.noSoportado` en canales
(ADR 0021). Sin ella, la pantalla mostraría un error rojo permanente sobre algo que
funciona exactamente como tiene que funcionar.

### 3. MercadoPago sí entra por API, y se pide el reporte de **liquidaciones**

Endpoints verificados contra la documentación oficial:

```
POST /v1/account/settlement_report            → pide generarlo. Responde 202.
GET  /v1/account/settlement_report            → lista los ya generados.
GET  /v1/account/settlement_report/{nombre}   → descarga el CSV.
```

**Se usa el reporte de liquidaciones y no `/v1/payments/search`**, y la diferencia
es la que hace útil a toda la función: buscar pagos devuelve lo que la pasarela
**aprobó**; el reporte devuelve lo que **acreditó**, con `SETTLEMENT_NET_AMOUNT`,
que es el impacto real en el saldo una vez descontadas comisión, financiación e
impuestos. Conciliar contra el importe aprobado dejaría siempre una diferencia
igual a la comisión, en todas las filas y para siempre — y esa diferencia es
justamente lo que hay que poder auditar.

Se guarda el **neto**; el bruto y la comisión quedan en la descripción, para poder
explicar la diferencia sin volver al archivo.

**La generación es asincrónica y la aplicación no hace polling.** El POST devuelve
202 «pending», no el archivo. Si el reporte del período no está, se pide y se avisa
que hay que volver en unos minutos. Dejar la petición del panel esperando a un
tercero es la forma de que la pantalla quede colgada y después nadie sepa por qué.

No hace falta una credencial nueva: es el mismo `MERCADOPAGO_ACCESS_TOKEN` del
cobro.

### 4. La conciliación **propone**; sólo cierra sola lo que no admite duda

| Coincidencia | Confianza | Quién decide |
|---|---|---|
| La referencia de la pasarela (`EXTERNAL_REFERENCE` = `pagos.external_id`) | exacta | **El sistema**, si es única |
| Importe igual, misma moneda, fecha dentro de 5 días | probable | **Una persona** |

Ésta es la decisión más importante del ADR. Casar por importe y fecha **parece**
razonable y no lo es: dos huéspedes que pagan la misma seña el mismo día es lo más
común del mundo, y casar el cobro con la reserva equivocada deja a uno figurando
impago y al otro pagado sin haber pagado. Un emparejamiento automático que se
equivoca ahí **no lo revisa nadie después**: la reserva queda marcada como cobrada
y sale de todas las listas de pendientes.

Dos pagos con la misma referencia tampoco cierran solos: significa que algo está
mal en los datos, y elegir cualquiera de los dos sería elegir al azar.

Los cinco días de tolerancia salen de la operación real: MercadoPago liquida a los
2 días hábiles en su plan estándar y una transferencia del viernes aparece el
lunes. Exigir la misma fecha no encontraría casi nada.

### 5. Ignorar deja rastro; cerrar una conciliación también

Un movimiento sin contrapartida en el sistema —un gasto, una transferencia entre
cuentas propias— se marca `ignorado` **con un motivo obligatorio**. Deja de
aparecer como pendiente pero sigue contando en los gastos del mes: ignorar no es
esconder.

Lo mismo del lado del canal (migración 0079): `canal_cargos` gana `conciliado_por`,
`conciliado_en` y `nota_conciliacion`, con dos `check` que la base impone —marcar
«en disputa» exige escribir por qué, y salir de «devengado» exige firma y fecha—.
Una disputa sin motivo es un reclamo que nadie puede sostener meses después, cuando
el canal conteste.

**Ningún automatismo concilia un cargo del canal.** Decidir que una diferencia es
aceptable es una decisión de gerencia, no un efecto secundario de cargar un número.

### 6. Los gastos del mes se agrupan **por moneda**

Sumar pesos con dólares en un mismo total da un número que no significa nada, y con
la inflación argentina el error ni siquiera se ve raro. Cada moneda tiene su propia
tabla en la pantalla.

Los egresos se muestran **en positivo**: nadie lee «gastos: −1.482.300» sin dudar
del signo. El neto conserva el signo, que ahí sí significa algo.

Los conceptos se agrupan por las primeras palabras significativas de la descripción
del banco, después de sacarle los números. **No se clasifica automáticamente**: un
clasificador que se equivoca esconde el gasto en la categoría equivocada, que es
peor que no tener categorías.

## Consecuencias

**A favor**

- Un cobro que la pasarela hizo y el webhook perdió ahora se ve, y se puede imputar.
- La comisión de MercadoPago queda comparable contra lo pactado.
- Los gastos del mes existen, con su detalle, sin cargarlos a mano.
- Reimportar un archivo es seguro, y eso quita el miedo que hace que nadie lo suba.

**En contra, y asumido**

- **El extracto del banco depende de que alguien lo suba.** Si nadie lo hace, la
  conciliación no pasa. Es el precio de no guardar la clave del banco, y la
  pantalla lo dice en vez de aparentar que se actualiza sola.
- **La conciliación por importe y fecha es trabajo manual.** Es deliberado; ver el
  punto 4.
- **Los movimientos anteriores a esta fecha no existen.** No hay backfill posible:
  el dato nunca estuvo en el sistema. Se importa hacia atrás lo que el banco deje
  exportar.

## Lo que este ADR NO resuelve

- **Extracto en PDF.** El importador lee CSV. Un PDF de banco es un problema
  distinto —posicional, sin estructura— y resolverlo mal daría movimientos
  plausibles y equivocados.
- **Multi-cuenta con reglas propias.** `cuenta` es un texto libre para distinguir
  una cuenta de otra; no hay un padrón de cuentas con su moneda y su titular.
- **Conciliación contra `movimientos_proveedor`.** Hoy se concilia contra `pagos`,
  que es lo que el hotel **cobra**. Los egresos quedan como gasto y no se casan
  contra la factura del proveedor que los originó. Es el paso siguiente natural.
