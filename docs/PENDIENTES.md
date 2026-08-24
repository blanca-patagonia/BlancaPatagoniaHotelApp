# Pendientes

> Estado al cerrar la rama `feat/relevamiento-cliente-agosto`.
> **Tests verdes, cero salteados.** Lint, typecheck y build en verde.
> Migraciones hasta la **0059**.

Este archivo reemplaza a `docs/audit/00-pendientes.md` y `docs/audit/HANDOFF.md`, que
quedaron congelados el 2026-08-14 y no incorporan nada del trabajo posterior.

---

## 1. Lo que falta del bloque Booking

El plan completo está en `~/.claude/plans/peaceful-bubbling-yeti.md` y las decisiones en
los ADRs 0021 y 0023. De los diez pasos hay **cinco hechos** (B1, B2, B4, B5, B6).

### B9 · Reportes: neto de comisión y costo por canal
Los datos ya están en `canal_cargos`; falta la pantalla que responda *cuánto me dejó
Booking neto*. Vista `resumen_canal_mes` con `security_invoker` —es lo que pide el
comentario de `app/panel/reportes/page.tsx:194`— más `lib/domain/metricas-canal.ts` puro.

> ⚠️ **El error fácil, que hay que dejar escrito en la pantalla:**
> `tarifa_tipo = 'neto'` es un **tipo de tarifa** (agencia vs mostrador), **no**
> «importe ya sin comisión». Neto de comisión = total − comisión. Restársela a un total
> que alguien creyó ya neto da un número más bajo y **no falla**: se publica como si
> estuviera bien.

Y dos honestidades obligatorias: si no había cotización al importar, `monto_usd` queda
nulo y el reporte tiene que **contar cuántas filas no pudo convertir** en vez de sumar
cero; y para `directo`/`web` el costo de adquisición se muestra `—`, **nunca `USD 0`**
—hay Google Ads y tiempo de mostrador, pero el sistema no los conoce—.

### ~~B8 · Programación de la sincronización~~ ✅ HECHO (PR #14)
`app/api/cron/canales/route.ts` + `vercel.json` (`0 6 * * *`) + `CRON_SECRET`.
El cron **aterriza, no importa**. Si `CRON_SECRET` falta, el handler rechaza; la
cabecera `x-vercel-cron` no se usa como autenticación. Documentado en
`docs/sincronizacion-automatica.md`, con la trampa del plan Hobby (una corrida
por día, no cada tres horas) y GitHub Actions como plan B.

### B7 · Feed iCal propio de salida + ADR 0022
El `ical_token` ya está en `canal_config` (migración 0049). Falta
`lib/canales/ical-saliente.ts` y `app/api/canales/ical/[token]/route.ts`.

Qué mitiga: Booking, Airbnb y Expedia pueden **importar** un iCal de bloqueos, así el
hotel deja de cerrar fechas a mano. Qué **no** mitiga, y va escrito en la pantalla:
la latencia de refresco (angosta la ventana, no la cierra), la granularidad (el iCal
expresa «ocupado», no cupo: con tres unidades del mismo tipo no se puede bloquear una
sola) y que no hay acuse de recibo.

`capacidades().publicaDisponibilidad` **sigue en `false`** y la advertencia de
overbooking **se matiza, no se borra**.

⚠️ Depende de que el extranet del hotel permita importar un calendario, que varía según
cómo esté configurada la propiedad. **Verificar antes de prometerlo.**

Seguridad del handler: token largo en la URL, `SUMMARY` genérico `"Ocupado"` —**nunca**
nombre del huésped ni código de reserva—, `no-store`, límite de tasa, y nada de precios
(ADR 0016). Test-contrato: el cuerpo no contiene ningún dato personal.

### B3 · Importador general (refactor)
Sin valor visible por sí solo: paga cuando haya más tipos de informe. Extraer lo genérico
de `csv.ts` a `lib/canales/tabla.ts` (y **re-exportar** desde `csv.ts`), `registrarCorrida`
de `guardarEntrantes`, y el contrato `LectorInforme`.

> **Criterio de terminado: los tests existentes pasan sin editar una línea.** Si hay que
> tocar un test, el refactor cambió comportamiento y se revisa el código, no el test.

