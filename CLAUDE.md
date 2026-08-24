# Blanca Patagonia — Guía para Claude (pautas fijas del proyecto)

> Este archivo define **cómo trabajar en este repo**. Vale siempre, incluso si se
> compacta el contexto. Leerlo antes de actuar.

## Qué es
Sistema Integral de Gestión Hotelera (PMS) para el **Hotel Blanca Patagonia**
(El Calafate, Santa Cruz). Proyecto de **tesis** de Analista de Sistemas (IES).
Autores: Octavio Fakiani y Santiago Morán. Reemplaza Winpax (gestión) y reduce la
dependencia de Booking/OTAs. Referencias de negocio: blancapatagonia.com y el
Tarifario 2025/2026 (Anexo A).

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
- **Gestión hotelera** (`app/panel`, login de staff) — el foco actual del desarrollo.
- **Reservas de clientes** (público: `app/reservar` + landing) — vista aparte, se
  amplía más adelante. Las funciones cara al cliente (web check-in, encuestas) van
  ahí, NO en la gestión.

## Arquitectura (capas)
- Presentación: `app/(public)` portal del huésped · `app/(admin)` panel por rol ·
  `app/api/...` route handlers · `app/api/webhooks/...`.
- Lógica: `lib/domain` (reglas puras, testeables), `lib/availability`,
  `lib/payments`, `lib/supabase` (clientes server/client/admin/proxy).
- Datos: Postgres con **RLS por rol**. La integridad crítica vive en la **base**,
  no solo en la app.

## Reglas de dominio clave
- **Roles:** `admin`, `gerencia`, `recepcion`, `housekeeping` (+ huésped público
  sin cuenta). Helper SQL `rol_actual()`.
- **Anti-overbooking (ADR 0002):** restricción de exclusión GiST sobre `estadias`
  (`unidad_id WITH =, periodo WITH &&`) para estados activos. Nunca confiar solo
  en la app; la garantía es de la base.
- **Moneda (ADR 0003):** USD base + ARS a **cotización configurable**.
- **Tarifas (ADR 0004):** doble precio **neto** (agencia) / **rack** (mostrador),
  **IVA discriminado** (se calcula en el dominio, no se almacena sumado). El canal
  de la reserva define `tarifa_tipo`.
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
- `service_role` **solo en servidor** (`lib/supabase/admin.ts`, `server-only`).

## Entorno local (decisión vigente: "por ahora local")
- Supabase local con **Docker**. CLI vía devDependency: `npx supabase`.
- Levantar: `npx supabase start` · aplicar migraciones+seed: `npx supabase db reset`
  · ver claves: `npx supabase status`.
- ⚠️ `db reset` **borra los usuarios de auth**: hay que correr `npm run seed:usuarios`
  después, o los tests de facturación fallan (hay FK contra `perfiles`).
- Studio http://127.0.0.1:54323 · API http://127.0.0.1:54321 · claves con nuevo
  formato `sb_publishable_…` / `sb_secret_…`. `.env.local` (gitignored) apunta al
  stack local.

## Comandos
- Dev `npm run dev` · Tests `npm test` · Typecheck `npm run typecheck` · Lint `npm run lint`.
- **CI (`.github/workflows/ci.yml`): verde y verificado en GitHub** desde la
  corrida #31. Levanta Supabase con Docker, crea el admin y corre typecheck,
  lint, la suite completa con `EXIGIR_DB=1` y el build. Dos cosas a respetar si se
  toca: el paso del seed invoca `node scripts/seed-usuarios.mjs` **directo** y no
  `npm run seed:usuarios` (ese script usa `--env-file-if-exists`, que necesita
  Node ≥ 20.12 y no hay `.env.local` en el runner); y sin ese paso la tabla
  `perfiles` queda vacía y los tests de facturación fallan por la FK.
- El test de integración anti-overbooking necesita DB local + env
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); sin ellos se saltea.
- **Gate de cada fase:** typecheck + lint + tests en verde.

