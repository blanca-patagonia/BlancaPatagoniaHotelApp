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

## Auditoría de seguridad (numeración propia)
- [x] Fase 0 — Reconocimiento sin modificar código (`docs/AUDITORIA_INICIAL.md`)
- [x] Fase 1 — Límite de tasa en entradas públicas y login (migración 0029),
      guarda del seed y encabezados de seguridad
- [x] Fase 2 — Cuatro bugs leyendo el código: precio neto de agencia expuesto a
      `anon` (migración 0030), webhook de pagos que fallaba abierto, inyección de
      condiciones en los filtros `or` y el último `<details>`
- [ ] Auditar las ~60 políticas RLS una por una: que estén activadas en las 33
      tablas no dice qué permite cada una. **No se pudo hacer en el entorno de
      trabajo**: exige ejecutar las políticas contra una base con los cuatro roles
      y el *pull* de las imágenes de Supabase está bloqueado por política de
      egreso (403 contra las CDN de los registries)
- [ ] Cerrar el segundo camino al precio neto: `GET /rest/v1/tarifas?select=precio_neto`.
      Exige revocar por columna **y** hacer `cotizar_estadia` `security definer` a la
      vez; ver la migración 0030. Pide ADR
- [ ] Atomicidad de los flujos de varios pasos de `reservas`: hoy un fallo a mitad
      de camino avisa, pero deja los datos a medias. Pide función SQL transaccional

## Pendiente — AFIP WSFE/CAE real
- [ ] Facturación electrónica real (certificados, punto de venta, CAE)