### ~~B10 · Documentación~~ ✅ HECHO
`README`, `docs/roadmap.md`, `docs/modelo-datos.md` y `docs/manual-usuario.md`
actualizados contra el estado real del repo (números verificados ejecutando, no
copiados). El manual cubre el flujo de canales: bajar el informe, mapear
columnas, conciliar la factura e importar reseñas.

---

## 2. P1 abiertos

| Qué | Dónde | Por qué importa |
|---|---|---|
| **Los tokens de firma y de portal no caducan ni se revocan** | `firmas.token`, `agencias.token`, `proveedores.token` | Dar de baja una agencia **no le cierra el portal**. Un token filtrado sirve para siempre. |
| Trigger de stock y `cambiar_unidad_reserva` como `SECURITY INVOKER` | migraciones 0028 y la de stock | Mismo defecto que la 0033 ya corrigió en la numeración de comprobantes. |
| Seis listados del panel no paginan | varios `page.tsx` | PostgREST corta en 1000 filas **sin avisar** (`traerTodo` de `lib/paginado.ts`). |
| El portal del socio lee `firmas` **entera** con `service_role` en cada carga | `app/portal/[token]/page.tsx` | Lectura sin filtrar de una tabla que crece. |
| No hay «olvidé mi contraseña» | `app/login` | Quien pierde la clave necesita a un admin. |
| Emitir factura en **una sola transacción SQL** | `app/panel/reservas/actions.ts` | El perdedor de una carrera gasta un número correlativo y pide un CAE sin fila: con AFIP real es un **salto de numeración**, que es obligación formal (ADR 0015). El test de concurrencia ya monta la carrera; falta afirmar que no hay salto. |

---

## 3. Auditoría

- **Los 29 tests de Server Actions corren con la autorización mockeada.**
  `tests/acciones/entorno.ts` reemplaza `requerirAcceso` por un admin fijo, así que
  verifican la lógica de negocio y **no** la guarda que más importa.
- **La matriz de escritura RLS es dirigida, no exhaustiva.** `tests/rls-escritura-por-rol.test.ts`
  cubre 19 casos elegidos por consecuencia (escalada de privilegio, dinero, inventario,
  borde público). Lo que no está, no está auditado — y el archivo lo dice.
  La de **lectura** sí es exhaustiva: 40 tablas × 4 roles, con la lista traída de la base
  para que una tabla nueva sin declarar haga fallar el test.

---

## 4. Diferido (P2)

Ninguno cuesta plata hoy, todos son «lo que un sistema serio necesita»:

1. **79% del código en `app/`** — 190 llamadas `.from()` en 56 archivos de rutas contra 5 en `lib/`.
2. `lib/domain/permisos.ts` no gobierna las escrituras: quedan lugares con el literal `['admin','gerencia']`.
3. `lib/env.ts` es perezoso y no valida `MERCADOPAGO_*`, `STRIPE_*` ni `RESEND_API_KEY`.
4. Sin logging estructurado con correlation ID — hoy son `console.error` sueltos.
5. Sin captura de errores en producción (Sentry o equivalente).
6. Sin tests E2E ni de componentes.
7. Sin `npm audit` en CI, sin Dependabot/Renovate.
8. Sin Prettier ni pre-commit; sin migraciones reversibles; sin backup restaurado y probado.

**Diseño — fases D–F del portal público** (7 items, sin especificar en ningún doc):
filtros laterales, galería con lightbox, barra sticky de reserva, señales de confianza y
mapa en SVG propio, desglose de precio en el checkout, la insignia de escasez completa
(necesita migración: `unidades` no es legible por el rol público) y el layout de dos
columnas en «Nueva reserva».

---

## 4 bis. Del relevamiento del 15/08/2026 — lo que queda

**Hecho:** P6 (documentación), P1 (exención de IVA, ADR 0024), P4 (fuente de la
cotización declarada), P3 (desayuno suelto contado por la cocina), P2 (garantía
de tarjeta tokenizada, ADR 0025).

