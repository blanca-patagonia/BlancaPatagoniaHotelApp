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
- [ ] Check-in digital (reemplazo de ficha en papel)
- [ ] Registro de consumos por estadía
- [ ] Consolidación automática al check-out
- [ ] Factura PDF interna a Storage

## Fase 6 — Reportes / Dashboard gerencial
- [ ] Ocupación, facturación mensual, ranking de canales, comparativos

## Fase 7 — Hardening de producción
- [ ] Revisión de RLS y permisos
- [ ] Backups, secrets, observabilidad
- [ ] Dominio + SSL
- [ ] Migración de datos desde Winpax / Excel

## Fase 8 — AFIP WSFE/CAE (posterior)
- [ ] Facturación electrónica real (certificados, punto de venta, CAE)