## Estado actual
- **Fase 0-2 ✅** fundaciones + núcleo de dominio + panel interno de Recepción ·
  **Fase 3 ✅** pagos · **Fase 4 ✅** portal público de reservas ·
  **Fase 5 ✅** consumos + factura · **Fase 6 ✅** reportes gerenciales ·
  **Fase 7 (parcial) ✅** hardening (token confirmación, expiración pendientes, webhook
  fail-closed) · **Fase 8 ✅** ampliación tipo WinPax/Odoo: **8.1** cuentas
  corrientes de agencias · **8.2** reservas grupales · **8.3** mantenimiento, objetos
  perdidos, encuestas, reportes avanzados (ADR/RevPAR) · **8.4/8.5** consolidación +
  dashboard-hub · **8.6** fidelidad + inventario · **8.7** proveedores (cuentas por
  pagar), reprogramación de reservas, asignación de mucamas y avisos internos ·
  **Fase 9** mejora integral del panel: identidad visual propia (ADR 0009),
  componentes compartidos, búsqueda + paginación + export CSV en todos los
  listados, navegación móvil y más funciones por módulo · **Fase 10** contratos
  con firma electrónica por token (ADR 0010) y conversaciones internas en tiempo
  real + asistente del portal basado en reglas (ADR 0011) · **Fase 11** alcance
  ERP: facturación fiscal argentina (ADR 0012), auditoría de operaciones
  sensibles, conciliación y antigüedad de saldos, pipeline comercial, encuestas
  NPS y mantenimiento preventivo · **Fase 12** endurecimiento del CI y tests
  sobre las Server Actions · **Fase 13** limpieza de código muerto y **cambio de
  unidad** (mudanza de habitación, migración 0028) · **Fase 14** experiencia de
  uso e interacción táctil · **Fase 15** rediseño de la interfaz (se eliminaron
  los 11 formularios plegados, altas en pantalla propia) y **sección de Ayuda** ·
  **Fase 16** portal público a la par del panel · **Fase 17** el CI en verde y
  verificado (corrida #31) · **Fase 18** cinco bugs encontrados recorriendo el
  sistema a mano (el más caro: «USD 0» al reservar, por falta de temporadas
  cargadas) · **Fase 19** buscador global por rol, confirmaciones y encabezado ·
  **Fase 20** ningún fallo de escritura en silencio (ver `lib/acciones.ts`) ·
  **Fase 21** catálogo público de alojamientos (`/alojamientos` + detalle).
- **Modernización WinPAX ✅ (2026-08-16, numeración propia de 11 pasos).** El cliente
  venía de WinPAX (Oracle Forms, ~año 2000) y se cubrieron sus funciones core.
  **El plan completo, con el porqué de cada decisión, está en
  `docs/modernizacion-winpax.md`** — leerlo antes de tocar cualquiera de estos
  módulos. Resumen: **1** cotización de divisas (cierra el ADR 0003) · **2** fila
  resumen de la grilla + estados legibles sin color · **3** diez vistas operativas
  del listado de reservas, con saldo · **4-5** canales de venta: se enchufó el
  puerto que estaba huérfano, con importación del informe CSV de Booking y feed
  iCal · **6** ficha de reserva completa (VIP, adultos/menores/bebés, cunas, plan,
  garantía, segmento, voucher, «no mover», desglose fiscal) · **7** punto de venta
  con grilla por departamento y número de comanda · **8** folios A/B con split y
  jerarquía de departamentos · **9** housekeeping móvil ordenado por prioridad ·
  **10** piso y bloque en `unidades` · **11** respaldos verificables.
  Migraciones `0036`–`0043`. Tres áreas nuevas del panel: `canales`, `punto_venta`
  y `respaldos`.
  ⚠️ **Tres cosas de este trabajo que hay que saber antes de tocarlo:**
  1. **La sincronización con Booking NO evita el overbooking.** Los dos caminos
     posibles sin ser Connectivity Partner (informe CSV y feed iCal) son de **solo
     lectura**: nadie le informa a Booking qué queda libre, así que puede vender una
     unidad ya vendida. Se declara en `capacidades()`, en `ResultadoEnvio.noSoportado`
     y en la pantalla. **No quitar esas advertencias**: la solución real es un
     channel manager y es una contratación del hotel (ADR 0021).
  2. **`crear_reserva` deriva `estadias.huespedes` del desglose** (`adultos +
     menores`; los bebés **no** cuentan, no ocupan plaza). No hay `check` en la base
     que lo garantice, y fue deliberado: habría roto los `update` de mudanza (0028) y
     reprogramación. La coherencia se garantiza en esa función, que es el **único**
     lugar donde nacen estadías.
  3. **La app no puede hacer un backup de Postgres.** Lo hace la plataforma. Lo que
     hay en `/panel/respaldos` es una exportación de los datos operativos, y la
     pantalla lo explica. **No convertirlo en un botón que diga «hacer backup».**
- **Auditoría de seguridad (numeración propia, empieza de nuevo en Fase 0):**
  **Fase 0 ✅** reconocimiento sin tocar código (`docs/AUDITORIA_INICIAL.md`) ·
  **Fase 1 ✅** límite de tasa en las entradas públicas y en el login
  (migración 0029, `lib/domain/limites.ts`), guarda del seed contra bases no
  locales y encabezados de seguridad en `next.config.ts` (sin CSP, y está
  documentado por qué) · **Fase 2 ✅** cuatro bugs leyendo el código: el **precio
  neto de agencia quedaba expuesto a `anon`** por RPC (migración 0030), el webhook
  de pagos fallaba abierto, inyección de condiciones en los filtros `or` de
  PostgREST y el `<details>` número 12. La segunda parte (migración 0031, **ADR
  0016**) cierra el otro camino al neto: `anon` ya no puede ejecutar
  `cotizar_estadia` ni leer la columna `precio_neto`. ⚠️ **No hacer
  `cotizar_estadia` `security definer`**: ahí `current_user` es el dueño de la
  función y la guarda quedaría siempre en verdadero.
  **Pendiente:** auditar las ~75 políticas RLS una por una — que estén activadas en
  las 40 tablas no dice qué permite cada una. ⚠️ La modernización WinPAX sumó **6
  tablas y 14 políticas** a ese pendiente (`cotizaciones`, `canal_reservas`,
  `canal_sincronizaciones`, `canal_mensajes`, `canal_resenas`, `departamentos`,
  `respaldos`); todas revocan `select` a `anon` explícitamente, pero eso no
  reemplaza la auditoría. ⚠️ **No se puede hacer en un entorno
  sin Docker**: exige ejecutar las políticas contra una base con los cuatro roles, y
  el *pull* de las imágenes de Supabase está bloqueado por política de egreso en el
  entorno remoto (403 contra las CDN de los registries). Hay que hacerlo en local.
  **Fase 3 ✅** (escrita sin Docker, **aplicada y verificada el 2026-08-14**): alta de
  usuario sin privilegios (ADR 0017, migraciones `0032` + `0035`), la baja de un
  usuario revoca acceso en la base y la numeración de facturas vuelve a funcionar
  (`0033`), tokens de firma fuera del alcance del staff, facturas inmutables y 9
  índices en FKs (`0034`), las 51 Server Actions verifican rol con guarda estructural,
  firma HMAC real en el webhook y los simuladores fallan fuerte en producción
  (ADR 0018). Estado y pendientes en `docs/audit/` (`00-pendientes.md` y `HANDOFF.md`).
  ⚠️ **Al agregar una migración que toque un enum:** `alter type ... add value` y el
  primer uso de ese valor **no pueden ir en el mismo archivo**. El CLI de Supabase
  envuelve cada migración en una transacción y Postgres corta con SQLSTATE 55P04;
  el `db reset` falla ahí y **no aplica nada de lo que sigue**. Es lo que le pasó a
  la `0032` y por eso existe la `0035`.
- **Tests:** cero salteados contra la base local. Para
  que no salteen hay que exportar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` **y**
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`: vitest no lee `.env.local`, y `EXIGIR_DB=1`
  protege `hayDB` pero **no** `hayAnon` (`tests/db.ts:40`), así que sin la clave
  publicable los 4 tests del borde público del ADR 0016 saltean en silencio. En CI
  no pasa: el workflow la exporta (`ci.yml:72`).
- **Siete adapters** con el mismo patrón (interfaz + simulador, se cambia por env):
  `PaymentProvider`, `FirmaElectronicaProvider`, `AsistenteProvider`,
  `FacturacionElectronicaProvider`, `EmailProvider` (`lib/email/index.ts`, el único
  camino para mandar correo), `CanalVentaProvider` (`lib/canales/`, OTA) y
  `CotizacionProvider` (`lib/divisas/`, tipo de cambio).
  ⚠️ Los dos últimos son distintos de los cinco primeros: **no tienen simulador que
  mienta**, porque sus fuentes son públicas y sin credenciales. El respaldo de
  divisas es `manual` (no inventa: usa lo que un admin cargó) y el de canales es
  `simulado` (ése sí no habla con nadie).
- **Trabajo futuro documentado (ADR 0013):** gestión documental con Storage,
  seguridad por campo y multi-propiedad. No implementar sin releer ese ADR.
- **Hay 24 ADRs.** Los últimos: **ADR 0016** el precio neto fuera del alcance
  público · **ADR 0017** el alta de usuario nace sin privilegios · **ADR 0018** los
  simuladores fallan fuerte en producción · **ADR 0019** cobro efectivo de la
  política de cancelación (**sin decidir**, pero ya tiene el dato que le faltaba:
  `reservas.garantia` dice si hay de dónde cobrar un no-show) · **ADR 0020**
  cotización de divisas, que **cierra el 0003** · **ADR 0021** canales de venta de
  solo lectura, con la limitación declarada · **ADR 0023** contabilidad de la
  comisión de canal · **ADR 0024** exención de IVA al turista del exterior, que se
  **deriva y no se tilda** · **ADR 0025** verificar la tarjeta de garantía **sin
  guardar el número** (el simulador declara que no puede, no inventa un «válida»).
- **Relevamiento con el cliente (15/08/2026), cerrado el 2026-08-24.** Franco
  mostró WinPAX 9 y el extranet de Booking. La mayoría ya estaba; se hicieron los
  cinco pedidos que faltaban: documentación al día, exención de IVA (migración
  0058), fuente de la cotización declarada en pantalla, desayuno suelto contado
  por la cocina y garantía de tarjeta tokenizada (migración 0059).
  **Queda solo P5** —bandeja, comentarios y analytics de Booking—, que **difirió
  el propio cliente**: antes de prometer nada hay que verificar qué exporta el
  extranet sin API de partner.
- **1389 tests verdes** (84 archivos), cero salteados, verificados contra una base
  levantada **desde cero** con las **63** migraciones.
- **Auditoría técnica aplicada (2026-08-24).** Doce fases de auditoría y sus hallazgos
  corregidos: tokens de socio fuera del alcance del staff (0060), el borrado de dinero
  con permiso revocado y auditado (0061), índices del listado y `canal` acotado (0062),
  enlaces del portal revocables (0063), recuperación de contraseña, y las dependencias
  de 8 vulnerabilidades a 1 baja. Cada hallazgo se verificó **ejecutándolo** antes y
  después; el detalle está en la bitácora.
- **Diseño del panel:** usar SIEMPRE los componentes de `app/panel/_components/ui.tsx`
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
    `lib/acciones.ts`, y sumar el motivo al `MENSAJES_ERROR` de la pantalla destino
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
- **Precios al público — OBLIGATORIO:** `tarifas.precio_rack` se guarda **sin
  IVA** (ADR 0004) y el checkout lo suma en `calcularEstadia`. Toda pantalla que
  le muestre un precio a un huésped tiene que pasarlo por `conIva()` de
  `lib/domain/catalogo.ts`, o publica un número más bajo del que después cobra.
  Y los rangos de temporada son `[desde, hasta)` con el **fin excluido**: para
  mostrarlos va `textoRango()`, que resta el día.
- **Filtros `or` de PostgREST:** el término del usuario **nunca** se interpola
  pelado (la coma separa condiciones y los paréntesis agrupan: `x,id.gt.0` cambia
  el filtro). Va `patronOr()` de `lib/listados.ts`, que lo encierra entre comillas
  dobles. Escapar `%` y `_` **no alcanza**: esos son los comodines de LIKE, otra
  capa distinta. Las llamadas `.ilike('col', valor)` son seguras: ahí el valor
  viaja como parámetro y no como sintaxis.
- **Ayuda:** el contenido vive en `lib/domain/ayuda.ts` y se filtra por rol con
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
- **Cara al cliente (diferido a la vista pública `app/reservar`):** web check-in y
  encuestas de satisfacción NO van en la gestión.
- **Deploy** (Vercel + Supabase cloud) pendiente — requiere cuentas del usuario.
- No se integran pasarelas reales ni envío de email real (credenciales/dinero);
  stubs listos para enchufar (`lib/payments`, `lib/email`).
- ⚠️ **Variables obligatorias en producción** (ADR 0018: si faltan, el sistema falla
  al arrancar, a propósito): `EMAIL_PROVIDER`, `FIRMA_PROVIDER`,
  `FACTURACION_PROVIDER`, `COTIZACION_PROVIDER` y `CANAL_PROVIDER`. Opcionales:
  `BOOKING_ICAL_FEEDS` (pares `CODIGO_TIPO=url`), `DOLARAPI_URL` y
  `ARGENTINADATOS_URL`. Revisarlas **antes** del deploy.
- Admin de dev: `admin@blancapatagonia.local` / `blancadev1234` (`npm run seed:usuarios`).
- Al embeber `huespedes` desde `reservas` usar `huespedes!reservas_huesped_id_fkey` (hay 2 FKs).
- Pendiente de confirmar con el hotel: **inventario físico real** de unidades y
  **tarifa rack de cabañas**. El Tarifario cargado es 2025/2026 (anterior a la fecha del sistema).

@AGENTS.md
