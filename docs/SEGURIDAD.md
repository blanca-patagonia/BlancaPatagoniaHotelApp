# Seguridad — hallazgos y correcciones

Formato de cada entrada: **qué encontré → por qué es riesgo → qué hice → cómo
verificarlo**.

---

## 🔴 1. El alta pública de reservas no tenía límite de volumen

### Qué encontré
`crearReservaPublica` (`app/reservar/actions.ts`) no aplicaba ninguna
restricción por IP. Cualquiera podía enviar el formulario público las veces que
quisiera, sin autenticarse.

### Por qué es riesgo
No es spam molesto: **cada reserva pendiente bloquea una unidad durante 5 días**
(`expirar_reservas_pendientes`, migración 0011). El hotel tiene 15 unidades.

Un script que enviara el formulario unas decenas de veces dejaba al hotel **sin
inventario vendible durante casi una semana**. Es una denegación de servicio
contra el negocio, no contra el servidor, y se ejecuta desde un navegador.

### Qué hice
Migración `0029_limite_de_intentos.sql`:

- Tabla `intentos_limitados` (IP, acción, fecha) **sin políticas RLS de lectura
  ni escritura** y con los permisos revocados a `anon` y `authenticated`. La
  maneja solo la función de abajo: nadie debería poder consultar desde qué IPs
  se intentó algo, ni borrar su propio rastro.
- Función `registrar_intento(ip, accion, maximo, minutos)`, `security definer`.
  **Inserta primero y cuenta después**, dentro de la misma llamada. Eso la hace
  atómica: si dos peticiones simultáneas leyeran el conteo y después
  insertaran, ambas podrían pasar el techo.
- `purgar_intentos()` programada por hora, para que la tabla no crezca sin fin.

Los límites viven en `lib/domain/limites.ts`, **cada uno con su justificación
escrita**. Un límite sin motivo se termina ajustando a ojo cuando alguien se
queja, y ahí deja de proteger.

| Acción | Límite | Por qué ese número |
|---|---|---|
| Reserva pública | 5 / hora | Una familia reserva 3-4 habitaciones seguidas; un ataque necesita cientos |
| Login | 10 / 15 min | Tolera a quien no recuerda la contraseña; corta la fuerza bruta |
| Encuesta | 3 / hora | Se responde una vez; evita inflar el NPS de los reportes |

**Decisión deliberada:** si la comprobación falla (base caída, encabezado
ausente), se **deja pasar**. El limitador protege contra abuso, pero si se rompe
no debe impedir que un huésped legítimo reserve. Bloquear todo ante un fallo del
contador convierte un problema de infraestructura en una caída de ventas.

### Cómo verificarlo
```bash
# 6 intentos con máximo 5: el sexto debe dar false
for i in 1 2 3 4 5 6; do
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/registrar_intento" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"p_ip":"203.0.113.9","p_accion":"reserva_publica","p_maximo":5,"p_minutos":60}'
done
```
Resultado comprobado: `true true true true true false`. Otra IP sigue en `true`.

```bash
# anon no debe poder leer la tabla
curl -s "$SUPABASE_URL/rest/v1/intentos_limitados?select=ip" -H "apikey: $ANON_KEY"
# → 42501 permission denied for table intentos_limitados
```

---

## 🟠 2. El login no limitaba reintentos

### Qué encontré
`iniciarSesion` consultaba las credenciales sin restricción de volumen.

### Por qué es riesgo
Fuerza bruta contra las cuentas del personal. Supabase Auth aplica su propio
límite del lado del servidor, lo que **mitiga** el ataque, pero no lo registra
localmente ni lo frena antes de llegar — con lo cual tampoco hay forma de
enterarse de que está ocurriendo.

### Qué hice
Mismo limitador, 10 intentos cada 15 minutos. Se comprueba **antes** de
consultar las credenciales, para no darle a un atacante una vía de deducir si un
email existe midiendo el tiempo de respuesta.

Se dejó asentado en el código por qué el mensaje de error es único («Email o
contraseña incorrectos»): distinguir «no existe» de «contraseña incorrecta» le
confirmaría a un atacante qué cuentas existen.

