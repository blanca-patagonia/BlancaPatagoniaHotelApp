## Qué cambia

<!-- Una o dos líneas, en criollo. Si son varias cosas sueltas, listalas. -->

## Por qué

<!-- El problema que resuelve. Si viene de un issue, enlazalo: "Cierra #12". -->

## Cómo verificarlo

<!-- Los pasos para ver el cambio funcionando: la pantalla, el rol con el que hay
     que entrar, los datos que hacen falta. Si es un bugfix, cómo se reproducía
     antes. -->

## Definition of Done

<!-- Es la lista de AGENTS.md. Lo que no aplique, tachalo con ~~texto~~ en vez de
     borrarlo, así se ve que lo miraste. -->

- [ ] `npm run check` en verde — **leyendo la salida, no el exit code**: sin `.env.local` devuelve 0 con tests en rojo
- [ ] Hay un test que cubre el cambio (y que fallaba antes del fix, si es un bugfix)
- [ ] Toda página y acción nueva verifica el rol con `requerirAcceso`
- [ ] Ningún `{ error }` de Supabase descartado (`cortarSiFalla` / `registrarFalla`)
- [ ] Estados de carga, vacío y error cubiertos, si toqué interfaz
- [ ] Sin `console.log` de depuración, sin `TODO` sin issue, sin código comentado
- [ ] Sin secretos ni datos hardcodeados
- [ ] `docs/bitacora.md` actualizada; ADR nuevo si hubo una decisión de arquitectura

## Migraciones

- [ ] Este PR **no** trae migración nueva

Si trae:

- [ ] Número correlativo, sin repetir uno existente — dos migraciones con el mismo prefijo **no conviven**: Supabase da la segunda por aplicada y la saltea en silencio
- [ ] No modifica ninguna migración ya aplicada
- [ ] Aplicada de cero contra la base local (`npx supabase db reset`, avisando antes: borra los usuarios de auth) y verificada
- [ ] RLS activada, políticas por rol y `GRANT` declarados
- [ ] Si toca un enum: el `alter type ... add value` y su primer uso van en **archivos distintos** (SQLSTATE 55P04)
