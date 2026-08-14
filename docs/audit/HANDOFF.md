# Handoff — continuar la auditoría de Blanca Patagonia

> Pegá este archivo entero como primer mensaje en una sesión nueva de Claude Code.
> Está escrito para que quien lo lea pueda seguir sin haber estado en la sesión anterior.

---

## CONTEXTO

Sos parte de un equipo senior (arquitecto, tech lead, AppSec, QA, SRE, UX) auditando y mejorando
**Blanca Patagonia**, un PMS hotelero de tesis: Next.js 16 (App Router) + React 19 + TypeScript +
Tailwind 4 + Supabase (Postgres + Auth + RLS), zod, vitest. ~25.000 líneas.

**No asumas nada: leé el código real antes de opinar.** Cada afirmación va respaldada con
`archivo:línea`. Si no lo podés verificar ejecutando, decilo como *hipótesis* o *pendiente de
verificación*, nunca como hecho. Esa distinción es lo que mantiene confiable la lista de pendientes.

Documentación y comentarios **en español**. Usá `rg`, `fd`, `bat`; no uses `grep`/`find`/`cat`/`ls`.

---

## ARRANQUE OBLIGATORIO — antes de escribir una línea

1. Leé `docs/audit/00-pendientes.md` (estado completo) y `AGENTS.md` (convenciones y trampas).
2. Leé `CLAUDE.md` — es el documento de proceso del proyecto y tiene reglas que no se negocian.
3. Estado de git: rama, diff sin commitear, migraciones sin aplicar.
4. Corré y pegá la salida cruda de:
   ```bash
   npx supabase db reset
   npm run seed:usuarios
   EXIGIR_DB=1 npm test
   npm run check
   ```
5. Reportá el estado real ANTES de proponer nada.

### REGLA DE BLOQUEO

**No escribas ni una migración más hasta que las tres pendientes (`0032`, `0033`, `0034`) estén
aplicadas y verificadas contra una base real.** SQL sin aplicar es riesgo acumulado, no trabajo
hecho. Si `db reset` falla, arreglar eso ES la tarea.

---

## ESTADO AL CERRAR LA SESIÓN ANTERIOR

| | |
|---|---|
| Rama | `audit/fase-1-seguridad-critica` · **sin commitear** |
| `npm run check` | exit 0 |
| Tests | **443 pasan · 43 salteados** (los de integración; no había Docker) |
| Migraciones escritas y **NO aplicadas** | `0032`, `0033`, `0034` |
| Pendientes | ~30 abiertos de ~97 confirmados |

Se corrieron dos auditorías multi-agente sobre 24 dimensiones: **193 hallazgos brutos → ~97
confirmados** tras verificación adversarial.

---

## LO QUE YA SE HIZO (no rehacer)

### Seguridad
- **Auto-registro público cerrado.** El trigger de alta daba rol `recepcion` activo a cualquiera
  (`0001:13-14`). Migración `0032`: nace `sin_rol` + `activo=false`. ADR 0017.
- **La baja de un usuario ahora revoca acceso.** `rol_actual()` ignoraba `perfiles.activo`, así que
  echar a alguien no le quitaba nada en la base. Migración `0033`.
- **La facturación estaba rota**: `siguiente_numero_comprobante` corría como INVOKER sobre una tabla
  cuyo UPDATE la misma migración revocaba. Ninguna factura se podía emitir. Migración `0033`.
- **Tokens de firma fuera del alcance del staff** (los leía housekeeping) y **facturas inmutables**.
  Migración `0034`, más 9 índices en claves foráneas.
- **51 Server Actions verifican rol** (antes 17 no verificaban ninguna). Guarda estructural en
  `tests/autorizacion-acciones.test.ts`: falla nombrando archivo, línea y acción.
- **Firma de webhook real**: era `header === secreto` (un bearer token sin vínculo con el cuerpo).
  Ahora HMAC-SHA256 sobre `timestamp.cuerpo`, comparación en tiempo constante, ventana anti-replay.
- **Inyección en el filtro `.or()`** de huéspedes (el único de 7 sin `patronOr`).
- **Limitador de intentos** ya no se evade rotando `x-forwarded-for`.
- **Los simuladores fallan fuerte en producción** (`lib/integraciones/seleccion.ts`, ADR 0018):
  `FACTURACION_PROVIDER` mal escrita emitía un **CAE inventado** sobre una factura real.

### Datos y dinero
- **Pago aprobado que quedaba `pendiente` para siempre** → la reserva nunca se saldaba con la plata
  cobrada. Regla en `puedeAvanzarEstadoPago`.
- **Cuenta marcada como saldada ignorando los consumos** (el webhook comparaba contra
  `reserva.total`, que es solo alojamiento).
- **Cargo de cancelación con unidades mezcladas**: `reserva.total` con IVA junto a
  `estadias.precio_noche` sin IVA. Corregido con `nochePromedioConIva`.
