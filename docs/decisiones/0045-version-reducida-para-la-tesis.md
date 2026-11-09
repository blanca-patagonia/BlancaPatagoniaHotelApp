# ADR 0045 — Versión reducida para presentar y defender la tesis (rama `tesis-a-presentar`)

- **Estado:** aceptada
- **Fecha:** 2026-11-09
- **Relacionadas:** ADR 0001 (alcance inicial), 0002 (anti-overbooking en la base), 0004 (tarifas neto/rack), 0011 (asistente del portal por reglas), 0018 (proveedores sin degradación silenciosa)

## Contexto

El sistema creció mucho más allá de lo que pidió el hotel. El pedido original
(PP2, sección 1.2) eran cinco módulos: reservas y estadías, check-in/check-out
con facturación, consumos, huéspedes y reportes, más la integración con una
pasarela de pagos y con el envío de correo. La rama `main` llegó a 26 áreas del
panel, 105 pantallas, 69 tablas, 127 migraciones y unas 100.000 líneas en
`src/`: una bandeja de mensajes estilo Chatwoot, un asistente de IA, un módulo
de canales de venta con publicación de disponibilidad, conciliación bancaria,
contratos con firma electrónica, cuentas corrientes de agencias y proveedores,
portal en cinco idiomas y aplicación instalable, entre otras cosas.

Para una tesis eso es un problema de defensa, no de calidad: no se puede
explicar, ni demostrar, ni responder preguntas sobre un sistema de ese tamaño en
el tiempo de una exposición, y lo que no se puede defender resta.

## Decisión

Se crea la rama **`tesis-a-presentar`** a partir de `main` (commit `c160c74`) y
se la reduce al núcleo del pedido original más lo que ese núcleo necesita para
funcionar. **`main` no se toca**: conserva el sistema completo.

### Qué se quitó (un commit por módulo, todos revertibles)

| Módulo | Qué incluía |
|---|---|
| Asistente de IA del panel | Chat con herramientas de datos, acciones propuestas, consultas rápidas del tablero (ADR 0039/0041) |
| Bandeja de mensajes y chat interno | WhatsApp, Instagram, Messenger, Telegram, correo entrante, chat de la web, CRM (ADR 0043/0044) |
| Conciliación y gastos | Extracto bancario, liquidaciones de Mercado Pago, gastos operativos (ADR 0030) |
| Contratos y firma electrónica | Contratos por token, firma, cron de vencimiento (ADR 0010) |
| Proveedores | Cuentas por pagar, facturas recibidas por QR (ADR 0031) |
| Agencias y portal del socio | Cuenta corriente, pipeline comercial, portal por token (ADR 0014) |
| Canales de venta | Importación de Booking, feed iCal, ARI, reseñas, comisiones, dos crons (ADR 0021/0022/0023/0032/0035) |
| Mantenimiento, objetos perdidos y avisos | Órdenes y preventivo, depósito, cartelera interna |
| Notificaciones avanzadas | Registro de envíos, recordatorios automáticos, seguimiento de entrega y rebotes, canal interno, WhatsApp |
| Configuración avanzada | Integraciones y claves, conexiones OAuth, cifrado de credenciales, plantillas de correo editables (ADR 0036) |
| Portal multi-idioma | Diccionarios en inglés, portugués, francés y chino, selector de idioma |
| Menores | Aplicación instalable (ADR 0028), respaldos, cierre del día, servicio de cocina |

### Qué se conserva (el núcleo)

- **Reservas y estadías**, con el anti-overbooking garantizado por la base
  (ADR 0002): grilla de ocupación, alta de mostrador y desde el portal público,
  máquina de estados, cancelación con su política, reprogramación, cambio de
  unidad, reservas grupales.
- **Check-in/check-out, consumos y factura**: punto de venta, cuenta del
  huésped, folios, facturación con CAE (proveedor simulado) y notas de crédito.
- **Pagos**: Mercado Pago, Stripe y Payway por webhook, en dólares y pesos.
- **Huéspedes**, fidelidad, tarifario (rack/neto, ADR 0004), temporadas,
  promociones, inventario, divisas, datos fiscales, tipos de alojamiento y
  ubicaciones.
- **Housekeeping**, **usuarios y roles** con RLS por rol.
- **Reportes** (ocupación/ADR/RevPAR, venta por categoría, satisfacción, estados,
  facturación) y exportación a CSV.
- **Portal público** en español, con el asistente por reglas (ADR 0011).
- **Seguridad y auditoría**: auditoría de operaciones sensibles, registro de
  errores, límites de tasa, firma de webhooks.
- **Notificaciones al huésped por correo**: bandeja de salida con reintentos y
  diez eventos (confirmación, pago, cancelación, recordatorio de check-in,
  encuesta, etc.).

## Consecuencias

- **Tamaño:** de ~100.000 a ~51.000 líneas en `src/`, de 105 a 55 pantallas, de
  26 a 12 áreas del panel, de 6 a 3 tareas programadas y de 226 a 146 archivos
  de test.
- **La base de datos no se achicó.** Las 127 migraciones y las tablas de los
  módulos quitados siguen ahí (`canal_*`, `crm_*`, `contratos`, `firmas`,
  `agencias`, `movimientos_cuenta`, `proveedores`, `comprobantes_recibidos`,
  `movimientos_externos`, `gastos_operativos`, `ordenes_mantenimiento`,
  `objetos_perdidos`, `avisos`, `plantillas_email`, `conexiones_proveedores`) y
  también las columnas `reservas.agencia_id` y `reservas.contrato_id`. Una
  migración aplicada no se edita; y borrar tablas con claves foráneas y
  funciones que las referencian no se puede verificar sin una base real, que
  este entorno de trabajo no tenía. La limpieza queda como paso aparte, a hacer
  contra la base de tests aislada (`npm run test:aislado`) antes de aplicarla
  en ningún otro lado. Mientras tanto son tablas sin pantalla ni código que las
  use, y sus tests de RLS (`tests/base-de-datos/rls-*.test.ts`) siguen
  describiendo la base tal como está.
- **La reserva ya no se vincula a una agencia.** La tarifa sale del canal
  (rack para mostrador y web, neto para Booking y Expedia) y la factura toma
  siempre al huésped como receptor.
- **Los avisos al huésped salen solo por correo**, y la tabla del catálogo
  quedó en diez eventos.
- **Un sitio de un solo idioma conserva la estructura multi-idioma** (prefijo
  en la URL, diccionario por idioma, `hreflang`) con `IDIOMAS = ['es']`:
  volver a sumar un idioma es agregarlo a esa lista y escribir su diccionario.
- **Los tests que tocan Postgres no se pudieron correr** en el entorno donde se
  hizo la reducción (sin Docker). Lo verificado ahí fue typecheck, lint, build y
  los 1.195 tests que no necesitan base. La suite completa (`npm run
  test:aislado`) hay que correrla en local antes de la entrega.
- **Cómo recuperar algo:** todo lo quitado sigue en `main`, y cada módulo salió
  en un commit propio de esta rama (`git log --oneline tesis-a-presentar`), de
  modo que se puede revertir uno sin tocar los demás.

## Lo que se dejó a propósito

Quedaron dentro tres piezas que estaban en la lista de candidatos, por su peso
en la defensa: la **auditoría** y el **registro de errores** (el índice de la
cátedra pide *Seguridad y Auditoría*), el **buscador global** y las **encuestas
de satisfacción** (alimentan el informe de NPS). Sacarlas es una decisión chica
que se puede tomar después.
