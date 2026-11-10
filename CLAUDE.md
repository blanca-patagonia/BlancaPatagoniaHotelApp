# Blanca Patagonia — Guía para Claude (pautas fijas del proyecto)

> Este archivo define **cómo trabajar en este repo**. Vale siempre, incluso si se
> compacta el contexto. Leerlo antes de actuar.

## Qué es
Sistema Integral de Gestión Hotelera (PMS) para el **Hotel Blanca Patagonia**
(El Calafate, Santa Cruz). Proyecto de **tesis** de Analista de Sistemas (IES).
Autores: Octavio Fakiani y Santiago Morán. Reemplaza Winpax (gestión) y reduce la
dependencia de Booking/OTAs. Referencias de negocio: blancapatagonia.com y el
Tarifario 2025/2026 (Anexo A).

**Alcance de esta rama (`tesis-a-presentar`, ADR 0045):** lo que pidió el hotel —reservas
y estadías, check-in/check-out, consumos, factura, pagos, huéspedes y reportes— más lo que ese
núcleo necesita para funcionar: housekeeping, usuarios y roles, tarifario, divisas, punto de
venta, auditoría, registro de errores y el portal público de reservas. Son **12 áreas** del
panel (`AREAS`, `src/lib/domain/permisos.ts`). `main` conserva el sistema completo; lo que no
está acá se recupera de ahí, y cada módulo quitado salió en un commit propio.

## Cómo trabajar (proceso — OBLIGATORIO)
- Desarrollo **prolijo, escalable y documentado paso a paso**: es entrega de tesis;
  la documentación importa tanto como el código.
- Trabajar **por fases** (ver `docs/roadmap.md`). Cada fase = **avance demostrable
  + tests verdes + bitácora actualizada + ADR** si hubo decisión de arquitectura.
- **Documentación y comentarios en español.**
- Antes de escribir código nuevo, **revisar lo existente** para no duplicar ni romper.
- Actualizar `docs/bitacora.md` en cada avance (fecha · fase · qué · por qué · decisiones).
- Registrar decisiones de arquitectura como **ADRs numerados** en `docs/decisiones/`.
- **Antes de implementar algo grande, mostrar el plan y esperar validación.**
- **Commit/push SOLO cuando el usuario lo pida.**

## Stack
- **Next.js 16** (App Router, TypeScript) + **Tailwind 4**. Deploy en **Vercel**.
- **Supabase** (Postgres + Auth + RLS + Storage). Validación con **zod**. Tests con **vitest**.
- ⚠️ Ver `@AGENTS.md`: Next.js 16 trae breaking changes. Leer
  `node_modules/next/dist/docs/` antes de tocar APIs de Next. `middleware` → `proxy`;
  `cookies()` es **async**.

## Dos vistas separadas (decisión de producto)
- **Gestión hotelera** (`src/app/(front-gestion)/panel`, login de staff) — el foco actual del desarrollo.
- **Reservas de clientes** (público: `src/app/(front-publico)/[idioma]/reservar` y
  `…/[idioma]/alojamientos`, con `/reservar` y `/alojamientos` redirigiendo al prefijo) — vista aparte.
  Las funciones cara al cliente (encuestas, factura propia, pago) van ahí, NO en la gestión.
  El portal está **sólo en español** (`IDIOMAS = ['es']`, `src/lib/i18n/idiomas.ts`) pero conserva
  el prefijo en la URL (`/es/…`) y el diccionario por idioma: volver a sumar uno es agregarlo a esa
  lista y escribir su diccionario (ADR 0045).

## Arquitectura (capas)
> **Mapa de carpetas completo: `ESTRUCTURA.md`** (raíz). Todo el código vive en `src/`.
> Las rutas viejas sin `src/` (`app/panel/…`, `lib/…`) que aparecen en la bitácora,
> los ADRs y los comentarios del código se leen desde `src/`, y `app/panel` pasó a
> `src/app/(front-gestion)/panel` (el grupo entre paréntesis no cambia la URL).
- Presentación (front): `src/app/(front-publico)` portal del huésped ·
  `src/app/(front-gestion)` panel por rol + login.
- Back HTTP: `src/app/(back-api)/api/...` route handlers: `buscar`, `cotizacion`, `salud`,
  `webhooks/pagos/[proveedor]` y los tres crons (`cron/notificaciones`, `cron/salud`,
  `cron/mantenimiento`). El callback de Auth está en `src/app/(back-api)/auth/callback`.
- Lógica: `src/lib/domain` (reglas puras, testeables), `src/lib/availability`,
  `src/lib/payments`, `src/lib/supabase` (clientes server/client/admin/proxy).
- Datos: Postgres con **RLS por rol**. La integridad crítica vive en la **base**,
  no solo en la app.
- ⚠️ **La base NO se achicó con la rama** (ADR 0045): siguen las 127 migraciones y las 69 tablas,
  incluidas las de los módulos quitados (`canal_*`, `crm_*`, `contratos`, `firmas`, `agencias`,
  `proveedores`, `avisos`…) y las columnas `reservas.agencia_id` y `reservas.contrato_id`. Son tablas
  sin pantalla ni código que las use. Una migración aplicada no se edita, y borrarlas se hace como
  paso aparte contra la base de tests aislada. Por eso los tests de RLS (`tests/base-de-datos/rls-*.test.ts`)
  siguen describiendo la base tal como está, con esas tablas incluidas.

## Reglas de dominio clave
- **Roles:** `admin`, `gerencia`, `recepcion`, `housekeeping` (+ huésped público
  sin cuenta). Helper SQL `rol_actual()`.
- **Anti-overbooking (ADR 0002):** restricción de exclusión GiST sobre `estadias`
  (`unidad_id WITH =, periodo WITH &&`) para estados activos. Nunca confiar solo
  en la app; la garantía es de la base.
- **Moneda (ADR 0003):** USD base + ARS a **cotización configurable**.
- **Tarifas (ADR 0004):** doble precio **neto** (agencia) / **rack** (mostrador),
  **IVA discriminado** (se calcula en el dominio, no se almacena sumado). El canal
  de la reserva define `tarifa_tipo` (`directo` y `web` → rack; `booking` y `expedia` → neto;
  `CANAL_TARIFA` en `src/app/(front-gestion)/panel/reservas/actions.ts`). La reserva ya no se
  vincula a una agencia y la factura toma siempre al huésped como receptor.
- **Cancelación (Tarifario):** >14 días sin cargo · 14–7 días primera noche · <7
  días 100% · no-show 100%.

## Convenciones de base de datos
- Migraciones SQL **numeradas** en `supabase/migrations/`; nombres y comentarios en
  español, `snake_case`.
