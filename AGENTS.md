<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AGENTS.md — Blanca Patagonia

> Operativo: comandos, arquitectura, convenciones y Definition of Done.
> El **proceso** de trabajo (fases, bitácora, ADRs) vive en `CLAUDE.md`. Leé los dos.
> Procedimientos paso a paso: `.claude/skills/`.

## Qué es este proyecto

PMS (sistema de gestión hotelera) del Hotel Blanca Patagonia, El Calafate. Proyecto de tesis.
Dos vistas separadas: **panel interno** de staff por rol (`app/panel`) y **portal público** de
reservas (`app/reservar`, `app/alojamientos`). El flujo central es reserva → estadía → consumos
→ pago → factura, con anti-overbooking garantizado por la base, no por la app.

## Setup y comandos

| Acción | Comando | Estado |
|---|---|---|
| Puesta en marcha | `npm run setup` | verificado — dice qué falta y cómo resolverlo |
| Dev | `npm run dev` | — |
| **Verificación completa** | **`npm run check`** (lint + typecheck + tests + build) | verificado, exit 0 |
| Lint | `npm run lint` | verificado, exit 0 |
| Typecheck | `npm run typecheck` | verificado, exit 0 |
| Tests | `npm test` — uno solo: `npm test -- <patrón>` | verificado, **1446 pasan / 0 saltean** con base y las 3 variables |
| Build | `npm run build` | verificado, 21 s |
| Sembrar usuarios | `npm run seed:usuarios` | requiere Node ≥ 20.12 |
| Base local | `npx supabase start` · `npx supabase db reset` | necesita Docker |
| Salud del sistema | `GET /api/salud` | 200 si la base responde, 503 si no |

**Antes de decir que terminaste, corré `npm run check`. Sin excepciones.**

## Arquitectura en 20 líneas

```
app/rutas ──124──> app/panel/_components (UI compartida)
          ──100──> lib/domain          (reglas puras)
          ───89──> lib/{auth,pricing,payments,email,firma,facturacion,availability,canales,divisas}
          ───60──> lib/supabase        ← puentea la capa de datos (deuda conocida)
lib/servicios ──> lib/domain ──> lib/fechas
lib/supabase ──> Postgres + RLS (90 políticas sobre 43 tablas)
```

Reglas de dependencia, verificables con `rg`:

- **`lib/domain/` es puro.** No importa `@supabase/*`, `next/*`, `react` ni `zod`. Son 50 módulos de
  reglas testeables sin base. **Nunca** metas un cliente de datos ahí.
- **`lib/` nunca importa de `app/`.** Cero excepciones (hoy hay cero aristas).
- La lógica de negocio va en `lib/domain/`. Las páginas y acciones orquestan; no calculan reglas.
- `lib/supabase/admin.ts` usa `service_role` y saltea RLS: **solo servidor**, nunca con datos del
  usuario sin filtrar.

## Convenciones de código

| Tema | Regla | Referencia canónica |
|---|---|---|
| Idioma | Código y docs en **español** (identificadores incluidos) | `lib/domain/cancelacion.ts` |
| Autorización | `requerirAcceso(area)` en toda página y acción del panel | `lib/auth/session.ts:50` |
| Escrituras que cortan | `cortarSiFalla(error, destino, motivo)` | `lib/acciones.ts:43` |
| Escrituras accesorias | `registrarFalla(error, contexto)` — loguea, no corta | `lib/acciones.ts:71` |
| Server Action con estado | `(prev, formData) => Promise<EstadoX>` con `{ error }` / `{ ok }` | `app/panel/huespedes/actions.ts:67` |
| Después de escribir | `revalidatePath(...)`; no redirigir en silencio | `app/panel/huespedes/actions.ts:92` |
| UI | Componentes de `app/panel/_components/ui.tsx` y `boton-envio.tsx` | `app/panel/proveedores/page.tsx` |
| Tests | `describe`/`it` en español, sin mocks en dominio | `tests/cancelacion.test.ts` |

**Nunca revises `{ data }` sin revisar `{ error }`.** Es el bug clásico de este stack y `lib/acciones.ts`
existe precisamente para eso.

