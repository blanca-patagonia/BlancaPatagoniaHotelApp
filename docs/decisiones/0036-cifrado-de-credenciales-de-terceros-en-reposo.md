# ADR 0036 — Cifrado de credenciales de terceros en reposo

- **Estado:** Aceptada
- **Fecha:** 2026-09-09
- **Origen:** pedido del usuario de conectar Mercado Pago y el correo por
  OAuth2 en vez de pegar una clave a mano; guardar el `access_token`/
  `refresh_token` en la base exige algo que hoy no existe.

## Contexto

El pedido decía «usá el mecanismo de secretos que ya quedó definido en el
hardening de seguridad — no lo dupliques». Se revisó antes de escribir nada, y
**ese mecanismo no existe**:

- Los secretos de proveedor (`MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`,
  `STRIPE_SECRET_KEY`...) viven en variables de entorno de Vercel — nunca en
  Postgres.
- Los únicos tokens que hoy viven en la base (`agencias.token`,
  `proveedores.token`, `firmas.token`, `canal_config.ical_token`) son UUIDs
  **sin cifrar**. Les alcanza con RLS + revocación por columna (migración
  0060) porque son credenciales que este sistema **genera y controla**: si se
  filtra un `agencias.token`, se rota con un botón (`regenerarEnlacePortal`) y
  el daño es acotado a esa agencia.

Un `access_token` de Mercado Pago es distinto en un punto que importa: **no lo
genera este sistema, lo genera Mercado Pago**, y con él se puede operar la
cuenta de cobro real del hotel desde afuera — cobrar, ver movimientos, lo que
el scope autorizado permita. RLS protege la FILA contra el resto del staff,
pero no protege el VALOR si alguna vez alguien lee la tabla con `service_role`
sin deber hacerlo, o si un volcado de la base termina en el lugar equivocado.
Ahí es donde RLS sola no alcanza y hace falta cifrado.

## Decisión

**AES-256-GCM a nivel de aplicación**, no cifrado nativo de Postgres
(`pgcrypto`/`pgsodium`):

- La clave de cifrado (`ENCRYPTION_KEY`, 32 bytes en base64) vive en variable
  de entorno, igual que el resto de los secretos del sistema — nunca en la
  base. Si alguien obtiene un volcado de Postgres sin las variables de
  entorno, los tokens siguen ilegibles.
- Se usa `crypto.subtle` (Web Crypto API), no el módulo `crypto` de Node: es
  lo que ya usa `lib/integraciones/firma-webhook.ts` para HMAC, y mantiene el
  código compatible con Edge Runtime sin agregar una dependencia nueva.
- Cada valor cifrado lleva su propio IV aleatorio de 12 bytes (el tamaño
  recomendado para GCM), antepuesto al texto cifrado y al tag de
  autenticación, todo en un único string base64. Un IV reusado en GCM
  compromete la confidencialidad de los dos mensajes que lo comparten — por
  eso se genera uno nuevo en cada llamada a `cifrar()`, nunca uno fijo por
  variable de entorno.
- `ENCRYPTION_KEY` se reusa como secreto HMAC para firmar el parámetro
  `state` del flujo OAuth2 (`lib/conexiones/estado-oauth.ts`): es la misma
  clase de secreto —«lo que sólo este servidor conoce»— y agregar una
  variable de entorno más para lo mismo no suma seguridad, solo superficie
  para olvidarse de configurarla.

## Por qué no `pgcrypto`

Cifrar en la base (`pgp_sym_encrypt`) pondría la clave de cifrado **en la
misma base que protege**: cualquier conexión con privilegio para leer la
función de descifrado (una migración, una consola de `service_role` abierta
por error) descifra todo con la misma sesión. Cifrar en la aplicación separa
dónde vive el dato cifrado (Postgres) de dónde vive la clave (variables de
entorno de Vercel) — son dos sistemas distintos que hay que comprometer los
dos, no uno.

## Consecuencias

**A favor**

- Ya no hace falta pegar un `access_token` a mano en ningún lado: el flujo de
  conexión (ventana emergente, `postMessage`, cierre automático) es
  exactamente lo que un no-técnico puede operar.
- El mismo `cifrar`/`descifrar` sirve para Mercado Pago, Google Mail, y
  cualquier proveedor OAuth2 que se sume después — es infraestructura, no
  código por proveedor.

**En contra, y asumido**

- **Rotar `ENCRYPTION_KEY` invalida todo lo cifrado.** No hay versión de
  clave todavía: cambiarla exige reconectar los proveedores. Para un solo
  hotel con pocas conexiones es un costo aceptable; con más proveedores
  convendría un esquema de versionado de clave.
- **No es un HSM ni un KMS gestionado.** La clave vive en una variable de
  entorno de Vercel, protegida por los mismos controles de acceso que el
  resto de los secretos del proyecto — ni mejor ni peor que
  `SUPABASE_SERVICE_ROLE_KEY` hoy.