### Cómo verificarlo
Once intentos fallidos seguidos desde la misma IP: el undécimo responde
«Demasiados intentos» en lugar de consultar las credenciales.

---

## ✅ Gestión de secretos — sin hallazgos

Tres comprobaciones, todas limpias (ver `docs/AUDITORIA_INICIAL.md` §3):
ningún `.env` en el historial, ningún token real en los 44 commits, ningún
literal sospechoso en el código. **No hace falta rotar credenciales.**

---

## Pendiente de esta fase

- Contraseña por defecto del seed (`blancadev1234`): impedir que se use fuera
  de desarrollo.
- Headers de seguridad en `next.config.ts`.
- **Auditar cada política RLS, una por una.** Están activadas en las 32 tablas,
  pero eso no dice qué permite cada una.
- Validación con Zod en el borde público (hoy es una expresión regular).
- Límite en la encuesta pública (el limitador ya existe; falta conectarlo).

---

## 🟠 3. Contraseña de administrador por defecto

### Qué encontré
`scripts/seed-usuarios.mjs` usaba `blancadev1234` cuando no se define
`ADMIN_PASSWORD`. Está documentada en el README, así que es **pública**.

### Por qué es riesgo
El riesgo no es que esté en el repositorio —para desarrollo local está bien—
sino que **nada impedía correr el script contra una base real**. Un deploy
apurado dejaría un administrador con una contraseña que cualquiera puede leer en
GitHub.

### Qué hice
El script ahora aborta si la URL no es local y no se definió `ADMIN_PASSWORD`.
El corte es por URL: `localhost` y `127.0.0.1` son inequívocamente desarrollo.

Se **falla** en lugar de generar una contraseña al azar: una clave aleatoria
impresa en un log de deploy es casi tan mala, y encima da la sensación de que el
problema está resuelto.

### Cómo verificarlo
```bash
NEXT_PUBLIC_SUPABASE_URL="https://x.supabase.co" node scripts/seed-usuarios.mjs
# → ✗ Te estás conectando a una base que no es local … (aborta)

ADMIN_PASSWORD="…" NEXT_PUBLIC_SUPABASE_URL="https://x.supabase.co" node scripts/seed-usuarios.mjs
# → pasa la guarda
```

---

## 🟡 4. Sin encabezados de seguridad

### Qué encontré
`next.config.ts` estaba vacío: ninguna respuesta llevaba encabezados de
seguridad.

### Por qué es riesgo
Sin `X-Frame-Options`, una página ajena puede embeber el panel en un iframe y
superponer sus propios botones sobre acciones reales (clickjacking). Sin
`Referrer-Policy`, salir por un enlace externo desde el detalle de una reserva
filtra su identificador al sitio de destino.

