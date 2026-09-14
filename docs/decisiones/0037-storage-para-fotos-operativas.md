# ADR 0037 — Supabase Storage para fotos operativas

- **Estado:** Aceptada
- **Fecha:** 2026-09-14
- **Origen:** pedido del dueño del hotel de poder adjuntar una foto al detalle
  de una orden de mantenimiento, a una tarea de housekeeping y al alta de un
  proveedor, más el comprobante de pago de una agencia.

## Contexto

El ADR 0013 había dejado la gestión documental con Storage como trabajo
futuro, sin decidir, con una recomendación concreta si algún día se
encaraba: bucket privado, políticas que repliquen `rol_actual()`, y acceso
**siempre por URL firmada generada en el servidor**, nunca exponiendo el
bucket a un cliente autenticado directo. Storage no se había usado en ningún
lugar del repo hasta esta migración (verificado: cero referencias a
`.storage.` fuera de `localStorage`/`sessionStorage` del navegador).

El pedido de esta sesión toca cuatro módulos con la misma necesidad (adjuntar
una foto o un PDF a una fila existente), así que conviene resolverlo una sola
vez en vez de cuatro veces con variantes.

## Decisión

**Un solo bucket privado, `adjuntos-operativos`** (migración 0099), con
`file_size_limit` de 8 MB y `allowed_mime_types` restringido a
`image/jpeg`, `image/png`, `image/webp` y `application/pdf` a nivel de
bucket (defensa en profundidad: el límite se repite en la app en
`lib/storage/index.ts` para dar un mensaje en español en vez del error crudo
de Storage).

**Sin ninguna política RLS sobre `storage.objects`.** Es la parte que se
aparta de la recomendación original del ADR 0013 (que proponía replicar
`rol_actual()` en políticas de Storage) y se hace a propósito: sin ninguna
policy, Postgres deniega TODO a `anon` y `authenticated` — el único camino de
lectura o escritura es `service_role`, servido siempre desde
`lib/storage/index.ts` (`subirAdjunto`, `urlAdjunto`, `eliminarAdjunto`),
llamado únicamente desde Server Actions que ya pasaron por
`requerirAcceso(area)`. Mantener la autorización en un solo lugar
(`lib/domain/permisos.ts` + `requerirAcceso`) evita el problema que ya pasó
dos veces en este proyecto con `cotizar_estadia` y con los privilegios de
escritura de `anon`: una política paralela (RLS de tabla, o acá RLS de
Storage) que hay que acordarse de mantener sincronizada con la matriz de
roles de la aplicación, y que si se desincroniza abre un camino que nadie
está mirando.

**Carpetas de primer nivel en vez de buckets separados.** `mantenimiento/`,
`housekeeping/`, `proveedores/`, `agencias/` — cada una seguida del id de la
entidad y un nombre aleatorio (`crypto.randomUUID()`) para que dos archivos
nunca choquen y el nombre original (que puede traer datos del dispositivo del
usuario) no quede expuesto en la ruta. Un bucket por módulo hubiera sido
sobre-ingeniería: no hay ninguna diferencia de política entre ellos —todos
pasan por el mismo `service_role`— así que la única función de separarlos
sería cosmética, y el prefijo de carpeta ya la cumple.

**La ruta se guarda en la base, nunca la URL.** Cada tabla que adjunta un
archivo guarda `ruta text` (o `text[]` si admite varias), no una URL. La URL
firmada se pide en el momento de mostrarla (`urlAdjunto`, 300 segundos por
omisión) y nunca se persiste: si se guardara la URL firmada, quedaría vencida
a los 5 minutos y el sistema mostraría un link roto sin ningún aviso.

## Consecuencias

- Cuatro módulos (mantenimiento, housekeeping, proveedores, agencias) reusan
  el mismo `lib/storage/index.ts` y los mismos componentes de UI
  (`SubirFoto` para el formulario, `FotoAdjunta` para mostrarlo), en vez de
  reinventar la subida cuatro veces.
- El costo es que **toda** lectura de un adjunto pasa por el servidor (una
  URL firmada por render), nunca por una URL directa del bucket. Para fotos
  de baja frecuencia de acceso (una orden de mantenimiento, un comprobante)
  el costo es despreciable; si en el futuro se necesitara servir adjuntos de
  alto tráfico, este diseño no escala así como está y habría que reconsiderar
  cachear las URLs firmadas con un margen de expiración.
- Sigue sin resolverse el versionado de documentos que preveía el ADR 0013
  (un archivo nuevo con el mismo nombre lógico no reemplaza al viejo, crea
  otro): no hacía falta para este pedido, que es "una foto adjunta", no
  "historial de versiones de un documento".
