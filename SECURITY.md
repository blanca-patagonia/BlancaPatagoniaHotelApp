# Política de seguridad

Sistema Integral de Gestión Hotelera del **Hotel Blanca Patagonia** (El Calafate,
Santa Cruz). Proyecto de tesis de Analista de Sistemas (IES) — Octavio Fakiani y
Santiago Morán.

## Alcance y estado del proyecto

**No hay versiones publicadas ni ningún despliegue en producción.** No incluimos
una tabla de «versiones soportadas» porque sería inventada: se trabaja sobre una
única línea (`main`), y lo que está en `main` es lo que se mantiene.

El sistema **no procesa dinero real ni envía correo real**. Las pasarelas de pago,
la facturación electrónica, la firma y el correo son adaptadores con un simulador
detrás (`lib/payments`, `lib/email`, `lib/firma`, `lib/facturacion`). Esos
simuladores **fallan al arrancar si el entorno es de producción** y no están
configuradas las variables correspondientes: es deliberado, para que nadie confunda
un comprobante simulado con uno fiscal (ADR 0018).

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usá la pestaña **Security → Report a vulnerability**
de este repositorio (GitHub Security Advisories), que crea un canal privado con
quienes mantenemos el proyecto.

> **Si no encontrás ese botón**, es que el reporte privado todavía no está
> activado en la configuración del repositorio (ver `docs/github.md`, §2.1).
> Mientras tanto, abrí un issue **sin el detalle técnico** —alcanza con «encontré
> algo en tal módulo, pido un canal privado»— y seguimos por ahí. Lo que no hay
> que hacer es publicar el detalle en un issue.

Ayuda mucho que incluyas:

- Qué rol de usuario hace falta para explotarlo (`anon`, `recepcion`,
  `housekeeping`, `gerencia`, `admin`, o un huésped sin cuenta).
- Los pasos para reproducirlo. Si toca la base, la consulta o la llamada concreta.
- Qué dato se expone o qué escritura se logra que no debería.

Al ser un proyecto de tesis y no un producto con guardia, **no podemos comprometer
un tiempo de respuesta**. Lo que sí: leemos todo lo que entre por ese canal y
respondemos si el reporte es válido, aunque sea para decir que no lo vamos a
arreglar y por qué.

No hay programa de recompensas.

## Qué defiende el sistema hoy

Lo que sigue está implementado y verificado con tests contra una base real; los
números salen de la migración `0065`, la última aplicada.

- **La integridad crítica vive en la base, no en la aplicación.** El
  anti-overbooking es una restricción de exclusión GiST sobre `estadias`
  (ADR 0002). Aunque la app tenga un bug, Postgres rechaza la doble venta.
- **RLS activado en las 43 tablas**, con 90 políticas y el helper `rol_actual()`.
  La lectura pública llega solo al catálogo; los datos personales, nunca.
- **El precio neto de agencia está fuera del alcance público** (ADR 0016): `anon`
  no puede leer la columna `precio_neto` ni ejecutar `cotizar_estadia`.
- **Un usuario nuevo nace sin privilegios** (`sin_rol`, `activo = false`), y darlo
  de baja le revoca el acceso en la base, no solo en la pantalla (ADR 0017).
- **Los tokens de socio no se leen con el cliente del usuario.** `agencias.token`,
  `proveedores.token` y `firmas.token` tienen el `select` revocado por columna:
  antes cualquier rol podía leerlos y con ellos firmar un contrato en nombre del
  socio.
- **No se borra dinero.** `authenticated` no tiene `delete` sobre reservas,
  estadías, pagos, agencias, proveedores, tarifas ni perfiles; lo que sí se borra
  queda auditado por trigger.
- **Límite de tasa por IP** en el alta pública de reservas, el login y las
  encuestas. El caso que lo motivó no era spam: cada reserva pendiente bloquea una
  unidad cinco días, y el hotel tiene quince — unas decenas de envíos lo dejaban
  sin inventario vendible durante una semana.
- **Nunca se guarda un número de tarjeta.** Hay un test-contrato que recorre las 65
  migraciones y falla si aparece una columna que pueda contenerlo, más
  restricciones en la base que rechazan doce o más dígitos seguidos. Es lo que
  mantiene al hotel dentro del alcance SAQ-A de PCI-DSS (ADR 0025).
