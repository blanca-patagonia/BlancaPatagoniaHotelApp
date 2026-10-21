# `src/` — el código de la aplicación

| Carpeta | Capa | Qué hay |
|---|---|---|
| `app/(front-publico)/` | Front | Sitio web del huésped: portada, alojamientos, reserva y pago |
| `app/(front-gestion)/` | Front | Panel de gestión del staff y login |
| `app/(back-api)/` | Back | Endpoints HTTP, webhooks y tareas programadas |
| `lib/` | Back | Reglas de negocio, acceso a datos e integraciones |
| `proxy.ts` | Back | Filtro de cada pedido: sesión, idioma y límites |
| `instrumentation.ts` | Back | Captura de errores del servidor |

Los paréntesis son grupos de rutas de Next.js: ordenan el código **sin cambiar
la URL**. Mapa completo en [`../ESTRUCTURA.md`](../ESTRUCTURA.md).