## Cómo se agrega algo nuevo

Cada receta está en un skill. Invocalos: `add-feature`, `api-endpoint`, `ui-component`,
`db-migration`, `write-tests`.

Regla corta de módulo del panel: `page.tsx` (listado) · `nuevo/page.tsx` · `[id]/page.tsx` ·
`[id]/editar/page.tsx` · `actions.ts` · `loading.tsx` · test en `tests/`.

**Un área nueva del panel se toca en cinco lugares, y cuatro tienen que moverse JUNTOS** o el
typecheck falla (`Area` es una unión de tipos y `NAV` un `Record<Area, …>`):

1. `lib/domain/permisos.ts` — `AREAS`, `ETIQUETAS_AREA` y los roles en `PERMISOS`
2. `lib/domain/navegacion.ts` — el grupo del menú (hay un test que verifica cobertura)
3. `app/panel/_components/shell.tsx` — la ruta y el icono
4. `lib/domain/ayuda.ts` — el capítulo (`CLAUDE.md` lo exige)
5. `app/panel/_components/iconos.tsx` si el icono es nuevo

Ejemplos recientes: `canales`, `punto_venta` y `respaldos`.

## Testing

- Dominio puro en `tests/*.test.ts`, sin base ni mocks. Server Actions en `tests/acciones/`.
- Los que tocan Postgres van bajo `describe.skipIf(!hayDB)` (`tests/db.ts`).
- **Trampa:** `npm test` sale verde con **43 tests salteados** si no hay base local — entre ellos
  el anti-overbooking. En CI `EXIGIR_DB=1` los vuelve obligatorios (`tests/db.ts:22`).
