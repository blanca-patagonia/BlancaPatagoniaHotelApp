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

**365 tests en verde** · typecheck y lint limpios · CI verificado en GitHub.

### Qué está funcionando

| Área | Alcance implementado |
|---|---|
| **Reservas** | Alta con cotización por temporada e IVA, máquina de estados (confirmar · check-in · check-out · cancelar · no-show), política de cancelación con vista previa del cargo, reservas grupales, reprogramación y cambio de unidad |
| **Ocupación** | Grilla unidades × días con celdas accionables, filtros por categoría, ventana de 14/30 días y KPIs del período |
| **Portal público** | Búsqueda de disponibilidad sin login, checkout del huésped, confirmación por token opaco, expiración de reservas pendientes y asistente basado en reglas |
| **Pagos** | Seña → saldo → `pagada` automática al saldar, registro manual desde recepción y webhook idempotente |
| **Consumos y factura** | Catálogo de productos/servicios, consumos por reserva, cuenta consolidada y comprobante imprimible con IVA discriminado |
| **Facturación fiscal** | Letra del comprobante según condición de emisor y receptor, desglose que garantiza `neto + iva = total` y validación de CUIT por módulo 11 |
| **Housekeeping** | Estados de habitación, vista por responsable, asignación de mucamas y KPIs de limpieza |
| **Mantenimiento** | Órdenes con prioridad y antigüedad, planes de mantenimiento **preventivo** y objetos perdidos |
| **Agencias y proveedores** | Cuentas corrientes, pipeline comercial, conciliación, antigüedad de saldos (*aging*) y portal de socios por token |
| **Reportes** | Ocupación, ingresos, ADR y RevPAR con prorrateo, comparativa contra el mes anterior, evolución de 6 meses, ranking de canales y NPS |
| **Contratos** | Redacción, envío, firma electrónica por token desde vista pública y verificación de integridad por hash |
| **Interno** | Conversaciones por canal en tiempo real, avisos fijables, buscador global por rol, auditoría *append-only* y sección de Ayuda |

### Garantías que impone la base de datos

La integridad crítica no depende de la aplicación:

- **Anti-overbooking** — restricción de exclusión GiST sobre `estadias`; dos
  reservas no pueden solapar la misma unidad aunque la app falle ([ADR 0002](docs/decisiones/0002-motor-de-disponibilidad.md)).
- **RLS activado en las 33 tablas**, con lectura pública solo del catálogo.
- **Auditoría *append-only*** por trigger genérico: el staff lee, no escribe.
- **Límite de tasa** en las entradas públicas, atómico (inserta y después cuenta).

### Lo que todavía no está

Los cinco bordes externos son **adapters con stub**, listos para enchufar un
proveedor real vía variable de entorno, pero **ninguno está integrado**:
`PaymentProvider`, `EmailProvider`, `FirmaElectronicaProvider`,
`AsistenteProvider` y `FacturacionElectronicaProvider`. No se procesan pagos ni
se envían correos reales, y el CAE es simulado.

El **deploy** (Vercel + Supabase cloud) está pendiente.

Tres pendientes técnicos, anotados donde viven y no solo acá:

- **Auditar las ~60 políticas RLS una por una.** Que estén activadas en las 33
  tablas no dice qué permite cada una. Exige ejecutarlas contra una base con los
  cuatro roles.
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

## Puesta en marcha (desarrollo local)

Requiere **Node.js ≥ 20.12** y **Docker** en ejecución (Supabase local).

```bash
npm install
npx supabase start           # levanta Postgres + Auth en Docker
cp .env.example .env.local   # en Windows (cmd): copy .env.example .env.local
```

Completar `.env.local` con lo que imprime `npx supabase status`:

```bash
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"   # la API URL, no la de Storage/S3
NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_…"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_…"             # en una sola línea
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
```

Las claves de pagos y email pueden quedar vacías: los adapters usan stubs.

```bash
npx supabase db reset        # aplica migraciones + seed (Tarifario real)
npm run seed:usuarios        # crea el admin de desarrollo
npm run dev                  # http://localhost:3000
```

> ⚠️ `db reset` **borra los usuarios de auth**: hay que volver a correr
> `npm run seed:usuarios` después, o los tests de facturación fallan por la FK
> contra `perfiles`.

**Panel interno:** `http://localhost:3000/panel` con el admin de desarrollo
(`admin@blancapatagonia.local` / `blancadev1234`, configurables con
`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Desde **Usuarios** se dan de alta el resto de
los roles. Contra una base que no sea local, el seed **exige** definir
`ADMIN_PASSWORD`: la contraseña por defecto es pública.

Detalle completo en el [manual técnico](docs/manual-tecnico.md).

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
- [Decisiones (ADR)](docs/decisiones/) — 16 decisiones de arquitectura numeradas.
- [Manual de usuario](docs/manual-usuario.md) · [Manual técnico](docs/manual-tecnico.md)
- [Seguridad](docs/SEGURIDAD.md) · [Auditoría inicial](docs/AUDITORIA_INICIAL.md) ·
  [Revisión de RLS y endpoints](docs/revision-seguridad.md)

## Estructura

```
app/            # Next.js App Router
  panel/        #   gestión hotelera (staff, por rol)
  reservar/     #   portal público de reservas
  firmar/       #   firma de contratos por token
  encuesta/     #   encuesta de satisfacción por token
  portal/       #   portal de agencias y proveedores por token
  api/          #   route handlers y webhooks
lib/            # dominio puro, disponibilidad, pagos, clientes Supabase
supabase/       # 31 migraciones SQL numeradas + seed
docs/           # documentación del proyecto / tesis
tests/          # 365 tests (Vitest)
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
