# Pulido integral 2026-10 — brief original de Octi

> Este archivo es una copia textual de las instrucciones que dieron origen a la
> rama `pulido/integral-2026-10`. No se edita el contenido de abajo: si el plan
> cambia, el cambio se anota en `progreso.md` y en `docs/bitacora.md`, no acá.
> Sirve para que cualquier sesión nueva pueda retomar el trabajo fase por fase
> sin depender de que alguien se acuerde el pedido original.

Recibido 2026-10-05/06, en dos mensajes. El primero define las 8 fases
completas; el segundo acota qué se hace en la corrida en curso.

## Mensaje 1 — el plan completo (fases 0 a 7)

> Sos el responsable técnico de dejar este sistema pulido. Trabajás por fases,
> verificás todo en el navegador y con tests, y al final entregás una rama
> lista para revisar. Lo que ya existe funciona y tiene que seguir
> funcionando: esto es pulir, no rehacer. Si dudás entre cambiar algo o
> dejarlo, lo dejás y lo anotás.
>
> ## 0. Antes de tocar nada
>
> 1. Leé enteros CLAUDE.md, AGENTS.md, COMO-LEVANTARLO.md, docs/PENDIENTES.md y
>    docs/analisis-pendientes-2026-09-09.md. Todas sus reglas valen; este
>    prompt no las anula, las ordena.
> 2. En docs/bitacora.md leé la última entrada (2026-09-16) y la sección «Lo
>    que NO se mergeó, y por qué» (entrada del 2026-08-25): explica por qué
>    las ramas viejas no se mergean.
> 3. El repo trae skills (.claude/skills/), comandos (/check, /review, /ship,
>    /plan) y agentes (reviewer, explorer, security-auditor, test-writer)
>    hechos para él. Usalos. Los hooks bloquean comandos destructivos,
>    secretos y la edición de migraciones ya aplicadas: si uno te frena, tenía
>    razón.
> 4. Datos de partida (verificalos, no los asumas): main está en cd8e8f7 con
>    CI verde del 24/9 · 146 archivos de test · 108 migraciones (la próxima es
>    la 0109) · el último ADR es el 0040 (el próximo, 0041) · vitest corre en
>    environment: 'node' y no hay ni un test de componente ni E2E.
>
> ## 1. Qué podés hacer sin preguntar y qué no
>
> Podés:
> - Crear la rama pulido/integral-2026-10 desde main y hacer commits
>   convencionales en español, uno por hallazgo o por lote coherente, con el
>   porqué en el cuerpo. Sin Co-Authored-By ni «Generated with».
> - Pushear esa rama y abrir UN pull request en draft contra main, con la
>   descripción en tres bloques: qué cambió, por qué, cómo probarlo.
> - Correr npx supabase start, npx supabase db reset y npm run seed:usuarios
>   SOLO contra la base local de Docker.
> - Comentar en los issues con evidencia (archivo:línea, nombre del test,
>   captura).
>
> No podés, ni aunque parezca obvio:
> - Mergear a main, hacer push --force, borrar ramas remotas ni cerrar PRs. Lo
>   proponés en el informe y esperás mi OK.
> - Agregar dependencias. Si algo las necesita (por ejemplo React Testing
>   Library para tests de componente), lo dejás propuesto con costo y
>   beneficio.
> - Tocar la base de la nube: ni migraciones, ni datos, ni reservas de prueba
>   desde el navegador. Esa base es la del hotel.
> - Cambiar reglas de negocio: política de cancelación, IVA, neto/rack, qué
>   cuenta como plaza, temporadas. Si un comportamiento te parece un bug de
>   negocio, lo documentás con el dato y seguís.
> - Quitar advertencias que el repo puso a propósito: overbooking en canales
>   (ADR 0021), respaldos que no son backup, simuladores que fallan fuerte en
>   producción (ADR 0018).
>
> ## 2. Entorno y verificación
>
> - El dev server apunta a Supabase en la nube con .env.local. Si falta el
>   archivo, pedímelo antes de la fase de interfaz; mientras tanto hacé todo
>   lo estático.
> - Verificá GET /api/salud y que el esquema de la nube esté al día con las
>   108 migraciones (el issue #73 contaba 0067 contra 83 en su momento). Si la
>   nube está atrasada, una pantalla que dice «no se pudo leer» NO es un bug
>   de código: anotalo y seguí contra la base local.
> - Para navegar y crear datos usá Supabase local: npx supabase start → npx
>   supabase db reset → npm run seed:usuarios, con las cuatro variables que
>   lista AGENTS.md exportadas (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
>   NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL). Los tests van con
>   EXIGIR_DB=1 npm test. Si no hay Docker, decilo en cada informe junto con
>   cuántos tests se saltearon: verde con 43 salteados no es verde, y entre
>   esos está el anti-overbooking.
> - La línea de base se toma ANTES de cambiar nada: npm run check completo,
>   anotando pasan / saltean / fallan. Todo lo que hagas después se compara
>   contra eso.
> - Cada bug entra con un test que falla antes del fix y pasa después. Sin
>   excepción.
> - Para la interfaz usá el navegador de verdad: la configuración panel de
>   .claude/launch.json levanta el dev server en el 3000. Hacé clic, mirá la
>   consola, sacá captura. En la bitácora del 16/9 hay un precedente: 17
>   hallazgos encontrados así que ningún test había visto.
>
> ## 3. Fases
>
> Cada fase termina con npm run check verde, commit, entrada en
> docs/bitacora.md (fecha · fase · qué · por qué · decisiones) y un resumen
> corto para mí. Si una fase encuentra algo que cambia el plan, lo decís y
> seguís con lo que no depende de eso. Podés paralelizar las auditorías de
> lectura con subagentes; las escrituras las hacés vos, en orden.
>
> ### Fase 0 — Línea de base y plan
> - npm run check y los números.
> - Inventario de pantallas: cada ruta de app/panel/**, app/reservar/**,
>   app/alojamientos, app/portal, app/encuesta, app/firmar, con su page.tsx,
>   loading.tsx, actions.ts y si tiene test.
> - Plan de hallazgos priorizados: P0 rompe algo · P1 engaña al usuario o deja
>   datos a medias · P2 pulido. Lo mostrás y seguís sin esperar, salvo por lo
>   que la sección 1 reserva para mi OK.
>
> ### Fase 1 — Ramas y PRs
> main es historia lineal de squashes, así que git log main..rama miente:
> comparás CONTENIDO (git diff main...rama -- <archivo>), no SHAs.
>
> - *Ya absorbidas, no se mergean.* La bitácora lo verificó y mergearlas
>   revertiría trabajo (audit/fase-1-seguridad-critica incluso trae un
>   config.toml que dejaría a todo el staff sin poder entrar):
>   audit/fase-1-seguridad-critica, feat/4-booking-integracion,
>   feat/booking-y-auditoria-rls, historia/detalle-hasta-0057,
>   feat/relevamiento-cliente-agosto, integracion/agosto,
>   fix/panel-nav-y-desbordes, feat/5-ical-saliente, feat/pwa-panel,
>   feat/pwa-panel-instalable. Reconfirmá por contenido que nada útil quedó
>   afuera. Caso puntual: fix/panel-nav-y-desbordes tiene
>   app/panel/_components/plegable.tsx y preferencias.ts, que main reemplazó
>   por lib/domain/nav-plegado.ts y nav-colapso.ts; verificá que la
>   funcionalidad esté cubierta. Después proponé borrarlas.
> - *Con valor sin mergear, rescatar:*
>   - docs/deriva-y-env-incompleto, commit 35f4e6e: dos tests que main no
>     tiene, tests/busqueda-servicio.test.ts y tests/nav-colapso.test.ts. El
>     código que prueban sí está en main (lib/busqueda/servicio.ts,
>     lib/domain/nav-colapso.ts, lib/domain/lateral.ts). Cherry-pick, adaptar,
>     correr.
>   - claude/github-repo-improvements-o2o8qz: docs/wiki/ (12 páginas) y 7
>     agentes en .claude/agents/ que main no tiene. Las plantillas de GitHub
>     ya las trajo el PR #90 y su CODEOWNERS choca con el PR #91: eso se
>     descarta. De la wiki traé solo lo que siga siendo cierto contra el
>     código de hoy; de los agentes, los que aporten algo que los 4 actuales
>     no cubren.
> - *PR #91* (docs/contributing-conducta-codeowners): revisalo. Si el
>   CODEOWNERS apunta a rutas y usuarios reales, recomendá merge.
> - *Dependabot*, uno por uno, cada uno en su rama con npm run check completo.
>   #94 (react + next, 6 paquetes), #55 (zod 4.6.5), #58 (supabase CLI
>   2.117.0), #95 (labeler 7) y #96 (github-script 9) deberían pasar. #56
>   (vitest 5) y #57 (eslint 10) son mayores, y eslint 10 ya se cerró dos
>   veces (#20, #34). Si uno rompe, informá qué rompe y proponé el ignore de
>   ese mayor en .github/dependabot.yml. No agrupes: si uno falla no arrastra
>   a los otros.
> - Entregable: tabla rama → veredicto (absorbida / rescatada / mergear /
>   cerrar) con la evidencia.
>
> ### Fase 2 — Lógica de reservas
> Es el corazón del sistema y donde el pulido vale plata. Mapa:
> - Reglas puras: lib/domain/reservas.ts (máquina de estados: ESTADOS_RESERVA,
>   TRANSICIONES, caminoDeEstados, GARANTIAS_COBRABLES),
>   lib/domain/cancelacion.ts, lib/domain/precios.ts, lib/pricing/cotizar.ts,
>   lib/availability/disponibilidad.ts, lib/domain/mudanzas.ts,
>   lib/domain/ocupantes.ts, lib/domain/grilla.ts,
>   lib/domain/arrastre-grilla.ts, lib/domain/borrador-reserva.ts.
> - Servicios: lib/reservas/crear.ts, cancelacion.ts, cobro.ts, saldar.ts.
> - Acciones: las 14 de app/panel/reservas/actions.ts (1901 líneas) y las 4 de
>   app/panel/reservas/[id]/cuenta/actions.ts; app/reservar/actions.ts
>   (portal); app/portal/[token]/actions.ts.
> - Funciones SQL que son la verdad: crear_reserva (único lugar donde nacen
>   estadías; recibe p_agencia_id desde la 0084), aplicar_precio_reserva
>   (0085), cambiar_unidad_reserva, cotizar_estadia, cotizar_estadia_publica,
>   unidades_disponibles, disponibilidad_por_tipo.
>
> Qué auditar y arreglar:
> 1. *Máquina de estados.* TRANSICIONES tiene que coincidir con el enum
>    estado_reserva de la base (leelo de las migraciones, no lo asumas) y con
>    los botones que muestra app/panel/reservas/[id]/page.tsx. Ningún botón
>    ofrece una transición inválida ni falta una válida. Test de dominio que
>    lo pruebe.
> 2. *Atomicidad (issue #85, prioridad alta).* Listá cada flujo que hace más
>    de una escritura. Ya conocidos: emitirFactura (lee facturas, reservas,
>    consumos y agencias y recién después inserta; una carrera gasta un
>    número correlativo y pide CAE sin fila; el test de concurrencia existe
>    pero no afirma que no haya salto), crearReservaGrupal (entra a medias y
>    lo informa con parcial), cambiarEstadoReserva (update del estado,
>    después sumar_puntos_huesped, después encuestas_satisfaccion). Por cada
>    uno: ¿qué queda a medias si falla el paso N? Si la respuesta es «datos
>    inconsistentes», va a una función SQL transaccional. Reglas del repo
>    para esas funciones: security invoker, comprobar FOUND después de cada
>    update, DROP + CREATE (nunca create or replace si cambian los
>    argumentos), rehacer el revoke execute ... from public, y si hay un
>    valor nuevo de enum va en dos migraciones. Test de integración que
>    fuerce el fallo intermedio.
> 3. *Cotización.* Ninguna pantalla puede mostrar ni guardar «USD 0» por falta
>    de temporada (el bug de la Fase 18). Fechas sin tarifa → mensaje claro y
>    botón deshabilitado, en panel y portal. Probá: invierno (junio-agosto no
>    tiene temporada, por diseño), rangos que cruzan dos temporadas,
>    check-out igual a check-in, fechas pasadas, más de 30 noches, bebés (no
>    ocupan plaza), menores.
> 4. *Disponibilidad.* La garantía es la restricción GiST (ADR 0002).
>    Verificá que la app la respete en los tres caminos (panel, portal,
>    grilla con arrastre) y que el error de solapamiento llegue al usuario
>    como mensaje legible, nunca como 500. La grilla arrastra de habitación,
>    no de fechas (ADR 0033): que siga así.
> 5. *Cancelación y no-show.* El cargo se calcula y se muestra (>14 días sin
>    cargo · 14-7 primera noche · <7 100% · no-show 100%) pero nunca se
>    cobra, y eso es una decisión abierta (ADR 0019). No la cierres vos. Sí
>    verificá que la vista previa sea correcta en los cuatro tramos, con test
>    en los bordes exactos (día 14 y día 7).
> 6. *Reprogramar y cambiar de unidad.* El precio y el total se escriben
>    juntos con aplicar_precio_reserva. Nada vuelve a escribir reservas.total
>    a mano. Grep y test.
> 7. *Portal público.* crearReservaPublica con expiración de pendientes,
>    token opaco, límite de tasa, cotizar_estadia_publica sin filtrar el neto
>    (ADR 0016). Probá el checkout de punta a punta contra la base local,
>    incluido el pago simulado (/pago-simulado) y la confirmación por token.
> 8. *Pagos y saldo.* Seña → saldo → pagada automática al saldar
>    (saldarSiCorresponde); saldo con consumos incluidos (hubo un bug en
>    agosto); nota de crédito. Cada invariante que encuentres escrita en un
>    comentario «⚠️» sin test, recibe su test de dominio.
>
> ### Fase 3 — Botones, formularios y acciones
> Un botón que no hace lo que dice es peor que uno que no está. Recorré los
> 64 archivos de app/ con <button fuera de _components y todos los <form
> action=…>:
> - Cada envío que escribe pasa por BotonEnvio
>   (app/panel/_components/boton-envio.tsx) o muestra estado pendiente de
>   otra forma verificable: nada de doble clic que cree dos reservas o dos
>   pagos. useActionState está en 30 archivos y useFormStatus en 2: buscá
>   formularios con acción y sin indicador de envío.
> - Toda acción destructiva o irreversible (cancelar, no-show, anular
>   comanda, dar de baja, emitir factura, nota de crédito, borrar plan) pide
>   confirmación con useConfirmar y dice qué pasa con el importe.
> - Después de escribir: revalidatePath y feedback visible (useAvisos o
>   Mensaje); nunca redirección muda ni éxito fingido. El { error } siempre
>   se muestra.
> - Botones puramente visuales (celdas de la grilla, chips, pestañas) usan
>   botonClases o tienen escrito por qué no, y llevan type="button" para no
>   enviar el formulario que los contiene.
> - Links internos con Link; disabled real y aria-disabled cuando
>   corresponde; foco visible; aria-label donde el botón es solo un icono.
> - Por cada pantalla, en el navegador y con la base local: hacés clic en
>   cada botón y anotás qué pasó. Lo que falle entra como hallazgo con test.
>
> ### Fase 4 — Interfaz gráfica
> Paleta y tipografía del ADR 0026 (azul y blanco; los tokens siguen
> llamándose lago y lenga, no los renombres). Componentes compartidos en
> app/panel/_components/ui.tsx: Pagina, Encabezado, Tarjeta, Kpi, Etiqueta,
> EstadoVacio, Tabla, Buscador, Paginacion, Campo, PieDeFormulario, Mensaje.
> - Consistencia: cada pantalla del panel usa Pagina + Encabezado; los
>   listados tienen Buscador, Paginacion, EstadoVacio y BotonExportar donde
>   corresponde; los formularios usan Campo y PieDeFormulario. Lo que se
>   desvíe sin motivo escrito, se alinea.
> - Estados: carga (loading.tsx por ruta, esqueletos de esqueletos.tsx),
>   vacío, error (error.tsx) y «sin permiso». Ninguna pantalla en blanco.
> - Responsive: 375 px, 768 px y 1280 px. Sin scroll lateral en el teléfono
>   (la Fase 22 lo logró en 38 pantallas; verificá que las nuevas lo
>   cumplan). Tablas que cortan columnas usan indicarScrollHorizontal o
>   COL_SECUNDARIA.
> - Accesibilidad mínima: contraste AA sobre lago, foco visible, aria-live en
>   avisos, etiquetas asociadas a inputs, orden de tabulación en los
>   formularios de reserva. Lighthouse sobre las cinco pantallas más usadas
>   (dashboard, ocupación, listado de reservas, ficha de reserva, nueva
>   reserva) y sobre el portal: números antes y después.
> - Textos: español rioplatense sin mezclar «tú/vos», sin jerga técnica en
>   los mensajes al usuario, fechas y moneda con el formato del resto
>   (lib/fechas.ts, lib/domain/moneda.ts).
> - Impresión: comprobante de factura, listados de desayuno y consumos
>   (print:hidden donde corresponde).
> - PWA: el panel se instala y no cachea datos (ADR 0028). Que siga sin
>   cachear.
> - Los cinco archivos más grandes (app/panel/canales/page.tsx 2448 líneas,
>   app/panel/reservas/actions.ts 1901, app/panel/reservas/[id]/page.tsx
>   1646, app/panel/canales/actions.ts 1134, app/panel/ocupacion/page.tsx
>   1004) se parten SOLO si el corte no cambia comportamiento y los tests
>   existentes pasan sin editar una línea (criterio del B3, issue #87). Si
>   hay que tocar un test, el refactor cambió algo y se revisa el código.
>
> ### Fase 5 — Portal público del huésped
> app/page.tsx, app/alojamientos, app/reservar/**, app/encuesta, app/firmar,
> app/portal. Mismo recorrido que el panel pero con ojos de huésped sin
> cuenta: búsqueda sin login, catálogo con precios por temporada, checkout,
> confirmación por token, pago, factura por token, asistente por reglas.
> Ningún dato de otro huésped alcanzable por URL; ningún precio neto. Las
> fotos del catálogo (FOTOS en lib/domain/catalogo.ts) corresponden a tipos
> que existen (la 0107 borró dos).
>
> ### Fase 6 — Deuda que se puede pagar hoy
> Issues abiertos que no necesitan credenciales ni decisiones del hotel, en
> este orden: #85 (atomicidad, cubierto en la Fase 2), #70 (pruebas
> funcionales: tu recorrido ES el plan de pruebas; dejalo escrito), #86
> (paginación; ojo: proveedores y agencias NO se paginan a propósito, está
> escrito en el código, no lo «arregles»), #88 (cerrar auditorías: cada
> hallazgo corregido o aceptado con motivo escrito), #89 (config local), #75
> (fotos). Los de integraciones (#76, #77, #78, #79, #80, #68) y los de
> deploy (#71, #74) NO se tocan: necesitan credenciales o una decisión del
> hotel. Comentá en cada issue lo que hiciste, con evidencia.
>
> ### Fase 7 — Documentación al día
> Es una tesis: la documentación vale tanto como el código, y hoy está
> desfasada.
> - README.md dice «1914 tests en verde (118 archivos)»: hay 146 archivos.
>   Recontá ejecutando, no copiando.
> - CLAUDE.md dice «Hay 35 ADRs, el último es el 0035»: el último es el 0040.
>   Y dice «Deploy (Vercel + Supabase cloud) pendiente» mientras vercel.json
>   tiene 6 crons configurados; confirmá conmigo el estado real y corregilo.
> - docs/PENDIENTES.md quedó congelado en la migración 0064 y
>   docs/analisis-pendientes-2026-09-09.md lo reemplaza en parte. Dejá UN
>   documento vigente de pendientes y marcá el otro como histórico.
> - docs/manual-usuario.md y docs/manual-tecnico.md reflejan lo que
>   cambiaste.
> - ADR nuevo (0041 en adelante) por cada decisión de arquitectura que
>   tomes, por ejemplo la función transaccional de factura.
> - docs/auditoria-pulido-2026-10.md: el informe final (sección 5).
>
> ## 4. Protocolo por hallazgo
> 1. Reproducilo: test que falla, o captura más pasos.
> 2. Clasificalo: P0 / P1 / P2 y a qué fase pertenece.
> 3. Arreglalo en el lugar correcto: regla → lib/domain; escritura → función
>    SQL o Server Action con cortarSiFalla; UI → componente compartido antes
>    que uno nuevo.
> 4. Test que falla antes y pasa después.
> 5. Commit propio con el porqué en el cuerpo.
> 6. Si el arreglo cambia comportamiento visible para el hotel, NO lo hagas:
>    documentalo como propuesta.
>
> ## 5. Informe final
> docs/auditoria-pulido-2026-10.md, y el mismo contenido como descripción del
> PR:
> - Línea de base vs resultado: tests (pasan / saltean), lint, typecheck,
>   build, Lighthouse.
> - Tabla de ramas y PRs con veredicto.
> - Hallazgos por fase: qué era, dónde, cómo se verificó, commit.
> - Lo que queda y por qué: credenciales, decisiones de negocio (ADR 0019,
>   rack de cabañas, invierno), dependencias propuestas, ramas a borrar, PRs
>   a cerrar.
> - Lo que tengo que hacer yo, en una lista corta y accionable.
>
> ## 6. Reglas duras (además de las de AGENTS.md)
> - No edites migraciones aplicadas; la próxima es la 0109.
> - No hagas cotizar_estadia security definer.
> - No toques el bloque generado por Next en AGENTS.md.
> - No borres ni saltees tests para que pase el build; no desactives reglas
>   del linter.
> - Nada de console.* en servidor: va por lib/registro.ts.
> - No inventes: si no pudiste verificar algo, decí «no verificado» y por
>   qué.
> - Si te quedás sin contexto, antes de compactar dejá en la bitácora dónde
>   estás y qué sigue.
>
> Empezá por la Fase 0 y mostrame la línea de base y el plan.

## Mensaje 2 — alcance de esta corrida

> ## Alcance de esta corrida
> De las siete fases hacé SOLO la 0, la 1 y la 7. Las fases 2 a 6 no se
> tocan: las hace otra sesión después, sobre la misma rama.
>
> Ajustes para gastar menos:
> - Sin navegador y sin Docker en esta corrida. npm run check con los tests
>   que salteen, y reportá cuántos saltearon.
> - Cortá la salida de todo comando largo: npm test -- --reporter=dot 2>&1 |
>   tail -40, npm run build 2>&1 | tail -30, npm run lint 2>&1 | tail -40;
>   git diff --stat antes que git diff completo.
> - De docs/bitacora.md leé solo las dos entradas que pide la sección 0,
>   nunca el archivo entero.
> - En la Fase 7 corregí solo la deriva (README, CLAUDE.md, PENDIENTES). El
>   punto «reflejan lo que cambiaste» queda para el final.
> - Una fase por sesión. Al terminar cada una: entrada en
>   lapulido/integral-2026-10. [sic — se entiende «en la bitácora, sobre la
>   rama pulido/integral-2026-10»]
>
> hace solo las fases de esta corrida pero ademas crea u archivo asi queda en
> el sistema guardado este prompt y lo vamos haciendo
