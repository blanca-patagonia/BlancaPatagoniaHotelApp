# Sistema de Gestión Hotelera — Hotel Blanca Patagonia

[![CI](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/actions/workflows/ci.yml/badge.svg)](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/actions/workflows/ci.yml)

Sistema integral de gestión hotelera (PMS) para el **Hotel Blanca Patagonia**
(El Calafate, Santa Cruz): reservas, estadías, consumos, facturación y reportes.
Reemplaza el sistema heredado **Winpax** y las planillas de Excel, y suma un
portal propio de reservas para reducir la dependencia de las OTAs — que hoy
concentran el **79 %** de las reservas del hotel.

> **Proyecto de tesis** — Analista de Sistemas, Colegio Universitario IES.
> Autores: Octavio Fakiani · Santiago Morán.

> ⚠️ **Rama `tesis-a-presentar` — versión reducida para la tesis.** Esta rama es el
> sistema recortado a lo que pidió el hotel (reservas, check-in/out, consumos,
> factura, pagos, huéspedes y reportes). Se quitaron la bandeja de mensajes, el
> asistente de IA, canales de venta, conciliación, contratos, agencias,
> proveedores, mantenimiento, objetos perdidos, avisos, el portal en otros
> idiomas, la app instalable y los respaldos. **`main` conserva el sistema
> completo.** Lo que quedó y el porqué: [ADR 0045](docs/decisiones/0045-version-reducida-para-la-tesis.md).
>
> Este documento describe **sólo lo que hay en esta rama**. Las migraciones son
> la excepción: la base de datos no se achicó, y las tablas de los módulos
> quitados siguen ahí sin pantalla ni código que las use
> ([qué tablas son de cada lado](docs/2-arquitectura/modelo-datos.md)).

## Estado del proyecto

**141 archivos de test, 1780 tests.** Sin base de datos corren 1197 y pasan los
1197; los otros 583 necesitan Postgres y se saltean (corrida del 2026-11-10 con
`npx vitest run`, sin las variables de la base). La suite completa contra la base
aislada (`npm run test:aislado`) **no está verificada desde esta rama**: se corre
en una máquina con Docker antes de la entrega ([ADR 0045](docs/decisiones/0045-version-reducida-para-la-tesis.md)).

### Qué está funcionando

| Área | Alcance implementado |
|---|---|
| **Reservas** | Alta con cotización por temporada e IVA, máquina de estados (confirmar · check-in · check-out · cancelar · no-show), política de cancelación con vista previa del cargo, reservas grupales, reprogramación y cambio de unidad |
| **Ocupación** | Grilla unidades × días con celdas accionables, filtros por categoría, bloque y piso, ventana de 14/30 días, KPIs del período y arrastre de una reserva a otra habitación ([ADR 0033](docs/decisiones/0033-arrastrar-una-reserva-cambia-de-habitacion-no-de-fechas.md)) |
| **Portal público** | Catálogo de alojamientos con detalle y precios por temporada, búsqueda de disponibilidad sin login, checkout del huésped, confirmación por token opaco, expiración de reservas pendientes y asistente basado en reglas. Sólo en español (`/es/…`) |
| **Pagos** | Mercado Pago, Stripe y Payway por webhook idempotente, en dólares y en pesos; seña → saldo → `pagada` automática al saldar y registro manual desde recepción |
| **Consumos y punto de venta** | Catálogo de productos/servicios, grilla por departamento con número de comanda, folios A/B con división de cuenta y cuenta consolidada |
| **Factura** | Comprobante imprimible con IVA discriminado, letra según emisor y receptor, `neto + iva = total`, validación de CUIT por módulo 11, numeración sin huecos y notas de crédito. **El CAE es simulado** |
| **Huéspedes** | Ficha, historial, fusión de duplicados, exención de IVA derivada y puntos de fidelidad |
| **Housekeeping** | Estados de habitación, vista por responsable, asignación de mucamas, vista móvil ordenada por prioridad y foto adjunta |
| **Reportes** | Ocupación, ADR y RevPAR con prorrateo, venta por categoría, facturación, satisfacción (NPS) y reservas por estado, con exportación a CSV |
| **Configuración** | Tarifario, temporadas, promociones, inventario, tipos de alojamiento, ubicaciones, datos fiscales y cotización del dólar ([ADR 0020](docs/decisiones/0020-cotizacion-de-divisas.md)) |
| **Correo al huésped** | Bandeja de salida con reintentos y diez eventos: confirmación, pago, cancelación, recordatorio de check-in, encuesta y otros |
| **Interno** | Buscador global por rol, auditoría *append-only*, registro de errores del servidor ([ADR 0029](docs/decisiones/0029-errores-observables-en-postgres.md)) y sección de Ayuda |

### Garantías que impone la base de datos

La integridad crítica no depende de la aplicación:

