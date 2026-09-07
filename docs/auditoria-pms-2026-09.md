# Auditoría de arquitectura — camino a PMS productivo

- **Fecha:** 2026-09-06
- **Alcance:** los 11 objetivos planteados por el usuario (Booking/OTAs, overbooking,
  sincronización, facturas, pagos, recordatorios, avisos, operación diaria, OCR de
  facturas, MercadoPago/Santander, trazabilidad).
- **Estado:** Fases 1–4 (auditoría, matriz, arquitectura, plan). **No se modificó
  ningún archivo del sistema.**
- **Método:** verificación leyendo el código y ejecutando consultas, no leyendo la
  documentación. Donde la documentación y el código se contradicen, se anota.

---

## 1. Resumen ejecutivo

El sistema está **mucho más completo de lo que su propia documentación sugiere** en
dominio, RLS y tests (98 archivos, 1617 tests, cero salteados), y **bastante menos
listo para operar un hotel real** de lo que sugiere su estado «Fase 24 ✅».

La brecha no está donde se esperaba. No es que falten funcionalidades: es que **hay
siete defectos verificados que pierden dinero o corrompen datos hoy**, en código que
ya está escrito, probado y en `main`. Ninguno depende de contratar nada.

El hallazgo estructural es otro: **el sistema no le habla a nadie.** No sale un solo
correo (el único proveedor de email es un simulador que escribe en consola), no hay
registro de envíos, no hay cola, no hay reintentos. Las cuatro plantillas que existen
se disparan en cuatro lugares y terminan en el log. Un huésped nunca recibió una
confirmación, un recordatorio ni una encuesta.

Sobre la prioridad absoluta —Booking.com— la respuesta es cerrada y no es de
ingeniería: **no hay integración directa posible** (sección 3). El ADR 0021 ya lo
había diagnosticado bien; esta auditoría le agrega los números y una consecuencia que
el ADR no contempla: el puerto de salida que promete «enchufar un channel manager es
configuración» **no tiene un solo llamador**, así que hoy esa promesa no se cumple.

---

## 2. Veredicto sobre los 11 objetivos

| # | Objetivo | Veredicto |
|---|---|---|
| 1 | Integración con Booking y canales | 🟡 **Directa: imposible** y no es de ingeniería (sección 3). Vía channel manager: **la arquitectura ya está completa del lado del sistema** (ADR 0032) — falta el adapter, que depende de contratarlo |
| 2 | Prevención real de overbooking | 🟡 La garantía de la base es **sólida y sin agujeros**, y el bug P0-1 está corregido. **El riesgo residual sigue siendo el mismo y es una contratación**: sin channel manager, la OTA puede vender lo ya vendido (ADR 0021, ADR 0032) |
| 3 | Sincronización de reservas/disponibilidad/tarifas/estados | 🟡 **Entrada completa; salida calculada y declarada** (ADR 0032). Cupo, tarifas, mínimo de noches y cierres se arman todos los días y se registran; hoy no salen porque el proveedor es de solo lectura, y la pantalla lo dice |
| 4 | Análisis y conciliación de facturas | 🟢 **Cerrado (Bloque C, ADR 0030).** Comisiones de canal, conciliación bancaria y de pasarela, `estado_conciliacion` escribible con firma y motivo |
| 5 | Registro y confirmación de pagos | 🟢 **Cerrado (Bloque A).** Cobro en línea real; reembolsos arreglados (P0-2), mostrador con idempotencia (P0-6) y el link de pago ya no cruza pasarelas (P1-5) |
| 6 | Recordatorios automáticos | 🟢 **Cerrado (Bloque B).** Bandeja de salida con idempotencia, reintentos acotados, ventana horaria del hotel y consentimiento; adapter Resend real. **Falta contratar la cuenta de correo** |
| 7 | Avisos ante pagos o cambios de estado | 🟢 **Cerrado (Bloque B).** Los eventos encolan en la bandeja en vez de enviar, así que una API caída no tumba la operación que los originó |
| 8 | Operación diaria (recepción, HK, mantenimiento, gerencia) | 🟢 **Es lo más maduro del sistema.** Cubierto y testeado |
| 9 | Foto de factura → datos en Excel | 🟢 **Cerrado (ADR 0031).** Se lee el **QR obligatorio** de la factura electrónica, no OCR: los datos son los que el emisor le informó a ARCA, no una lectura probable. La imagen no sale del dispositivo. Export CSV por el punto único |
| 10 | MercadoPago + Santander, gastos mensuales | 🟢 **Cerrado (Bloque C, ADR 0030).** MercadoPago por su API de liquidaciones; Santander por importación del extracto —no publica API y **no se raspa el home banking**—; gastos por mes y por concepto en `/panel/conciliacion` |
| 11 | Trazabilidad, auditoría, seguridad, recuperación | 🟢 Auditoría y RLS son fuertes. **El camino del dinero ya se ve en `/panel/errores`** (P1-6), con test-contrato. 🟡 Queda el resto de los `console.*`, que no tocan dinero, y **restaurar un backup**, que no se cierra desde el código |

