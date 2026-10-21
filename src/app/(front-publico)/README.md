# Front público — el sitio del huésped

Lo que ve cualquier visitante, sin cuenta. Las páginas de `[idioma]/` se sirven
en cinco idiomas (`/es`, `/en`, `/pt`, `/fr`, `/zh`).

- `[idioma]/page.tsx` — portada
- `[idioma]/alojamientos/` — catálogo y ficha de cada unidad
- `[idioma]/reservar/` — fechas, alojamiento, datos y pago
- `reservar/` — confirmación, pago por enlace, factura, asistente y la Server Action que crea la reserva
- `_publico/` — componentes compartidos (no son páginas)
- `encuesta/`, `firmar/`, `portal/` — accesos por enlace con token
- `pago-simulado/`, `pago-payway/` — pantallas de pasarela