**P5 · Booking: bandeja, comentarios y analytics — DIFERIDO POR EL CLIENTE.**
No arrancar sin confirmarlo con él. Las tablas `canal_mensajes` y `canal_resenas`
ya existen (migración 0038) y hoy se cargan a mano. Lo primero a resolver **no es
código** sino una pregunta: ¿qué de todo eso se puede obtener sin API de partner?
Verificar qué exporta realmente el extranet antes de prometer nada.

**Preguntas abiertas que condicionan lo entregado** (ninguna bloquea, las dos
funciones andan con supuestos declarados en su ADR):

| Pregunta | A qué afecta |
|---|---|
| ¿Facturan sin IVA a los extranjeros, o cobran y tramitan reintegro? | ADR 0024. El modelo soporta lo primero, que es lo que prevé la norma |
| ¿Qué le piden al huésped para aplicar la exención? | Hoy se registra lo que recepción declara; el sistema no verifica el origen del pago |
| ¿Tienen pasarela contratada? | ADR 0025. Sin pasarela la verificación de tarjeta responde `no_soportado` y lo dice en pantalla |
| ¿La garantía es para cobrar no-shows o solo para «tener algo anotado»? | Si es lo segundo, con los últimos 4 dígitos alcanza |
| El desayuno extra, ¿lleva IVA? ¿USD 15 fijo? | Hoy es un producto más del catálogo, gravado como cualquier consumo |

## 5. Acción del usuario — 11 items que el código no puede resolver

### 🔴 Crítico, si el proyecto está desplegado
**Apagar el auto-registro en el Supabase hosted** — *Authentication → Providers*.
`config.toml` solo cubre el entorno local; en la nube el registro abierto viene
habilitado por defecto. Con eso, cualquiera se crea una cuenta.

### Decisiones de negocio
- **Cerrar el ADR 0019**: la política de cancelación se calcula, se le anuncia al huésped
  y **nunca se cobra**. Es riesgo comercial, no técnico. (Ya tiene el dato que le
  faltaba: `reservas.garantia` dice si hay de dónde cobrar un no-show.)
- Revisar si `agencias/registrarMovimiento` debería ser del área `agencias` completa
  —que incluye recepción— en vez de admin/gerencia.

### Datos del hotel
- **Si se vende el invierno.** Junio–agosto no tiene temporada cargada y el sistema no
  cotiza esas fechas, **por diseño y no por error**. (Un test de esta rama falló por esto
  y lo reconfirmó.)
- La **tarifa rack de las cabañas**: hoy es igual al neto, así que ninguna agencia con
  convenio recibe descuento ahí.
- Precios y **Semana Santa del ciclo 2026/2027**, cargados como proyección.
- Alcance de una migración de datos de WinPAX: hace falta un export de muestra
  (20 filas anonimizadas) para no inventar un formato.

### Operativo
- **Dar de alta usuarios de staff.** Hoy existe un único usuario, el admin de desarrollo,
  así que los selectores de responsable en Housekeeping y Mantenimiento no tienen a quién
  asignar.
- Abrir el PR de la rama para que corra el CI: el workflow dispara en push a `main` y en
  pull request, no en push a una rama cualquiera.
- **Auditar los perfiles existentes**, por si la base estuvo expuesta antes de cerrar el
  auto-registro.
- **Verificar en el navegador** el formulario de huéspedes con un CUIT inválido.

### Sobre Booking, específicamente
- Copiar del extranet **una URL iCal por habitación** y armar `BOOKING_ICAL_FEEDS`.
- Bajar el informe de reservas y el export de reseñas, y subirlos.
- **Contratar un channel manager** si se quiere evitar el overbooking de verdad
  (~USD 50-150/mes). Es la única solución real y es una decisión del hotel, no del
  código (ADR 0021).

---

## 6. Lo que NO está verificado en el navegador

Ninguna de las pantallas nuevas se abrió visualmente: `/panel` pide sesión y no se
tipean contraseñas en formularios. Están verificadas **por test y por consulta directa a
la base**, y el build compila, pero conviene mirarlas:

- `/panel/canales` — las cinco vistas (entrantes, cobros, costos, mensajes, reseñas)
- `/panel/canales/mapeo` — el mapeo manual de columnas
- El aviso rojo de posible overbooking en el hub de inicio

Para verlas con datos hay una siembra en `scratchpad/demo.sql`.
