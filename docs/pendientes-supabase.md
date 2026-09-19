# Pendientes de Supabase

> Escrito el 2026-09-16, al cerrar una auditoría funcional del panel hecha
> navegando de verdad con Claude + la extensión de Chrome. Todo lo de acá
> requiere tocar la base (migraciones, datos o configuración de Supabase) y
> por eso se dejó aparte — la sesión que lo escribió tenía instrucción
> explícita de **no tocar Supabase**. Es autocontenido: se puede abrir una
> sesión nueva con solo este archivo y seguir.

---

## 1. Urgente — la base local quedó desincronizada de sus propias migraciones

### El diagnóstico, verificado con `psql` directo (no asumido)

```
supabase_migrations.schema_migrations dice aplicadas: ... 0087, 0088, ... 0095, 0101
```

Pero:

```sql
-- Ninguna de las dos existe en el esquema real:
\dt public.canal_restricciones   →  Did not find any relation
\dt public.plantillas_email      →  Did not find any relation
```

Y probando en vivo apareció un tercer caso: `canal_reservas.divergencia`
(de la migración 0088) tampoco existe — el error real fue
`column canal_reservas.divergencia does not exist`.

**Conclusión:** el registro de versiones dice que 0087-0095 están aplicadas,
pero varias de esas migraciones no surtieron efecto de verdad — probablemente
un `supabase migration repair` que marcó versiones sin correr el SQL. Y las
migraciones **0096 a 0108 nunca se aplicaron** (el registro salta de 0095 a
0101, y no hay nada después de 0101).

No es un bug de código: es el estado de esta base local en particular.

### La acción

```
npx supabase db reset && npm run seed:usuarios
```

⚠️ Esto borra los usuarios de auth (por eso el seed después). Es la base
LOCAL de tests, no la hosted — confirmar igual antes con quien esté usando
esta sesión, porque el hook de seguridad del repo bloquea `db reset` a
propósito y hay que correrlo a mano.

### Qué reverificar después del reset

Varios hallazgos de la auditoría del 2026-09-16 se atribuyeron a este drift,
no a un bug de código — pero **se dedujo por inspección, no se probó con la
base ya corregida**. Después del reset, volver a probar en el navegador:

- **Publicación al canal** (`/panel/canales?vista=publicacion`) — cargar un
  tope de cupo o una restricción por fecha, guardar, recargar. Tendría que
  persistir (ya se probó que el `insert`/`upsert` usa `cortarSiFalla`
  correctamente — lo que faltaba era la tabla).
- **Plantillas de correo** (`/panel/config/plantillas`) — editar el texto de
  una plantilla, guardar, y confirmar que el banner rojo "No se pudo leer
  qué plantillas están editadas" desaparece.
- **Conexión de Mercado Pago** (`/panel/config/conexiones`) — el 500 de
  `/api/conexiones/mercadopago/autorizar` era por falta de `ENCRYPTION_KEY`
  (variable de entorno, no de Supabase), así que esto no se arregla solo con
  el reset — pero conviene revisar si además dependía de alguna tabla de las
  migraciones 0096+ (`conexiones_proveedores`, migración 0096).
- Correr `npm test` completo con las 4 variables de entorno exportadas
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`) para confirmar que sigue en 0 salteados por este
  motivo.

---

## 2. Corrección de datos — una reserva cargada sin el IVA que le correspondía

Investigado con consultas de sólo lectura (no se tocó nada):

```sql
select r.codigo, e.periodo, e.precio_noche, r.total, r.estado
from estadias e join reservas r on r.id = e.reserva_id
order by e.periodo;

     codigo     |         periodo         | precio_noche | total  |   estado
----------------+-------------------------+--------------+--------+------------
 BP-260825-2EA7 | [2026-08-25,2026-08-28) |       121.00 | 363.00 | checkout
 BP-260910-9078 | [2026-09-10,2026-09-11) |       240.00 | 290.40 | confirmada
 BP-260909-A6DB | [2026-10-10,2026-10-12) |       143.00 | 346.06 | confirmada