- **RLS activado en TODAS las tablas.** Lectura pública solo en catálogo
  (tipos/tarifas/temporadas/promos activas); datos personales (huéspedes, reservas)
  solo staff.
- En **local** hay que declarar los `GRANT` a `anon`/`authenticated`/`service_role`
  (migración `0006`); en **hosted** los aplica la plataforma. La seguridad real la
  impone RLS.
- `service_role` **solo en servidor** (`src/lib/supabase/admin.ts`, `server-only`).

## Entorno de datos (decisión vigente: Supabase en la nube)
- La base es un **proyecto Supabase hosted**, con las migraciones y el catálogo ya
  aplicados. Levantarlo es `npm install` + `.env.local` + `npm run dev`: **no hace
  falta Docker para usar el sistema.** Instructivo completo en `COMO-LEVANTARLO.md`.
- Claves en **Project Settings → API keys**, formato `sb_publishable_…` /
  `sb_secret_…`. `.env.local` (gitignored) apunta a la nube. Salud: `GET /api/salud`.
  ⚠️ La clave del protocolo S3 del Storage **se parece a la secret y no sirve**: con
  ésa falla todo lo que use `service_role` y el error no dice que la clave esté mal.
- **Docker sigue haciendo falta para una sola cosa: correr los tests.** Hay 22
  archivos de `tests/` que hacen `.delete()` con `service_role` —saltea RLS— sobre `reservas`,
  `huespedes`, `tarifas`, `unidades` y `tipos_unidad`: contra la base real destruyen
  datos del hotel (recontado el 2026-11-10; el comentario de `tests/apoyo/db.ts` todavía dice 24).
  Por eso `tests/apoyo/db.ts` **corta si la URL no es local**, con salida
  de escape `PERMITIR_DB_REMOTA=1` para una base remota descartable.
- Para testear: `npx supabase start` · `npx supabase db reset` · `npm run seed:usuarios`
  (o, mejor, la base aislada de `npm run test:aislado`: ver ADR 0042).
  Studio local http://127.0.0.1:54323 · API local http://127.0.0.1:54321.
- ⚠️ `db reset` **borra los usuarios de auth**: hay que correr `npm run seed:usuarios`
  después, o los tests de facturación fallan (hay FK contra `perfiles`).

## Comandos
- Dev `npm run dev` · Tests `npm test` · Typecheck `npm run typecheck` · Lint `npm run lint`.
- **CI (`.github/workflows/ci.yml`): verde y verificado en GitHub en `main` desde la
  corrida #31** (no verificado en esta rama). Levanta Supabase con Docker, crea el admin y corre typecheck,
  lint, la suite completa con `EXIGIR_DB=1` y el build. Dos cosas a respetar si se
  toca: el paso del seed invoca `node scripts/seed-usuarios.mjs` **directo** y no
  `npm run seed:usuarios` (ese script usa `--env-file-if-exists`, que necesita
  Node ≥ 20.12 y no hay `.env.local` en el runner); y sin ese paso la tabla
  `perfiles` queda vacía y los tests de facturación fallan por la FK.
- El test de integración anti-overbooking (`tests/base-de-datos/overbooking.test.ts`) necesita
  DB local + env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); sin ellos se saltea.
- **Gate de cada fase:** typecheck + lint + tests en verde.

## Estado actual
- **Cifras (recontadas el 2026-11-10):** 127 migraciones · 69 tablas · 29 ADRs · 141 archivos
  de test (138 `.test.ts` + 3 `.test.tsx` de componentes). Corriendo `npm test` **sin base**: 1.197
  tests pasan y 583 se saltean. Con la base local no corrió en esta rama (el ADR 0045 deja
  `npm run test:aislado` como paso previo a la entrega); `typecheck` y `lint` salen con exit 0.
- **Fase 0-2 ✅** fundaciones + núcleo de dominio + panel interno de Recepción ·
  **Fase 3 ✅** pagos · **Fase 4 ✅** portal público de reservas ·
  **Fase 5 ✅** consumos + factura · **Fase 6 ✅** reportes gerenciales ·
  **Fase 7 (parcial) ✅** hardening (token confirmación, expiración pendientes, webhook
  fail-closed) · **Fase 8** ampliación tipo WinPax/Odoo, lo que quedó: **8.2** reservas
  grupales · **8.3** encuestas y reportes avanzados (ADR/RevPAR) · **8.4/8.5** consolidación +
  dashboard-hub · **8.6** fidelidad + inventario · **8.7** reprogramación de reservas y asignación
  de mucamas · **Fase 9** mejora integral del panel: identidad visual propia (ADR 0009),
  componentes compartidos, búsqueda + paginación + export CSV en todos los listados,
  navegación móvil · **Fase 10** asistente del portal basado en reglas (ADR 0011) ·
  **Fase 11** facturación fiscal argentina (ADR 0012), auditoría de operaciones sensibles y
  encuestas NPS · **Fase 12** endurecimiento del CI y tests sobre las Server Actions ·
  **Fase 13** limpieza de código muerto y **cambio de unidad** (mudanza de habitación,
  migración 0028) · **Fase 14** experiencia de uso e interacción táctil · **Fase 15** rediseño
  de la interfaz (se eliminaron los 11 formularios plegados, altas en pantalla propia) y
  **sección de Ayuda** · **Fase 16** portal público a la par del panel · **Fase 17** el CI en
  verde · **Fase 18** cinco bugs encontrados recorriendo el sistema a mano (el más caro: «USD 0»
  al reservar, por falta de temporadas cargadas) · **Fase 19** buscador global por rol,
  confirmaciones y encabezado · **Fase 20** ningún fallo de escritura en silencio (ver
  `src/lib/acciones.ts`) · **Fase 21** catálogo público de alojamientos (`/alojamientos` +
  detalle) · **Fase 22** interfaz azul y blanca (ADR 0026), entrada con Google y menú lateral fijo.
  La numeración de fases es la de `main`; las fases de los módulos quitados (cuentas corrientes
  de agencias, mantenimiento y objetos perdidos, contratos, bandeja, conciliación, canales de
  venta, PWA…) no aplican a esta rama.
