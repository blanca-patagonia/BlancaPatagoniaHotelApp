# ADR 0016 — El precio neto, fuera del alcance del rol público

- **Estado:** aceptada
- **Fecha:** 2026-08-13
- **Fase:** 2 de la auditoría de seguridad (segunda parte)
- **Migraciones:** 0030 y 0031

## Contexto

El sistema maneja doble precio (ADR 0004): **neto** es lo que el hotel negocia con
cada agencia, **rack** lo que cobra en mostrador. El neto es información comercial
sensible: una agencia que conoce la grilla de netos negocia distinto.

La auditoría encontró que ese dato era legible por cualquiera, **por dos caminos
independientes**, ambos con la clave publicable — que viaja en el bundle del
navegador por diseño y por lo tanto no es un secreto:

1. **Por función.** `cotizar_estadia` (migración 0008) recibe `p_tarifa_tipo`,
   devuelve `precio_neto` cuando vale `'neto'` y tiene `grant execute … to anon`,
   porque el portal la necesita para mostrar precios. Un POST a
   `/rest/v1/rpc/cotizar_estadia` con `'neto'` devolvía los netos noche por noche.
2. **Por tabla.** `grant select on all tables … to anon` (migración 0006) más la
   política «tarifas: lectura publica … using (true)» —sin cláusula `to`, así que
   aplica a `PUBLIC`— permitían `GET /rest/v1/tarifas?select=precio_neto`.

Que la aplicación siempre mande `'rack'` en sus rutas públicas no defiende nada:
la defensa tiene que estar donde está el dato.

**RLS no resuelve esto.** RLS filtra **filas**, y el problema es una **columna**.
Es el límite del modelo de seguridad del proyecto y conviene tenerlo escrito: la
frase «RLS activado en las 33 tablas» no cubre la exposición por columna.

## Decisión

### 1. Guarda por rol en la función que conoce el neto (migración 0030)

`cotizar_estadia` devuelve rack cuando quien la llama es `anon`, aunque pida neto.

La guarda va sobre **`current_user`**, no sobre `rol_actual()`. `rol_actual()` sale
de `perfiles` vía `auth.uid()`, y para `service_role` eso es NULL —no hay perfil
detrás de la clave del servidor—, así que habría roto el cotizado neto del servidor
y el test de integración que ya lo cubría. PostgREST cambia el rol de Postgres según
la credencial (`anon` / `authenticated` / `service_role`), de modo que `current_user`
distingue exactamente lo que hay que distinguir.

A `anon` que pida neto se le devuelve rack **en silencio y sin error**: ningún
llamador legítimo pide neto sin sesión, y un error solo le confirmaría a quien
sondea que encontró algo.

### 2. Dos funciones, cada una con un solo trabajo (migración 0031)

Para cerrar el camino de la tabla hay que revocar el privilegio **por columna**.
Pero `cotizar_estadia` menciona `t.precio_neto` en su `CASE`, y Postgres exige
privilegio sobre toda columna referenciada **aunque la rama no se ejecute**: un
`revoke` a secas haría fallar la función para `anon` y tiraría abajo la cotización
del portal entero.

Entonces:

- **`cotizar_estadia_publica`** — solo rack, no menciona `precio_neto`, y por eso
  funciona sin privilegio sobre esa columna. Es la que usa el portal.
- **`cotizar_estadia`** — sin cambios, y se le revoca el `execute` a `anon`.
- **`tarifas`** — se revoca el `select` de tabla a `anon` y se otorga por columna
  sobre todas menos `precio_neto`.

`lib/pricing/cotizar.ts` elige la función según el tipo de tarifa.

## Alternativa descartada: `SECURITY DEFINER`

Era el camino obvio para resolver el privilegio de columna, y **habría reabierto en
silencio lo que la 0030 vino a cerrar**.

Dentro de una función `SECURITY DEFINER`, `current_user` es el **dueño** de la
función y no quien la llama. La guarda `current_user <> 'anon'` habría quedado
siempre en verdadero, y `anon` habría vuelto a recibir el neto — con el agravante
de que el test de la 0030 seguiría en verde, porque prueba el resultado con la clave
publicable a través de una función que ya no distingue nada.

Habría hecho falta cambiar la guarda a algo inmune al cambio de contexto (leer el
claim `role` de `request.jwt.claims`), sumando dependencia de un detalle de
PostgREST. Se prefirió el diseño donde **no hay privilegio elevado que auditar**.

## Consecuencias

**A favor**

- La garantía es más fuerte que una guarda por parámetro: el rol público **no puede
  ejecutar** la función que conoce el neto ni **leer** la columna. No depende de que
  una condición esté bien escrita.
- Ninguna de las dos funciones es `security definer`: no hay privilegio elevado.
- Cada función hace una cosa, y la que atiende al público es trivial de auditar —se
  lee entera y no menciona el dato sensible—.

**En contra / a tener en cuenta**

- Hay **dos funciones que cotizan** y hay que mantenerlas coherentes. Si cambia la
  resolución de temporada, hay que tocar las dos. Se aceptó a cambio de no tener una
  función privilegiada.
- El `grant` por columna **enumera columnas**: al agregar una columna a `tarifas`
  hay que decidir explícitamente si `anon` la ve. Es un costo de mantenimiento y a
  la vez la propiedad que se quería —agregar una columna sensible ya no la expone
  por omisión—.
- `revoke select on tarifas from anon` no alcanza por sí solo: el asistente del
  portal lee `precio_rack` de esa tabla como `anon`.

**Lo que sigue sin estar cubierto**

La exposición por columna se resolvió **para este caso**. No hay una revisión
sistemática de qué columnas ve `anon` en las demás tablas de lectura pública
(`temporadas`, `temporada_rangos`, `politicas_cancelacion`, `tipos_unidad`), aunque
ninguna tiene hoy un dato comercial equivalente. Va junto con la auditoría de las
~60 políticas RLS, todavía pendiente.
