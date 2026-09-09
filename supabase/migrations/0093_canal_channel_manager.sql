-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 0093 — `channel_manager` se suma a los canales válidos
--
-- La 0062 fijó `reservas_canal_valido` a la lista exacta de `CANALES`
-- (`lib/domain/reservas.ts`), a propósito acotada: es la dimensión de
-- `resumen_canal_mes` y de la conciliación de comisiones, y un CHECK más ancho
-- que el dominio no protege de nada.
--
-- El webhook de la 0092 (`POST /api/canales/externos/<token>`, Fase 7 del
-- análisis de referencia) necesita guardar `reservas.canal` para algo que no es
-- Booking ni Expedia. Se agrega UN valor genérico —`channel_manager`— y no uno
-- por proveedor: cuál proveedor específico fue fue una reserva ya lo dice
-- `canales_externos` a través del mapeo, y agregar una fila a esa lista por
-- cada Beds24/Hotelrunner/RateGain que se contrate infla exactamente la misma
-- dimensión que la 0062 quiso mantener chica. Si algún día un proveedor puntual
-- necesita su propia fila en los reportes de comisión, esa es la migración
-- chica que corresponde entonces — no antes de tener un proveedor real.
-- ─────────────────────────────────────────────────────────────────────────────

alter table reservas drop constraint reservas_canal_valido;

alter table reservas
  add constraint reservas_canal_valido
  check (canal in ('directo', 'web', 'booking', 'expedia', 'channel_manager'));

comment on constraint reservas_canal_valido on reservas is
  'Sin esto, un typo creaba un canal fantasma en `resumen_canal_mes` y en la conciliación de comisiones, sin fallar. Al sumar un canal nuevo hay que ampliar esta lista y `segmentoDeCanal()` en `lib/domain/reservas.ts`. `channel_manager` (0093) es el bucket genérico de cualquier proveedor conectado por `canales_externos`.';