- **Modernización WinPAX ✅ (2026-08-16, numeración propia de 11 pasos).** El cliente
  venía de WinPAX (Oracle Forms, ~año 2000) y se cubrieron sus funciones core.
  **El plan completo, con el porqué de cada decisión, está en
  `docs/2-arquitectura/modernizacion-winpax.md`** — leerlo antes de tocar cualquiera de estos
  módulos. Lo que sigue en esta rama: **1** cotización de divisas (cierra el ADR 0003) · **2** fila
  resumen de la grilla + estados legibles sin color · **3** diez vistas operativas del listado de
  reservas, con saldo (`src/lib/domain/vistas-reservas.ts`) · **6** ficha de reserva completa (VIP,
  adultos/menores/bebés, cunas, plan, garantía, segmento, voucher, «no mover», desglose fiscal) ·
  **7** punto de venta con grilla por departamento y número de comanda · **8** folios A/B con split
  y jerarquía de departamentos · **9** housekeeping móvil ordenado por prioridad · **10** piso y
  bloque en `unidades`. Migraciones `0036`–`0043`. El paso **4-5** (canales de venta, importación de
  Booking, feed iCal) y el **11** (respaldos) se quitaron con el ADR 0045; el documento los sigue
  describiendo como historial. Área nueva del panel que quedó: `punto_venta`.
  ⚠️ **Algo de este trabajo que hay que saber antes de tocarlo:** `crear_reserva` **deriva
  `estadias.huespedes` del desglose** (`adultos + menores`; los bebés **no** cuentan, no ocupan
  plaza). No hay `check` en la base que lo garantice, y fue deliberado: habría roto los `update`
  de mudanza (0028) y reprogramación. La coherencia se garantiza en esa función, que es el **único**
  lugar donde nacen estadías.
- **Auditoría de seguridad (numeración propia, empieza de nuevo en Fase 0):**
  **Fase 0 ✅** reconocimiento sin tocar código (`docs/4-seguridad-y-auditorias/AUDITORIA_INICIAL.md`) ·
  **Fase 1 ✅** límite de tasa en las entradas públicas y en el login
  (migración 0029, `src/lib/domain/limites.ts`), guarda del seed contra bases no
  locales y encabezados de seguridad en `next.config.ts` (sin CSP, y está
  documentado por qué) · **Fase 2 ✅** cuatro bugs leyendo el código: el **precio
  neto de agencia quedaba expuesto a `anon`** por RPC (migración 0030), el webhook
  de pagos fallaba abierto, inyección de condiciones en los filtros `or` de
  PostgREST y el `<details>` número 12. La segunda parte (migración 0031, **ADR
  0016**) cierra el otro camino al neto: `anon` no puede **leer la columna
  `precio_neto`** de `tarifas`. ⚠️ **Corrección de la Fase 4 (migración 0070):**
  la 0031 decía además revocarle a `anon` el `execute` de `cotizar_estadia`, y
  **no lo lograba** —revocó de `anon`, que no tenía grant propio, mientras el
  privilegio le seguía llegando por PUBLIC—. La exposición real era nula igual
  (la función es `security invoker`, `anon` no lee `tarifas`, y la 0030 tiene la
  guarda `current_user <> 'anon'` adentro), pero recién la 0070 lo cierra con
  `revoke execute ... from public`. Hay un test de contrato
  (`tests/base-de-datos/funciones-sin-public.test.ts`) para que ninguna función nazca abierta.
  ⚠️ **No hacer `cotizar_estadia` `security definer`**: ahí `current_user` es el
  dueño de la función y la guarda quedaría siempre en verdadero.
  **Fase 5 ✅ (2026-09-08) — el borde público en ESCRITURA, exhaustivo.**
  `tests/base-de-datos/anon-no-escribe.test.ts` audita tabla por tabla que `anon` no tenga
  `insert/update/delete`, con la lista traída de la base. La primera corrida
  encontró que **sí los tenía**: no por una migración de este proyecto —la 0006
  le da sólo `select`— sino por los privilegios por omisión de la plataforma, que
  la 0072 no miró. Exposición real cero (RLS acota a admin/gerencia), pero es la
  forma exacta del hallazgo de `cotizar_estadia`. Lo cierra la **0089**, que
  revoca en bloque y toca los `default privileges` — sin eso el arreglo duraría
  hasta el próximo `create table`.
  **Auditoría de las políticas RLS rol por rol — cerrada del lado de lectura,
  acotada a propósito del lado de escritura.**
  `tests/base-de-datos/rls-por-rol.test.ts` prueba el `select` de **todas las tablas y
  vistas, sin excepción**: lee la lista real de `pg_tables`/vistas y hace fallar el test de
  cobertura si aparece una sin declarar en la matriz — así que un `select` de más o de menos en
  cualquier tabla nueva se detecta solo. `tests/base-de-datos/rls-escritura-por-rol.test.ts` cubre
  el resto (`insert`/`update`/`delete`/`all`), y lo dice de frente en su propio encabezado: es
  **por consecuencia, no por cobertura** — una matriz completa serían tablas × 4 roles × 3
  operaciones, y la mayoría son catálogo de bajo riesgo. Cubre las tablas elegidas por impacto:
  escalada de privilegio (`perfiles`), dinero (`pagos`, `facturas`, `consumos`, `tarifas`,
  `cotizaciones`), inventario (`unidades`, `tipos_unidad`), integridad de `estadias` (la tabla del
  anti-overbooking, ADR 0002) y datos personales (`huespedes`), además de algunas de módulos
  quitados que siguen en la base. Lo que no tiene caso dirigido **no se presenta como auditado**.
  ⚠️ **No se puede correr en un entorno sin Docker**: exige ejecutar las políticas contra una base
  con los cuatro roles, y el *pull* de las imágenes de Supabase estuvo bloqueado por política de
  egreso en el entorno remoto. Hay que hacerlo en local.
  **Fase 3 ✅** (escrita sin Docker, **aplicada y verificada el 2026-08-14**): alta de
  usuario sin privilegios (ADR 0017, migraciones `0032` + `0035`), la baja de un
  usuario revoca acceso en la base y la numeración de facturas vuelve a funcionar
  (`0033`), facturas inmutables y 9 índices en FKs (`0034`), toda Server Action verifica rol con
  guarda estructural (`tests/contratos/autorizacion-acciones.test.ts`), firma HMAC real en el
  webhook de pagos y los simuladores fallan fuerte en producción (ADR 0018). El estado y los
  pendientes están en `docs/5-pendientes/PENDIENTES.md` y `docs/4-seguridad-y-auditorias/`
  (`SEGURIDAD.md`, `revision-seguridad.md`).
  ⚠️ **Al agregar una migración que toque un enum:** `alter type ... add value` y el
  primer uso de ese valor **no pueden ir en el mismo archivo**. El CLI de Supabase
  envuelve cada migración en una transacción y Postgres corta con SQLSTATE 55P04;
  el `db reset` falla ahí y **no aplica nada de lo que sigue**. Es lo que le pasó a
  la `0032` y por eso existe la `0035`.
- **Tests:** para que no salteen contra la base local hay que exportar `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` **y** `NEXT_PUBLIC_SUPABASE_ANON_KEY` (más `NEXT_PUBLIC_SUPABASE_URL`, ver
  `AGENTS.md`): vitest no lee `.env.local`, y `EXIGIR_DB=1` protege `hayDB` pero **no**
  `hayAnon` (`tests/apoyo/db.ts:130`), así que sin la clave publicable los tests del borde público
  del ADR 0016 saltean en silencio. En CI no pasa: el workflow la exporta (`ci.yml:105`).
