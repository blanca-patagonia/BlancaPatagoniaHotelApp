# Revisión de seguridad

- **Fecha:** 2026-07-28
- **Alcance:** modelo de datos (RLS), roles/permisos, endpoints públicos (portal y
  webhook), uso de `service_role` y validación de entrada.

## Base de datos — verificado ✅

- **RLS habilitado en todas** las tablas de `public` (verificado con `pg_class`).
- **Ninguna** tabla con RLS pero sin políticas.
- Las funciones `SECURITY DEFINER` (`rol_actual`, `manejar_nuevo_usuario`,
  `disponibilidad_por_tipo`) tienen **`search_path` fijo** → sin riesgo de secuestro
  de esquema.
- **Acceso anónimo comprobado:** con la clave pública, el rol `anon` obtiene
  **0 filas** de `huespedes`, `reservas`, `pagos`, `perfiles`, `facturas` y
  `consumos` (PII y datos financieros protegidos por RLS, aunque el rol tenga el
  `GRANT SELECT`); solo lee el catálogo público (tipos, tarifas, temporadas, promos)
  y las RPC de disponibilidad. Defensa en profundidad correcta.

## Aplicación — verificado ✅

- `service_role` **solo** en módulos `server-only` (`lib/supabase/admin.ts`); se usa
  en el webhook, el alta pública y la gestión de usuarios, siempre en servidor y
  —para usuarios— detrás del guard de `admin`.
- Los **Server Actions** de Next.js incluyen protección CSRF nativa (chequeo de origen).
- **Validación de entrada:** fechas por regex, montos coercionados (+ `CHECK monto > 0`
  en la base), transiciones de estado validadas por la máquina de estados, y control
  de acceso por rol en dos capas (guard + RLS).
- Anti-overbooking garantizado por la base (restricción de exclusión), no por la app.

## Hallazgos corregidos en esta revisión

1. **Webhook *fail-closed* en producción (crítico).** `verificarFirma` aceptaba
   eventos sin firma cuando no había secreto configurado; útil en desarrollo pero un
   agujero en producción (permitiría registrar pagos falsos y marcar reservas como
   pagadas). Ahora, sin secreto, **se rechaza en producción**. Requiere
   `MERCADOPAGO_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` en producción.
2. **Validación de email** del lado del servidor en el alta pública.
3. **Tope de 30 noches** en el alta pública (evita la retención abusiva de inventario).

## Riesgos conocidos / a resolver en la Fase 7

- **Enumeración del código de reserva** en la confirmación pública
  (`BP-YYMMDD-XXXX`, ~65k combinaciones por día): quien adivine un código vería datos
  del huésped. Mitigar con un **token de acceso separado e inadivinable** para la URL
  de confirmación.
- **Sin rate-limiting** en los endpoints públicos (alta y webhook): agregar límite por
  IP para prevenir abuso/DoS.
- **Expiración de reservas `pendiente`**: liberar las que no paguen la seña a los 5
  días (job programado).
- Integrar pasarelas y email reales (hoy stubs) y cargar sus secretos.