- **PostgREST cortaba en 1000 filas sin avisar** (`max_rows`): los KPI de reportes mentían y las
  exportaciones CSV salían incompletas. `lib/paginado.ts` + aviso visible en pantalla.
- **El alta pública no validaba capacidad** (`huespedes: 50` en una doble entraba) ni reutilizaba
  huéspedes por email (duplicaba en cada reserva).

### Funcionalidad nueva
- **`/panel/servicio`** — lista de desayuno del día y resumen de consumos vendidos, ambos
  imprimibles. Sin dependencia de PDF: usa el patrón `window.print()` que el proyecto ya tenía.
  Regla de borde en `lib/domain/servicio.ts`: **desayuna quien durmió anoche**, así que el que hace
  check-out hoy entra y el que llega hoy no.
- **Preparación para Booking** — `lib/canales/index.ts` (puerto `CanalVentaProvider` + simulador) y
  `lib/domain/canales.ts` (reglas puras, 19 tests). Fija: OTA va a tarifa **neto**, entra
  **confirmada** (no pendiente, o la expiración la liberaría), guarda contra eventos fuera de orden.
- **`GET /api/salud`**, **`npm run check`**, **`npm run setup`**.

### UX
- `loading.tsx`: de 26 a **45 de 48 páginas**.
- Límites de error: de 1 a **3** (panel, público, raíz). Antes un huésped que fallaba en
  `/firmar/[token]` veía la pantalla cruda de Next.
- **`prefers-reduced-motion` respetado** (había 84 transiciones y no se contemplaba).
- Foco reforzado donde `focus:outline-none` pisaba el `:focus-visible` global.
- Estados vacíos con botón de salida (decían "quitá los filtros" sin dar con qué).

### Infraestructura de calidad (`.claude/`)
`AGENTS.md` (150 líneas, preserva el bloque autogenerado de Next), **10 skills**, **4 subagentes**,
**6 hooks** y **5 slash commands**. Todo verificado ejecutándolo.

> ⚠️ **Los hooks están escritos en Node, no en bash, a propósito.** Corren con PATH mínimo: `rg` y
> `fd` de Homebrew NO existen ahí, y un `rg ... && bloquear` con `rg` ausente **deja pasar todo
> mientras aparenta proteger**. Si tocás un hook, probalo con
> `env PATH="/usr/bin:/bin:$(dirname $(command -v node))"` y verificá el **exit code**, no la salida.

---

## LO QUE FALTA — por prioridad

### P0 — bloqueado hasta tener base real

1. **Aplicar y verificar `0032`, `0033`, `0034`** — una por vez: up, down, up, y comprobar el
   esquema resultante contra lo que cada una dice hacer.
   ⚠️ La `0033` **no tiene `down` limpio**: reescribe `siguiente_numero_comprobante` leyendo su
   propia definición con `pg_get_functiondef`. Revertirla exige guardar la definición previa.
2. **Restricción única sobre `facturas.reserva_id`** (migración `0035`). `emitirFactura` es
   check-then-act: dos emisiones simultáneas generan dos comprobantes fiscales de la misma reserva.
   Exigencia: **test de integración que intente emitir dos y falle a nivel base**, no aplicación.
3. **Los 29 tests de Server Actions siguen desactivando la autorización**
   (`tests/acciones/entorno.ts`: el `vi.mock` reemplaza `requerirAcceso` por un no-op que devuelve
   un admin fijo). Procedimiento: construir factories de usuarios por rol y helper de sesión real
   **antes** de tocar los tests; migrarlos de a uno; y por cada acción agregar el test que falta:
   **usuario sin permiso → la acción rechaza**.
4. **Las ~60 políticas RLS no tienen un solo test.** Es el pendiente que el equipo declaró hace
   fases. Usar `clienteAnonimo()` de `tests/db.ts` para probar qué NO debe ver un desconocido.

### P1 — dinero e integridad

- `crearReservaGrupal` no es atómica y reporta un lote parcial como éxito.
- El correlativo de factura se reserva en transacción propia antes de pedir el CAE: cualquier
  rechazo posterior deja un hueco permanente en la numeración.
- El cargo "primera noche" usa el **promedio**, no la primera noche real. Los precios por noche no
  se persisten (solo el promedio en `estadias.precio_noche`) → requiere cambio de modelo.
- `cambiarEstadoReserva` pisa los puntos de fidelidad en vez de sumarlos si falla la lectura previa.
- Trigger de descuento de stock y `cambiar_unidad_reserva`: **mismo defecto de `SECURITY INVOKER`
  que la `0033` corrigió en numeración**. Revisarlos con ese criterio.

### P1 — seguridad

- Los tokens de firma y de portal **nunca caducan ni se revocan**. Dar de baja a una agencia no le
  cierra el portal. Requiere columna de expiración → migración.
- **No se puede cambiar ni recuperar una contraseña** desde el sistema en marcha.
- Las políticas «staff lee» dan a housekeeping el padrón completo de huéspedes, pagos y facturas,
  que el **propio ADR 0005 declara vedados** para ese rol.