- **Cuatro adapters** con el mismo patrón (interfaz + simulador, se cambia por env):
  `PaymentProvider` (`src/lib/payments/`), `FacturacionElectronicaProvider`
  (`src/lib/facturacion/`), `EmailProvider` (`src/lib/email/index.ts`, el único camino para
  mandar correo) y `CotizacionProvider` (`src/lib/divisas/`, tipo de cambio). Los eligen
  `PAGO_PROVIDER`, `FACTURACION_PROVIDER`, `EMAIL_PROVIDER` y `COTIZACION_PROVIDER` por
  `src/lib/integraciones/seleccion.ts` (ADR 0018). Hay además un quinto, `AsistenteProvider`
  (`src/lib/asistente/`, `ASISTENTE_PROVIDER`, opcional), cuyo **único valor es `reglas`**: el
  asistente del portal no usa un modelo de IA, a propósito (ADR 0011).
  ⚠️ `CotizacionProvider` es distinto de los otros: **no tiene simulador que mienta**, porque sus
  fuentes son públicas y sin credenciales. Su respaldo es `manual` (no inventa: usa lo que un
  admin cargó). El de facturación sí es un simulador: devuelve un **CAE inventado** con la forma
  del real, y por eso es obligatorio declararlo en producción.
- **Trabajo futuro documentado (ADR 0013):** gestión documental con Storage,
  seguridad por campo y multi-propiedad. No implementar sin releer ese ADR.
- **Hay 29 ADRs, numerados hasta el 0045,** y la numeración tiene huecos: son las decisiones de
  los módulos quitados, que viven en `main`. El último es el **0045** (esta versión reducida). Antes,
  el **0042** (cómo se verifica el sistema: base de tests AISLADA en `supabase-tests/` con
  `npm run test:aislado` —los tests nunca van contra la base de trabajo—, `npm run esquema:comparar`
  antes de cualquier deploy, tests de interfaz en `tests/componentes/` y el recorrido e2e con
  `npm run e2e`). El **0040** (inventario físico real de unidades: nombres reales de
  habitación/cabaña y la franja de calendario de Ocupación, migración 0106). El **0038** (Payway como
  tercera pasarela —posnet/tarjeta local— con el patrón de los dos pasos del lado del integrador
  que exige su Gateway API, distinto del checkout alojado de Mercado Pago/Stripe del ADR 0027). El
  **0037** (Supabase Storage para fotos operativas de housekeeping: bucket privado, acceso siempre
  por URL firmada generada en el servidor). El **0033** (el arrastre en la grilla cambia de
  habitación y no de fechas). El **0029** los errores del servidor se guardan en una tabla de
  Postgres (`errores`, migración 0068), no en un tercero: los datos de huéspedes no salen del
  sistema y el hotel no depende de mirar el log de Vercel. El **0027** cobro en línea con dos
  pasarelas y una sola moneda de saldo. El **0026** interfaz azul y blanca, que reemplaza al
  **0009 solo en paleta y tipografía** (los componentes compartidos siguen vigentes);
  ⚠️ los NOMBRES de los tokens no cambiaron —`lago` es azul, `lenga` es ámbar— porque Tailwind
  resuelve las clases por texto y un renombre masivo rompe sin que el typecheck lo vea. El
  **0025** verificar la tarjeta de garantía **sin guardar el número** (el simulador declara que no
  puede, no inventa un «válida»). El **0024** exención de IVA al turista del exterior, que se
  **deriva y no se tilda**. El **0020** cotización de divisas, que **cierra el 0003**. El **0019**
  cobro efectivo de la política de cancelación (**sin decidir**, pero ya tiene el dato que le
  faltaba: `reservas.garantia` dice si hay de dónde cobrar un no-show). Los previos: **ADR 0016**
  el precio neto fuera del alcance público · **ADR 0017** el alta de usuario nace sin privilegios ·
  **ADR 0018** los simuladores fallan fuerte en producción · **ADR 0012** facturación electrónica
  argentina · **ADR 0011** asistente del portal basado en reglas.
- **Nada del servidor se loguea con `console`** (P1-6). Va por `registrarError` /
  `registrarAviso` de `src/lib/registro.ts`, que además de stdout escribe en `errores`
  y se ve en `/panel/errores` (ADR 0029). `tests/contratos/observabilidad-del-dinero.test.ts`
  recorre `src/app/` y `lib/` enteras y falla si aparece uno nuevo.
  ⚠️ Hay **7 excepciones legítimas** declaradas en ese test **con su motivo**, y el
  test exige que el motivo esté escrito: `/api/salud` (el sink escribe en la misma
  base que sondea), los 3 *error boundaries* (`src/app/error.tsx`, `global-error.tsx` y
  `panel/error.tsx`: son cliente y `registro` es `server-only`), el `EmailProvider` de consola (esa
  ES su salida), la advertencia de arranque de `integraciones/seleccion.ts` y
  `src/lib/divisas` (502 transitorios; persistirlos ahogaría las señales reales).
- ⚠️ **El precio de la estadía y el total de la reserva se escriben JUNTOS**, con
  `aplicar_precio_reserva` (0085). Reprogramar y recotizar por mudanza lo hacían
  con dos `update` sueltos, y si el segundo fallaba el total contradecía a la
  estadía: la reserva quedaba con el precio de las fechas viejas, o facturando la
  unidad anterior. **No volver a escribir `reservas.total` a mano** en esos
  flujos (`tests/contratos/reservas-total-sin-mano.test.ts` lo vigila). ⚠️ La función es
  `security invoker` y comprueba `FOUND` después de CADA `update`: sin eso, un RLS que bloquee la
  escritura afecta cero filas, **no lanza**, y la función devolvería «listo» sin haber hecho nada.
  ⚠️ **Desde la 0114 también escribe el desglose** (`p_subtotal`, `p_total_neto`,
  `p_iva`, opcionales): pasarlo SIEMPRE al recotizar, o `total_neto + iva` deja
  de ser el total. Y recotizar va con las condiciones de la reserva
  (`lib/reservas/condiciones-de-precio.ts`: promoción y descuento adicional);
  sin eso se perdían en silencio. Con factura emitida no se recotiza.
- ⚠️ **`crear_reserva` y `p_agencia_id`.** La 0084 le sumó `p_agencia_id` (opcional, `default null`)
  para que el vínculo con la agencia fuera DENTRO de la función atómica. La app de esta rama **ya
  no lo manda** (`src/lib/reservas/crear.ts`), pero el parámetro sigue en la base. Al tocar esa función:
  **DROP y CREATE, nunca `create or replace`** (cambiar los argumentos crea una sobrecarga y
  PostgREST puede resolver a la vieja), y **rehacer el `revoke execute ... from public`**, porque
  una función nace abierta (y, desde la 0119, también ejecutable por `anon` directo: ver `AGENTS.md`).
