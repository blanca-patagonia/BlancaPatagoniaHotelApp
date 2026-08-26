# Seguridad

Un PMS guarda documentos, domicilios, teléfonos y movimientos de dinero de gente
que no eligió confiar en el software: eligió un hotel. Esa asimetría es la que
justifica el trabajo que sigue.

Esta página explica **el enfoque**. La política formal de reporte está en
[`SECURITY.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/SECURITY.md).

---

## El principio

**Defensa en la base de datos, no en la pantalla.**

Una comprobación en la interfaz protege contra el error; una comprobación en la
base protege también contra el bug, contra la consulta escrita a mano y contra el
endpoint que alguien agregue mañana sin acordarse de la regla.

Por eso el sistema tiene **RLS activo en las 43 tablas**, con más de 90 políticas,
y el rol se resuelve con un helper de SQL (`rol_actual()`) que no depende de que la
aplicación lo pase bien.

---

## Las capas

| Capa | Qué impone |
|---|---|
| **Postgres** | Anti-overbooking por restricción de exclusión · sin `delete` sobre dinero · facturas inmutables · tokens revocados por columna · `check` que rechazan datos de tarjeta |
| **RLS** | Qué filas ve y toca cada rol. Lectura pública sólo del catálogo |
| **`GRANT`** | Qué columnas y funciones puede siquiera nombrar cada rol |
| **Server Actions** | `requerirAcceso(area)` en las 51 acciones, con guarda estructural |
| **Next.js** | Encabezados de seguridad, incluido HSTS |
| **CI** | `npm audit`, typecheck, lint, 1555 tests y build en cada push |
| **CodeQL** | Análisis estático del código propio, en cada PR y semanalmente |

---

## Los cuatro roles, y el quinto que no tiene cuenta

`admin` · `gerencia` · `recepcion` · `housekeeping` — más el **huésped público**,
que navega como `anon` y nunca se registra.

Dos reglas que ordenan el resto:

- **Un usuario nace sin privilegios.** `sin_rol` y `activo = false`: alguien con
  permiso tiene que darle un rol a mano. Un alta que naciera con acceso convierte
  cualquier registro en una escalada ([ADR 0017](Decisiones-de-arquitectura)).
- **La baja revoca el acceso en la base**, no sólo en la pantalla. Un usuario dado
  de baja cuya sesión siguiera funcionando es una baja que no dio de baja.

---

## La auditoría de seguridad

Se hizo con numeración propia, empezando de cero, y **cada hallazgo se verificó
ejecutándolo** antes y después del arreglo.

### Fase 0 — Reconocimiento
Sin tocar código. Inventario de superficie, roles, entradas públicas y datos
sensibles.

### Fase 1 — Las entradas públicas
Límite de tasa en el alta de reservas, el login y las encuestas. Guarda del script
de siembra contra bases que no sean locales. Encabezados de seguridad.

### Fase 2 — Cuatro bugs leyendo el código

El más caro: **el precio neto de agencia quedaba expuesto a `anon`** por una
función RPC. Los otros tres: el webhook de pagos **fallaba abierto** (un evento con
firma inválida se procesaba igual), inyección de condiciones en los filtros `or` de
PostgREST, y una acción escondida en un `<details>`.

### Fase 3 — Permisos, tokens e integridad

- Alta de usuario sin privilegios y baja que revoca de verdad.
- **Tokens de socio fuera del alcance del staff**: antes cualquier rol
  —housekeeping incluido— podía leer el token de una agencia y con él firmar un
  contrato en su nombre.
- Facturas inmutables y su numeración reparada.
- Las 51 Server Actions verificando rol con guarda estructural.
- **Firma HMAC real** en el webhook de pagos.
- Los simuladores fallan fuerte en producción
  ([ADR 0018](Decisiones-de-arquitectura)).

### Auditoría técnica aplicada (agosto 2026)
Doce fases más: borrado de dinero revocado y auditado, índices del listado,
enlaces del portal revocables, recuperación de contraseña, y las dependencias **de
8 vulnerabilidades a 1 baja**.

---

## Lo que está pendiente

Se declara para que nadie gaste tiempo reportando algo que ya sabemos.

| Pendiente | Por qué sigue abierto |
|---|---|
| **Auditar las ~90 políticas RLS una por una** | Que estén activadas en las 43 tablas dice que hay una puerta, no qué deja pasar. Es el pendiente principal, y **exige Docker**: hay que ejecutar cada política contra una base con los cuatro roles |
| **No hay Content-Security-Policy** | Decidido y documentado: una CSP mal puesta rompe la aplicación en silencio, y ponerla bien exige un inventario de orígenes que todavía no se hizo |
| **Los flujos de reserva de varios pasos no son atómicos** | Si falla el tercer paso, los datos quedan a medias. Está anotado en el código; resolverlo pide una función SQL transaccional |
| **Cinco funciones del panel de GitHub apagadas** | Alertas de Dependabot, escaneo de secretos y reporte privado de vulnerabilidades son casillas de la web. Estado y cómo se activan: [`docs/github.md`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/github.md) |

---

## Fuera de alcance

- **Las credenciales de desarrollo** (`admin@blancapatagonia.local`). Son del stack
  local en Docker y la contraseña por defecto es pública a propósito. El script de
  siembra **aborta** si la URL no es local y no se eligió una contraseña a mano —
  falla en vez de generar una al azar, porque una contraseña aleatoria impresa en
  un log de deploy es casi tan mala y encima parece resuelta.
- **Los simuladores.** No hablan con ningún servicio externo y fallan al arrancar
  en producción.
- **Las claves del stack local de Supabase**, que son públicas y conocidas por
  diseño.

---

## Cómo reportar algo

**No abras un issue público.** El camino es la pestaña **Security** del
repositorio.

Ayuda mucho incluir: **con qué rol** se explota (es lo que más falta), los pasos
para reproducirlo, y qué dato se expone o qué escritura se logra que no debería.

Al ser un proyecto de tesis y no un producto con guardia, no hay tiempo de
respuesta comprometido ni programa de recompensas. Lo que sí: se lee todo lo que
entre por ahí.
