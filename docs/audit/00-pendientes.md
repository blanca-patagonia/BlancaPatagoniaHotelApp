# Auditoría — qué se corrigió y qué falta

**Fecha:** 2026-08-14 · **Rama:** `audit/fase-1-seguridad-critica`

Dos auditorías multi-agente sobre 24 dimensiones produjeron **193 hallazgos brutos**; tras
verificación adversarial quedaron **97 confirmados**, de los cuales **99 son críticos o altos**
(varios los encontraron agentes independientes por separado, lo que sube la confianza).

Este documento registra lo aplicado y, sobre todo, **lo que queda**. La lista completa de
hallazgos está en los journals de las corridas `wf_10f9c38e-13f` y `wf_a6a689c5-595`.

---

## Corregido en esta rama

| # | Problema | Dónde | Verificación |
|---|---|---|---|
| 1 | Cualquiera en internet se registraba como recepcionista | migración `0032`, `config.toml` | ⚠️ sin Docker |
| 2 | Huéspedes exigía sesión, no rol | `app/panel/huespedes/actions.ts` | ✅ test |
| 3 | Facturación emitía CAE inventado en silencio | `lib/integraciones/seleccion.ts` | ✅ 10 tests |
| 4 | La baja de un usuario no revocaba acceso a la base | migración `0033` | ⚠️ sin Docker |
| 5 | Ninguna factura se podía emitir (función invoker sin permiso) | migración `0033` | ⚠️ sin Docker |
| 6 | Inyección de condiciones en el filtro de huéspedes | `app/panel/huespedes/page.tsx` | ✅ typecheck |
| 7 | Pago aprobado quedaba `pendiente` y la reserva impaga | webhook + `lib/domain/pagos.ts` | ✅ 7 tests |
| 8 | Tokens de firma legibles por cualquier rol de staff | migración `0034` | ⚠️ sin Docker |
| 9 | Facturas emitidas se podían editar y borrar | migración `0034` | ⚠️ sin Docker |
| 10 | 9 claves foráneas sin índice | migración `0034` | ⚠️ sin Docker |
| 11 | Limitador evadible rotando `x-forwarded-for` | `lib/limites.ts` | ✅ typecheck |
| 12 | CSV y reportes truncados en 1000 filas sin aviso | `lib/paginado.ts` | ✅ 6 tests |
| 13 | KPI calculados sobre datos incompletos, en silencio | `app/panel/reportes/page.tsx` | ✅ aviso visible |
| 14 | Enlaces a `localhost` en los correos de producción | `lib/env.ts` | ✅ typecheck |
| 15 | El alta pública no validaba la capacidad de la unidad | `lib/domain/unidades.ts` | ✅ 8 tests |
| 16 | El portal público duplicaba huéspedes en cada reserva | `app/reservar/actions.ts` | ✅ typecheck |
| 17 | `verificarFirma` comparaba un secreto de cabecera, sin firma real | `lib/integraciones/firma-webhook.ts` | ✅ 12 tests |

| 18 | **17 Server Actions sin ninguna verificación de rol** | 7 archivos de `actions.ts` | ✅ test estructural |

**Agregado, que no existía:** `npm run check` (verificación única), `npm run setup`
(puesta en marcha que dice qué falta), `GET /api/salud` (healthcheck),
`tests/autorizacion-acciones.test.ts` (guarda estructural).

### Hallazgo #18 — el más grave de la Fase 4

Al inventariar los 29 tests con la sesión falseada apareció **por qué el mock no rompía nada**:
17 de las 51 Server Actions del panel no verificaban ningún rol. Entre ellas `registrarPago`,
`cambiarEstadoReserva`, `emitirFactura`, `cambiarUnidadReserva` y `crearReservaGrupal`.

`proxy.ts` tampoco bloquea: solo refresca el token y devuelve `NextResponse.next()`.

**Matiz que baja la severidad de crítica a alta:** ninguna de las 17 usa `crearClienteAdmin`,
así que todas pasan por RLS. La barrera existía, pero era la única — y son las ~60 políticas que
el equipo declaró sin auditar.

Estado final medido: **51 acciones con verificación de rol · 0 sin verificación · 0 que solo
autentican.**

La guarda es ahora estructural (`tests/autorizacion-acciones.test.ts`): análisis estático que
recorre los `actions.ts` y falla nombrando archivo, línea y acción. **Verificado rompiendo una
guarda a propósito y comprobando que la suite se pone en rojo.**

Suite: **393 tests** (eran 344). ADRs `0017` y `0018`. Migraciones `0032`, `0033`, `0034`.