- **Fiscal — la parte sin certificado (Bloque D, 2026-09-07).**
  `src/lib/domain/wsfev1.ts` traduce el comprobante al formato de ARCA (lo usa
  `panel/reservas/factura.actions.ts`), y la migración **0082** guarda los datos del **emisor**
  (pantalla `panel/config/datos-fiscales`). ⚠️ Cuatro cosas antes de tocarlo:
  1. **El CUIT del hotel no estaba en ninguna tabla** hasta la 0082, y bloqueaba
     la solicitud de CAE. La tabla es de **una sola fila, impuesta por la base**, y
     **no se siembra**: un CUIT inventado haría creer que ya está configurado.
  2. **Consumidor final es `DocTipo = 99` con `DocNro = 0`.** Hay documentación de
     terceros que dice `5` y es incorrecta.
  3. **Una estadía es `Concepto = 2` (servicios)**, y eso vuelve obligatorias
     `FchServDesde`, `FchServHasta` y `FchVtoPago`.
  4. **La base imponible es el neto MENOS lo exento** (ADR 0024), y la moneda es
     `PES`/`DOL`, no ISO 4217 — con `MonId != PES`, `MonCotiz` no puede ser 1.
  ⚠️ **`facturas` YA tenía columna `moneda`** desde la 0010 (la auditoría decía que
  no). Lo que falta es la conversión a pesos para ARCA, que es del contador. El proveedor de
  facturación vigente es el **simulado**: no hay cliente real de ARCA.
- **Auditoría técnica — Fases 1 a 5 (2026-09-01).** Cinco riesgos de una auditoría
  externa, verificados ejecutando y no leyendo. **F1** `hoyISO()` calculaba «hoy» en
  UTC y el hotel está en UTC−3: bug activo cada noche (housekeeping, punto de venta).
  Ahora en `ZONA_HOTEL`. **F2** observabilidad (ADR 0029). **F3** la
  carrera de facturación ya no gasta un CAE: el número correlativo es la clave de
  idempotencia (migración 0069, `reservar_numero_factura`); medido, el contador
  avanza 1 y no 2 con dos emisiones simultáneas. **F4** dos grants a PUBLIC que las
  auditorías previas daban por cerrados: `cotizar_estadia` y
  `siguiente_numero_comprobante` eran ejecutables por cualquiera (migración 0070,
  con test de contrato `funciones-sin-public`), y `anon` conservaba SELECT de tabla
  sobre todo lo no-catálogo (migración 0072). **F5** los 28 índices de FK que
  faltaban (migración 0071), caché del catálogo público (`src/lib/catalogo/publico.ts`,
  la disponibilidad **no** se cachea) y `verificarCredencialesDePasarela` al
  arrancar (`src/instrumentation.ts`). **Lo que NO se cierra desde código:** «el sistema nunca
  corrió en producción» — latencia real, límites de conexión, un pago por una pasarela viva,
  un CAE de AFIP, y **restaurar un backup**.
- **Relevamiento con el cliente (15/08/2026), cerrado el 2026-08-24.** Franco
  mostró WinPAX 9 y el extranet de Booking. La mayoría ya estaba; se hicieron los
  pedidos que faltaban que siguen vigentes: documentación al día, exención de IVA
  (migración 0058), fuente de la cotización declarada en pantalla y garantía de tarjeta
  tokenizada (migración 0059).
- **Pedidos del cliente del 2026-09-07, hechos el 2026-09-08.** Audio + captura de
  la grilla mensual de WinPAX. Lo que sigue en esta rama, sin migración nueva:
  1. **Arrastrar una reserva en la grilla para cambiarla de habitación**
     (**ADR 0033**). El servidor ya estaba entero: llama a la misma
     `cambiar_unidad_reserva` de la 0028. Lo nuevo es
     `src/lib/domain/arrastre-grilla.ts` (regla pura, que **llama** a
     `mudanzas.ts` en vez de reimplementarla) y
     `src/app/(front-gestion)/panel/ocupacion/arrastre.tsx`.
  2. **Informe de venta por categoría**: `/panel/reportes/categorias` +
     `src/lib/domain/metricas-categoria.ts`.
  3. **Los informes en pantallas propias**: índice + `ocupacion`, `categorias`,
     `satisfaccion`, `estados` y `facturacion`, cada uno con su URL, su mes y un botón
     «Abrir aparte». Catálogo en `src/lib/domain/informes.ts`.
  ⚠️ **Seis cosas que hay que saber antes de tocar esto:**
  1. **El arrastre mueve de HABITACIÓN, nunca de fechas** (ADR 0033). Correr
     fechas recotiza —cambia lo que el huésped paga— y eso no puede salir de un
     gesto que se dispara sin querer. Reprogramar sigue teniendo su pantalla.
  2. **La validación del navegador NO es la garantía**, sigue siendo el ADR 0002.
     Pero hay un caso donde sí alcanza y está demostrado: si el bloque entra
     entero en la ventana visible, cualquier choque posible ya está en pantalla
     (`ventanaAlcanza`). Cuando se sale, el diálogo lo dice en vez de afirmar
     una disponibilidad que no verificó.
  3. **`preventDefault` va en CADA `dragover`**, no sólo al cambiar de fila: el
     navegador da la zona por rechazada apenas un evento pasa sin él y el
     `drop` no llega nunca. El síntoma («a veces no me deja soltar») no apunta
     a la causa.
  4. **La ruta de retorno de la mudanza es un token de lista blanca, no una URL**
     (`retornoDeMudanza`, en `panel/reservas/cambios.actions.ts`). Un campo de formulario con
     «volvé acá» es un redirect abierto.
  5. **La venta por categoría se agrupa por `estadias.tipo_unidad_id`**, no por
     el tipo de la unidad actual: después de una mudanza entre tipos son
     distintos, y un informe de venta dice qué se **vendió**. Un tipo sin
     unidades activas muestra «—» y no «0 %» (no está vacío: no tiene
     denominador), y el ADR del total es ingreso/noches, **no** el promedio de
     los ADR de cada tipo.
  6. **No se hizo vista SQL para el informe por categoría, a propósito**: reusa
     `metricasDeMes`, así ocupación/ADR/RevPAR tienen una sola definición en
     todo el sistema. Los históricos (NPS, estados) **no llevan selector de mes**:
     uno que no cambia nada haría creer que el número es el de ese mes.
