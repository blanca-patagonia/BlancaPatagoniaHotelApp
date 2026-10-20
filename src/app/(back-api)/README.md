# Back HTTP — endpoints

Rutas que no devuelven pantallas sino datos. Todas cuelgan de `/api/...`.

- `api/salud/` — estado del sistema
- `api/webhooks/pagos/` — confirmación de pagos de las pasarelas (es quien da un pago por hecho)
- `api/webhooks/email/` — entregas y rebotes de correo
- `api/cron/` — tareas automáticas (las programa `vercel.json`)
- `api/canales/` — feed iCal para Booking
- `auth/callback/` — vuelta del login con Google
