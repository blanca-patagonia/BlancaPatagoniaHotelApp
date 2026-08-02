# Prompt descriptivo del sistema

Texto autocontenido para darle contexto completo del proyecto a otra IA (ChatGPT,
Claude, Gemini) o para usar como resumen técnico en la defensa de la tesis.
Copiar desde el bloque de abajo.

---

Estoy trabajando en **Blanca Patagonia**, un Sistema Integral de Gestión Hotelera
(PMS) desarrollado como proyecto de tesis de Analista de Sistemas (IES) para una
hostería boutique con cabañas real, ubicada en El Calafate, Santa Cruz, Argentina.
El sistema reemplaza al software heredado **WinPax** y busca reducir la dependencia
de Booking y otras OTAs mediante un motor de reservas propio.

## Stack

- **Next.js 16** (App Router, React 19, Server Components y Server Actions,
  TypeScript). Ojo: en esta versión `cookies()` es asíncrono, `params` y
  `searchParams` son promesas, y `middleware` se reemplaza por `proxy.ts`.
- **Tailwind CSS 4** (configuración por `@theme` en CSS, sin `tailwind.config.js`).
- **Supabase**: PostgreSQL 17 + Auth + Row Level Security. Entorno local por
  Docker vía `npx supabase`.
- **Zod** para validación y **Vitest** para tests. Deploy previsto en Vercel.
- Sin librerías de UI ni de iconos: los componentes y los iconos SVG son propios.

## Arquitectura en capas

- **Presentación**: `app/panel/**` (gestión interna, con login) y `app/reservar/**`
  + landing (portal público del huésped). `app/api/webhooks/**` para route handlers.
- **Lógica de negocio**: `lib/domain/**` con reglas puras y testeables
  (precios, cancelación, reservas, pagos, consumos, cuentas, fidelidad, métricas,
  permisos, roles, unidades), más `lib/availability`, `lib/pricing`, `lib/payments`,
  `lib/csv` y `lib/listados`.
- **Datos**: PostgreSQL con **RLS activado en todas las tablas** y 17 migraciones
  SQL numeradas y versionadas. La integridad crítica vive en la base, no en la app.

## Modelo de datos (23 tablas)

`perfiles` · `tipos_unidad` · `unidades` · `temporadas` · `temporada_rangos` ·
`tarifas` · `promociones` · `politicas_cancelacion` · `huespedes` · `reservas` ·
`estadias` · `reserva_huespedes` · `pagos` · `consumos` · `productos_servicios` ·
`facturas` · `agencias` · `movimientos_cuenta` · `proveedores` ·
`movimientos_proveedor` · `ordenes_mantenimiento` · `objetos_perdidos` · `avisos`.

Funciones y triggers en PostgreSQL: `rol_actual()`, `crear_reserva()`,
`cotizar_estadia()`, `unidades_disponibles()`, `disponibilidad_por_tipo()`,
`temporada_en()`, `sincronizar_estado_estadias()`, `expirar_reservas_pendientes()`,
`descontar_stock_consumo()`, `manejar_nuevo_usuario()`, `solo_fijar_aviso()`.

## Reglas de negocio centrales

- **Anti-overbooking garantizado por la base**: la tabla `estadias` tiene una
  restricción de exclusión GiST (`unidad_id WITH =, periodo WITH &&`) filtrada por
  los estados que ocupan inventario. Un solape es imposible incluso ante
  concurrencia; el alta se hace con la RPC atómica `crear_reserva`, y el error
  `23P01` se traduce a un mensaje claro en la interfaz.
- **Doble tarifa**: precio **neto** (agencias) y **rack** (mostrador), con **IVA
  discriminado** que se calcula en el dominio y nunca se almacena sumado. El canal
  de la reserva determina qué tarifa se aplica.
- **Multi-moneda**: USD como moneda base, ARS a cotización configurable.
- **Temporadas** (baja / media / alta) resueltas por rango de fechas, con
  restricción anti-solape en la base.
- **Política de cancelación** del tarifario real: sin cargo a más de 14 días,
  primera noche entre 14 y 7 días, 100 % a menos de 7 días y en no-show.
