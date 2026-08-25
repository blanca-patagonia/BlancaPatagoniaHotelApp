# ADR 0022 — Feed iCal de salida: publicar la ocupación sin prometer que evita el overbooking

- **Estado:** Aceptada
- **Fecha:** 2026-08-22
- **Complementa:** [ADR 0021](0021-canales-de-venta-solo-lectura.md) · [ADR 0014](0014-portal-de-socios-por-token.md) · [ADR 0016](0016-precio-neto-fuera-del-alcance-publico.md)

## Contexto

El ADR 0021 dejó la integración con Booking en una sola dirección: entran reservas,
mensajes y reseñas, y **no sale nada**. La consecuencia práctica es que cuando el hotel
se queda sin lugar, alguien tiene que entrar al extranet y cerrar las fechas a mano.

Eso falla justo cuando importa. El día de mucho trabajo —el que llena el hotel— es el
día en que nadie se acuerda de ir a cerrar fechas, y es exactamente el día en que
Booking puede vender una unidad que el mostrador acaba de vender.

Publicarle disponibilidad de verdad a Booking exige el protocolo ARI, que es de
Connectivity Partner: una contratación del hotel, no algo que se resuelva con código.

Pero hay un camino intermedio que no requiere permiso de nadie: **Booking, Airbnb y
Expedia pueden importar un calendario iCal**. Es el mismo formato que ya se lee de
entrada (`lib/canales/ical.ts`), en la dirección opuesta.

## Decisión

Se publica un feed iCal de salida con la ocupación del hotel, en
`GET /api/canales/ical/<token>?tipo=CODIGO` (o `?unidad=NOMBRE`).

**Y `capacidades().publicaDisponibilidad` sigue en `false`.**

Eso último es la mitad de la decisión, no un olvido. El feed es un empujón en una
dirección que el otro lado puede ignorar: no hay confirmación, no hay reintento, no hay
error si deja de leerlo. Marcarlo como «publica disponibilidad» haría desaparecer la
advertencia de la pantalla y dejaría al hotel creyendo que está cubierto.

### Cuándo se marca ocupada una noche

**Sólo cuando no queda ninguna unidad activa del tipo libre.**

Un calendario dice «ocupado» o «libre», sin cantidades. El tipo `HOST-DBL-STD` tiene
tres unidades: si se marcara ocupado al vender la primera, se cerrarían las ventas de
las otras dos y el feed **le costaría plata al hotel** en vez de ahorrársela. Es el
error caro y silencioso del módulo: no falla nada, simplemente entran menos reservas.

La contracara, dicha de frente: con varias unidades por tipo el feed avisa tarde —
recién cuando ya está todo vendido—. Rinde de verdad cuando **cada unidad es una
habitación separada en el extranet**, y para eso existe `?unidad=`. Que lo esté o no es
configuración del extranet del hotel, no algo que se decida acá. La pantalla lo dice
tipo por tipo, con el número de unidades a la vista.

### Lo que NO mitiga

| Límite | Qué significa en la práctica |
|---|---|
| **Latencia** | El canal relee cuando quiere y no promete un intervalo. Entre que se vende la última unidad y que se entera, puede vender de nuevo. **Angosta la ventana, no la cierra.** |
| **Sin acuse** | Nadie confirma que leyó ni avisa que dejó de leer. Se registra cada lectura (`canal_config.ical_leido_en`, migración 0065) y la pantalla dice «lo leyeron hace 3 h» o «hace 6 días que no lo leen». Es lo más parecido a un acuse que permite el formato: dice que **pasaron a buscarlo**, no que lo hayan aplicado. |
| **Granularidad** | El iCal expresa ocupación, no cupo. Ver arriba. |

Por eso la advertencia de la pantalla se **matiza y no se borra**: sigue diciendo que
la sincronización es de una dirección y que hace falta un channel manager, y ahora
además ofrece el calendario como mitigación parcial, con las palabras «angosta la
ventana, no la cierra».

### Seguridad

- **Token al portador en la URL**, igual que el portal del socio (ADR 0014) y por la
  misma razón: quien llama es un servidor de Booking, que no puede iniciar sesión. Sale
  de `canal_config.ical_token` y se puede rotar.
- **Un token inválido devuelve 404, no 401.** Un 401 confirmaría que la ruta existe y
  que el token tenía la forma correcta.
- **El cuerpo no lleva un solo dato personal.** Ni apellido, ni correo, ni código de
  reserva, ni token de reserva, ni precio (ADR 0016). El `SUMMARY` es la constante
  «Ocupado». Hay dos tests: uno sobre la función pura y otro **contra la base, con un
  huésped sembrado**, porque la fuga posible no está en la función sino en el `select`
  que la alimenta.
- **Límite de tasa por IP** (`ical`, 120 por hora). No protege datos —el archivo no
  los tiene— sino de que la URL se convierta en un amplificador: cada lectura recorre
  un año de estadías.
- `service_role`, porque `canal_config` no la lee ni recepción y quien llama no tiene
  sesión. La autorización de este endpoint **es el token**.

### Fallar antes que mentir

Si la lectura de estadías queda truncada por el techo de paginado de PostgREST, el
handler responde **503 y no sirve un calendario parcial**.

Es la decisión menos obvia del handler y la más importante. Un calendario incompleto no
se ve roto: se ve como un calendario con menos bloqueos, o sea **publicando como libres
noches que están llenas** — precisamente el overbooking que esto viene a angostar. Un
canal que no puede leer conserva la versión anterior; uno que lee una versión
incompleta vende de más.

En cambio, el registro de la lectura sí es una escritura accesoria: si falla, el
calendario se sirve igual (`registrarFalla`). Cortar ahí convertiría un problema de
bitácora en fechas que el canal no cierra.

## Alternativas descartadas

- **Marcar `publicaDisponibilidad: true`.** Haría desaparecer la advertencia de
  overbooking de la pantalla. El feed no da ninguna de las garantías que ese `true`
  promete.
- **Cerrar el tipo al vender la primera unidad.** Simple y equivocado: pierde ventas
  reales, y el hotel no tendría cómo notar por qué bajaron las reservas.
- **Publicar un calendario por reserva, con nombre y fechas.** Es lo que hacen algunos
  PMS. Convierte una URL adivinable en una filtración de datos personales.
- **Cachear la respuesta.** El valor de esto es estar al día; un intermediario que
  guarde el archivo agranda la ventana que se quiere angostar. Va `no-store`.
- **Servir el calendario parcial cuando la consulta se trunca.** Ver arriba.

## Consecuencias

- El hotel deja de depender de acordarse de cerrar fechas a mano, en el caso más común.
- Aparece un dato que antes no existía: si el canal está leyendo el calendario o no.
- Queda una URL secreta más para administrar. Rotarla exige volver a pegarla en el
  extranet, y hasta que eso pase el canal deja de recibir bloqueos **sin que nada
  falle** — el «hace N días que no lo leen» de la pantalla es el único aviso.
- **No se toca el ADR 0021.** La solución real sigue siendo un channel manager.