```

Las dos últimas tienen `total = precio_noche × noches × 1.21` (el 21% de
IVA). La primera (`BP-260825-2EA7`) tiene `total = precio_noche × noches`
**exacto, sin el 21%** — 121 × 3 = 363,00.

No es una exención legítima del ADR 0024 (turista del exterior): se verificó
que esa reserva tiene `huespedes.residente_exterior = false` y
`reservas.pago_desde_exterior` vacío. Es un dato cargado sin el IVA que le
correspondía — probablemente una fila de seed vieja, de antes de que la
lógica de IVA estuviera completa.

**Qué hacer:** decidir si corresponde corregir `reservas.total` a mano
(363,00 → 439,23) para que los tres registros de ejemplo sean consistentes,
o dejarla así si es un caso de prueba deliberado para ejercitar el sistema
con datos "sucios". Si se corrige, hacerlo con el cliente admin y dejar
constancia en la bitácora — no hay ninguna Server Action pensada para
"corregir el total de una reserva ya facturada o en checkout" a propósito
(ver la nota de `emitirFactura` sobre por qué una factura con CAE es
inmutable).

---

## 3. Limpieza de datos de demo / prueba

Encontrado navegando, sin arreglar (es contenido de la base, no código):

- **~84 de 86 huéspedes** son `Externo-xxxxxx` con email `@ejemplo.com`,
  contra sólo 3 reservas reales. Es lógico en un ambiente de desarrollo — la
  pregunta es si conviene sembrar un dataset de demo más chico y realista
  para las próximas rondas de prueba, en vez de acarrear docenas de fichas
  vacías.
- **Una tarea de mantenimiento preventivo** con el título `"rrr"` — dato de
  prueba, candidato a borrar.
- **Un huésped con `<script>alert(1)</script>` en el apellido.** Confirmado
  que React lo escapa bien en el listado y en el buscador (no es explotable
  ahí). Antes de borrarlo, sería bueno verificar los dos caminos que NO
  pasan por el escapado automático de React:
  - **Exportar CSV** de huéspedes — revisar que `escaparCampo()`
    (`lib/csv.ts`) no tenga un caso borde con `<script>` (debería estar bien,
    ese escapado es para inyección de fórmulas de Excel — `= + - @ —, no
    para HTML — pero conviene confirmarlo en un CSV real).
  - **Vista HTML de una plantilla de correo**, si alguna vez se le manda un
    correo a este huésped de prueba con su apellido interpolado
    (`textoAHtml` en `lib/domain/plantillas.ts` ya escapa con
    `escaparHtml()` antes de formatear — también debería estar bien, pero
    no se verificó en vivo mandándole un correo de verdad).

  Una vez verificados los dos caminos, este huésped de prueba se puede
  borrar sin más vueltas.

---

## 4. Configuración de Supabase a revisar (Dashboard / `config.toml`)

No se tocó nada acá, son punteros a revisar cuando se vuelva a tocar el
proyecto de Supabase:

- **`[auth.email].enable_signup`** — AGENTS.md documenta una trampa real: en
  `false` apaga TAMBIÉN el login con contraseña del staff (`enable_signup`
  no es "no dejes que se registren", es "habilitá el proveedor de email").
  Quien cierra el auto-registro público es `[auth].enable_signup = false`,
  un flag distinto. Confirmar que los dos estén en el valor que corresponde
  antes de cualquier despliegue nuevo — `tests/auth-config.test.ts` ya fija
  las dos garantías juntas, pero vale la pena revisar a mano en el
  Dashboard del proyecto hosted, que es donde de verdad importa.
- **Variables obligatorias en producción** (ADR 0018) que dependen de
  credenciales que viven en Supabase o relacionadas: `MERCADOPAGO_ACCESS_TOKEN`,
  `MERCADOPAGO_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `ENCRYPTION_KEY` (para el OAuth2 de las conexiones de proveedores, migración
  0096). El detalle completo con qué pasa si falta cada una está en
  `docs/despliegue.md` §1 — no repetirlo acá, pero es el primer lugar a mirar
  antes del deploy.

---

## 5. Ya declarado como línea consciente, no huecos — sólo si se quiere ampliar

De `CLAUDE.md`, sin re-litigar la decisión, sólo para que quede a mano:

- **Auditoría de políticas RLS de escritura**: cubre 13 tablas elegidas por
  impacto (dinero, escalada de privilegio, integridad de `estadias`). Quedan
  **36 tablas con alguna política de escritura sin caso dirigido** — el
  propio archivo (`tests/rls-escritura-por-rol.test.ts`) explica por qué es
  "por consecuencia, no por cobertura" y no es una omisión silenciosa. Si se
  quiere ampliar la cobertura, ese test es el punto de partida.
- **`docs/decisiones/0013-*.md`** (gestión documental con Storage, seguridad
  por campo, multi-propiedad) — trabajo futuro documentado, no implementado.
  No tocar sin releer ese ADR primero.

---

## Cómo seguir

1. Primero el punto 1 (el reset) — todo lo demás depende de tener la base al
   día para poder distinguir "esto sigue roto" de "esto era el drift".
2. Después, el punto 2 es una decisión de negocio chica (¿corregimos un
   dato de ejemplo?) — no bloquea nada más.
3. Los puntos 3 y 4 son housekeeping, se pueden hacer en cualquier momento.
4. El punto 5 es opcional, sólo si en algún momento se decide invertir en
   ampliar la cobertura de RLS más allá de las 13 tablas de alto impacto.
