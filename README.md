# Sistema de Gestión Hotelera — Hotel Blanca Patagonia

[![CI](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/actions/workflows/ci.yml/badge.svg)](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/actions/workflows/ci.yml)

Sistema integral de gestión hotelera (PMS) para el **Hotel Blanca Patagonia**
(El Calafate, Santa Cruz): reservas, estadías, consumos, facturación y reportes.
Reemplaza el sistema heredado **Winpax** y las planillas de Excel, y suma un
portal propio de reservas para reducir la dependencia de las OTAs — que hoy
concentran el **79 %** de las reservas del hotel.

> **Proyecto de tesis** — Analista de Sistemas, Colegio Universitario IES.
> Autores: Octavio Fakiani · Santiago Morán.

## Estado del proyecto

**1446 tests en verde** (89 archivos, cero salteados contra la base local) · typecheck,
lint y build limpios · CI verificado en GitHub.

### Qué está funcionando

| Área | Alcance implementado |
|---|---|
| **Reservas** | Alta con cotización por temporada e IVA, máquina de estados (confirmar · check-in · check-out · cancelar · no-show), política de cancelación con vista previa del cargo, reservas grupales, reprogramación y cambio de unidad |
| **Ocupación** | Grilla unidades × días con celdas accionables, filtros por categoría, ventana de 14/30 días y KPIs del período |
| **Portal público** | Catálogo de alojamientos con detalle y precios por temporada, búsqueda de disponibilidad sin login, checkout del huésped, confirmación por token opaco, expiración de reservas pendientes y asistente basado en reglas |
| **Pagos** | Seña → saldo → `pagada` automática al saldar, registro manual desde recepción y webhook idempotente |
| **Consumos y factura** | Catálogo de productos/servicios, consumos por reserva, cuenta consolidada y comprobante imprimible con IVA discriminado |
| **Facturación fiscal** | Letra del comprobante según condición de emisor y receptor, desglose que garantiza `neto + iva = total` y validación de CUIT por módulo 11 |
| **Housekeeping** | Estados de habitación, vista por responsable, asignación de mucamas y KPIs de limpieza |
| **Mantenimiento** | Órdenes con prioridad y antigüedad, planes de mantenimiento **preventivo** y objetos perdidos |
| **Agencias y proveedores** | Cuentas corrientes, pipeline comercial, conciliación, antigüedad de saldos (*aging*) y portal de socios por token |
| **Reportes** | Ocupación, ingresos, ADR y RevPAR con prorrateo, comparativa contra el mes anterior, evolución de 6 meses, ranking de canales y NPS |
| **Contratos** | Redacción, envío, firma electrónica por token desde vista pública y verificación de integridad por hash |
| **Canales de venta** | Importación del informe CSV de Booking y del feed iCal, mapeo manual de columnas, zona de recepción de entrantes, costos y comisiones por canal, conciliación de la factura del canal, mensajes y reseñas. **Solo lectura: no evita el overbooking** ([ADR 0021](docs/decisiones/0021-canales-de-venta-solo-lectura.md)) |
| **Punto de venta** | Grilla por departamento con buscador, total en vivo, número de comanda y anulación con detalle del importe |
| **Respaldos** | Exportación verificable de los datos operativos, con el alcance declarado en pantalla. **No es un backup de Postgres**: eso lo hace la plataforma |
| **Divisas** | Cotización automática con respaldo manual del gerente ([ADR 0020](docs/decisiones/0020-cotizacion-de-divisas.md)) |
| **Interno** | Conversaciones por canal en tiempo real, avisos fijables, buscador global por rol, auditoría *append-only* y sección de Ayuda |

### Garantías que impone la base de datos

La integridad crítica no depende de la aplicación:

- **Anti-overbooking** — restricción de exclusión GiST sobre `estadias`; dos
  reservas no pueden solapar la misma unidad aunque la app falle ([ADR 0002](docs/decisiones/0002-motor-de-disponibilidad.md)).
- **RLS activado en las 43 tablas** (90 políticas), con lectura pública solo del catálogo.
- **Auditoría *append-only*** por trigger genérico: el staff lee, no escribe.
- **Límite de tasa** en las entradas públicas, atómico (inserta y después cuenta).

### Lo que todavía no está

Hay **siete puertos** con el mismo patrón (interfaz + implementación
seleccionable por variable de entorno). Los cinco primeros tienen **simulador y
ninguno está integrado**: `PaymentProvider`, `EmailProvider`,
`FirmaElectronicaProvider`, `AsistenteProvider` y
`FacturacionElectronicaProvider`. **No se procesan pagos ni se envían correos
reales, y el CAE es simulado.**

Los otros dos son distintos: `CotizacionProvider` (divisas) y
`CanalVentaProvider` (OTA) hablan con fuentes públicas sin credenciales, así que
**no tienen un simulador que mienta**. El respaldo de divisas es el valor que
cargó un admin a mano; el de canales sí es simulado y no habla con nadie.

Si un simulador queda seleccionado en producción, el sistema **falla al
arrancar** a propósito ([ADR 0018](docs/decisiones/0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md)).

El **deploy** (Vercel + Supabase cloud) está pendiente. La sincronización
automática de canales ya tiene su tarea programada (`vercel.json`), documentada
en [`docs/sincronizacion-automatica.md`](docs/sincronizacion-automatica.md) —
con la advertencia de que el plan Hobby de Vercel corre **una vez por día**,
no cada tres horas.