### P1 — rendimiento

- Seis listados del panel no paginan.
- El portal del socio lee la tabla `firmas` **entera** con `service_role` en cada carga.
- Las 48 rutas son dinámicas; el catálogo público podría ser estático o con `revalidate`.

### P2 — arquitectura y faltantes

- **79% del código vive en `app/`.** `lib/domain` está limpio pero subutilizado: 190 llamadas
  `.from()` en 56 archivos de rutas contra 5 en `lib/`.
- **19 lugares con el literal `['admin','gerencia']`** en vez de `lib/domain/permisos.ts`.
- `lib/env.ts` promete fallar "al arrancar" pero sus funciones son perezosas, y no valida
  `MERCADOPAGO_*`, `STRIPE_*` ni `RESEND_API_KEY`.
- Sin logging estructurado con correlation ID, sin Sentry, sin E2E, sin tests de componentes, sin
  `npm audit` en CI, sin Prettier, sin pre-commit hooks, sin migraciones reversibles, sin backup
  restaurado y probado.

### Pendiente de verificación (NO marcar como hecho)

- **Preservación de datos en el formulario de huéspedes.** Se agregó `valores` a `EstadoHuesped`
  siguiendo el patrón de `EstadoNuevaReserva`, pero `defaultValue` solo aplica al montar el input:
  depende del reseteo de formulario de React 19 tras una action. **Comprobar en el navegador**:
  cargar un huésped responsable inscripto con CUIT inválido y ver si los nueve campos siguen llenos.
  Si no funciona, `reservas/nueva` tiene el mismo problema latente desde antes.
- Los otros 7 archivos de acciones (28 retornos de error) siguen perdiendo lo escrito.

---

## REGLAS DE TRABAJO

- **Un lote por vez.** Después de cada uno: `npm run check` + `EXIGIR_DB=1 npm test`, diff resumido,
  commit atómico. Recién ahí seguís.
- **Nada se marca resuelto sin evidencia ejecutada.** "Debería andar" no cuenta.
- Por cada arreglo de seguridad, **un test que reproduzca el ataque** y demuestre que ahora se
  rechaza. El test es la prueba; el arreglo, solo la intención.
- Actualizá `docs/audit/00-pendientes.md` después de cada lote: qué se cerró, con qué commit, con
  qué test se demuestra.
- Si un arreglo destapa un hallazgo nuevo, **agregalo a la lista con su severidad** en vez de
  arreglarlo de paso.
- **Pará y preguntá antes de**: cambiar contratos de API, tocar el modelo de datos más allá de las
  migraciones ya escritas, o cualquier cosa irreversible.
- Commit y push **solo** cuando el usuario lo pida (`CLAUDE.md`).

---

## TAREAS DEL USUARIO (no las puede hacer el agente)

| # | Qué | Por qué |
|---|---|---|
| 1 | **Levantar Docker Desktop** | 3 migraciones sin aplicar. Bloquea todo el P0. |
| 2 | **Apagar el auto-registro en el Supabase hosted** (*Authentication → Providers*) | `config.toml` solo cubre local; el default de la plataforma es habilitado. **Es el único crítico vivo en producción.** |
| 3 | Agregar a `.env.example`: `EMAIL_PROVIDER`, `FIRMA_PROVIDER`, `FACTURACION_PROVIDER` | El harness bloquea editar archivos `.env`. Son obligatorias en producción desde el ADR 0018. |
| 4 | **Completar la decisión del ADR 0019** (`docs/decisiones/0019-*.md`) | La política de cancelación se calcula, se le anuncia al huésped y **nunca se cobra**. Es decisión de producto y de riesgo comercial, no técnica. |
| 5 | **Mandar un export de muestra de Winpax** (20 filas anonimizadas) + definir alcance | Sin el formato real, un importador inventado mete basura en producción. ¿Solo huéspedes? ¿Historial de reservas? ¿Cuentas de agencias? |
| 6 | **Verificar en el navegador** el formulario de huéspedes | Ver "Pendiente de verificación" arriba. |
| 7 | **Revisar una decisión tomada**: en `agencias/registrarMovimiento` se aplicó admin/gerencia y no el área `agencias` de la matriz (que incluye recepción), porque mueve plata en cuenta corriente | Si el criterio va al revés, es una línea. |
| 8 | **Auditar los perfiles existentes** si la base estuvo expuesta | `select p.id, p.nombre, p.rol, p.activo, p.creado_en, u.email from perfiles p join auth.users u on u.id = p.id order by p.creado_en desc;` |

---

## PRIMER PASO SUGERIDO

Corré el arranque obligatorio y reportá el estado real. Si Docker está arriba, empezá por aplicar y
verificar las tres migraciones **una por vez**. Si sigue abajo, decilo y proponé qué se puede
avanzar sin base — pero no escribas SQL nuevo.