- **Auditoría técnica aplicada (2026-08-24).** Doce fases de auditoría y sus hallazgos
  corregidos: el borrado de dinero con permiso revocado y auditado (0061), índices del listado
  (0062), recuperación de contraseña, y las dependencias de 8 vulnerabilidades a 1 baja. Cada
  hallazgo se verificó **ejecutándolo** antes y después; el detalle está en la bitácora.
- **Fase 23 ✅ (2026-08-25) — la pasarela de pagos, enchufada (ADR 0027).** El puerto
  existía desde la Fase 3 y **no lo llamaba nadie**: `crearCheckout` tenía cero call
  sites, `/pago-simulado` daba 404 y no existía `PAGO_PROVIDER`. Hoy se cobra desde
  la web y desde el mostrador, en dólares y en pesos, con **varias pasarelas a la vez**
  (Stripe para la tarjeta internacional, MercadoPago para pesos, cuotas, billetera y
  efectivo en Rapipago; Payway como tercera, ADR 0038) porque el hotel es internacional y ninguna
  cubre las dos puntas. Migración **0067**. ⚠️ Tres cosas antes de tocarlo:
  1. **`pagos.monto` está SIEMPRE en USD.** `resumenPagos` suma esa columna sin mirar
     la moneda; un cobro en pesos guardado ahí daba la reserva por pagada al instante.
     Lo cobrado de verdad va en `monto_cobrado` + `moneda` + `cotizacion`.
  2. **`pendiente → pagada` no existe**: se pasa por `confirmada` (`caminoDeEstados`).
     El salto se descartaba en silencio y la reserva expiraba **con la plata cobrada**.
  3. **`rechazado` no es final para un pago**: el huésped reintenta con otra tarjeta
     bajo la misma referencia externa.
  Ninguna pasarela verifica la tarjeta de garantía y las tres lo declaran (ADR 0025).
- **Fase 25 (2026-09-09) — patrones de sistemas de referencia** (QloApps, Hotel
  PMS, Evolution API, Invoice Ninja). Lo que quedó en esta rama:
  reservas nuevas/canceladas en el tablero (con `reservas.cancelada_en`);
  auditoría de LECTURA de fichas de huésped, no solo de escritura
  (`src/lib/auditoria/accesos.ts`); el huésped puede ver y descargar su propia factura por el
  mismo token de confirmación (`/reservar/factura/[token]`); re-precio inline al reprogramar
  una reserva; y el tarifario rehecho —una fila, un «Guardar», etiquetas
  visibles en vez de `aria-label`—. Migraciones 0090-0093 (alguna de esa tanda es de una pieza quitada).
  A propósito **no** se tocaron: permisos por acción (hoy es rol→área
  completa, cambiarlo toca todas las Server Actions), CSRF propio (Next ya
  protege el origen nativamente en Server Actions), facturación recurrente
  con auto-cobro y el channel manager bidireccional real — son decisiones de negocio o de
  arquitectura mayor, no huecos de código que se llenen en una pasada.
- **Auditoría de calidad QA/UX (2026-09-09).** Relevamiento en vivo con
  Playwright de accesibilidad, flujos, rendimiento e integridad de datos.
  El hallazgo más grande, por volumen: **~53 lecturas de Supabase en páginas
  del panel descartaban `{ error }`** — el mismo antipatrón que la Fase 20 ya
  había cerrado del lado de las escrituras, pero nunca se había mirado del
  lado de las lecturas. Todas quedaron cubiertas con `registrarFalla`, y
  donde el dato es crítico para una decisión de dinero o de disponibilidad
  (el dashboard, la ficha de reserva, el tarifario, el punto de venta, la
  grilla de ocupación) se agregó además un aviso visible que distingue «cero
  confirmado» de «no se pudo leer». Dos bugs de UI reales encontrados y
  corregidos con test de regresión: fechas invertidas en el alta de
  mostrador que dejaban la pantalla en blanco (`parsearBusquedaFechas()` en
  `src/lib/domain/reservas.ts`), y un `<select>` con `w-full` más una etiqueta
  `sr-only` que hacía arrastrar la página entera de costado en el teléfono.
  De paso apareció un bug de segundo orden en el propio test de auditoría de RLS: su seed de
  `notas_credito` se saltaba en silencio si la reserva de prueba no tenía
  factura propia, dejando esa fila de la matriz sin auditar de verdad.
  **Regla nueva a partir de acá:** toda página nueva del panel que lea de Supabase revisa
  `{ error }` con `registrarFalla`, igual que ya es obligatorio para las escrituras.
  Oportunidades de esa auditoría, ya resueltas: `Tabla` (`ui.tsx`) tiene el prop
  `indicarScrollHorizontal` (opt-in) para avisar que se puede arrastrar de costado, y
  `panel/reservas/nueva` guarda un borrador del alta en `sessionStorage` —no `localStorage`: en
  una recepción con la computadora compartida, el nombre de un huésped a medio cargar no debería
  sobrevivir a que alguien cierre la pestaña—, scoped por
  `claveBorradorReserva(checkIn, checkOut, huespedes)`. ⚠️ **Un intento inicial de ese borrador
  rompió la hidratación**: ajustar estado leyendo `sessionStorage` bajo
  `if (typeof window !== 'undefined')` se ve «verdadero» ya en el primer render del cliente, y
  React tiraba «Hydration failed». Se resolvió con `useSyncExternalStore` y `getServerSnapshot`
  en `false`. Hoy sí hay tests de componente (`tests/componentes/`, ADR 0042: tres archivos con
  jsdom y Testing Library); **Lighthouse y React DevTools Profiler siguen sin correrse de forma
  sistemática**.
- **Diseño del panel:** usar SIEMPRE los componentes de `src/app/(front-gestion)/panel/_components/ui.tsx`
  (`Encabezado`, `Tarjeta`, `Kpi`, `Tabla`, `Buscador`, `Paginacion`, `Chip`…) y los
  iconos de `iconos.tsx`.
- **Interfaz (Fase 15) — principio fijado por el usuario:** *nada oculto, nada
  manejado por URL, pensado para gente que no usa mucho la computadora.* En
  concreto: **prohibido `<details>` para esconder una acción o un formulario**
  (se eliminaron los 11 que había); el alta y la edición van en **pantalla
  propia** con un botón primario visible en el `Encabezado` del listado; todo
  campo lleva **etiqueta visible** (`Campo`), nunca solo `placeholder`; al
  guardar no se redirige solo, se usa `ExitoConPasos`; los `<form action={…}>`
  de servidor usan `BotonEnvio` (bloquea el doble clic) y `confirmar` si la
  acción no tiene vuelta atrás. Envolver cada pantalla en `Pagina`.