---

## 3. Booking.com — por qué la integración directa no es alcanzable

Investigado contra la documentación oficial de Booking, no por memoria.

- **No existe API pública.** El acceso a las Connectivity APIs es exclusivo de
  *Connectivity Partners*, que son **empresas proveedoras de software**, no
  propiedades. La documentación de desarrolladores es explícita: no hay acceso
  self-service para un hotel que quiera conectar su propio PMS.
- **Los requisitos mínimos de permanencia están dimensionados para channel
  managers**: ≥ **3.000 ABRN** por año de programa y un promedio diario de ≥ **250
  listings** abiertos/reservables. Blanca Patagonia tiene ~16 unidades: es dos
  órdenes de magnitud de distancia, y no se cierra creciendo.
- **Booking pausó las integraciones con nuevos proveedores de conectividad** y no
  acepta registros nuevos mientras actualiza los términos.

**Conclusión:** el camino es contratar un **channel manager** que ya sea partner
certificado (SiteMinder, Cloudbeds, Beds24 tienen API para PMS) y escribir un adapter
contra *su* API. Es una **contratación del hotel** (~USD 50–150/mes), no una decisión
técnica. Esto **confirma el ADR 0021** sin cambiarlo.

> **Nunca scraping.** No se contempla y no se va a implementar.

Lo que sí es responsabilidad del código, y hoy no está: que enchufar ese channel
manager sea efectivamente configuración. Ver P1-1.

---

## 4. Diagnóstico — defectos verificados

Los siete P0 están **verificados leyendo el código**, con archivo y línea. Ninguno
requiere contratar nada para arreglarse.

### 🔴 P0-1 · Una cancelación de Booking bloquea la habitación para siempre

Tres defectos que se componen:

1. **`lib/canales/servicio.ts:532`** — el corte por «ya se importó» está **antes** del
   chequeo de cancelación (`:538`), que por lo tanto es inalcanzable para toda reserva
   ya importada:
   ```ts
   if (e.estado === 'importada' && e.reserva_id) return { ok:false, error:'Esa reserva ya se importó.' }
   if (e.operacion === 'cancelada') { ... }   // ← nunca llega
   ```
2. **`lib/canales/ical.ts:337`** fija `operacion: 'nueva'` siempre. En Booking una
   cancelación es la **desaparición del VEVENT**, y `grep` sobre `lib/canales/` no
   encuentra **nada** que detecte desapariciones.
3. **`servicio.ts:216`** hace `motivo: ''` incondicional en cada actualización, y el
   iCal sella `emitidaEn = new Date()` (`ical.ts:341`), así que **cada corrida del
   cron pisa todas las filas** y borra cualquier aviso de discrepancia.

**Efecto:** la reserva queda `confirmada`, la estadía viva, la unidad invendible.
En temporada alta cada cancelación de Booking come inventario y nadie se entera.

### 🔴 P0-2 · Un reembolso de la pasarela nunca aterriza

`lib/domain/pagos.ts:76` — `aprobado: []`. Un `refunded` o `charged_back` sobre un
pago aprobado **se descarta** y el webhook responde `ok`. En Stripe ni siquiera llega:
`estadoSegunEvento` (`lib/payments/stripe.ts:299`) mapea 4 eventos y `charge.refunded`
no está entre ellos.

Y el camino manual tampoco existe: el formulario de reembolso solo se renderiza si
`!resumen.saldada` (`app/panel/reservas/[id]/page.tsx:950`) — exactamente el caso en
que hay algo que devolver. Un reembolso **parcial** no es modelable: el estado es de
la fila entera.

**Efecto:** la reserva queda `pagada` con la plata ya devuelta. El ADR 0027 declara
`aprobado`/`reembolsado` como terminales y lo presenta como virtud; **no dice que eso
deja los reembolsos fuera del sistema**.

