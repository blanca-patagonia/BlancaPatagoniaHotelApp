# ADR 0040 — Inventario físico real de unidades (migración 0106)

- **Estado:** Aceptada
- **Fecha:** 2026-09-15
- **Origen:** dos fotos del dueño del hotel: la planilla de recepción con el
  nombre real de cada habitación y cabaña, y una franja de calendario
  (ocupadas/libres/pax/llegadas/salidas por día) que pidió agregar a
  Ocupación.

## Contexto

`CLAUDE.md` tenía anotado, desde el relevamiento con el cliente, un pendiente
explícito: *"inventario físico real de unidades y tarifa rack de cabañas"*.
`supabase/seed.sql` cargaba un catálogo **representativo** —10 tipos, 15
unidades con nombres genéricos («Hostería 101», «Cabaña Lenga»)— y lo decía
en su propio encabezado. El dueño mandó la hoja que usa recepción con los
nombres reales:

- **Sueltas:** Agassiz, Mayo (Triple), Frías (Suite).
- **Planta Alta (6):** Gorra Blanca, Murallón, Heim (las tres Superior),
  Ameghino, Caglio (Standard), Torre (Suite).
- **Planta Baja (6):** Peineta (Triple), Cono, Marconi, Bertachi, Nunatak
  (Standard), Viedma (Superior).
- **Cabañas (22 unidades en 5 tipos):** Bolados ×7 (capacidad 6), Onelli ×4
  (cap. 3), Spegazzini ×5 (cap. 4), Upsala ×3 (cap. 2), Moreno ×3 (cap. 2).

37 unidades físicas en total.

## Decisión

**Se renombran los `tipos_unidad` existentes en vez de borrarlos y crear
otros nuevos**, porque seis de ellos ya tenían **tarifas reales del Anexo A**
cargadas y `tarifas.tipo_unidad_id` referencia el `id`, no el `codigo`.
Renombrar conserva esa tarifa sin volver a tipearla (y sin el riesgo de que
el número nuevo no coincida con el oficial):

| Código viejo | Código nuevo | Nombre nuevo |
|---|---|---|
| `HOST-DBL-STD` | `HOST-STD` | Standard |
| `HOST-DBL-SUP` | `HOST-SUP` | Superior |
| `HOST-TRIPLE` | *(sin cambio)* | Triple |
| `HOST-SUITE` | *(sin cambio)* | Suite |
| `CAB-3D-6P` | `CAB-BOLADOS` | Bolados |
| `CAB-1D-3P` | `CAB-ONELLI` | Onelli |
| `CAB-2D-4P` | `CAB-SPEGAZZINI` | Spegazzini |

**Dos tipos nuevos (`CAB-UPSALA`, `CAB-MORENO`, cabañas de 2 personas) se
crean sin tarifa.** El Anexo A no publica ninguna categoría de 2 personas, y
el sistema no inventa un precio — mismo criterio que la cotización de
divisas (`manual`, nunca aproxima) y el "USD 0" de la Fase 18 (mejor sin
cotizar que cotizar mal). Esas 6 cabañas quedan en el inventario pero **no
se pueden reservar** hasta que el hotel confirme cuánto cobran.

**Tres tipos quedan "huérfanos" — sin ninguna unidad física —, sin
borrarse:** `HOST-SINGLE` (ninguna habitación real es individual según la
hoja), `CAB-2D-5P` y `CAB-3D-7P` (ninguna cabaña real tiene 5 o 7 personas
de capacidad). Conservan su tarifa real del Anexo A por si el hotel confirma
que sí corresponden a algo — capaz una de las que hoy se marcó Standard, o
una cabaña que la hoja no llegó a mostrar.

**La configuración de cama (Twin / Matrimonial / Solo Twin / Solo
Matrimonial) que trae la hoja NO se carga.** No existe ningún campo para eso
— ni en `tipos_unidad` ni en `unidades` — y agregarlo es una decisión de
diseño aparte (¿por tipo o por unidad? ¿debería limitar quién puede
reservarla?) que no se tomó en esta pasada. Si hace falta, es una migración
chica (una columna de texto) más la pantalla que la muestre.

**La categoría de las habitaciones sin ninguna etiqueta en la hoja**
(Ameghino, Caglio, Cono, Nunatak, Marconi, Bertachi, y también Agassiz) **es
una inferencia**: se tomaron como Standard por no tener «SUP», «Triple» ni
«Suite» anotado al lado. Si alguna es en realidad Superior, se corrige
cambiándole el tipo desde la ficha de la unidad — no hace falta tocar la
migración.

