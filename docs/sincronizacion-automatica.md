# Sincronización automática de canales

> Cómo se dispara `/api/cron/canales`, qué hace y —sobre todo— **qué no hace**.

## El problema que resuelve

Hasta la incorporación del cron, **nadie sincronizaba si nadie apretaba el botón**. El
feed iCal de Booking se leía sólo cuando alguien entraba a `/panel/canales` y hacía
clic, así que una reserva que entraba el viernes a la noche podía descubrirse el lunes
—o el día del check-in, con el huésped en la puerta—.

## ⚠️ El cron ATERRIZA, no importa

Trae lo que el canal tenga y lo deja en `canal_reservas` para que alguien lo revise.
**No crea reservas.**

Es la decisión más importante del módulo. Importar significa crear una reserva
`confirmada` que ocupa inventario, y hacerlo sin que nadie mire contradice la razón por
la que existe la zona de recepción ([ADR 0021](decisiones/0021-canales-de-venta-solo-lectura.md)):
que el choque con el anti-overbooking sea **visible** en vez de perderse en un log. Un
cron que importara solo convertiría ese caso —el más caro que le puede pasar al hotel—
en una fila de error que nadie lee.

Lo que sí gana el hotel es tiempo: el conflicto de cupo se detecta al aterrizar
(migración 0052), así que el KPI de posible overbooking se enciende sin que nadie haya
entrado al sistema.

## Autenticación

Un secreto compartido en la cabecera `authorization`, comparado en tiempo constante.

**Si `CRON_SECRET` no está configurada, el handler rechaza con 503.** No existe un modo
«sin secreto»: eso convertiría el endpoint en una puerta pública que escribe en la base
con `service_role`, y el fallo sería silencioso justo en producción, que es donde
importa. Mismo criterio que el [ADR 0018](decisiones/0018-los-simuladores-fallan-fuerte.md).

**La cabecera `x-vercel-cron` no es autenticación.** Vercel la agrega a sus llamadas,
pero cualquiera la escribe en un `curl`. Sirve para saber quién *dice* ser el llamador,
no para creerle. Hay un test que lo fija.

## Cómo dispararlo

### Opción A · Vercel Cron — la recomendada, con una advertencia

Ya está declarado en `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/canales", "schedule": "0 6 * * *" }] }
```

Hace falta cargar `CRON_SECRET` en las variables de entorno del proyecto en Vercel.
Vercel manda el secreto automáticamente en la cabecera `authorization` cuando esa
variable existe.

> ⚠️ **El plan Hobby permite una corrida por día, no una cada tres horas.** Por eso el
> `schedule` está en `0 6 * * *` —seis de la mañana, antes de que abra el mostrador— y
> no en algo más frecuente. Poner `0 */3 * * *` en Hobby **no falla visiblemente**: se
> ejecuta una vez al día igual, y quien lo configuró queda creyendo que corre cada tres
> horas. Si el hotel pasa a un plan pago, ahí sí conviene bajarlo a cada 3–6 horas.

### Opción B · GitHub Actions — el plan B

No depende del plan de Vercel. Un `workflow` con `schedule` y un `curl`:

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'
jobs:
  sincronizar:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "$URL/api/cron/canales" \
            -H "authorization: Bearer $SECRET"
        env:
          URL: ${{ secrets.SITIO_URL }}
          SECRET: ${{ secrets.CRON_SECRET }}
```

⚠️ Los cron de Actions **se retrasan bajo carga** y **se pausan a los 60 días sin
actividad en el repositorio**. Para un proyecto de tesis que puede quedar quieto entre
entregas, eso importa.

### Opción C · Una PC del hotel

Si no hay ni Vercel ni Actions, el mismo `curl` en el Programador de tareas de Windows
sirve. Es lo menos elegante y lo más robusto: no depende de ningún plan.

### Lo que NO se hace: sincronizar al abrir la pantalla

Es la salida tentadora y está mal por tres razones: sería un `GET` que muta, se
dispararía N veces con tres personas mirando el panel, y **no correría de noche** —que
es justamente cuando entran las reservas que después nadie ve—.

Lo que sí hace la pantalla es **avisar**: si hace más de 12 horas que no se sincroniza,
lo dice. Aviso, no acción.

## Verificar que anda

```bash
curl -i -X POST "https://<sitio>/api/cron/canales"
```

Sin cabecera tiene que responder **401**. Con el secreto correcto, **200** y un cuerpo
con `leidas`, `nuevas`, `actualizadas` y `rechazadas`.

En el panel, la tarjeta «Estado de la sincronización» muestra la última corrida con su
origen. Una que diga **`cron`** es la prueba de que el disparador funciona — y esa
distinción es la diferencia entre confiar en el sistema y no confiar.

## Lo que sigue sin resolver

El cron trae las reservas antes, pero **no evita el overbooking**: para eso habría que
publicarle disponibilidad a Booking, y eso exige un channel manager, que es una
contratación del hotel (ADR 0021). Lo que se gana es descubrir el choque el mismo día en
vez de en el check-in.