- **Segunda trampa, la que `EXIGIR_DB` NO cubre:** esa guarda mira `hayDB`, no `hayAnon`
  (`tests/db.ts:40`). Vitest no lee `.env.local`, así que sin exportar
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` los **4 tests del borde público (ADR 0016) saltean en
  silencio** aun con `EXIGIR_DB=1`. Localmente hay que exportar las tres variables:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. En CI ya se
  exportan (`ci.yml:72`).
- Todo bugfix entra con un test que fallaba antes del fix.

## Definition of Done

- [ ] `npm run check` en verde
- [ ] Test que cubre el cambio (y que fallaba antes, si es bugfix)
- [ ] Toda página y acción nueva verifica rol con `requerirAcceso`
- [ ] Todo `{ error }` de Supabase revisado, no descartado
- [ ] Estados de loading / vacío / error cubiertos si tocaste UI
- [ ] Sin `console.log` de depuración, sin `TODO` sin issue, sin código comentado
- [ ] Sin secretos ni datos hardcodeados
- [ ] `docs/bitacora.md` actualizada; ADR nuevo si hubo decisión de arquitectura

## Reglas duras (NUNCA)

- No commitees `.env.local` ni ningún secreto.
- No edites el bloque entre `BEGIN:nextjs-agent-rules` y `END:nextjs-agent-rules`: lo genera Next.
- No edites una migración ya aplicada. Creá la siguiente con el número que sigue.
- No pongas `alter type ... add value` y el primer uso de ese valor en el **mismo** archivo de
  migración: el CLI envuelve cada uno en una transacción y Postgres corta con SQLSTATE 55P04
  («unsafe use of new value»). El `db reset` falla ahí y no aplica nada de lo que sigue. Van en
  dos migraciones (ver `0032` + `0035`).
- No hagas `git push --force` ni trabajes directo sobre `main`.
- No corras `npx supabase db reset` sin avisar: **borra los usuarios de auth**.
- No hagas `cotizar_estadia` `security definer`: ahí `current_user` pasa a ser el dueño de la
  función y la guarda del precio neto queda siempre en verdadero (ADR 0016).
- No borres ni saltees tests para que pase el build.
- No desactives reglas del linter para "arreglar" un error: arreglá el código.
- No agregues dependencias sin avisar.
- No uses `any`, `as any` ni `@ts-ignore` sin un comentario que lo justifique.
- Commit y push **solo** cuando el usuario lo pida (`CLAUDE.md`).

## Trampas conocidas

- **Next 16:** `cookies()` y `headers()` son `async`; `params` y `searchParams` son `Promise`;
  `middleware` se llama `proxy.ts`. Leé `node_modules/next/dist/docs/` antes de tocar APIs de Next.
- **`next typegen`** genera tipos de rutas: `npm run typecheck` los regenera, no los edites.
- **CI:** el seed invoca `node scripts/seed-usuarios.mjs` **directo**, no `npm run seed:usuarios`
  (ese usa `--env-file-if-exists`, que no aplica en el runner). Sin ese paso `perfiles` queda vacía
  y los tests de facturación fallan por la FK.
- **Rol hardcodeado:** hay 21 lugares con el literal `['admin','gerencia']` en vez de
  `lib/domain/permisos.ts`. Al tocar uno, migralo a `puedeAcceder(rol, area)` — es lo que hicieron
  las acciones de la modernización WinPAX, así que hay ejemplos en
  `app/panel/{canales,punto-venta}/actions.ts`.
- **`lib/env.ts`** dice que falla "al arrancar", pero `envPublico()`/`envServidor()` son perezosas y
  no validan `MERCADOPAGO_*`, `STRIPE_*` ni `RESEND_API_KEY`.
- **PostgREST corta en 1000 filas** (`max_rows`, `supabase/config.toml:10`), sin error y sin aviso.
  Toda lectura que agregue sobre una tabla entera tiene que ir por `traerTodo` (`lib/paginado.ts`).
- **Los simuladores fallan fuerte en producción:** `EMAIL_PROVIDER`, `FIRMA_PROVIDER`,
  `FACTURACION_PROVIDER`, `COTIZACION_PROVIDER` y `CANAL_PROVIDER` son obligatorias ahí
  (`lib/integraciones/seleccion.ts`, ADR 0018).
- **`estadias.check_in` / `check_out` son columnas GENERADAS** desde `periodo` (migración 0037). No
  se pueden escribir, y eso es la garantía de que no se desincronizan. Existen porque PostgREST no
  expone `lower()`: sin ellas, «las que llegan hoy» había que escribirlo con operadores de rango
  negados (`periodo=nxl.[hoy,hoy] & periodo=not.nxl.[mañana,mañana]`), donde un signo cambiado da un
  resultado plausible y equivocado.
- **Un filtro sobre tabla embebida solo acota la fila madre si el embed es `!inner`.** Con un embed
  normal, PostgREST devuelve **todas** las filas madre con el array vacío: un filtro que no filtra y
  no falla. Es la trampa más silenciosa de este stack (ver `SELECT_RESERVAS` en
  `app/panel/reservas/consulta.ts` y el test que la detecta).
- **`crear_reserva` deriva `estadias.huespedes` del desglose** (`adultos + menores`; los bebés no
  cuentan). No hay `check` que lo garantice, a propósito: habría roto los `update` de mudanza (0028)
  y reprogramación. Es el **único** lugar donde nacen estadías, así que la coherencia se garantiza
  ahí. Si agregás otro camino de alta, replicá la derivación.
- **La numeración de comandas es una secuencia y admite huecos** (`comandas_numero_seq`). Es lo
  contrario de `puntos_venta.ultimo_numero`, que **no puede tenerlos** por exigencia fiscal. No
  intercambiar los mecanismos.
- **`departamentos` tiene jerarquía de dos niveles, con trigger que rechaza el tercero.** Un árbol
  arbitrario pediría consultas recursivas en la cuenta del huésped y el hotel no lo necesita.
- **La app no puede hacer backups de Postgres.** `/panel/respaldos` exporta datos operativos y lo
  aclara. No convertirlo en un botón que diga «hacer backup»: sería la peor función del sistema.
- **`rangoISO(hoy, hoy)` es un rango VACÍO** (`[hoy,hoy)`) y no se solapa con nada. «La noche de hoy» se escribe `rangoISO(hoy, sumarDias(hoy, 1))`. El punto de venta salía siempre en cero por esto y decía «no hay nadie alojado hoy».
- **PostgREST NO sigue una clave foránea auto-referencial hacia el padre.** Un embed anidado como `departamento:departamentos(nombre, padre:departamentos(nombre))` devuelve `"padre": []` —los hijos, no el padre— y las pistas de FK no lo corrigen. La jerarquía se resuelve en la app con `lib/domain/departamentos.ts`.
- **Los importes van por `formatearUSD`/`importe` de `lib/domain/moneda.ts`, nunca por `toLocaleString`.** Éste usa entre 0 y 3 decimales, así que una misma columna publica «USD 726», «USD 290,4» y «USD 40,11»: el segundo parece un número cortado. Ya se migraron los 67 del panel; las cantidades (filas, puntos) sí van con `toLocaleString`.
- **`[auth.email].enable_signup` NO es «no dejes que se registren»: es «habilitá el proveedor de
  email».** En `false` desactiva **también el inicio de sesión con contraseña**, que es el único
  camino de acceso del staff (`app/login/actions.ts` usa `signInWithPassword`), o sea que nadie
  entra al panel. Quien cierra el auto-registro es `[auth].enable_signup = false`. Y no se nota en
  local: un contenedor que ya está corriendo conserva la configuración con la que arrancó, así que
  el síntoma aparece recién en un entorno nuevo — lo destapó el CI. `tests/auth-config.test.ts`
  fija las dos garantías juntas.
- **El feed iCal de salida marca ocupado sólo cuando NO queda ninguna unidad del tipo libre.** Un
  calendario dice «ocupado», no «me queda una»: cerrar el tipo al vender la primera unidad le
  costaría ventas reales al hotel. Y si la consulta de estadías se trunca, el handler responde
  **503 en vez de servir un calendario parcial** — uno incompleto no se ve roto, se ve como uno con
  menos bloqueos, o sea publicando como libres noches llenas (ADR 0022).
- **Booking es de solo lectura y NO evita el overbooking.** `capacidades()` lo declara y
  `ResultadoEnvio.noSoportado` distingue «no puedo» de «fallé». No borrar esas advertencias (ADR 0021).
- **NUNCA agregues una columna que pueda guardar datos de tarjeta** (`tarjeta_numero`, `pan`,
  `cvv`, `codigo_seguridad`, `pin`…). Saca al hotel del alcance SAQ-A de PCI-DSS. Hay un
  **test-contrato** que recorre las migraciones y falla si aparece una (`tests/garantia-tarjeta.test.ts`),
  más restricciones en la `0059` que rechazan 12+ dígitos seguidos en el token y en el detalle.
  Se resuelve con preautorización tokenizada (ADR 0025).
- **La exención de IVA NO se tilda, se deriva.** No existe ni debe existir un campo «exento»:
  sale de `huespedes.residente_exterior` + `reservas.pago_desde_exterior` vía `exentoDeIva()`
  (ADR 0024). Un extranjero que paga en efectivo **no está exento**, y ése es el error caro.
  En la factura, `exento` es un **subconjunto de `neto`**, no un sumando: así `neto + iva = total`
  sigue siendo cierto.
- **`create type` sí puede usarse en la misma migración que lo crea.** La regla del SQLSTATE
  55P04 —la que obligó a dividir la `0032`— aplica solo a `alter type ... add value` sobre un
  enum **ya existente**. La `0059` crea un enum y lo usa en el mismo archivo, y aplica bien.
- **Un `revoke select (columna)` NO recorta un `grant` de tabla previo.** Postgres lo acepta sin
  error pero no tiene efecto: el GRANT de tabla (`relacl`) y el de columna (`attacl`) son
  catálogos distintos. La `0034` intentó eso sobre `firmas.token` y el privilegio sigue ahí
  (verificable con `has_column_privilege`). Para que surta efecto hay que revocar el de tabla y
  reponer por columna — y eso rompe a quien lea esa columna con el cliente del usuario.
- **Un token de socio NO se lee con el cliente del usuario.** `agencias.token`,
  `proveedores.token` y `firmas.token` tienen el `select` revocado por columna
  (migración 0060). Para mostrarlos hay que usar `crearClienteAdmin()`. Antes cualquier
  rol —housekeeping incluido— podía leerlos, y con ellos abrir `/portal/<token>` y firmar
  un contrato en nombre del socio.
- **No se borran reservas, estadías, pagos, agencias, proveedores, tarifas ni perfiles.**
  `authenticated` no tiene `delete` sobre esas tablas (migración 0061): el camino es la
  máquina de estados o la baja lógica (`activo`). Los borrados que la UI sí usa —consumos,
  huéspedes, avisos, rangos de temporada, mapeos— siguen habilitados y auditados.
- **Contar filas es `count: 'exact', head: true`, nunca traerlas.** PostgREST corta en
  1000 (`max_rows`) con **HTTP 200 y sin aviso**: contar en JavaScript da un número
  equivocado a partir de la fila 1001 y nada falla. Hay un test que lo demuestra
  (`tests/truncado-mil-filas.test.ts`).
- **La cuenta se cierra con la FACTURA, no con el check-out** (`motivoNoCargable`, ADR/P3). Es lo
  que permite cobrarle el desayuno al que llegó a las 9 y al que se va a las 10.
- **`truncate` no achica: agranda el ancho MÍNIMO.** Incluye `white-space: nowrap`, así que el
  min-content de ese elemento pasa a ser la línea entera. Si algún ancestro es ítem de grilla o de
  flex —o sea `min-width: auto`— la caja se estira hasta que la línea entre, y el `truncate` no se
  activa nunca: en el hub un apellido compuesto daba 515 px de mínimo y estiraba la tarjeta a 557
  dentro de una pantalla de 320. `Tarjeta` ya trae `min-w-0`; si armás un contenedor a mano,
  ponéselo. Lo mismo con un `<select>`: `w-full` **no** alcanza, porque `min-width: auto` lo ancla
  a su opción más ancha.
- **Una celda `sticky` dentro de un contenedor con scroll se escapa del recorte.** Extiende la
  región scrolleable de sus ancestros y hace que la PÁGINA arrastre de lado hacia espacio vacío —no
  se ve nada cortado, así que es difícil de atribuir—. Verificado que no lo frenan `overflow-x:
  hidden` en el `main`, ni sacar el `whitespace-nowrap`, ni el `max-width`, ni `table-layout: fixed`.
  Se resuelve con `contain-paint` en el scrollport (ver la grilla de `ocupacion`).
- **`overflow-x: auto` convierte al elemento en scrollport de los DOS ejes** (el `overflow-y`
  computa a `auto`). Un `sticky bottom-0` adentro se ancla a ese scrollport, no a la ventana; y si
  el div no tiene altura acotada su `scrollTop` es siempre 0 y el sticky no hace nada. El `tfoot` de
  la grilla de ocupación tenía un comentario afirmando que se pegaba, y no se pegaba.
- **Una tabla en dos columnas puede ser MÁS ALTA que en una.** La grilla alinea por fila: cada fila
  queda tan alta como su celda más alta, y con textos desparejos se desperdicia más de lo que se
  ahorra. Pasó al compactar Ayuda: el primer intento empeoró el tramo de 1024 px un 10 %. Para
  tarjetas de alturas dispares va `columns` (que equilibra sola), y conviene **medir** las variantes
  antes de elegir.
- **`pagos.monto` está SIEMPRE en USD, sin importar en qué moneda se cobró.** `resumenPagos`
  suma esa columna para decidir si la reserva quedó saldada y **no mira la moneda**: un cobro de
  ARS 350.000 guardado ahí se sumaría como si fueran dólares y el huésped se iría sin pagar. Lo
  que de verdad pasó por la pasarela va en `monto_cobrado` + `moneda` + `cotizacion`, y la
  migración 0067 tiene los `check` que lo obligan (ADR 0027).
- **La cotización se congela al crear el link, no al confirmar el pago.** Recalcularla movería el
  saldo de una reserva con el dólar del día siguiente, y no habría forma de explicar de dónde
  salió el importe en dólares que la saldó.
- **`pendiente → pagada` NO es una transición válida:** hay que pasar por `confirmada`. Una
  reserva de la web nace `pendiente`, así que el salto directo se descartaba en silencio, la
  reserva quedaba pendiente, la expiración liberaba la unidad a los 5 días y el hotel la revendía
  **con la plata ya cobrada**. Va por `caminoDeEstados` + `estadoSegunPagos`, nunca con un
  `update` de estado a mano.
- **`rechazado` NO es un estado final de un pago.** Una pasarela real crea varios intentos bajo la
  misma referencia externa: la tarjeta se rechaza por fondos, el huésped pone otra y aprueba. Si
  el rechazo trabara la fila, la reserva no se saldaría nunca con la plata cobrada. Terminales son
  `aprobado` y `reembolsado`.
- **Stripe cuenta en centavos y MercadoPago firma un manifiesto.** Mandarle `145.2` a Stripe cobra
  un dólar cuarenta y cinco **sin ningún error**; firmar el cuerpo crudo para MercadoPago —en vez
  de `id:…;request-id:…;ts:…;`— rechaza todos los eventos y el síntoma es «el hotel dejó de
  enterarse de los pagos». Los dos casos tienen test (`tests/pasarelas-reales.test.ts`).
- **Un webhook que responde 400 a un evento que no le interesa termina deshabilitado.** Stripe y
  MercadoPago mandan decenas de tipos de evento; acumulan fallos y cortan el endpoint, y ahí se
  pierden también los cobros buenos. Por eso `ResultadoWebhook` distingue `ignorar` (200),
  `invalido` (400) y `reintentar` (500).
- **El límite de tasa del webhook de pagos se cuenta DESPUÉS de rechazar la firma, nunca antes.**
  Cada evento descartado por volumen es un cobro del que el hotel no se entera.
- **La URL de retorno de una pasarela no es prueba de pago:** se puede abrir a mano sin haber
  pagado. Quien confirma es el webhook; la pantalla de confirmación lee el estado de la base.
- **`npm run check` devuelve 0 con tests en rojo** si no hay `.env.local`: tres archivos fallan por
  falta de `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y el exit code igual da 0. Es la misma trampa
  que `tests/db.ts` documenta querer evitar, pero el guardián (`EXIGIR_DB=1`) no está en ese script.
  **Leé la salida, no el exit code**, o exportá las tres variables antes.

