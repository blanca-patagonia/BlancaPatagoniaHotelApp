# Roadmap por fases

Cada fase deja un **avance demostrable**, **tests verdes**, la **bitácora**
actualizada y, si corresponde, un **ADR**. Las fases mapean a los capítulos de
diseño / implementación / pruebas de la tesis.

## Fase 0 — Fundaciones
- [x] Proyecto Next.js 16 + TypeScript + Tailwind
- [x] Repositorio Git conectado al remoto
- [x] Clientes Supabase (server / browser / admin) + refresco de sesión (`proxy`)
- [x] Migración 0001: perfiles, roles y RLS base
- [x] CI (lint + tests + build) y primer test
- [x] Estructura de documentación y ADRs iniciales
- [ ] Proyecto Supabase creado y migración aplicada
- [ ] Deploy inicial a Vercel

## Fase 1 — Núcleo de dominio
- [x] Migraciones: tipos de unidad, unidades, temporadas, tarifas, promociones, huéspedes
- [x] Seed con datos reales de la PP2 (Anexo A — Tarifario 2025/2026)
- [x] Motor de disponibilidad con restricción de exclusión + tests (20 en verde)
- [x] Lógica de dominio de precios (neto/rack + IVA) y cancelación
- [ ] CRUD de administración (habitaciones, tipos, temporadas, tarifas, promociones) → UI en Fase 2

## Fase 2 — Panel interno de Recepción (funciones tipo WinPax)
- [x] Autenticación de staff (Supabase Auth) + control de acceso por rol (ADR 0005)
- [x] Shell del panel por rol (dashboard, sidebar) + gestión de usuarios (niveles)
- [x] Grilla de ocupación (unidades × días)
- [x] Alta de reservas con cotización (temporada + IVA) y motor anti-overbooking
- [x] Consulta / máquina de estados (confirmar, check-in/out, cancelar, no-show)
- [x] Aplicación de la política de cancelación (preview de cargo)
- [x] Estados de habitación (housekeeping) · huéspedes e historial · tarifario (lectura)

## Fase 3 — Pagos
- [x] Modelo de pagos (seña / saldo / reembolso) + registro manual desde recepción
- [x] Flujo seña → saldo → `pagada` automática al saldar
- [x] Capa de abstracción `PaymentProvider` (stubs MercadoPago + Stripe)
- [x] Webhook idempotente (`external_id` único)
- [ ] Integración real de pasarelas (requiere credenciales) · reembolsos automáticos por política

## Fase 4 — Portal público de reservas
- [x] Landing pública + búsqueda de disponibilidad (sin login)
- [x] Checkout con datos del huésped → reserva `pendiente` (anti-overbooking en vivo)
- [x] Página de confirmación por código con seña
- [x] Email de confirmación (stub, listo para proveedor real)
- [ ] Pago de seña online (requiere pasarela) · expiración de reservas pendientes

## Fase 5 — Check-in / Check-out + Consumos + Factura
- [x] Check-in / check-out por máquina de estados
- [x] Catálogo de productos/servicios + registro de consumos por reserva
- [x] Cuenta consolidada (alojamiento + consumos)
- [x] Factura interna (registro + comprobante imprimible; columnas AFIP preparadas)
- [ ] Generación server-side de PDF a Storage · consolidación automática al check-out

## Fase 6 — Reportes / Dashboard gerencial
- [x] Ocupación por mes, ingresos cobrados y facturación, ranking de canales, reservas por estado
- [ ] Comparativos interanuales y exportación (CSV / Power BI)

## Fase 7 — Hardening de producción
- [x] Revisión de seguridad + RLS (ver `docs/revision-seguridad.md`)
- [x] Token opaco de confirmación (anti-enumeración) + expiración de reservas pendientes
- [ ] Rate-limiting de endpoints públicos · programar expiración por cron
- [ ] Backups, secrets, observabilidad · Dominio + SSL · Deploy (Vercel + Supabase cloud)
- [ ] Migración de datos desde Winpax / Excel

