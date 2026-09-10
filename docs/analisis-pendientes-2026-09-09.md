# Análisis de lo que le falta al proyecto (2026-09-09)

> Foto tomada sobre `main` en `0d61664` (después de mergear el PR #41). No es un
> reemplazo de `docs/PENDIENTES.md`: ese archivo quedó congelado en el cierre de
> `feat/relevamiento-cliente-agosto` (migración 0064) y varios de sus pendientes
> —por ejemplo B7, el feed iCal de salida— ya se resolvieron después (ADR 0022).
> Este documento junta lo que sigue abierto **hoy**, verificado contra el código
> y los ADRs, no inventado.

## 1. Integraciones reales pendientes

Patrón simulador/real confirmado en código: ninguna de estas tres tiene una
clase real (tipo `lib/payments/stripe.ts` o `lib/email/resend.ts`), solo el
simulador.

- **Firma electrónica** (`lib/firma/index.ts`): el `ProveedorLocal` no tiene
  validez legal — sin certificado ni autoridad certificante (ADR 0010, a
  propósito). Conectar DocuSign/Odoo Sign/firma de AFIP es escribir una clase
  nueva, mismo patrón que pagos.
- **Facturación electrónica AFIP/ARCA** (`lib/facturacion/index.ts`): emite un
  CAE simulado de 14 dígitos. `lib/facturacion/emisor.ts` y
  `lib/domain/wsfev1.ts` ya arman el comprobante en el formato que pide
  WSFEv1; falta el adapter que de verdad hable con ARCA.
- **Asistente** (`lib/asistente/index.ts`): solo reglas locales, no hay LLM
  real conectado.
- **Booking** (canales): de solo lectura, y **declarado explícitamente que no
  evita overbooking** (ADR 0021). La única solución real es contratar un
  channel manager — decisión y costo del hotel, no una tarea de código.

## 2. Decisiones de arquitectura sin cerrar

- **ADR 0019** (cobro efectivo de la política de cancelación) sigue en estado
  `PROPUESTA`. El sistema calcula y muestra el cargo por cancelar, pero
  **nunca lo cobra de verdad**: no hay registro de pago ni retención al
  cancelar, y el camino de no-show no tiene un solo lugar que lo dispare. Es
  una decisión de riesgo comercial del hotel, no algo que falte programar.
- **ADR 0013** (gestión documental con Storage, seguridad por campo,
  multi-propiedad) es trabajo futuro **documentado y no implementado** a
  propósito. El ADR 0031 lo cita como el motivo de por qué la factura
  recibida se lee por QR y no por OCR.

## 3. De cara al huésped, diferido

- **Web check-in**: no hay rastro de implementación en `app/reservar`. Sigue
  diferido tal como dice `CLAUDE.md`.
- Las **encuestas de satisfacción sí existen** (`app/encuesta/[token]`) — no
  es un gap, aunque `CLAUDE.md` las mencione en la misma frase que el
  check-in.
- Fases D–F del portal público, sin especificar en ningún doc todavía
  (`docs/PENDIENTES.md` §4): filtros laterales, galería con lightbox, barra
  sticky de reserva, mapa SVG, desglose de precio en el checkout, insignia de
  escasez (necesita una migración de RLS) y layout de dos columnas en «Nueva
  reserva».

## 4. Deuda técnica conocida (`docs/PENDIENTES.md` §4, sigue vigente)

- **El punto ciego más grande, en palabras del propio repo: nunca se restauró
  un backup.** Un backup que no se probó restaurar no es un backup.
- Emitir factura en una sola transacción SQL sigue sin resolver
  (`app/panel/reservas/actions.ts`): el test de concurrencia ya arma la
  carrera, falta la garantía transaccional (riesgo: salto de numeración
  fiscal, ADR 0015).
- Auditoría de las políticas RLS **una por una** sigue pendiente (están
  activadas en todas las tablas, pero eso no dice qué permite cada una).
- 79 % de la lógica vive en `app/` en vez de `lib/` (190 llamadas `.from()`
  en 56 archivos de rutas contra 5 en `lib/`).
- `lib/env.ts` no valida `MERCADOPAGO_*`, `STRIPE_*` ni `RESEND_API_KEY` (es
  perezoso, ver nota de `AGENTS.md`).
- Sin captura de errores en producción (Sentry o equivalente), sin tests
  E2E/de componentes, sin Prettier ni pre-commit, sin migraciones
  reversibles.

## 5. Estado de deploy

`vercel.json` tiene **5 crons reales configurados** (`canales`, `salud` cada
15 min, `mantenimiento`, `notificaciones` cada 5 min) — algo que solo tiene
efecto si el proyecto efectivamente corre en Vercel. Esto contradice la línea
de `CLAUDE.md` que dice «Deploy (Vercel + Supabase cloud) pendiente»: esa
línea está desactualizada, igual que la de email que ya se corrigió esta
semana. **Falta confirmar con el usuario y actualizar `CLAUDE.md`.**

## 6. Pendientes operativos / de negocio (acción del usuario, no de código)

- 🔴 **Si ya está desplegado**: apagar el auto-registro en el Supabase hosted
  (Authentication → Providers) — `config.toml` solo cubre el entorno local.
- Dar de alta a los usuarios reales de staff (hoy solo existe el admin de
  desarrollo).
- Confirmar el **inventario físico real** de unidades y la **tarifa rack de
  cabañas** (hoy igual al neto, pendiente desde hace varias fases).
- Cargar la temporada de invierno si se decide vender esas fechas, y los
  precios de Semana Santa 2026/2027.
- **P5 de Booking** (bandeja, comentarios, analytics del extranet) sigue
  diferido **por decisión del propio cliente**, no por una limitación
  técnica: antes de prometer algo hay que ver qué expone el extranet sin API
  de partner.