---

## Lo que falta — por prioridad

### Fase 5 — UX y accesibilidad

Cerrado y verificado con `npm run check`:

| Mejora | Antes | Después |
|---|---|---|
| Páginas con `loading.tsx` | 26 / 48 | **45 / 48** |
| Límites de error | 1 (solo panel) | **3** (panel · público · raíz) |
| `prefers-reduced-motion` | no respetado (84 transiciones) | **respetado** |
| Estados vacíos con salida | 15 / 27 | **19 / 27** |
| Foco visible sobre `focus:outline-none` | pisado en 15 controles | **anillo por `box-shadow`** |

**Pendiente de verificación (no marcar como hecho):**

- [ ] **Preservación de lo escrito en el formulario de huéspedes.** Se agregó `valores` a
      `EstadoHuesped` siguiendo el patrón que ya usa `EstadoNuevaReserva`, pero `defaultValue`
      solo aplica al montar el input. Depende del reseteo de formulario de React 19 tras una
      action. **Hay que comprobarlo en el navegador:** cargar un huésped con CUIT inválido y
      confirmar que los nueve campos siguen llenos. Si no funciona, `reservas/nueva` tiene el
      mismo problema latente.
- [ ] Los otros 7 archivos de acciones (28 retornos de error) siguen perdiendo lo escrito.
      Se hizo solo huéspedes, que es el formulario más largo y el de mostrador.

### P0 · Acción manual tuya, hoy

- [ ] **Apagar el auto-registro en el Supabase hosted** (*Authentication → Providers*).
      `config.toml` solo cubre el entorno local; el default de la plataforma es habilitado.
- [ ] **Aplicar y probar las migraciones `0032` y `0033`** con Docker:
      `npx supabase db reset && npm run seed:usuarios && EXIGIR_DB=1 npm test`.
- [ ] **Auditar los perfiles existentes** si la base estuvo expuesta:
      `select p.id, p.nombre, p.rol, p.activo, p.creado_en, u.email from perfiles p join auth.users u on u.id = p.id order by p.creado_en desc;`
- [ ] Agregar a `.env.example` (el harness bloquea editar archivos `.env`):
      `EMAIL_PROVIDER`, `FIRMA_PROVIDER`, `FACTURACION_PROVIDER`.

### P0 · Correcciones pendientes

- [x] ~~**Los tokens de portal y firma son legibles por cualquier rol de staff**, housekeeping~~ ✅ corregido
      incluido, vía PostgREST (`0018_contratos_firmas.sql:115`). Un token es una credencial:
      leerlo es poder usarlo.
- [x] ~~**`verificarFirma` no verifica ninguna firma** (`lib/payments/index.ts:62`): compara un~~ ✅ corregido
      secreto estático de cabecera, sin vínculo con el cuerpo y con `===` no constante.
      Hoy no hay proveedor real conectado, pero el contrato está mal y se va a heredar.
- [ ] **Los 29 tests de Server Actions desactivan la autorización** que esas acciones tienen
      (`tests/acciones/entorno.ts:36`). Prueban todo menos lo que más importa.
- [x] ~~**`facturas` es mutable y borrable por recepción** sin auditoría~~ ✅ corregido
      (`0010_consumos_facturas.sql:85`). Borrar una factura deja un hueco correlativo permanente.
- [x] ~~**Reportes agrega en JavaScript sobre 5 tablas enteras** y PostgREST corta en 1000 filas~~ ✅ corregido
      (`app/panel/reportes/page.tsx:73`): los KPI mienten en silencio a partir del mes 11.

### P1 · Integridad de datos y dinero

- [ ] `emitirFactura` es check-then-act sin restricción única sobre `facturas.reserva_id`: dos
      emisiones simultáneas generan dos comprobantes fiscales de la misma reserva.
- [ ] El correlativo se reserva en transacción propia antes de pedir el CAE: cualquier rechazo
      posterior deja un hueco permanente.
- [ ] `crearReservaGrupal` no es atómica y reporta un lote parcial como éxito.
- [ ] `resumenPagos` ignora los consumos: se factura más de lo que el sistema considera saldado.
- [ ] El cargo por cancelación «primera noche» usa el precio **sin IVA y promediado**, no la
      primera noche real.
- [ ] La política de cancelación se calcula y se le anuncia al usuario, **pero nunca se cobra**.
      La rama de no-show no tiene un solo llamador.