## Fase 8 — Ampliación tipo WinPax / Odoo
- [x] 8.1 Cuentas corrientes de agencias y empresas
- [x] 8.2 Reservas grupales
- [x] 8.3 Mantenimiento, objetos perdidos, encuestas y reportes avanzados (ADR / RevPAR)
- [x] 8.4 / 8.5 Consolidación de la gestión y dashboard-hub
- [x] 8.6 Fidelidad e inventario
- [x] 8.7 Proveedores (cuentas por pagar), reprogramación, mucamas y avisos internos

## Fase 9 — Mejora integral del panel
- [x] Identidad visual propia y sistema de diseño compartido (ADR 0009)
- [x] Búsqueda, filtros, paginación y exportación a CSV en todos los listados
- [x] Navegación móvil, accesibilidad, estados de carga y error por ruta
- [x] Mejora funcional módulo por módulo (13 módulos)

## Fase 10 — Contratos y comunicación (inspiradas en Odoo)
- [x] Contratos con firma electrónica por token (ADR 0010)
- [x] Conversaciones internas en tiempo real por canal
- [x] Asistente del portal basado en reglas (ADR 0011)

## Fase 11 — Alcance ERP
- [x] Facturación fiscal argentina: letra, IVA discriminado, CUIT (ADR 0012)
- [x] Auditoría *append-only* de operaciones sensibles
- [x] Conciliación de proveedores y antigüedad de saldos (*aging*)
- [x] Pipeline comercial de agencias · encuestas NPS · mantenimiento preventivo
- [x] Portal de agencias y proveedores por token (ADR 0014)
- [ ] Gestión documental con Storage · seguridad por campo · multi-propiedad (ADR 0013)

## Fase 12 — Endurecimiento y verificación
- [x] CI que corre los tests de integración con credenciales reales (`EXIGIR_DB=1`)
- [x] Tests sobre las Server Actions · reglas faltantes y concurrencia (ADR 0015)