- **Escrituras a la base (Fase 20) — OBLIGATORIO en toda Server Action nueva:**
  *nunca descartar el error de un `insert`/`update`/`delete`.* Si la base rechaza y
  nadie avisa, la pantalla recarga sin cambios y quien la usa no puede distinguir
  «no se pudo» de «no pasó nada». Había 38 así; hoy hay **cero**, y conviene que
  siga en cero.
  - Acción que **devuelve estado**: `return { error: 'mensaje en español' }`.
  - Acción que **redirige**: `cortarSiFalla(error, destino, 'motivo')` de
    `src/lib/acciones.ts`, y sumar el motivo al `MENSAJES_ERROR` de la pantalla destino
    (que además tiene fallback, así que un motivo sin mapear igual muestra algo).
    Verificar que esa pantalla **renderice** `?error=`: varias no lo hacían y el
    mensaje se perdía.
  - **Compensaciones y escrituras accesorias**: `registrarFalla(error, contexto)`,
    que loguea sin cortar. En un rollback, `cortarSiFalla` **taparía el error
    original**, que es el que hay que mostrar.
  - El detalle técnico va al **log del servidor, nunca a la URL**.
  - ⚠️ Un mensaje de error **no arregla la atomicidad**: en los flujos de varios
    pasos de `reservas`, si falla el paso 3 los datos quedan a medias. Está anotado
    en el código; resolverlo pide una función SQL transaccional.
- **Lecturas de la base (auditoría QA/UX 2026-09-09) — OBLIGATORIO en toda
  página nueva del panel:** *nunca descartar el error de un `select`.* La
  Fase 20 ya exigía esto para escrituras; del lado de las lecturas había
  **~53 pantallas** que solo tomaban `{ data }` y tiraban el `error`. El
  problema no es solo el log perdido: una lectura fallida devuelve `data:
  null`, que el código vacío (`?? []`) confunde con «no hay nada» — la
  grilla de ocupación se veía toda libre y el punto de venta decía «no hay
  nadie alojado hoy». Regla: `registrarFalla(error, 'modulo:que_se_leyó')`
  siempre, sin condicional; y cuando el dato es crítico para una decisión de
  dinero o de disponibilidad, sumar un `<Mensaje tono="error">` visible que
  diga explícitamente «no se pudo leer», nunca solo mostrar la pantalla vacía.
- **Precios al público — OBLIGATORIO:** `tarifas.precio_rack` se guarda **sin
  IVA** (ADR 0004) y el checkout lo suma en `calcularEstadia`. Toda pantalla que
  le muestre un precio a un huésped tiene que pasarlo por `conIva()` de
  `src/lib/domain/catalogo.ts`, o publica un número más bajo del que después cobra.
  Y los rangos de temporada son `[desde, hasta)` con el **fin excluido**: para
  mostrarlos va `textoRango()`, que resta el día.
- **Días del hotel en consultas e informes — OBLIGATORIO (2026-10-19):** un
  `timestamptz` se corta con `fechaDelHotel()` y no con `.slice(0, 10)` (eso es
  el día UTC: entre las 21 y las 24 de El Calafate da el día siguiente), y para
  filtrar «el día D» va `>= inicioDelDiaHotel(D)` y `< inicioDelDiaHotel(D+1)`,
  no `'AAAA-MM-DD'` pelado. «Nuevas/canceladas hoy» del tablero tenía este bug:
  lo cobrado a la noche caía en el día siguiente.
- **La cuenta se cierra con la factura en TODOS los caminos:** cargar, mover de
  folio, quitar consumos y cerrar o anular comandas pasan por
  `motivoCuentaCerrada()` (`lib/reservas/cuenta-cerrada.ts`). Y la factura
  impresa muestra el total del COMPROBANTE, no el recalculado.
- **Dos módulos que existen sólo para no duplicar una regla de plata:**
  `src/lib/notificaciones/cobros.ts` (los avisos de un cobro, desde el webhook y desde el
  mostrador) y `src/lib/reservas/cancelacion.ts` (el cargo por cancelar, desde la ficha de la
  reserva y desde la acción de cancelar). Es la situación de `saldarSiCorresponde`
  (`src/lib/reservas/saldar.ts`), que estuvo duplicada, divergió, y se notó en la plata.
  Y `DIAS_EXPIRACION` vive **una sola vez**, en `src/lib/domain/expiracion.ts`: lo usan el cron
  que libera las reservas sin seña y lo que se le dice al huésped; con dos constantes, subir una
  sin la otra le prometería un plazo distinto del que el sistema aplica.
- **Notificaciones al huésped: sólo por correo, diez eventos** (`EVENTOS_EMAIL` en
  `src/lib/domain/plantillas.ts`: confirmación, pago recibido o rechazado, cancelación,
  reprogramación, no-show, recordatorio de check-in, encuesta, cambio de nivel de fidelidad…).
  `src/lib/notificaciones/` es una bandeja de salida con reintentos: **encolar y enviar están
  separados a propósito** (`encolar` en la acción, `despachar` en `cron/notificaciones`), así un
  proveedor lento no demora el alta de una reserva y un fallo suyo no se pierde. Ninguna función
  de `eventos.ts` corta la operación que la llamó.
- **Tareas programadas (0117):** son **tres** (`notificaciones` cada 5 min, `salud` cada 15 y
  `mantenimiento` una vez al día: expira las reservas sin seña y purga `errores`). Cada una anota
  su resultado con `anotarCorrida()` (`lib/crons.ts`) y el tablero avisa a la dirección, en
  producción, cuando una lleva más de su tolerancia sin correr (`lib/domain/crons.ts`). Un cron
  nuevo se suma a `CRONS` y a `vercel.json` (el contrato `tests/contratos/cron-get.test.ts` exige
  que responda a GET). Los de 5 y 15 minutos exigen el plan Pro de Vercel
  (`docs/3-manuales/despliegue.md` §0).
- **Listas blancas:** `deLista(LISTA, valor)` de `lib/domain/listas.ts` y no
  `(LISTA as readonly string[]).includes(x) ? (x as T) : …`.
- **Mensajes de error al usuario, en español:** nunca `${error.message}` en lo
  que ve el usuario (llegaba Postgres en inglés). Va `mensajeDeFalla()` de
  `lib/acciones.ts`, que registra el detalle y traduce duplicado/en uso/formato.
  Y los `?error=` se leen con `mensajeDe()` de `lib/listados.ts` (seguro ante
  claves heredadas como `constructor`).