### Qué hice
Cinco encabezados en `next.config.ts`, cada uno comentado con su motivo:
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` y `Strict-Transport-Security`.

**No se agregó Content-Security-Policy.** Next inyecta estilos y scripts en
línea; una CSP mal calibrada rompe la aplicación de formas difíciles de
diagnosticar. Hacerla bien exige `nonce` por petición y probar cada pantalla.
Queda como trabajo pendiente: es mejor no tenerla que tenerla mal y desactivarla
al primer problema.

### Cómo verificarlo
```js
const r = await fetch('/reservar')
r.headers.get('x-frame-options')  // → DENY
```
Los cinco verificados en el navegador.

---

## 🟡 5. La encuesta pública ya tiene límite

Conectada al limitador de §1: 3 respuestas por hora y por IP.

---

## 🟠 6. `anon` conservaba INSERT, UPDATE y DELETE *(2026-09-08, migración 0089)*

### Qué encontré

Escribiendo el test que audita el borde público en escritura tabla por tabla:
el rol público —el que cualquiera alcanza desde internet, sin credenciales—
conservaba el grant de **escritura sobre las seis tablas del catálogo**
(`tipos_unidad`, `tarifas`, `temporadas`, `temporada_rangos`, `promociones`,
`politicas_cancelacion`), que son las que la migración 0072 dejó legibles para
que funcione el portal.

No venía de ninguna migración de este proyecto: la 0006 le da a `anon` **sólo**
`select`, y su `alter default privileges` también. El grant sale de los
privilegios por omisión de la **plataforma**, y nadie lo había mirado — la 0072
revocó `select` sobre lo que no es catálogo y ahí se detuvo.

⚠️ Y sobre el resto de las tablas probablemente estaba también. No se nota
porque, sin `select`, PostgREST no expone la tabla al rol y responde «no existe»
antes de llegar a la base: la barrera que actúa ahí no es el permiso, es que el
cliente no encuentra la puerta.

### Por qué es riesgo

**Exposición real: ninguna, hoy.** Las seis tablas tienen políticas RLS de
escritura acotadas a `admin` y `gerencia`, y `rol_actual()` es NULL para el rol
público, así que un `update` de `anon` filtra cero filas.

El riesgo es de forma, y es exactamente el que ya se pagó dos veces en este
sistema (`cotizar_estadia`, la 0070): **la capa que la documentación daba por
puesta no estaba**, y la protección efectiva dependía de una sola política. El
día que una migración agregue una política de escritura `using (true)` a una
tabla de catálogo —o que alguien copie una de las públicas de lectura sin mirar
el `for all`— `anon` pasa a poder editar las tarifas del hotel desde internet, y
no habría nada más que lo frene.

### Qué hice

`revoke insert, update, delete on all tables in schema public from anon`, en
bloque, **más** `alter default privileges`. Sin lo segundo el arreglo duraría
hasta el próximo `create table`: la plataforma se lo vuelve a conceder.

Se puede revocar en bloque porque **ninguna escritura pública de este sistema usa
el rol `anon`**. Las tres que existen —reservar desde el portal, responder la
encuesta y firmar un contrato— resuelven con `service_role` desde el servidor,
con el token de la URL como credencial.

### Cómo verificarlo

```sql
select * from privilegios_de_escritura('anon');         -- cero filas
select count(*) from privilegios_de_escritura('authenticated');  -- muchas
select has_table_privilege('anon', 'tarifas', 'select');         -- t
```

El test de contrato es `tests/anon-no-escribe.test.ts`, con sus dos contrapesos:
que el catálogo siga siendo legible (un `revoke` de más rompe el portal en
silencio) y que `authenticated` siga escribiendo (un `revoke` dirigido a `public`
alcanzaría a los dos roles).

⚠️ **Ese test pregunta `has_table_privilege`; no sondea con un `insert`.** La
primera versión sondeaba y leía el código de error —`42501` es «denegado»,
cualquier otra cosa es «pasó»— y tiene dos falsos negativos que no se ven: una
**vista** responde `55000` y una tabla con **trigger BEFORE INSERT** responde lo
que lance el trigger. En los dos casos el error no es de permiso y el test lo leía
como si la barrera hubiera actuado.

---

## Pendiente — lo más importante que queda

**Auditar cada política RLS, una por una.** *(Actualizado el 2026-09-08.)*

Lo que ya está cubierto de forma **exhaustiva**:

- **Lectura**, los cuatro roles × todas las tablas: `tests/rls-por-rol.test.ts`,
  con la lista traída de la base para que una tabla nueva sin declarar haga
  fallar el test.
- **Escritura de `anon`**, todas las tablas: `tests/anon-no-escribe.test.ts` (§6).

Lo que sigue siendo **dirigido y no exhaustivo**: la escritura de los tres roles
de staff (`tests/rls-escritura-por-rol.test.ts`), que elige los casos por
consecuencia —escalada de privilegio, dinero, inventario, borrado—. Ahí hace falta
una cuenta del hotel, así que el riesgo es escalada interna y no exposición
pública; sigue mereciendo una sesión dedicada, pero ya no es el hueco más grande.

También queda: validación con Zod en el borde público (hoy es una expresión
regular), y revisar qué campos exactos devuelven las respuestas públicas.