- **Anti-overbooking** — restricción de exclusión GiST sobre `estadias`; dos
  reservas no pueden solapar la misma unidad aunque la app falle ([ADR 0002](docs/decisiones/0002-motor-de-disponibilidad.md)).
- **RLS activado en las 69 tablas** que crean las migraciones, con lectura pública
  solo del catálogo.
- **Auditoría *append-only*** por trigger genérico: el staff lee, no escribe.
- **Límite de tasa** en las entradas públicas, atómico (inserta y después cuenta).

### Lo que todavía no está

Hay **cinco puertos** con el mismo patrón (interfaz + implementación
seleccionable por variable de entorno). Cuatro tienen **simulador**:
`PaymentProvider`, `EmailProvider`, `FacturacionElectronicaProvider` y
`AsistenteProvider` (éste último es por reglas, a propósito: [ADR 0011](docs/decisiones/0011-asistente-basado-en-reglas.md)).
Los adaptadores de Mercado Pago, Stripe, Payway y Resend están escritos, pero
**ninguna cuenta está contratada**: no se procesan pagos ni se envían correos
reales, y el CAE es simulado.

El quinto es distinto: `CotizacionProvider` (divisas) habla con fuentes públicas
sin credenciales, así que **no tiene un simulador que mienta**. Su respaldo es el
valor que cargó un admin a mano.

Si un simulador queda seleccionado en producción, el sistema **falla al
arrancar** a propósito ([ADR 0018](docs/decisiones/0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md)).

El **deploy** (Vercel + Supabase cloud) está pendiente. `vercel.json` declara tres
tareas programadas (avisos por correo, sondeo de salud y mantenimiento); las
primeras dos corren varias veces por día, así que **no entran en el plan Hobby**
de Vercel (detalle en [despliegue](docs/3-manuales/despliegue.md)).

Dos pendientes técnicos, anotados donde viven y no solo acá:

- **Auditar las políticas RLS una por una.** Que estén activadas en todas las
  tablas no dice qué permite cada una. La matriz de **lectura** ya es exhaustiva
  (todas las tablas × 4 roles, `tests/base-de-datos/rls-por-rol.test.ts`); la de **escritura** es
  dirigida, no exhaustiva, y está declarado en el propio archivo.
- **Atomicidad de los flujos de varios pasos de `reservas`.** Hoy un fallo a mitad
  de camino avisa, pero deja los datos a medias; resolverlo pide una función SQL
  transaccional.

Ver [roadmap](docs/roadmap.md) y [ADR 0013](docs/decisiones/0013-alcance-erp-y-trabajo-futuro.md)
para el trabajo futuro documentado.

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind CSS 4**
- **Supabase** — PostgreSQL + Auth + Storage + RLS
- **zod** para validación · **Vitest** para tests
- Despliegue previsto en **Vercel**

## Puesta en marcha (desarrollo)

Requiere **Node.js ≥ 20.12**. La base es un proyecto **Supabase en la nube**, con
las migraciones aplicadas y el catálogo cargado: no hay que levantar nada.

```bash
npm install
cp .env.example .env.local   # en Windows (cmd): copy .env.example .env.local
#  ↑ completalo con las claves (ver abajo) ANTES de seguir
npm run dev                  # http://localhost:3000
```

Completar `.env.local` con las claves del panel de Supabase, en
**Project Settings → API keys**:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://<tu-proyecto>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_…"   # la publishable key
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…"            # la secret key, en una sola línea
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
```

Las claves de pagos y email pueden quedar vacías: los adapters usan simuladores.

Para confirmar que enganchó con la base, entrá a
<http://localhost:3000/api/salud>: tiene que responder `{"estado":"ok","base":"ok"}`.

> ⚠️ **Cuidado con cuál clave copiás.** La *secret key* es la que empieza con
> `sb_secret_`. En el panel hay además una clave del protocolo S3 del Storage que
> se le parece y **no sirve**: con ésa falla todo lo que use `service_role`
> —incluida el alta de usuarios— y el error no dice que la clave esté mal.

**Panel interno:** `http://localhost:3000/panel`, con tu usuario y contraseña.

**Los usuarios ya viven en la base**, así que son los mismos desde cualquier
computadora: no hay nada que sembrar para empezar a trabajar. El staff no se
auto-registra — las cuentas se dan de alta desde **`/panel/usuarios`**, y una
contraseña perdida se recupera en **`/login/recuperar`**.