### 🔴 P0-3 · El descuento de stock se pierde (corregido tras verificarlo)

> **Corrección del 2026-09-06.** La primera versión de esta auditoría decía «el stock
> se descuenta **dos veces**». **Es falso**, y lo descubrí al escribir el test de
> regresión: pasaba sin el arreglo. La aritmética no da doble descuento, y el error
> va en la dirección contraria a la que informé. Queda anotado porque es exactamente
> el tipo de conclusión plausible que hay que verificar ejecutando.

La migración **0064** convirtió `descontar_stock_consumo()` en `security definer`
porque con sesión de recepción el trigger no descontaba. Correcto. Pero **nadie quitó
el bucle manual** que hacía de parche: `app/panel/punto-venta/actions.ts:159-166`
volvía a escribir el stock con un valor calculado sobre una lectura **anterior** al
insert:

```ts
.update({ stock: Math.max(0, l.stock - l.cantidad) })   // l.stock se leyó ANTES
```

No es un segundo descuento: es una **lectura-modificación-escritura que pisa lo que el
trigger ya hizo**. Con una sola línea los dos números coinciden (50−3 = 47 por los dos
caminos) y el defecto es invisible. Divergen en cuanto el trigger corre más de una vez
entre la lectura y el update:

| Caso | Trigger deja | El bucle escribe | Real |
|---|---|---|---|
| Una línea de 3 | 47 | 47 | ✅ coincide |
| **Dos líneas del mismo producto (3 y 3)** | **44** | **47** | ❌ sobran 3 |
| Dos comandas simultáneas del mismo producto | correcto | pisa con lectura vieja | ❌ |

**El inventario queda más alto que la realidad**, no más bajo: se pierden descuentos.
Para el hotel eso es peor que lo que informé — vender lo que no hay, en vez de no
vender lo que hay.

Verificado ejecutando: con el bucle puesto, el test da `expected 47 to be 44`.
`tests/stock-descuento.test.ts` no lo veía porque prueba el **trigger** insertando
directo en `consumos`, sin pasar por la acción.

### 🔴 P0-4 · Se puede emitir una factura inmutable con CAE por menos importe

`app/panel/reservas/actions.ts:802` descarta el `{ error }` de la lectura de consumos
(también `:777` en `facturas` y `:786` en `reservas`). Si esa lectura falla, se pide
el CAE y se emite la factura **por un total menor al real**. Y `facturas` es inmutable
desde la 0034 (`revoke update, delete`).

`saldarSiCorresponde:103` sí chequea ese mismo error. Acá no.

### 🔴 P0-5 · Una factura mal emitida no tiene camino de corrección

**No existen notas de crédito.** El enum `tipo_comprobante` es solo `('A','B','C')`;
no hay tabla, ni acción, ni pantalla. Combinado con factura **inmutable** (0034) y
**una por reserva** (0045), el sistema no tiene forma de corregir un comprobante mal
emitido. Con el simulador es un inconveniente; con CAE real es un problema fiscal.

Tampoco existen **percepciones ni retenciones** (cero ocurrencias en el repo).

### 🔴 P0-6 · El cobro de mostrador no tiene idempotencia

`app/panel/reservas/actions.ts:392-450` — `registrarPago` no tiene `external_id` ni
clave de idempotencia. Dos envíos = **dos pagos**. Lo único que lo frena es
`BotonEnvio` del lado del cliente, que no sobrevive a un reintento de red.

### 🔴 P0-7 · La liberación de inventario depende de que pg_cron haya quedado activo

`expirar_reservas_pendientes` **no tiene un solo call site en la aplicación**. Su
único disparo es pg_cron, programado dentro de un bloque
`do $$ ... exception when others` que **se traga el fallo**
(`supabase/migrations/0027_cron_y_limites.sql:16-52`).

Si la extensión no quedó activa en el proyecto hosted, **las reservas web nunca
expiran** y el inventario retenido no se libera nunca. No es verificable desde el
código: hay que consultar `cron.job` contra la base.

### Además — P1 seleccionados

