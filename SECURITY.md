# Política de seguridad

Sistema Integral de Gestión Hotelera del **Hotel Blanca Patagonia** (El Calafate,
Santa Cruz). Proyecto de tesis de Analista de Sistemas (IES) — Octavio Fakiani y
Santiago Morán.

## Alcance y estado del proyecto

**No hay versiones publicadas ni ningún despliegue en producción.** No incluimos
una tabla de «versiones soportadas» porque sería inventada: `main` es el sistema
completo y `tesis-a-presentar` es la versión reducida que se presenta como tesis
([ADR 0045](docs/decisiones/0045-version-reducida-para-la-tesis.md)). Este
documento describe esta última.

El sistema **no procesa dinero real ni envía correo real**. Las pasarelas de pago,
la facturación electrónica y el correo son adaptadores con un simulador
detrás (`src/lib/payments`, `src/lib/email`, `src/lib/facturacion`). Esos
simuladores **fallan al arrancar si el entorno es de producción** y no están
configuradas las variables correspondientes: es deliberado, para que nadie confunda
un comprobante simulado con uno fiscal (ADR 0018).

## Cómo reportar una vulnerabilidad

**No abras un issue público.** El reporte privado de GitHub (Security → *Report a
vulnerability*) **hoy está apagado** en este repositorio (verificado con la API,
`private-vulnerability-reporting: enabled = false`, 2026-11-10), así que ese botón
no existe todavía. Hasta que se active, escribile directamente a quienes mantienen
el proyecto —Octavio Fakiani o Santiago Morán— por un medio privado de los que
figuran en su perfil de GitHub.

Ayuda mucho que incluyas:

- Qué rol de usuario hace falta para explotarlo (`anon`, `recepcion`,
  `housekeeping`, `gerencia`, `admin`, o un huésped sin cuenta).
- Los pasos para reproducirlo. Si toca la base, la consulta o la llamada concreta.
- Qué dato se expone o qué escritura se logra que no debería.

Al ser un proyecto de tesis y no un producto con guardia, **no podemos comprometer
un tiempo de respuesta**. Lo que sí: leemos todo lo que nos llegue por esa vía y
respondemos si el reporte es válido, aunque sea para decir que no lo vamos a
arreglar y por qué.

No hay programa de recompensas.

## Qué defiende el sistema hoy

Lo que sigue está implementado y se verifica con tests contra una base real
(`npm run test:aislado`). Los números salen de las 127 migraciones del repositorio.

- **La integridad crítica vive en la base, no en la aplicación.** El
  anti-overbooking es una restricción de exclusión GiST sobre `estadias`
  (ADR 0002). Aunque la app tenga un bug, Postgres rechaza la doble venta.
- **RLS activado en las 69 tablas** que crean las migraciones (39 de ellas sin
  código en esta rama), con el helper `rol_actual()`. La lectura pública llega solo
  al catálogo; los datos personales, nunca.
- **El precio neto de agencia está fuera del alcance público** (ADR 0016): `anon`
  no puede leer la columna `precio_neto` ni ejecutar `cotizar_estadia`.
- **Un usuario nuevo nace sin privilegios** (`sin_rol`, `activo = false`), y darlo
  de baja le revoca el acceso en la base, no solo en la pantalla (ADR 0017).
- **No se borra dinero.** `authenticated` no tiene `delete` sobre reservas,
  estadías, pagos, agencias, proveedores, tarifas ni perfiles; lo que sí se borra
  queda auditado por trigger.
- **Límite de tasa por IP** en el alta pública de reservas, el login y las
  encuestas. El caso que lo motivó no era spam: cada reserva pendiente bloquea una
  unidad cinco días, y el hotel tiene 37 unidades (ADR 0040) — unas pocas decenas
  de envíos lo dejaban sin inventario vendible durante una semana.
- **Nunca se guarda un número de tarjeta.** Hay un test-contrato que recorre las
  migraciones y falla si aparece una columna que pueda contenerlo, más
  restricciones en la base que rechazan doce o más dígitos seguidos. Es lo que
  mantiene al hotel dentro del alcance SAQ-A de PCI-DSS (ADR 0025).
- **El webhook de pagos verifica firma HMAC** y falla cerrado.
- **Encabezados de seguridad** en `next.config.ts`, incluido HSTS.
- **CI** que levanta Postgres con Docker y corre `npm audit`, typecheck, lint, toda
  la suite con `EXIGIR_DB=1` y el build en cada push.

## Límites conocidos

Los declaramos para que nadie gaste tiempo reportando algo que ya sabemos, y
porque un documento que solo enumera aciertos no sirve para decidir si confiar.

- **Las políticas RLS no fueron auditadas una por una.** La matriz de lectura es
  exhaustiva (todas las tablas × 4 roles), pero la de escritura es dirigida: cubre
  los casos elegidos por consecuencia, no todas las combinaciones. Es el pendiente
  principal (`docs/5-pendientes/PENDIENTES.md`).
- **No hay Content-Security-Policy.** Está decidido y documentado en
  `next.config.ts`: una CSP mal puesta rompe la aplicación en silencio, y ponerla
  bien exige un inventario de orígenes que todavía no se hizo.
- **Los flujos de reserva de varios pasos no son atómicos.** Si falla el tercer
  paso, los datos quedan a medias. Está anotado en el código; resolverlo pide una
  función SQL transaccional.
- **Las variables obligatorias en producción** (`EMAIL_PROVIDER`,
  `FACTURACION_PROVIDER`, `COTIZACION_PROVIDER`, `PAGO_PROVIDER`) tienen que
  revisarse antes de cualquier despliegue.
- **Las tablas de los módulos quitados siguen en la base** (ADR 0045), con RLS
  activo pero sin código que las use. La limpieza es un paso pendiente.

## Fuera de alcance

- **Las credenciales de desarrollo de `CLAUDE.md`**
  (`admin@blancapatagonia.local`). Son para la base local de los tests, y la
  contraseña por defecto es pública a propósito. El script de siembra **aborta si la
  URL no es `localhost` ni `127.0.0.1` y no se definió `ADMIN_PASSWORD`**: contra
  cualquier otra base hay que elegir una contraseña a mano. Falla en vez de generar
  una al azar, porque una contraseña aleatoria impresa en un log de deploy es casi
  tan mala y encima parece resuelto.
- **Los simuladores de pago, facturación y correo.** No hablan con
  ningún servicio externo y fallan al arrancar en producción (ADR 0018).
- **El contenido del directorio `supabase/` cuando se corre en local.** Las claves
  del stack de desarrollo de Supabase son públicas y conocidas por diseño.
- Ataques que requieran acceso físico a la máquina del hotel, o ingeniería social
  contra el personal.

## Dependencias

Dependabot está configurado (`.github/dependabot.yml`) con actualizaciones
semanales, y el CI corre `npm audit --audit-level=high` en cada push. Al momento de
escribir esto queda **una vulnerabilidad de severidad baja**.

## Más detalle

- `docs/4-seguridad-y-auditorias/SEGURIDAD.md` — cada hallazgo con el formato «qué encontré → por qué es
  riesgo → qué hice → cómo verificarlo».
- `docs/4-seguridad-y-auditorias/AUDITORIA_INICIAL.md` — el reconocimiento inicial.
- `docs/5-pendientes/PENDIENTES.md` — lo que falta.
- `docs/decisiones/` — los 29 ADRs de esta rama. Los de seguridad son el 0002,
  0016, 0017, 0018 y 0025.