- [ ] `cambiarEstadoReserva` pisa los puntos de fidelidad en vez de sumarlos si falla la lectura.
- [ ] `registrarPago` descarta errores de lectura y deja el pago cobrado con la reserva sin marcar.
- [x] ~~El alta pública de reservas **no valida la capacidad de la unidad**: el límite de huéspedes~~ ✅ corregido
      solo existe en el filtro de la pantalla.
- [ ] Trigger de descuento de stock y `cambiar_unidad_reserva`: mismo defecto que la `0033`
      corrigió en numeración — corren como invoker sobre tablas donde recepción no escribe.

### P1 · Seguridad

- [x] ~~El limitador de intentos se llavea con `x-forwarded-for`, que **controla el cliente**~~ ✅ corregido
      (`lib/limites.ts:19`): se evade rotando la cabecera. Además, un contador en memoria no
      funciona en serverless.
- [ ] Los tokens de firma y de portal **nunca caducan ni se revocan**. Dar de baja a una agencia
      no le cierra el portal.
- [x] ~~`NEXT_PUBLIC_SITE_URL` es opcional y cae a `localhost`: los enlaces que van por correo al~~ ✅ corregido
      huésped salen rotos en producción.
- [ ] Las políticas «staff lee» dan a housekeeping el padrón completo de huéspedes, pagos,
      facturas y contratos, que el **propio ADR 0005 declara vedados** para ese rol.
- [ ] **No se puede cambiar ni recuperar una contraseña** desde el sistema en marcha.
- [ ] Las ~60 políticas RLS siguen **sin un solo test**. Es el pendiente que el equipo ya había
      declarado y sigue abierto.

### P1 · Rendimiento

- [ ] **Seis listados del panel no paginan**, pese a que los docs afirman lo contrario.
      (No corregido: se arreglaron la exportación CSV y los reportes, que es un problema distinto.)
- [x] ~~El listado principal de reservas filtra y ordena por columnas sin índice~~ ✅ índices en la `0034`
      (`reservas.huesped_id` y otras 8 FK). **Postgres no indexa las FK automáticamente.**
- [x] ~~`MAX_FILAS = 5000` en la exportación CSV es inalcanzable: `max_rows = 1000` trunca todas~~ ✅ corregido
      las descargas en silencio.
- [ ] El portal público del socio lee la tabla `firmas` **entera** con `service_role` en cada carga.
- [ ] Las 48 rutas son dinámicas. El catálogo público podría ser estático o con `revalidate`.

### P2 · Arquitectura

- [ ] **El 79 % del código vive en `app/`.** `lib/domain` está limpio pero subutilizado:
      hay 190 llamadas `.from()` repartidas en 56 archivos de rutas contra 5 en `lib/`.
- [ ] **`lib/domain/permisos.ts` no gobierna ninguna escritura.** Las 19 acciones de escritura
      reimplementan la regla con el literal `['admin','gerencia']`, repetido 14 veces en 7 archivos.
- [ ] `lib/env.ts` promete fallar «al arrancar» pero sus funciones son perezosas, y no valida
      `MERCADOPAGO_*`, `STRIPE_*` ni `RESEND_API_KEY`.

### P2 · Lo que no existe y un proyecto serio necesita

- [ ] Logging estructurado con correlation ID. Hoy hay `console.error` sueltos.
- [ ] Captura de errores en producción (Sentry o equivalente).
- [x] ~~Healthcheck / readiness endpoint.~~ ✅ corregido
- [ ] Tests E2E de los flujos críticos. No hay Playwright ni Cypress.
- [ ] Tests de componentes. Ninguna pantalla tiene test.
- [ ] `npm audit` en CI. Dependabot o Renovate.
- [ ] Formatter (no hay Prettier) y pre-commit hooks.
- [ ] Migraciones reversibles: no hay `down`.
- [ ] Backup y restore **probado**. Un backup que nunca se restauró no es un backup.
- [ ] Performance budgets en CI.
- [x] ~~Comandos `npm run check` y `npm run setup`.~~ ✅ corregido

---

## Cómo seguir

El orden importa: **corregir > optimizar > agregar.**

1. Aplicar y probar `0032` y `0033` con Docker. Sin eso, cinco correcciones críticas están
   escritas pero no verificadas.
2. Cerrar los P0 pendientes: tokens, firma del webhook, tests de acciones, facturas inmutables.
3. Recién después, dinero e integridad (P1), que es donde más hallazgos quedan.

**Nada de esto invalida el trabajo hecho.** El proyecto tiene 21 fases, 18 ADRs, CI en verde y
una auditoría de seguridad propia: eso es más rigor del que se ve habitualmente. Los hallazgos
son los que aparecen cuando un sistema **crece lo suficiente como para tener superficie**.