- **Máquina de estados** de la reserva: `pendiente → confirmada → pagada →
  in_house → checkout`, con salidas a `cancelada` y `no_show`. Las transiciones
  válidas se validan en el dominio antes de tocar la base.
- **Cuatro roles** con permisos por área: `admin`, `gerencia`, `recepcion` y
  `housekeeping`. Doble capa de control: guard en la aplicación (`requerirAcceso`)
  y RLS en la base.
- **Fidelidad**: 1 punto por cada USD 10 de estadía, con niveles bronce, plata,
  oro y platino; los puntos se otorgan en el check-out.
- **Inventario**: el stock de frigobar y amenities se descuenta por trigger al
  cargar un consumo, con alerta de stock mínimo.

## Dos vistas separadas (decisión de producto)

**1. Gestión hotelera** (`/panel`, solo staff con login) — 13 módulos:

- **Inicio**: KPIs del día, llegadas y salidas accionables, alertas de
  mantenimiento, objetos en depósito y stock bajo.
- **Ocupación**: grilla de unidades × días (14 o 30), con el día de hoy destacado,
  filtro por categoría y celdas interactivas (una celda libre abre la reserva con
  las fechas ya cargadas).
- **Reservas**: alta individual y grupal, cotización, ciclo de vida completo,
  reprogramación con recotización, registro de pagos, consumos, factura interna
  imprimible, búsqueda y filtros por estado, canal y rango de estadías.
- **Huéspedes**: ficha, historial y nivel de fidelidad.
- **Housekeeping**: estados de limpieza y asignación de mucamas, con vista por
  responsable.
- **Mantenimiento**: órdenes de trabajo con prioridad, estado y antigüedad.
- **Objetos perdidos**: registro y devolución.
- **Avisos**: tablón interno con avisos fijados.
- **Agencias**: cuentas corrientes por cobrar, con descuento por convenio.
- **Proveedores**: cuentas por pagar.
- **Reportes**: ocupación, **ADR** y **RevPAR** con prorrateo de estadías entre
  meses, comparativa contra el mes anterior, evolución de 6 meses y ranking de
  canales.
- **Configuración**: tarifario editable e inventario.
- **Usuarios**: alta de staff, cambio de rol, activación y último acceso.

Transversal a todos los listados: búsqueda, filtros y paginación por URL
(formularios GET que funcionan sin JavaScript) y exportación a CSV centralizada
en un único endpoint que audita permisos por área.

**2. Reservas de clientes** (público, sin cuenta): landing, buscador de
disponibilidad con precios, checkout y confirmación por token. Las funciones de
cara al huésped (web check-in, encuestas) están planificadas para esta vista.

## Pagos

Abstracción `PaymentProvider` que desacopla la pasarela concreta, con webhook
idempotente (identificador externo único) y validación de firma que falla cerrada.
No hay integración con pasarelas reales ni con AFIP: quedan stubs listos para
enchufar, porque el proyecto es académico y no maneja dinero real.

## Identidad visual

Paleta con nombres del entorno del hotel: **lago** (turquesa glaciar del Lago
Argentino), **calafate** (el violeta de la baya que da nombre al pueblo), **lenga**
(el naranja del bosque en otoño) y **stone** (grises cálidos de la estepa).
Tipografías Fraunces para títulos y marca, Geist para la interfaz. Los componentes
compartidos son de servidor, sin estado ni eventos, para no arrastrar JavaScript
al cliente.

## Calidad

96 tests en Vitest repartidos en 17 archivos, incluyendo tests de integración
contra PostgreSQL real que verifican el anti-overbooking, la cotización y la
expiración de reservas pendientes. Cada fase exige typecheck, lint y tests en
verde. El proyecto se documenta con una bitácora cronológica y ADRs numerados,
todo en español.

## Estado

Fases 0 a 9 completas: fundaciones, núcleo de dominio, panel interno, pagos,
portal público, consumos y facturación, reportes gerenciales, hardening,
ampliación tipo WinPax/Odoo y mejora integral del panel. Pendiente: el deploy a
Vercel y Supabase cloud, y la ampliación de la vista pública de clientes.