## Automatizaciones (hooks activos)

Configurados en `.claude/settings.json`, documentados en `.claude/hooks/README.md`:

| Evento | Qué hace |
|---|---|
| `PreToolUse` Write/Edit | Bloquea escrituras sobre `.env*`, lockfiles, autogenerados y migraciones ya aplicadas |
| `PreToolUse` Write/Edit | Bloquea contenido con secretos hardcodeados |
| `PreToolUse` Bash | Bloquea `rm -rf`, `push --force`, `db reset`, `reset --hard` |
| `PostToolUse` Write/Edit | Corre `eslint --fix` sobre el archivo tocado |
| `Stop` | Corre los tests y avisa cuántos se saltearon |
| `SessionStart` | Muestra rama, estado de git y migración más reciente |

## Qué corre en GitHub

Workflows en `.github/workflows/`. Los tres son verificables desde la pestaña Actions:

| Workflow | Cuándo | Qué verifica |
|---|---|---|
| `ci.yml` | Push a cualquier rama (menos las de Dependabot, que ya corren por su PR) y en cada PR | `npm audit`, typecheck, lint, la suite completa con `EXIGIR_DB=1` y el build, contra Postgres en Docker |
| `codeql.yml` | Push a `main`, PRs y los lunes | Análisis estático de seguridad del código propio. Corre con `build-mode: none`: **no necesita Docker ni Supabase** (ADR 0028) |
| `dependency-review.yml` | En cada PR | Falla si el PR **agrega** una dependencia con vulnerabilidad alta o crítica |

Parte de la seguridad del repositorio **no vive en el código**: las alertas de
Dependabot, el escaneo de secretos y el reporte privado de vulnerabilidades son
casillas de la web de GitHub. Estado y cómo se activan: `docs/github.md`. No las
des por hechas al escribir documentación.