| | Defecto | Evidencia |
|---|---|---|
| ~~**P1-1**~~ | 🟡 **el ARI ya tiene llamador (ADR 0032)** · Se calcula un año de cupo y tarifas, se llama a `publicarDisponibilidad` y la corrida queda registrada con `sentido='salida'`. Con los proveedores de hoy responde `noSoportado`, que es la verdad. **Queda sin llamador el webhook de canales** (`interpretarWebhook`, `confirmarRecepcion`): sin channel manager no hay quién lo emita | `lib/canales/ari.ts`, migración 0081 |
| **P1-2** | **Cero notificaciones reales.** Único `EmailProvider`: `consola`. Sin registro de envíos, sin reintentos, sin idempotencia, sin consentimiento | `lib/email/index.ts:82` |
| ~~**P1-3**~~ | ✅ **corregido (0078)** · `movimientos_cuenta` y `movimientos_proveedor` tenían columna `moneda` **que ninguna acción escribía**, y `saldoCuenta` suma sin mirarla | el mismo bug que la 0067 arregló en `pagos`, acá sin `check` |
| ~~**P1-4**~~ | ✅ **corregido (0079)** · `estado_conciliacion` **solo se leía**; no había ninguna escritura de `conciliado`/`en_disputa` en toda la app | quedaba en `devengado` para siempre |
| ~~**P1-5**~~ | ✅ **corregido** · `linkReutilizable` no filtraba por `medio`: quien elegía MercadoPago/pesos podía recibir el link de Stripe en USD. ⚠️ El filtro va sobre `proveedor.nombre` y no sobre la clave de configuración (el simulador se elige como `simulado` y registra `tarjeta`) | `lib/payments/servicio.ts` |
| ~~**P1-6**~~ | 🟡 **el camino del dinero, corregido** · Los 5 archivos por los que pasa la plata —webhook, servicio de cobro y los tres adapters— quedaron con **cero `console`**, con test-contrato (`observabilidad-del-dinero`). El resto de los `console.*` del sistema sigue pendiente y no toca dinero | `tests/observabilidad-del-dinero.test.ts` |
| ~~**P1-7**~~ | ✅ **corregido (0084 + 0085)** · La reserva de agencia nace con su `agencia_id` dentro de `crear_reserva` (0084). Y la reprogramación y la recotización por mudanza aplican precio y total en **una** transacción con `aplicar_precio_reserva` (0085): antes eran dos `update` sueltos y el total podía quedar contradiciendo a la estadía. **Queda fuera el alta grupal**, y es deliberado: un lote de 5 que consigue 3 es un resultado útil, no una transacción a medias — está argumentado en `crearReservaGrupal` | `lib/reservas/crear.ts`, `actions.ts` |
| ~~**P1-8**~~ | ✅ **corregido** · `purgar_errores` corre en `/api/cron/mantenimiento`, todos los días a las 6:40 | `app/api/cron/mantenimiento/route.ts` |

### Discrepancias documentación ↔ código

- `AGENTS.md`/`CLAUDE.md`: «hoy hay **cero**» escrituras que descartan el error de
  Supabase. **Falso** en al menos tres lugares que importan (P0-4,
  `proveedores/actions.ts:100`, `mantenimiento/actions.ts:94`).
- «El iCal se sondea **cada hora**» (`servicio.ts:202`, `booking-ical.ts:17`,
  `ical.ts:10`) contra `vercel.json`: **`0 6 * * *`**, una vez por día, 03:00 del hotel.
- `plantillas.ts:36` dice «al confirmarse la reserva», pero el correo sale en el alta
  con estado `pendiente` y el texto afirma «Confirmamos tu reserva». El webhook, que
  es quien confirma de verdad, **no manda nada**.
- `RESEND_API_KEY` está en `.env.example` y **no lo lee nadie**. A la inversa, el
  código lee 8 variables que `.env.example` no declara (`BOOKING_ICAL_FEEDS`,
  `ASISTENTE_PROVIDER`, `PAGO_WEBHOOK_SECRET`, `DOLARAPI_URL`, `ARGENTINADATOS_URL`,
  `AUTH_GOOGLE_HABILITADO`, `EMAIL_LOG_CUERPO`, `REGISTRO_SIN_BASE`).
- Conteo de tests: `CLAUDE.md` dice 1575/95, `AGENTS.md` 1446. Real: **98 archivos,
  1617 tests**.
- El total del correo va con `toLocaleString('es-AR')` (`app/reservar/actions.ts:143`),
  no con `formatearUSD` como exige `CLAUDE.md`.

### Lo que está bien y no hay que tocar