- **El webhook de pagos verifica firma HMAC** y falla cerrado.
- **Encabezados de seguridad** en `next.config.ts`, incluido HSTS.
- **CI** que levanta Postgres con Docker y corre `npm audit`, typecheck, lint, los
  1446 tests y el build en cada push.
- **Análisis estático de seguridad (CodeQL)** sobre el código propio, en cada PR y
  una vez por semana ([ADR 0028](docs/decisiones/0028-analisis-estatico-y-configuracion-de-github.md)).
  Cubre lo que ni `npm audit` ni el typecheck ven: el dato del request que llega
  hasta una consulta, la redirección abierta, la expresión regular que se cuelga.

## Límites conocidos

Los declaramos para que nadie gaste tiempo reportando algo que ya sabemos, y
porque un documento que solo enumera aciertos no sirve para decidir si confiar.

- **Las ~90 políticas RLS no fueron auditadas una por una.** Que estén activadas en
  las 43 tablas dice que hay una puerta, no qué deja pasar. Es el pendiente
  principal (`docs/audit/00-pendientes.md`).
- **No hay Content-Security-Policy.** Está decidido y documentado en
  `next.config.ts`: una CSP mal puesta rompe la aplicación en silencio, y ponerla
  bien exige un inventario de orígenes que todavía no se hizo.
- **Los flujos de reserva de varios pasos no son atómicos.** Si falla el tercer
  paso, los datos quedan a medias. Está anotado en el código; resolverlo pide una
  función SQL transaccional.
- **La sincronización con Booking es de solo lectura y no evita el overbooking**
  (ADR 0021). No es una vulnerabilidad: es una limitación de no ser Connectivity
  Partner, y está declarada en el código y en la pantalla.
- **Las variables obligatorias en producción** (`EMAIL_PROVIDER`, `FIRMA_PROVIDER`,
  `FACTURACION_PROVIDER`, `COTIZACION_PROVIDER`, `CANAL_PROVIDER`) tienen que
  revisarse antes de cualquier despliegue.

## Fuera de alcance

- **Las credenciales de desarrollo del README y de `CLAUDE.md`**
  (`admin@blancapatagonia.local`). Son para el stack local en Docker, y la
  contraseña por defecto es pública a propósito. El script de siembra **aborta si la
  URL no es `localhost` ni `127.0.0.1` y no se definió `ADMIN_PASSWORD`**: contra
  cualquier otra base hay que elegir una contraseña a mano. Falla en vez de generar
  una al azar, porque una contraseña aleatoria impresa en un log de deploy es casi
  tan mala y encima parece resuelto.
- **Los simuladores de pago, firma, facturación, correo y canales.** No hablan con
  ningún servicio externo y fallan al arrancar en producción (ADR 0018).
- **El contenido del directorio `supabase/` cuando se corre en local.** Las claves
  del stack de desarrollo de Supabase son públicas y conocidas por diseño.
- Ataques que requieran acceso físico a la máquina del hotel, o ingeniería social
  contra el personal.

## Dependencias

Dependabot está configurado (`.github/dependabot.yml`) con actualizaciones
semanales, y el CI corre `npm audit --audit-level=high` en cada push. Al momento de
escribir esto queda **una vulnerabilidad de severidad baja**.

Además, el workflow `dependency-review.yml` **bloquea el pull request que
introduce** una dependencia con vulnerabilidad alta o crítica: `npm audit` audita
el árbol entero y por eso corta en `high`, mientras que la revisión de
dependencias mira sólo lo que agrega ese PR, que es deuda que todavía se puede no
contraer.

⚠️ Falta un paso, y no depende del código: las **alertas de Dependabot** están
apagadas en la configuración del repositorio. Sin ellas no hay *security updates*
—los PRs que se abren porque se publicó una vulnerabilidad, sin esperar al lunes—
y el `npm audit` del CI sólo se entera cuando alguien hace push. Cómo activarlas:
`docs/github.md`, §2.2.

## Más detalle

- `docs/SEGURIDAD.md` — cada hallazgo con el formato «qué encontré → por qué es
  riesgo → qué hice → cómo verificarlo».
- `docs/AUDITORIA_INICIAL.md` — el reconocimiento inicial.
- `docs/audit/00-pendientes.md` — lo que falta.
- `docs/decisiones/` — los 28 ADRs. Los de seguridad son el 0002, 0016, 0017, 0018,
  0025 y 0028.
- `docs/github.md` — la configuración del repositorio en GitHub: lo que hay que
  activar desde la web y ningún archivo puede encender por su cuenta.