## Fases 13 a 19 — Uso real del sistema
- [x] 13 Limpieza de código muerto y cambio de unidad (mudanza de habitación)
- [x] 14 Experiencia de uso e interacción táctil (móvil)
- [x] 15 Rediseño de la interfaz (nada oculto) y sección de Ayuda
- [x] 16 Portal público: paridad con el trabajo hecho en el panel
- [x] 17 El CI en verde, verificado en GitHub (corrida #31)
- [x] 18 Cinco bugs encontrados recorriendo el sistema a mano
- [x] 19 Buscador global por rol, confirmaciones y encabezado
- [x] 20 Ningún fallo de escritura en silencio: `cortarSiFalla` / `registrarFalla`
      en las 38 escrituras que descartaban su error
- [x] 21 Catálogo público de alojamientos (`/alojamientos` + detalle por tipo),
      con precios por temporada. Pendiente: incorporar las fotos del hotel

## Modernización WinPAX (numeración propia de 11 pasos) — ✅ 2026-08-16

El cliente venía de **WinPAX** (Oracle Forms, ~año 2000) y se cubrieron sus
funciones core. El plan completo, con el porqué de cada decisión, está en
[`docs/modernizacion-winpax.md`](modernizacion-winpax.md). Migraciones `0036`–`0043`.

- [x] 1 Cotización de divisas automática con respaldo manual (ADR 0020, cierra el ADR 0003)
- [x] 2 Fila resumen de la grilla y estados legibles sin color
- [x] 3 Diez vistas operativas del listado de reservas, con saldo
- [x] 4-5 Canales de venta: informe CSV de Booking y feed iCal (ADR 0021)
- [x] 6 Ficha de reserva completa (VIP, ocupantes, plan, garantía, segmento, voucher)
- [x] 7 Punto de venta con grilla por departamento y número de comanda
- [x] 8 Folios A/B con split y jerarquía de departamentos
- [x] 9 Housekeeping móvil ordenado por prioridad real
- [x] 10 Piso y bloque en `unidades`
- [x] 11 Respaldos verificables

Tres áreas nuevas del panel: `canales`, `punto_venta` y `respaldos`.

> ⚠️ **La sincronización con Booking NO evita el overbooking.** Los dos caminos
> posibles sin ser Connectivity Partner son de **solo lectura**: nadie le informa
> a Booking qué queda libre. La solución real es un channel manager y es una
> contratación del hotel (ADR 0021). No quitar esas advertencias de la pantalla.

## Bloque Booking (B1–B10)

- [x] **B1** Costos y comisiones por canal (migración 0049)
- [x] **B2** Modalidad de cobro del canal (migración 0050)
- [x] **B4** Mapeo manual de columnas del informe (migración 0051)
- [x] **B5** Conflicto de cupo detectado al aterrizar (migración 0052)
- [x] **B6** Ingesta de reseñas y vínculo con la reserva (migración 0054)
- [x] **B8** Sincronización automática: cron diario que **aterriza, no importa**
      (`app/api/cron/canales/route.ts`, `vercel.json`, PR #14).
      Ver [`docs/sincronizacion-automatica.md`](sincronizacion-automatica.md)
- [ ] **B3** Importador general (refactor sin valor visible por sí solo)
- [ ] **B7** Feed iCal propio de salida + ADR 0022
- [ ] **B9** Reporte de neto de comisión y costo por canal.
      **Tiene demanda del cliente:** en el relevamiento del 15/08/2026 preguntó
      «cuál nos conviene». La vista `resumen_canal_mes` (0055) ya existe
- [x] **B10** Documentación al día (este archivo, README, modelo de datos, manual)

## Relevamiento con el cliente — 15/08/2026

Franco (Blanca Patagonia) mostró WinPAX 9 y el extranet de Booking. La mayoría de
lo pedido ya estaba; lo que faltaba se abordó así:

- [x] **P6** Sincronizar la documentación con el estado real
- [x] **P1** Exención de IVA a turistas extranjeros (RG 3971) — ADR 0024
- [x] **P4** Declarar en pantalla la fuente y la antigüedad de la cotización
- [x] **P3** Desayuno como ítem cobrable fuera de la estadía
- [x] **P2** Verificar la tarjeta de garantía **sin guardar el número** — ADR 0025
- [ ] **P5** Booking: bandeja, comentarios y analytics. **Diferido por el propio
      cliente.** Antes de prometer nada hay que verificar qué exporta realmente el
      extranet sin API de partner

## Auditoría de seguridad (numeración propia)
- [x] Fase 0 — Reconocimiento sin modificar código (`docs/AUDITORIA_INICIAL.md`)
- [x] Fase 1 — Límite de tasa en entradas públicas y login (migración 0029),
      guarda del seed y encabezados de seguridad
- [x] Fase 2 — Cuatro bugs leyendo el código: precio neto de agencia expuesto a
      `anon` (migración 0030), webhook de pagos que fallaba abierto, inyección de
      condiciones en los filtros `or` y el último `<details>`
- [x] Fase 3 — Alta de usuario sin privilegios (ADR 0017), baja efectiva,
      numeración operable, tokens de firma fuera del alcance del staff, facturas
      inmutables, 51 Server Actions con verificación de rol, firma HMAC real en el
      webhook y simuladores que fallan fuerte en producción (ADR 0018).
      Migraciones `0032`–`0035`, **aplicadas y verificadas contra Postgres**
- [x] Matriz de **lectura** RLS exhaustiva: 43 tablas × 4 roles
      (`tests/rls-por-rol.test.ts`), con la lista traída de la base para que una
      tabla nueva sin declarar haga fallar el test
- [ ] Matriz de **escritura** RLS: hoy es dirigida (20 casos elegidos por
      consecuencia), no exhaustiva. El archivo lo declara. Es el pendiente de
      seguridad más importante que queda
- [x] Cerrar el segundo camino al precio neto (migración 0031, ADR 0016): dos
      funciones en vez de una con parámetro, `execute` revocado a `anon` sobre la
      que conoce el neto y privilegios por columna sobre `tarifas`. Se descartó
      `security definer`, que habría desactivado en silencio la guarda de la 0030
- [ ] Atomicidad de los flujos de varios pasos de `reservas`: hoy un fallo a mitad
      de camino avisa, pero deja los datos a medias. Pide función SQL transaccional
- [ ] Los tokens de firma y de portal no caducan ni se revocan

## Pendiente — AFIP WSFE/CAE real
- [ ] Facturación electrónica real (certificados, punto de venta, CAE)
- [ ] Emitir la factura en **una sola transacción SQL**: hoy el correlativo se
      consume antes de pedir el CAE, así que un rechazo deja un salto de
      numeración, que es obligación formal (ADR 0015)