- **Anti-overbooking**: la restricción GiST (`0005:46-49`) cubre exactamente
  `ESTADOS_ACTIVOS`, los tres caminos que escriben `estadias` chocan con 23P01 y lo
  manejan. **No se encontró ningún camino que la esquive.** (Fuera de su alcance:
  `unidades.estado='bloqueada'` es un flag sin período, así que un bloqueo por
  mantenimiento no participa del GiST.)
- **La invariante de moneda de `pagos`** (0067) está impuesta en la base con `check`.
- **La carrera de facturación** (0069) quedó resuelta y medida.
- **RLS**: matriz de lectura exhaustiva y verificada; `anon` sin acceso fuera del
  catálogo (0072/0073).
- **Los adapters de pago son HTTP real**, no simuladores: MercadoPago Checkout
  Preferences y Stripe Checkout Sessions, los dos con clave de idempotencia.

---

## 5. Matriz de brechas priorizada

| Área | Estado | Problema | Impacto | Riesgo | Referencia | Solución | Esfuerzo | Depende de | Aceptación |
|---|---|---|---|---|---|---|---|---|---|
| Canales | roto | P0-1 cancelación no propaga | Unidad invendible | **Alto — plata** | — | Reordenar guarda + detectar desaparición de VEVENT + no pisar `motivo` | M | — | Test: cancelar una importada libera la unidad |
| Pagos | roto | P0-2 reembolso no aterriza | Reserva `pagada` con plata devuelta | **Alto — plata** | — | `aprobado→reembolsado`, mapear `charge.refunded`, reembolso parcial | M | — | Test: refund de MP y de Stripe bajan el saldo |
| Punto de venta | roto | P0-3 descuentos perdidos por lectura vieja | Inventario más alto que la realidad | **Alto — datos** | — | Borrar el bucle manual; el trigger ya descuenta | **S** | — | Test: dos líneas del mismo producto descuentan las dos |
| Facturación | roto | P0-4 factura con CAE por menos | Comprobante fiscal mal emitido e inmutable | **Alto — fiscal** | — | `cortarSiFalla` en las 3 lecturas | **S** | — | Test: lectura fallida aborta la emisión |
| Facturación | falta | P0-5 sin notas de crédito | Sin corrección posible | **Alto — fiscal** | Invoice Ninja (patrón) | Enum + tabla + acción + pantalla | L | P0-4 | Emitir NC contra una factura |
| Pagos | roto | P0-6 mostrador sin idempotencia | Doble cobro | **Alto — plata** | — | Clave de idempotencia por (reserva, tipo, monto, ventana) | M | — | Test: doble envío = 1 pago |
| Jobs | riesgo | P0-7 expiración depende de pg_cron mudo | Inventario nunca liberado | **Alto** | — | Cron de Vercel + verificar `cron.job` | S | Acceso a la base hosted | `/api/cron/expirar` corre y se ve en `errores` |
| Canales | falta | P1-1 ARI de salida sin llamadores | El CM no es «configuración» | Medio | Channel manager | Cron ARI + mapeo en base + adapter | L | Contratar CM | Adapter simulado publica y queda log |
| Notificaciones | falta | P1-2 no sale nada | Sin recordatorios ni avisos | **Alto — negocio** | — | Puerto + outbox + reintentos + Resend/WhatsApp Cloud | **XL** | Cuenta Resend / Meta | Confirmación real al reservar |
| Cuentas | roto | P1-3 `moneda` que nadie escribe | Saldos mezclando monedas | Medio | — | Escribir moneda + `check` como 0067 | M | — | Test: saldo en 2 monedas no se suma plano |
| Conciliación | falta | P1-4 `estado_conciliacion` solo lectura | No se puede cerrar una conciliación | Medio | — | Acción + pantalla | M | — | Marcar conciliado/disputa |
| Observabilidad | parcial | P1-6 webhooks invisibles | Falla de firma no se ve | Medio | — | Migrar `console.*` críticos | M | — | Firma rechazada aparece en `/panel/errores` |
| Atomicidad | ✅ | P1-7 cerrado (0084 + 0085). El alta grupal queda parcial a propósito | Datos inconsistentes | Medio | — | RPC transaccional por flujo | L | — | Test: el período que pisa otra estadía no cambia ni el precio ni el total |
| Conciliación | falta | MercadoPago: sin importación | «Gastos mensuales» no existe | Medio | **MP Reports API** | Adapter + importador + pantalla | L | Cuenta MP | Reporte mensual importado y conciliado |
| Conciliación | falta | Santander: sin extracto | idem | Medio | — | `ExtractoBancarioProvider` + CSV/Excel | M | Formato del extracto | Extracto importado y conciliado |
| Comprobantes | falta | OCR foto→datos | Carga manual | Bajo | — | `OcrComprobanteProvider` + zod | L | Proveedor de visión | Foto → fila revisable → export |
| Facturación | simulado | AFIP 100 % simulado | No factura de verdad | **Alto — legal** | — | WSAA+WSFEv1 + campos faltantes | XL | Certificado + PV | Homologación devuelve CAE real |

