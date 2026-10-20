# Estructura del proyecto — Blanca Patagonia

Este documento es el mapa del repositorio: qué hay en cada carpeta, cuál es el
**front**, cuál es el **back**, dónde está la base de datos y **dónde va cada
cosa nueva**. Está pensado para presentar el trabajo y para que alguien nuevo se
ubique en cinco minutos.

> **Regla de oro:** todo el código de la aplicación vive en `src/`. Afuera de
> `src/` solo hay base de datos, pruebas, archivos estáticos, documentación y
> configuración.

**Índice:** [1. Vista general](#1-vista-general) ·
[2. Front y back](#2-front-y-back-en-una-tabla) ·
[3. Front público](#3-srcappfront-publico--el-sitio-del-huésped) ·
[4. Front de gestión](#4-srcappfront-gestion--el-panel-del-staff) ·
[5. Endpoints](#5-srcappback-api--los-endpoints) ·
[6. Lógica](#6-srclib--la-lógica-el-corazón-del-back) ·
[7. Capas](#7-las-capas-y-quién-puede-usar-a-quién) ·
[8. Un pedido de punta a punta](#8-un-pedido-de-punta-a-punta) ·
[9. Base de datos](#9-supabase--la-base-de-datos) ·
[10. Pruebas](#10-tests--las-pruebas) ·
[11. Resto del repo](#11-el-resto-del-repositorio) ·
[12. Documentación](#12-docs--la-documentación) ·
[13. Dónde va cada cosa nueva](#13-dónde-va-cada-cosa-nueva) ·
[14. Convenciones](#14-convenciones-de-nombres) ·
[15. Recorrido para presentar](#15-recorrido-sugerido-para-una-presentación) ·
[16. Historial](#16-qué-cambió-en-la-reorganización)

---

## 1. Vista general

```
BLANCA/
├── src/                      ← TODO EL CÓDIGO DE LA APLICACIÓN
│   ├── app/                  ← Rutas (Next.js App Router)
│   │   ├── (front-publico)/  ← FRONT · sitio web del huésped
│   │   ├── (front-gestion)/  ← FRONT · panel de gestión del staff + login
│   │   ├── (back-api)/       ← BACK  · endpoints HTTP, webhooks y cron
│   │   └── layout.tsx …      ← piezas comunes a todo el sitio
│   ├── lib/                  ← BACK  · reglas de negocio, datos e integraciones
│   ├── proxy.ts              ← BACK  · filtro de cada pedido (sesión, idioma)
│   └── instrumentation.ts    ← BACK  · captura de errores del servidor
│
├── supabase/                 ← BASE DE DATOS · migraciones SQL numeradas
├── tests/                    ← PRUEBAS · separadas por tipo
├── public/                   ← Archivos estáticos (fotos, video, service worker)
├── scripts/                  ← Utilidades de consola
├── docs/                     ← DOCUMENTACIÓN (tesis, arquitectura, manuales, ADRs)
│
├── README.md                 ← Presentación del proyecto
├── ESTRUCTURA.md             ← Este documento
├── COMO-LEVANTARLO.md        ← Cómo correrlo en una computadora nueva
├── CLAUDE.md · AGENTS.md     ← Reglas de trabajo del proyecto
├── SECURITY.md               ← Política de seguridad
└── package.json, tsconfig.json, next.config.ts, vitest.config.mts, …
                              ← configuración: va en la raíz por convención de las herramientas
```

### ¿Por qué hay paréntesis en `(front-publico)`?

Son **grupos de rutas** de Next.js: una carpeta entre paréntesis **ordena el
código sin cambiar la dirección web**. El archivo
`src/app/(front-gestion)/panel/reservas/page.tsx` se sigue abriendo en
`/panel/reservas`, y `src/app/(back-api)/api/salud/route.ts` en `/api/salud`.
Así se separa front de back a la vista sin romper ningún enlace.

### ¿Qué significa cada archivo especial de Next.js?

| Archivo | Qué es |
|---|---|
| `page.tsx` | Una pantalla: la carpeta que lo contiene es la URL |
| `layout.tsx` | El marco que envuelve a todas las pantallas de esa carpeta |
| `loading.tsx` | Lo que se muestra mientras la pantalla carga |
| `error.tsx` · `not-found.tsx` | Lo que se muestra si algo falla o no existe |
| `route.ts` | Un endpoint: responde datos, no una pantalla |
| `actions.ts` | Server Actions: funciones que el formulario llama y **corren en el servidor** |
| `[algo]/` | Segmento variable de la URL (`[id]`, `[token]`, `[idioma]`) |
| `_algo/` | Carpeta privada: componentes, **no** es una URL |

---

## 2. Front y back, en una tabla

| Capa | Carpeta | Qué hay | Lo usa |
|---|---|---|---|
| **Front público** | `src/app/(front-publico)/` | Portada, alojamientos, reserva, checkout y pago, confirmación, factura, encuestas, firma de contratos, portal de socios | Huéspedes, agencias, proveedores |
| **Front de gestión** | `src/app/(front-gestion)/` | Panel interno (28 módulos) y pantallas de login | Staff del hotel, según su rol |
| **Back HTTP** | `src/app/(back-api)/` | Endpoints `/api/...`, webhooks de pagos y correo, tareas programadas, callback de Google | Pasarelas de pago, Vercel Cron, el propio front |
| **Back lógico** | `src/lib/` | Reglas de negocio, acceso a datos, pagos, facturación, correo, canales | Todo lo anterior |
| **Base de datos** | `supabase/` | 117 migraciones SQL: tablas, RLS por rol, funciones atómicas | El back |

Las **Server Actions** (`actions.ts`) son la frontera entre los dos mundos:
viven al lado de la pantalla que las usa, pero **corren en el servidor**. Son el
«back» de ese formulario y delegan las reglas en `src/lib/`.

---

## 3. `src/app/(front-publico)/` — el sitio del huésped

```
(front-publico)/
├── [idioma]/                 ← páginas traducidas: /es, /en, /pt, /fr, /zh
│   ├── layout.tsx            ← responde 404 si el idioma no es uno de los cinco
│   ├── page.tsx              ← portada (landing)
│   ├── alojamientos/         ← catálogo (page.tsx) y ficha de cada unidad ([codigo]/)
│   └── reservar/             ← paso 1: fechas · checkout/: datos y pago
├── reservar/                 ← lo que pasa DESPUÉS de reservar (enlaces por correo)
│   ├── actions.ts            ← crea la reserva y abre la pasarela de pago
│   ├── confirmacion/[token]  ← confirmación de la reserva
│   ├── pagar/[token]         ← pagar la seña o el saldo desde el enlace
│   ├── factura/[token]       ← ver e imprimir la factura
│   └── _asistente/           ← asistente de preguntas frecuentes
├── _publico/                 ← componentes del sitio (marco, galería, buscador, pasos…)
├── encuesta/[token]          ← encuesta de satisfacción post-estadía
├── firmar/[token]            ← firma electrónica de contratos
├── portal/                   ← portal de socios (agencias y proveedores)
├── pago-simulado/            ← pasarela simulada (solo desarrollo)
└── pago-payway/              ← formulario de tarjeta de Payway
```

**¿Por qué hay dos `reservar`?** El de `[idioma]/reservar` es la compra
(elegir fechas, cargar datos, pagar) y está traducido a cinco idiomas. El de
`reservar/` son las pantallas que el huésped abre **desde un enlace del correo**
con su token, y la Server Action que crea la reserva; esas URL no llevan
idioma porque viajan en correos ya enviados y tienen que seguir funcionando.

## 4. `src/app/(front-gestion)/` — el panel del staff

```
(front-gestion)/
├── login/                    ← ingreso, recuperar y cambiar contraseña
└── panel/
    ├── layout.tsx            ← verifica la sesión y dibuja el menú lateral
    ├── _components/          ← kit visual del panel (tablas, tarjetas, íconos, menú)
    ├── page.tsx              ← tablero de inicio
    │
    │   (agrupados como en el menú lateral, `src/lib/domain/navegacion.ts`)
    ├── Operación        ocupacion/ reservas/ punto-venta/ huespedes/
    ├── Unidades         housekeeping/ mantenimiento/ servicio/ objetos-perdidos/
    ├── Comercial        agencias/ proveedores/ contratos/ canales/
    ├── Equipo           avisos/ notificaciones/ conversaciones/
    ├── Administración   reportes/ ia/ conciliacion/ auditoria/ errores/ config/ usuarios/ respaldos/
    ├── ayuda/
    └── Fuera del menú   cierre-diario/ · buscar/ · exportar/ (CSV) · cuenta/ (mis datos)
```

Qué módulos ve cada rol lo decide `src/lib/domain/permisos.ts`.

**Cuando una pantalla crece demasiado** se parte como `panel/canales/`, que pasó
de ~2470 líneas en un archivo a:

```
canales/
├── page.tsx          ← arma la pantalla (422 líneas)
├── _datos.ts         ← toda la lectura; su tipo (`DatosCanales`) se deduce solo
├── _compartido.ts    ← constantes y tipos que usan los demás
└── _vistas/          ← un componente por pestaña (entrantes, cobros, costos…)
```

Cada módulo sigue el mismo molde, lo que lo hace fácil de recorrer y de copiar:

| Archivo | Para qué |
|---|---|
| `page.tsx` | El listado (con búsqueda, paginación y exportación) |
| `nuevo/page.tsx` | El alta, en pantalla propia |
| `[id]/page.tsx` | La ficha |
| `[id]/editar/page.tsx` | La edición |
| `actions.ts` | Lo que guarda (verifica el rol con `requerirAcceso`) |
| `loading.tsx` | Lo que se ve mientras carga |

## 5. `src/app/(back-api)/` — los endpoints

```
(back-api)/
├── api/
│   ├── salud/                ← estado del sistema (200 si la base responde, 503 si no)
│   ├── webhooks/pagos/       ← la pasarela avisa que un pago se acreditó (es quien lo confirma)
│   ├── webhooks/email/       ← entregas y rebotes de correo
│   ├── cron/                 ← tareas automáticas: expirar reservas, recordatorios, canales…
│   ├── canales/              ← feed iCal para Booking
│   ├── buscar/               ← búsqueda global del panel
│   ├── cotizacion/           ← tipo de cambio USD/ARS
│   ├── conexiones/           ← vuelta de OAuth (Mercado Pago, Google)
│   └── respaldo/             ← exportación de datos operativos
└── auth/callback/            ← vuelta del login con Google
```

Los horarios del cron están en `vercel.json`.

## 6. `src/lib/` — la lógica (el corazón del back)

Cada carpeta y archivo suelto está descrito en [`src/lib/README.md`](src/lib/README.md), y los
módulos de reglas por tema en [`src/lib/domain/README.md`](src/lib/domain/README.md). Un test
(`tests/contratos/indices.test.ts`) falla si alguno de los dos queda desactualizado.

| Grupo | Carpetas | Qué resuelven |
|---|---|---|
| **Reglas de negocio puras** | `domain/` | 80 módulos sin base de datos ni framework (índice por tema en `src/lib/domain/README.md`): precios, IVA, cancelación, disponibilidad, permisos, estados de reserva… Lo más testeado del sistema. |
| **Acceso a datos** | `supabase/`, `catalogo/`, `reservas/`, `busqueda/`, `paginado.ts`, `listados.ts` | Clientes de Supabase y consultas reutilizables |
| **Seguridad y sesión** | `auth/`, `seguridad/`, `limites.ts`, `auditoria/` | Roles, sesión, cifrado, límites de tasa, auditoría |
| **Dinero** | `payments/`, `pricing/`, `facturacion/`, `conciliacion/`, `divisas/` | Pasarelas, tarifas, factura electrónica, conciliación, cotización |
| **Comunicación** | `email/`, `whatsapp/`, `notificaciones/` | Avisos al huésped y al staff |
| **Integraciones** | `canales/`, `firma/`, `integraciones/`, `conexiones/`, `storage/`, `asistente/`, `ia/`, `availability/` | Booking, firma electrónica, OAuth, archivos, asistentes |
| **Portal público** | `i18n/`, `seo.ts`, `pwa/` | Traducciones (5 idiomas), metadatos, app instalable |
| **Utilidades** | `fechas.ts`, `csv.ts`, `env.ts`, `registro.ts`, `acciones.ts`, `retorno.ts`, `crons.ts` | Fechas en la zona del hotel, CSV seguro, variables de entorno, registro de errores, manejo de errores de escritura, registro de las tareas programadas |

### Los adaptadores: cambiar de proveedor sin tocar código

Cada servicio externo tiene una **interfaz** y varias implementaciones, y se
elige cuál usar con una variable de entorno. En desarrollo se usa el simulador;
en producción, el real.

| Servicio | Carpeta | Variable |
|---|---|---|
| Cobros | `payments/` | `PAGO_PROVIDER` (Stripe, Mercado Pago, Payway, simulado) |
| Correo | `email/` | `EMAIL_PROVIDER` (Resend, consola) |
| Factura electrónica | `facturacion/` | `FACTURACION_PROVIDER` |
| Firma de contratos | `firma/` | `FIRMA_PROVIDER` |
| Canales de venta | `canales/` | `CANAL_PROVIDER` |
| Tipo de cambio | `divisas/` | `COTIZACION_PROVIDER` |
| WhatsApp | `whatsapp/` | `WHATSAPP_PROVIDER` (opcional) |

Así un proveedor nuevo es **un archivo nuevo** que implementa la interfaz, no
un cambio en las pantallas.

## 7. Las capas y quién puede usar a quién

```
   (front-publico)        (front-gestion)        (back-api)
          │                      │                    │
          └──────────────┬───────┴────────────────────┘
                         ▼
                     src/lib/             ← datos, integraciones, sesión
                         │
                         ▼
                  src/lib/domain/         ← reglas puras (solo usa lib/fechas)
                         
   src/lib/supabase ──────────────► Postgres + RLS (supabase/)
```

Las flechas van **en un solo sentido**, y un test lo hace cumplir
(`tests/contratos/capas.test.ts`). Si alguien agrega un import en la dirección
prohibida, la suite falla:

1. `src/lib/` **nunca** importa de `src/app/`: la lógica no conoce pantallas.
2. `src/lib/domain/` solo importa de sí mismo y de `lib/fechas`: nada de base
   de datos, React, Next ni paquetes. Por eso se prueba sin nada instalado.
3. `(back-api)` no importa de ningún front: lo que compartan va a `src/lib/`.
4. Entre los dos fronts solo hay **cinco cruces declarados**, cada uno con su
   motivo escrito en el test (el portal de socios reutiliza tres componentes del
   panel, el login usa el esqueleto de carga del sitio y la factura del huésped
   el botón de imprimir de recepción).

## 8. Un pedido de punta a punta

Qué pasa cuando un huésped confirma una reserva en el checkout:

```
navegador ──► src/proxy.ts                         idioma y sesión
          ──► (front-publico)/[idioma]/reservar/checkout/page.tsx   la pantalla
          ──► (front-publico)/reservar/actions.ts  Server Action (servidor)
                 ├─► src/lib/domain/…              precio, IVA, seña, validaciones
                 ├─► src/lib/reservas/crear.ts     llama a la función SQL crear_reserva:
                 │                                 la base impide el overbooking
                 └─► src/lib/payments/portal.ts    abre el cobro en la pasarela
          ──► pasarela de pago (Stripe / Mercado Pago)
pasarela  ──► (back-api)/api/webhooks/pagos/       confirma el pago
                 └─► src/lib/payments/servicio.ts  registra el pago y avanza la reserva
staff     ──► (front-gestion)/panel/reservas/      ve la reserva pagada
```

La URL de vuelta de la pasarela **no** confirma nada (se podría abrir a mano):
quien da el pago por hecho es el webhook.

## 9. `supabase/` — la base de datos

| Ruta | Contenido |
|---|---|
| `migrations/` | 117 migraciones numeradas (`0001_…` a `0117_…`). Se aplican en orden y **nunca se edita una ya aplicada**: se crea la siguiente. |
| `config.toml` | Configuración de la base local de pruebas |
| `seed.sql` | Datos iniciales de la base local |
| `snippets/` | Carpeta del CLI de Supabase para consultas guardadas (hoy vacía) |

La integridad crítica vive acá y no en la aplicación: la restricción que impide
vender dos veces la misma unidad (ADR 0002), las políticas RLS que limitan qué
ve cada rol y las funciones que escriben varias tablas de una sola vez.

## 10. `tests/` — las pruebas

```
tests/
├── dominio/          ← reglas puras (~1500 pruebas, corren en cualquier máquina)
├── servicios/        ← webhooks, cron y pasarelas con dependencias simuladas
├── acciones/         ← Server Actions
├── base-de-datos/    ← RLS, funciones SQL, anti-overbooking (necesitan base local)
├── contratos/        ← reglas sobre el código: capas, nada de console en el dinero, PCI…
└── apoyo/            ← helpers compartidos (no son pruebas)
```

Cada tipo se corre solo: `npm run test:dominio`, `test:servicios`,
`test:acciones`, `test:db`, `test:contratos`. Todo junto: `npm test`. Detalle,
y cómo correr los que necesitan base: [`tests/README.md`](tests/README.md).

## 11. El resto del repositorio

| Carpeta | Contenido |
|---|---|
| `public/hotel/` | Fotos y video del hotel ([`public/hotel/README.md`](public/hotel/README.md)) |
| `public/alojamientos/` | Una foto por tipo de unidad |
| `public/sw.js`, `public/sin-conexion.html` | Service worker y pantalla sin conexión del panel instalable |
| `public/plantilla-next-sin-uso/` | SVG de la plantilla de Next que nadie usa (se apartaron, no se borraron) |
| `scripts/` | `setup.mjs` (dice qué falta para arrancar), `seed-usuarios.mjs`, `limpiar-qa.mjs`, `activar-google.sh` |
| `.github/` | Integración continua (`workflows/ci.yml`), plantilla de PR, etiquetas automáticas |
| `.claude/`, `.agents/`, `.codex/` | Reglas, recetas y revisores para asistentes de código |
| `.nvmrc`, `.editorconfig`, `.prettierrc.json` | Versión de Node (la misma que usa el CI), estilo base del editor y formato del código: sin punto y coma, comillas simples, 100 columnas |

## 12. `docs/` — la documentación

```
docs/
├── README.md                 ← índice de la documentación
├── 1-tesis/                  ← tesis completa, PP3 e informe final (md + pdf)
├── 2-arquitectura/           ← arquitectura, modelo de datos, modernización WinPAX
├── 3-manuales/               ← manual de usuario, manual técnico, despliegue
├── 4-seguridad-y-auditorias/ ← auditorías de seguridad, calidad y pulido
├── 5-pendientes/             ← trabajo pendiente y análisis
├── decisiones/               ← ADRs: cada decisión de arquitectura, numerada
├── bitacora.md               ← diario del desarrollo, fecha por fecha
├── roadmap.md                ← fases del proyecto
├── wiki/                     ← páginas de la wiki de GitHub
└── img/                      ← capturas usadas en la documentación
```

## 13. Dónde va cada cosa nueva

La estructura está pensada para crecer sin desordenarse. Antes de crear un
archivo, buscalo en esta tabla:

| Quiero agregar… | Va en | Y además |
|---|---|---|
| Una regla de negocio (un cálculo, una validación) | `src/lib/domain/<tema>.ts` | Su prueba en `tests/dominio/` |
| Un módulo nuevo del panel | `src/app/(front-gestion)/panel/<modulo>/` con el molde de §4 | Tocar `permisos.ts`, `navegacion.ts`, `shell.tsx` y `ayuda.ts` (ver `AGENTS.md`) |
| Una pantalla para el huésped | `src/app/(front-publico)/[idioma]/<pantalla>/` | Sus textos en los 5 diccionarios de `src/lib/i18n/diccionarios/` y la ruta en `RUTAS_CON_IDIOMA` (`src/proxy.ts`) |
| Un formulario que guarda | `actions.ts` junto a la pantalla | `requerirAcceso`, nunca descartar `{ error }` |
| Un endpoint, webhook o cron | `src/app/(back-api)/api/<nombre>/route.ts` | El cron, en `vercel.json` |
| Un proveedor externo (otra pasarela, otro correo) | Un archivo en la carpeta del adaptador (`src/lib/payments/`, `email/`…) | Implementa la interfaz; se elige por variable de entorno |
| Un componente que usa todo el panel | `src/app/(front-gestion)/panel/_components/` | — |
| Un componente que usa todo el sitio | `src/app/(front-publico)/_publico/` | — |
| Algo que comparten los dos fronts | Declararlo en `tests/contratos/capas.test.ts` con su motivo | Si lo comparten por igual, conviene un lugar común |
| Una tabla o cambio en la base | `supabase/migrations/<siguiente número>_<descripcion>.sql` | RLS activado y su prueba en `tests/base-de-datos/` |
| Una decisión de arquitectura | `docs/decisiones/<siguiente número>-<tema>.md` | Una entrada en `docs/bitacora.md` |
| Fotos del hotel | `public/hotel/fotos/<sección>/` | Ver `public/hotel/README.md` |

## 14. Convenciones de nombres

- **Español en todo**: carpetas, archivos, funciones y variables
  (`calcularEstadia`, `reservas/`, `cierre-diario/`). Los nombres de Next.js
  (`page`, `layout`, `route`) y los de paquetes quedan como son.
- **Carpetas y archivos en minúscula con guiones**: `punto-venta/`,
  `boton-envio.tsx`.
- **Componentes React en PascalCase** dentro del archivo: `BotonEnvio`.
- **Migraciones con número de cuatro dígitos**: `0114_precio_de_reserva_con_desglose.sql`.
- **ADRs con número de cuatro dígitos**: `0027-cobro-en-linea….md`.
- **Pruebas**: `<tema>.test.ts`, con `describe`/`it` en español.
- **Imports internos con `@/`**, que apunta a `src/`: `@/lib/domain/precios`.

## 15. Recorrido sugerido para una presentación

1. **El problema**: `README.md` y `docs/1-tesis/`.
2. **El mapa**: este documento, §1 y §2. Abrir `src/` y mostrar los tres
   grupos: front público, front de gestión, back.
3. **El front del huésped**: `src/app/(front-publico)/[idioma]/page.tsx` → ficha
   de alojamiento → checkout (`[idioma]/reservar/checkout/`).
4. **El back de esa reserva**: seguir §8 — la Server Action, las reglas de
   `src/lib/domain/`, la pasarela y el webhook.
5. **La base**: `supabase/migrations/` — el anti-overbooking vive en la base
   (ADR 0002), no en la aplicación.
6. **El front del staff**: `src/app/(front-gestion)/panel/reservas/` y
   `ocupacion/`, donde aparece la reserva recién hecha.
7. **La calidad**: `tests/` (§10), el test de capas (§7) y el CI en
   `.github/workflows/ci.yml`.

## 16. Qué cambió en la reorganización

No se borró ni se reescribió lógica: **solo se movieron carpetas** y se
ajustaron las rutas que las nombraban. Las direcciones web no cambiaron.

**Primera pasada (2026-10-16) — `src/` y front/back:**

| Antes | Ahora |
|---|---|
| `app/` | `src/app/` |
| `app/panel/`, `app/login/` | `src/app/(front-gestion)/…` |
| `app/[idioma]/`, `app/reservar/`, `app/_publico/`, `app/encuesta/`, `app/firmar/`, `app/portal/`, `app/pago-*/` | `src/app/(front-publico)/…` |
| `app/api/`, `app/auth/` | `src/app/(back-api)/…` |
| `lib/` | `src/lib/` |
| `proxy.ts`, `instrumentation.ts` | `src/proxy.ts`, `src/instrumentation.ts` |
| `docs/*.md` sueltos | `docs/1-tesis/` … `docs/5-pendientes/` (ver `docs/README.md`) |

**Segunda pasada (2026-10-17) — pruebas y reglas que sostienen el orden:**

| Antes | Ahora |
|---|---|
| `tests/*.test.ts` (150 archivos sueltos) | `tests/dominio/`, `servicios/`, `acciones/`, `base-de-datos/`, `contratos/` |
| `tests/db.ts`, `tests/roles.ts`, `tests/stubs/` | `tests/apoyo/` |
| Las capas, solo escritas en `AGENTS.md` | Vigiladas por `tests/contratos/capas.test.ts` |
| `public/{file,globe,next,vercel,window}.svg` | `public/plantilla-next-sin-uso/` |

Los imports con `@/lib/…` siguen igual porque el alias `@/` apunta a `src/`. La
bitácora, los ADRs, la tesis y las migraciones nombran las rutas viejas porque
son registro histórico: se leen con estas tablas.
