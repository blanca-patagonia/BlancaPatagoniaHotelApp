# `lib/` — la lógica del sistema (back)

Regla: `lib/` **nunca** importa de `app/`. Mapa completo en
[`../../ESTRUCTURA.md`](../../ESTRUCTURA.md).

Hay dos tipos de código acá:

- **`domain/`** — reglas puras, sin base ni framework. Índice por tema en
  [`domain/README.md`](domain/README.md).
- **Todo lo demás** — el código que sí habla con algo de afuera (la base, una
  pasarela, el correo). Usa `domain/` para decidir y se ocupa de leer y escribir.

Cada carpeta y cada archivo suelto figura abajo: `tests/contratos/indices.test.ts`
falla si aparece uno sin listar.

## Carpetas

| Carpeta | Para qué |
|---|---|
| `domain/` | Reglas de negocio puras (precios, IVA, cancelación, estados…) |
| `supabase/` | Clientes de la base: navegador, servidor, `admin` (saltea RLS: sólo servidor) y el del `proxy` |
| `auth/` | Sesión del staff y `requerirAcceso(area)` |
| `auditoria/` | Registro de quién abrió la ficha de un huésped |
| `reservas/` | Alta de reserva, saldo, cancelación y cuenta cerrada: lo que comparten panel y portal |
| `housekeeping/` | Estado de limpieza de las unidades y el aviso a recepción (compartido con el asistente) |
| `availability/` | Consulta de disponibilidad (la garantía real es la base, ADR 0002) |
| `pricing/` | Cotización de una estadía contra las tarifas cargadas |
| `payments/` | Pasarelas de pago: MercadoPago, Stripe, Payway y el simulador (ADR 0027) |
| `facturacion/` | Facturación electrónica y datos del hotel como emisor |
| `divisas/` | Cotización del dólar, con su cadena de respaldo |
| `email/` | Envío de correo: consola o Resend |
| `notificaciones/` | Bandeja de salida de avisos al huésped, con reintentos |
| `integraciones/` | Elección de proveedor por variable de entorno y firma de webhooks |
| `storage/` | Fotos operativas en Supabase Storage (ADR 0037) |
| `asistente/` | Asistente del portal público, por reglas (ADR 0011) |
| `busqueda/` | Consulta del buscador global |
| `catalogo/` | Catálogo público cacheado |
| `i18n/` | Diccionarios del portal en cinco idiomas |
| `pwa/` | Ícono de la aplicación instalable |

## Archivos sueltos (utilidades que usa todo el sistema)

| Archivo | Para qué |
|---|---|
| `acciones.ts` | `cortarSiFalla`, `registrarFalla`, `mensajeDeFalla`: ningún error de la base en silencio |
| `registro.ts` | Registro de errores en la tabla `errores` (ADR 0029) — nada se loguea con `console` |
| `env.ts` | Lectura y validación de variables de entorno |
| `fechas.ts` | Fechas `AAAA-MM-DD` y la zona del hotel (`hoyISO`, `fechaHotel`…) |
| `listados.ts` | Paginación, búsqueda y filtros de los listados (`patronOr`, `mensajeDe`) |
| `paginado.ts` | `traerTodo`: leer una tabla entera por encima del techo de 1000 filas |
| `csv.ts` | Exportación a CSV con protección contra fórmulas |
| `limites.ts` | Aplica los límites de intentos de `domain/limites.ts` contra la base |
| `crons.ts` | Anota el resultado de cada tarea programada (`cron_corridas`) |
| `retorno.ts` | A qué pantalla vuelve una acción que se pide desde varias |
| `seo.ts` | URL base para metadatos, sitemap y robots |