**Prioridad sugerida de ejecución:** P0-3 y P0-4 primero (son de una línea y de alto
impacto), después P0-1, P0-2, P0-6, P0-7, y recién ahí lo que necesita contratar algo.

---

## 6. Repositorios externos — decisión

Revisado licencia, stack, mantenimiento y compatibilidad de cada uno.

| Repo | Licencia | Stack | Decisión | Por qué |
|---|---|---|---|---|
| **QloApps** | **OSL-3.0** (core) / AFL-3.0 (módulos) | PHP + MySQL | 🟡 **Solo ideas, nunca código** | OSL-3.0 es copyleft fuerte **con cláusula de despliegue en red**: copiar código obligaría a licenciar el derivado bajo OSL-3.0 y publicar su fuente, incluso desplegado como servicio web. Sumado a que el stack es incompatible, no hay nada que integrar. Sirve como referencia de modelo de datos hotelero |
| **hotel-pms** (diegoandruccioli) | **SIN LICENCIA** | Java 21 + Spring Boot, microservicios | 🔴 **No utilizar** | Sin archivo de licencia, por defecto son **todos los derechos reservados**: legalmente no se puede reusar aunque sea público. Además: stack incompatible, 1 estrella, integraciones específicas de Italia (Alloggiati Web, FatturaPA) y **carece justamente de channel manager, Booking y pagos** — lo que buscamos |
| **Evolution API** | Apache 2.0 + condiciones de marca | Node | 🟡 **Opcional en desarrollo; no en producción** | Soporta dos modos: **Baileys (no oficial)** y Meta Cloud API. El modo Baileys automatiza WhatsApp por fuera de los términos de Meta: riesgo real de **baneo del número del hotel**. El README **no trae ninguna advertencia** al respecto. Y si se va por el modo oficial, Evolution es un salto de más: conviene ir directo a **WhatsApp Cloud API** |
| **Invoice Ninja** | **Elastic License 2.0** | PHP/Laravel | 🟡 **Referencia de patrones; a lo sumo API** | ELv2 **prohíbe** ofrecer el software como servicio gestionado a terceros y copiar su código al producto arrastra esas restricciones — inviable en un repo público de tesis. Además **no hace facturación fiscal argentina**: sin AFIP/ARCA, sin CAE, sin A/B/C, sin CUIT. El módulo fiscal propio no se reemplaza. Sirve el patrón de notas de crédito y numeración |

**Conclusión honesta: ninguno de los cuatro aporta código integrable.** Dos por
licencia (OSL-3.0 y sin licencia), uno por riesgo operativo (Baileys) y uno porque
resuelve otro problema (documentos comerciales, no fiscales argentinos). Lo que sí
aportan son **patrones**: el modelo de tarifas/restricciones de QloApps y el ciclo de
notas de crédito de Invoice Ninja.

---

## 7. Arquitectura propuesta

Se respeta el patrón que el sistema ya usa —interfaz + simulador explícito, elegido
por variable de entorno, que **falla fuerte en producción** (ADR 0018)— y no se
introduce ningún stack nuevo.

### Puertos nuevos

```
NotificacionProvider          ← el que más falta
  ├── consola (simulador, ya existe como EmailProvider)
  ├── resend            (email real)
  └── whatsapp-cloud    (Meta oficial; NO Baileys)
  + tabla `notificaciones` (outbox): estado, intentos, clave de idempotencia,
    plantilla+versión, destinatario, error. Reintentos con backoff desde un cron.

ExtractoBancarioProvider      ← desbloquea Santander sin depender del banco
  ├── csv / excel  (real, funciona hoy con lo que el banco ya exporta)
  └── agregador    (opcional, si algún día se contrata)

ConciliacionPasarelaProvider
  └── mercadopago  (Reports API: /v1/account/settlement_report — pública y documentada)

OcrComprobanteProvider        ← foto de factura → datos
  ├── simulado
  └── vision       (modelo de visión + esquema zod; ya se usa zod en el proyecto)

CanalVentaProvider            ← YA EXISTE, hay que cablear la salida
  └── + adapter de channel manager cuando el hotel lo contrate
```