**`piso`/`bloque` (migración 0042) modelan la planta:** `PA`/`PB` para la
hostería, `Hostería`/`Cabañas` de bloque. Las tres sueltas (Agassiz, Mayo,
Frías) quedan con `piso` vacío — «sin asignar» es más honesto que inventar
una planta que la hoja no dice.

## Cómo llega a las dos bases

- **Hosted** (ya tenía el catálogo representativo cargado): la migración
  0106 hace el trabajo entero — `update` por el código viejo para renombrar,
  `insert ... where not exists` para lo nuevo.
- **Local, en un `db reset` de cero:** los `update` de la migración no
  encuentran nada (`tipos_unidad` todavía está vacía a esa altura de
  `db reset` — corre antes que `seed.sql`), así que `supabase/seed.sql` se
  reescribió con los códigos NUEVOS puestos directamente. Las dos rutas
  llegan al mismo catálogo final por caminos distintos; están documentadas
  una al lado de la otra en el encabezado de cada archivo.

**Verificado localmente** (no vía `db reset` — está bloqueado por el hook de
seguridad del repo — sino aplicando la migración con `psql` directo contra
el Postgres local, primero en una transacción con `rollback` para confirmar
que corre limpio, después aplicada de verdad para poder correr la suite):
7 `update` de 1 fila cada uno, 2 `insert` de 1 fila (Upsala, Moreno), 1
`insert` de 37 filas (unidades), sin errores. `lib/domain/catalogo.ts`
(mapa de fotos del catálogo público, por `codigo`) se actualizó con las
claves nuevas — la foto de stock sigue siendo la misma, sólo cambió a qué
código apunta.

## Lo que sigue pendiente

- Confirmar con el hotel: la tarifa de Upsala y Moreno, y si `HOST-SINGLE`
  corresponde a algo real o se puede dar de baja (ver la corrección de abajo
  sobre `CAB-2D-5P`/`CAB-3D-7P`, que sí se resolvió).
- La configuración de cama, si el hotel la necesita reflejada en el sistema
  (por ejemplo para que Recepción sepa de un vistazo cuáles admiten armar
  camas separadas).
- Aplicar esta migración al proyecto hosted (queda para cuando el hotel esté
  listo para el cambio real de nombres en producción).

## ⚠️ Corrección (2026-09-15, mismo día) — migraciones 0107 y 0108

El dueño del hotel pidió, sin esperar a más confirmaciones, sacar `CAB-2D-5P`
y `CAB-3D-7P` directamente: la hoja de recepción es la lista completa de
cabañas reales y no hay una sexta ni séptima. Dos cosas que esta ADR no
había previsto:

1. **La 0106 nunca había tocado las `unidades` FICTICIAS viejas** («Cabaña
   Lenga», «Cabaña Ñire», «Cabaña Calafate», «Cabaña Notro», «Cabaña
   Coihue») — sólo agregó las 37 reales al lado. Sacar los dos tipos sin
   sacar antes esas unidades fallaba por la FK `on delete restrict` de
   `unidades.tipo_unidad_id`. La 0107 asumía que ya no había ninguna (cierto
   sólo en un `db reset` de cero) y la 0108 completa el trabajo: borra las
   cinco unidades ficticias primero, y recién después reintenta los tipos.
2. **«Cabaña Coihue» tenía una estadía real cargada.** Borrarla de un tirón
   habría perdido de qué unidad fue esa estadía — el error que el proyecto
   evita en todos lados (`AGENTS.md`: "no se borran reservas, estadías…").
   La 0108 intenta borrar cada unidad ficticia y, si la base la rechaza por
   tener historial, la da de baja (`activo = false`) en vez de cortar. Por
   eso `CAB-3D-7P` sigue existiendo después de la 0108: todavía lo referencia
   esa unidad dada de baja, y no es un bug — es la misma garantía aplicada un
   nivel más abajo, en el tipo.

Verificado igual que la 0106: con `psql` directo contra el Postgres local
(ahí es donde apareció el caso real de la estadía, que confirmó que la
lógica de baja lógica hacía falta y no era una precaución de más).
Typecheck 0 · lint 0 · build 0 · 2012 tests en verde, los mismos 11 en rojo
de siempre (desvío de esquema preexistente, sin relación).