*(Para el caso de una base recién creada, sin ningún usuario todavía, ver
[cómo crear el primer administrador](COMO-LEVANTARLO.md#apéndice-crear-el-primer-administrador-de-una-base-nueva).)*

## Correr los tests — esto sí necesita Docker

Los tests **no** se corren contra el proyecto de la nube: hay 20 archivos que
escriben con `service_role` —que saltea RLS— y borran filas (entre otras, de
`reservas`, `huespedes`, `tarifas`, `unidades` y `tipos_unidad`). Contra la base
real eso destruye datos del hotel, así que `tests/apoyo/db.ts` corta si las
variables no apuntan a una base local.

Tampoco contra la base local con la que se trabaja (la de `npm run dev`): para eso
hay una base aparte, sólo para tests ([ADR 0042](docs/decisiones/0042-verificacion-base-aislada-esquema-e2e.md)).

```bash
npm run test:aislado         # levanta la base de tests (puerto 55321), la deja en cero,
                             # siembra el admin y corre TODO, sin saltear nada
npm run test:aislado:parar   # la apaga cuando terminás
```

Sin base `npm test` **saltea** los tests de integración en vez de fallar
—entre ellos el anti-overbooking, que es la garantía central del sistema—. En CI
eso no puede pasar: `EXIGIR_DB=1` convierte la ausencia de base en error.

Detalle completo en [cómo levantarlo](COMO-LEVANTARLO.md) y en el
[manual técnico](docs/3-manuales/manual-tecnico.md).

## Roles

`admin` · `gerencia` · `recepcion` · `housekeeping`, más el huésped público sin
cuenta. Cada rol ve su propia navegación, su propio alcance de búsqueda y sus
propios capítulos de Ayuda ([ADR 0005](docs/decisiones/0005-autenticacion-y-roles.md)).
El panel tiene **12 áreas** (`src/lib/domain/permisos.ts`).

## Documentación

Toda la documentación vive en [`docs/`](docs/), en español (índice en [`docs/README.md`](docs/README.md)):

- [Bitácora de avances](docs/bitacora.md) — registro cronológico del desarrollo.
- [Roadmap por fases](docs/roadmap.md) — plan y estado de cada fase.
- [Arquitectura](docs/2-arquitectura/arquitectura.md) — visión técnica del sistema.
- [Modelo de datos](docs/2-arquitectura/modelo-datos.md) — entidades y relaciones.
- [Decisiones (ADR)](docs/decisiones/) — 29 decisiones de arquitectura numeradas
  (los números saltan porque las de los módulos quitados quedaron en `main`).
- [Qué queda pendiente](docs/5-pendientes/PENDIENTES.md); el estado más actual son
  los [issues de GitHub](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/issues).
- [Manual de usuario](docs/3-manuales/manual-usuario.md) · [Manual técnico](docs/3-manuales/manual-tecnico.md) · [Despliegue](docs/3-manuales/despliegue.md)
- [Seguridad](docs/4-seguridad-y-auditorias/SEGURIDAD.md) · [Auditoría inicial](docs/4-seguridad-y-auditorias/AUDITORIA_INICIAL.md) ·
  [Revisión de RLS y endpoints](docs/4-seguridad-y-auditorias/revision-seguridad.md)

## Estructura

Mapa completo, carpeta por carpeta: **[ESTRUCTURA.md](ESTRUCTURA.md)**.

```
src/                    # TODO el código de la aplicación
  app/(front-publico)/  #   FRONT · sitio del huésped (reserva y pago, en español)
  app/(front-gestion)/  #   FRONT · panel de gestión del staff + login
  app/(back-api)/       #   BACK  · endpoints, webhooks y cron
  lib/                  #   BACK  · reglas de negocio, datos e integraciones
  proxy.ts              #   BACK  · sesión, idioma y límites de cada pedido
supabase/               # base de datos: migraciones SQL numeradas
tests/                  # pruebas por tipo: dominio, servicios, acciones, base de datos, contratos, componentes
public/                 # fotos del hotel
docs/                   # documentación: tesis, arquitectura, manuales, ADRs, bitácora
scripts/                # utilidades de consola
```

Los paréntesis son grupos de rutas de Next.js: ordenan el código sin cambiar
ninguna URL (`src/app/(front-gestion)/panel` se sigue abriendo en `/panel`).

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | Chequeo de tipos |
| `npm test` | Tests (Vitest) |
| `npm run test:aislado` | Todos los tests, sin saltear nada, contra una base propia (necesita Docker) |
| `npm run e2e` | Recorrido de las pantallas en un navegador (Playwright, con la app corriendo) |
| `npm run check` | lint + typecheck + tests + build |
| `npm run esquema:comparar` | ¿La base tiene exactamente el esquema de las migraciones? |
| `npm run seed:usuarios` | Crea el primer admin de una base **nueva**. Contra la nube va una sola vez; en la base local de tests, después de cada `db reset` |

El test de integración anti-overbooking necesita una base local y sus variables
de entorno; sin ellas se saltea. En CI corre con `EXIGIR_DB=1`.

Para correr la suite completa a mano hay que exportar las cuatro variables — vitest no lee
`.env.local`, y sin la clave publicable los 4 tests del borde público saltean sin
avisar aunque `EXIGIR_DB=1` esté puesto (`npm run test:aislado` lo resuelve solo):

```bash
EXIGIR_DB=1 \
SUPABASE_URL="http://127.0.0.1:54321" \
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_…" \
npm test
```