### Decisiones de diseño

1. **La outbox es una tabla, no una cola externa.** Mismo criterio que el ADR 0029
   con `errores`: sin dependencias nuevas, los datos del huésped no salen del sistema,
   y se ve desde el panel. Reintentos por cron de Vercel con backoff.
2. **Idempotencia por clave natural, no por reintento ciego.** Cada notificación lleva
   `(evento, entidad_id, plantilla)` único: reprocesar un webhook no manda dos correos.
3. **Consentimiento y horarios en el modelo**, no en el código de envío. Hoy no existe
   ninguna columna de preferencias del huésped.
4. **El ARI de salida se dispara por evento, no solo por cron**: al vender, al
   cancelar y al mudar. Con cron como red de seguridad, no como mecanismo principal.
5. **AFIP se separa en dos**: los campos que faltan en `SolicitudCae` (CUIT emisor,
   `Concepto`, `Iva[]` por alícuota, `Tributos`, `MonId`/`MonCotiz`) son trabajo del
   dominio y se pueden hacer ya; el adapter WSAA/WSFEv1 depende del certificado.
   ⚠️ `facturas.total` está en USD y **no hay columna de moneda** — eso hay que
   resolverlo antes de facturar de verdad.
6. **Nada degrada en silencio.** Todo puerto nuevo declara `capacidades()` y devuelve
   `noSoportado` en vez de fingir éxito, como ya hacen canales y pagos.

---

## 8. Plan de implementación por commits

Cada uno es independiente, reversible y con su test. **Ninguno mezcla áreas.**

**Bloque A — los P0 que no dependen de nadie** (recomendado empezar acá)

| # | Commit | Archivos | Migración | Revertir |
|---|---|---|---|---|
| A1 | `fix(punto-venta)`: el stock se descuenta una sola vez | `punto-venta/actions.ts` | — | revert directo |
| A2 | `fix(facturación)`: no emitir con una lectura fallida | `reservas/actions.ts` | — | revert directo |
| A3 | `fix(canales)`: la cancelación de una importada libera la unidad | `canales/servicio.ts` | — | revert directo |
| A4 | `fix(canales)`: detectar desaparición de VEVENT y no pisar `motivo` | `canales/{ical,servicio}.ts` | 0074 (marca de ausencia) | revert + migración inversa |
| A5 | `feat(pagos)`: reembolsos de pasarela y parciales | `domain/pagos.ts`, `stripe.ts`, webhook | 0075 | revert + migración inversa |
| A6 | `fix(pagos)`: idempotencia del cobro de mostrador | `reservas/actions.ts` | 0076 (índice único) | revert + drop index |
| A7 | `fix(jobs)`: expiración por cron de Vercel | `api/cron/expirar/`, `vercel.json` | — | quitar entrada del cron |

**Bloque B — notificaciones (el objetivo 6 y 7)**

| B1 | outbox + puerto `NotificacionProvider` + simulador | 0077 |
| B2 | adapter Resend + plantillas versionadas en base | 0078 |
| B3 | disparadores por evento (pago, confirmación, cancelación, check-in) | — |
| B4 | consentimiento, horarios y preferencias del huésped | 0079 |
| B5 | WhatsApp Cloud API | — |

**Bloque C — conciliación (objetivos 4 y 10) — ✅ hecho el 2026-09-06**

Los números de migración quedaron corridos respecto de lo planificado, porque los
bloques A, B y las notas de crédito ocuparon del 0074 al 0076. **ADR 0030.**

| C1 | `moneda` + `monto_origen` + `cotizacion` en cuentas corrientes, con los mismos `check` que la 0067 | **0078** ✅ |
| C2 | `estado_conciliacion` escribible, con firma y motivo obligatorios | **0079** ✅ |
| C3 | `ExtractoProvider` + importador CSV del extracto bancario | **0077** ✅ |
| C4 | MercadoPago *settlement report* por API + conciliación automática por referencia | — ✅ |
| C5 | gastos mensuales por moneda y por concepto (pantalla `/panel/conciliacion`) | — ✅ |

Tres cosas que salieron distintas de lo planificado, y por qué:

- **C1 no era sólo agregar un `check`.** La columna `moneda` ya existía en las dos
  tablas desde el primer día; el defecto era que **ninguna acción la escribía** y
  todas las filas decían USD. Se agregaron `monto_origen` y `cotizacion` —la misma
  forma que `pagos` (0067)— y se corrigieron los **tres** `insert` que existen:
  agencias, proveedores y la factura de comisión de canales.
- **C2 pedía más que un `update`.** Aceptar una diferencia contra el canal es
  aceptar un costo; sin quién y sin por qué, la revisión siguiente no puede
  reconstruir si se aceptó por buena o por cansancio. La 0079 agrega firma, fecha y
  motivo, con dos `check` que lo imponen desde la base.
- **La conciliación NO se cierra sola salvo por referencia exacta.** Está explicado
  en el ADR 0030 §4; es la decisión de diseño más importante del bloque.

**Bloque D — fiscal** · 🟡 **la parte de dominio, hecha.** Notas de crédito
(**0076**), los campos que faltaban en `SolicitudCae` —resueltos con
`lib/domain/wsfev1.ts`, que arma el comprobante entero— y los datos del **emisor**
(**0082**), que no estaban en ninguna tabla.

⚠️ Dos correcciones a lo que decía este documento:

- **`facturas` SÍ tenía columna `moneda`** desde la migración 0010, con default
  `'USD'`. El defecto era el mismo de P1-3 —nadie la escribía— y en este caso el
  default resultaba correcto, porque `reservas.total` está en USD. Lo que falta de
  verdad es la conversión a pesos para ARCA, que es decisión del contador.
- **El CUIT del hotel no existía en ninguna parte.** No estaba en la lista de
  pendientes y bloqueaba dos cosas: la solicitud de CAE y el aviso de «esta
  factura no es para el hotel» del escaneo (0080).

**Sigue faltando el certificado y el adapter WSAA/WSFEv1**, más las decisiones del
contador sobre moneda de emisión y alícuotas.

**Bloque E — canales bidireccional** · cableado ARI de salida, mapeo en base, adapter
de channel manager. **Requiere contratar el channel manager.**

---

## 9. Lo que necesito de vos (no lo puede resolver el código)

**Bloqueantes para producción**
1. **Apagar el auto-registro** en el Supabase hosted (*Authentication → Providers*).
   Ya está en `PENDIENTES.md` como 🔴 y sigue abierto.
2. **Verificar que pg_cron esté activo** en el proyecto hosted:
   `select jobname, schedule, active from cron.job;`. De eso depende P0-7.

**Contrataciones / credenciales**
3. **Channel manager** — la única solución real al overbooking de OTAs (~USD 50–150/mes).
4. **Cuenta de Resend** (o SMTP) para que salga un correo.
5. **WhatsApp Business + Meta Cloud API**, si se quiere WhatsApp oficial.
6. **Certificado AFIP/ARCA** + alta del punto de venta electrónico + ambiente de
   homologación. Y una definición del contador sobre notas de crédito y percepciones.
7. **MercadoPago**: credenciales de producción (las mismas del cobro sirven para
   Reports).
8. **Un extracto de Santander de muestra** (anonimizado) para fijar el formato del
   importador. Santander Argentina no tiene API pública: se resuelve importando.

**Decisiones de negocio pendientes**
9. Cerrar el **ADR 0019** (la política de cancelación se calcula y nunca se cobra).
10. Confirmar el **inventario físico real** y la **tarifa rack de cabañas**.

---

## 10. Lo que NO se hizo en esta auditoría

Para que quede explícito y no se lea como más de lo que es:

- **No se modificó ningún archivo del sistema.** Este documento es el único agregado.
- **No se corrió la suite.** Los conteos de tests salen de contar archivos y de la
  corrida anterior (1617/98, verificada el 2026-09-01).
- **No se auditaron las ~90 políticas RLS de escritura** una por una; la matriz de
  lectura sí es exhaustiva (trabajo de la auditoría anterior).
- **No se verificó nada contra la base hosted** — no hay `.env.local` en este entorno.
  Todo lo verificado contra base es contra la local.
- **No se revisaron** los flujos de contratos/firmas ni el asistente del portal.
- Sigue abierto el riesgo mayor de la auditoría anterior: **el sistema nunca corrió en
  producción**. Latencia real, límites de conexión, un pago por una pasarela viva, un
  CAE real y **restaurar un backup** siguen sin ejercitarse.