- **Fechas y horas en pantalla — OBLIGATORIO:** un `timestamptz` **nunca** se
  formatea con `new Date(iso).toLocaleDateString('es-AR')` pelado. Sin `timeZone`
  toma la del proceso, que en Vercel es UTC: entre las 21:00 y la medianoche de
  El Calafate la fecha se corre un día y toda hora sale tres horas adelantada.
  Van `fechaHotel()`, `fechaHoraHotel()` y `horaHotel()` de `src/lib/fechas.ts`, que
  fijan `ZONA_HOTEL`. Es el mismo error que `hoyISO()` arregló del lado de lo que
  el sistema **opera**, y estaba en 14 pantallas del lado de lo que **muestra**
  (entre ellas la emisión de una nota de crédito y la auditoría). Esos helpers además fijan
  **reloj de 24 horas**: el ICU de Node formatea `es-AR` en 12 y `toLocaleString` no le pone el
  a. m./p. m., así que las 21:30 salían «09:30:00», iguales a las de la mañana.
- **Exportaciones CSV:** `escaparCampo()` de `src/lib/csv.ts` antepone un apóstrofo a
  lo que empiece con `= + - @` (inyección de fórmulas), **salvo** un decimal
  escrito entero (`-50.00`). Sin esa excepción todo importe negativo —saldo a
  favor, nota de crédito— llegaba a Excel como texto
  y la columna sumaba mal sin que nada lo delatara.
  ⚠️ **Los importes van con COMA decimal** (`decimal()` de `src/lib/csv.ts`):
  Excel en es-AR —el mismo que separa columnas por `;`— no reconoce `145.20`
  como número. **Los filtros de la pantalla tienen que llegar al archivo**: la
  condición vive en `panel/exportar/busquedas.ts` y la usan la pantalla y el
  exportador. **Un fallo de lectura responde 500**, nunca un CSV vacío (se ve
  igual que «no hay datos»). El libro de ventas (facturas + notas de crédito en
  negativo) sale de `lib/domain/libro-ventas.ts`, y los informes de facturación
  también restan las notas de crédito.
- **Filtros `or` de PostgREST:** el término del usuario **nunca** se interpola
  pelado (la coma separa condiciones y los paréntesis agrupan: `x,id.gt.0` cambia
  el filtro). Va `patronOr()` de `src/lib/listados.ts`, que lo encierra entre comillas
  dobles. Escapar `%` y `_` **no alcanza**: esos son los comodines de LIKE, otra
  capa distinta. Las llamadas `.ilike('col', valor)` son seguras: ahí el valor
  viaja como parámetro y no como sintaxis.
- **Ayuda:** el contenido vive en `src/lib/domain/ayuda.ts` y se filtra por rol con
  `puedeAcceder`. Al agregar un módulo, sumarle su capítulo ahí.
- **Móvil (Fase 14):** columnas de tabla no esenciales con `COL_SECUNDARIA`
  (`hidden sm:table-cell`), aplicado al `<th>` **y** al `<td>`; si el dato importa,
  plegarlo bajo la columna principal con `sm:hidden` en vez de perderlo. Campos y
  botones de formulario `w-full sm:w-auto`. Nunca `overflow-hidden` sobre una tabla
  (recorta datos): va `overflow-x-auto`. `globals.css` ya da 16px a los campos y
  44px de área de toque bajo `@media (pointer: coarse)`; no hace falta repetirlo. Paleta de marca: `lago` / `calafate` / `lenga` / `stone`
  (no usar `sky` ni `amber`). Títulos con `font-display`.
- ⚠️ `next/font/google` descarga las tipografías en build. Si se borra `.next` y la
  descarga falla, el error se cachea y **toda la app da 500** (incluido `/login`):
  se arregla reiniciando el dev server.
- ⚠️ El builder de PostgREST es **thenable**: una función `async` no debe devolverlo
  pelado o el `await` del llamador ejecuta la consulta (ver `reservas/consulta.ts`).
- **Cara al cliente (diferido a la vista pública `src/app/(front-publico)`):** web check-in y
  encuestas de satisfacción NO van en la gestión. La encuesta se responde por token en
  `/encuesta/[token]`.
- **Deploy** (Vercel + Supabase cloud) pendiente — requiere cuentas del usuario.
- **Pagos: los adaptadores reales están escritos** (MercadoPago Checkout Pro, Stripe Checkout
  Sessions y Payway, por HTTP y sin SDK). Lo que falta es **contratar** las
  pasarelas: enchufarlas es cargar `PAGO_PROVIDER` y las credenciales, no tocar
  código (ADR 0027). **El envío de email real también está integrado** (Resend,
  `src/lib/email/resend.ts`, por HTTP y sin SDK): enchufarlo es cargar
  `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` con un dominio
  verificado en Resend (ver `COMO-LEVANTARLO.md`). Esta rama no recibe webhooks de Resend, así que
  **no se detectan los rebotes**: el estado de un aviso llega hasta `enviada`.
- ⚠️ **Variables obligatorias en producción** (ADR 0018: si faltan, el sistema falla
  al arrancar —`src/instrumentation.ts`—, a propósito): `EMAIL_PROVIDER`,
  `FACTURACION_PROVIDER`, `COTIZACION_PROVIDER` y **`PAGO_PROVIDER`**
  (ésta admite **varias separadas por comas**: `mercadopago,stripe,payway`; es el único
  adapter plural, porque el hotel ofrece varios medios a la vez), más `NEXT_PUBLIC_SITE_URL` y
  `CRON_SECRET`. Con las pasarelas van `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYWAY_PUBLIC_KEY`, `PAYWAY_PRIVATE_KEY` y
  `PAYWAY_INTERNAL_SECRET`. Opcionales: `DOLARAPI_URL`, `ARGENTINADATOS_URL`, `AMBITO_URL`,
  `ASISTENTE_PROVIDER` y `AUTH_GOOGLE_HABILITADO`.
  **La tabla completa, con qué pasa si falta cada una, está en
  `docs/3-manuales/despliegue.md` §1** — junto con las instrucciones de despliegue y de
  vuelta atrás (entregables 8, 15 y 16). Revisarlas **antes** del deploy.
- Admin de la **base local de tests**: `admin@blancapatagonia.local` / `blancadev1234`
  (`npm run seed:usuarios`, que hay que repetir después de cada `db reset`). En el
  proyecto hosted los usuarios ya están sembrados y **no hay que correr el seed**:
  se entra al panel con las credenciales de cada uno. ⚠️ Esa contraseña es pública
  —está en este repositorio, que es público—, así que sirve para `127.0.0.1` y no
  para una base alcanzable desde internet.
- Al embeber `huespedes` desde `reservas` usar `huespedes!reservas_huesped_id_fkey` (hay 2 FKs).
- ✅ **Inventario físico real de unidades, resuelto** (ADR 0040, migraciones
  0106-0108: nombres reales de habitaciones/cabañas y baja de las cabañas
  ficticias del seed representativo). **Sigue pendiente de confirmar con el
  hotel la tarifa rack de cabañas** (hoy igual al neto). El Tarifario cargado
  es 2025/2026 (anterior a la fecha del sistema).

@AGENTS.md