Tres pendientes técnicos, anotados donde viven y no solo acá:

- **Auditar las 90 políticas RLS una por una.** Que estén activadas en las 43
  tablas no dice qué permite cada una. La matriz de **lectura** ya es exhaustiva
  (43 tablas × 4 roles, `tests/rls-por-rol.test.ts`); la de **escritura** es
  dirigida, no exhaustiva, y está declarado en el propio archivo.
- **Atomicidad de los flujos de varios pasos de `reservas`.** Hoy un fallo a mitad
  de camino avisa, pero deja los datos a medias; resolverlo pide una función SQL
  transaccional.
- **Las fotos de los alojamientos.** El catálogo está diseñado para verse
  terminado sin ellas; para sumarlas, copiar los archivos en
  `public/alojamientos/` y descomentar su línea en `FOTOS`
  (`lib/domain/catalogo.ts`).

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

**Panel interno:** `http://localhost:3000/panel`. El staff no se auto-registra: el
primer administrador lo crea el script de siembra y desde **Usuarios** se dan de
alta el resto de los roles.

```bash
ADMIN_EMAIL="tu-mail@dominio.com" ADMIN_PASSWORD="una-larga-y-propia" npm run seed:usuarios
```

Contra una base que no sea local el seed **exige** `ADMIN_PASSWORD`: la contraseña
de desarrollo (`admin@blancapatagonia.local` / `blancadev1234`) es pública, está en
este repositorio.

> ⚠️ Crear el usuario desde el panel de Supabase **no alcanza**: el perfil nace
> `sin_rol` y `activo = false` a propósito (ADR 0017, migraciones 0032 y 0035), así
> que puede autenticarse pero el panel lo rechaza. El script es el que lo promueve.

## Correr los tests — esto sí necesita Docker

Los tests **no** se corren contra el proyecto de la nube: 24 archivos escriben con
`service_role` —que saltea RLS— y borran filas de `reservas`, `huespedes`,
`tarifas`, `unidades` y `tipos_unidad`. Contra la base real eso destruye datos del
hotel, así que `tests/db.ts` corta si las variables no apuntan a una base local.

```bash
npx supabase start      # Postgres + Auth locales; la primera vez tarda unos minutos
npx supabase db reset   # aplica las migraciones + el seed (Tarifario real)
npm run seed:usuarios   # OJO: db reset borra los usuarios de auth
npm test
```

Sin base local `npm test` **saltea** los tests de integración en vez de fallar
—entre ellos el anti-overbooking, que es la garantía central del sistema—. En CI
eso no puede pasar: `EXIGIR_DB=1` convierte la ausencia de base en error.

Detalle completo en [cómo levantarlo](COMO-LEVANTARLO.md) y en el
[manual técnico](docs/manual-tecnico.md).

## Roles

`admin` · `gerencia` · `recepcion` · `housekeeping`, más el huésped público sin
cuenta. Cada rol ve su propia navegación, su propio alcance de búsqueda y sus
propios capítulos de Ayuda ([ADR 0005](docs/decisiones/0005-autenticacion-y-roles.md)).

## Documentación

Toda la documentación vive en [`docs/`](docs/), en español:

- [Bitácora de avances](docs/bitacora.md) — registro cronológico del desarrollo.
- [Roadmap por fases](docs/roadmap.md) — plan y estado de cada fase.
- [Arquitectura](docs/arquitectura.md) — visión técnica del sistema.
- [Modelo de datos](docs/modelo-datos.md) — entidades y relaciones.
- [Decisiones (ADR)](docs/decisiones/) — 22 decisiones de arquitectura numeradas.
- [Auditoría de seguridad](docs/audit/) — qué se corrigió y qué queda abierto.
- [Manual de usuario](docs/manual-usuario.md) · [Manual técnico](docs/manual-tecnico.md)
- [Seguridad](docs/SEGURIDAD.md) · [Auditoría inicial](docs/AUDITORIA_INICIAL.md) ·
  [Revisión de RLS y endpoints](docs/revision-seguridad.md)

## Estructura

```
app/            # Next.js App Router
  panel/        #   gestión hotelera (staff, por rol)
  alojamientos/ #   catálogo público con detalle por tipo
  reservar/     #   portal público de reservas
  firmar/       #   firma de contratos por token
  encuesta/     #   encuesta de satisfacción por token
  portal/       #   portal de agencias y proveedores por token
  api/          #   route handlers, webhooks y cron
lib/            # dominio puro, disponibilidad, pagos, canales, divisas, clientes Supabase
supabase/       # 57 migraciones SQL numeradas + seed
docs/           # documentación del proyecto / tesis
tests/          # 1446 tests (Vitest)
```

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm test` | Tests (Vitest) |
| `npm run test:watch` | Tests en modo watch |
| `npm run typecheck` | Chequeo de tipos |
| `npm run seed:usuarios` | Crea/actualiza el admin de desarrollo |

El test de integración anti-overbooking necesita la base local y sus variables
de entorno; sin ellas se saltea. En CI corre con `EXIGIR_DB=1`.

Para correr los 1446 en local hay que exportar las tres variables — vitest no lee
`.env.local`, y sin la clave publicable los 4 tests del borde público saltean sin
avisar aunque `EXIGIR_DB=1` esté puesto:

```bash
EXIGIR_DB=1 \
SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_…" \
npm test
```
