---
name: perf-audit
description: Medir y mejorar el rendimiento. Usalo cuando algo esté lento, se hable de performance, optimizar, N+1, índices, bundle, tiempo de carga o escalabilidad. Exige medir antes y después, con los comandos concretos de este proyecto.
---

# Auditoría de rendimiento

> **Medí antes de optimizar y medí después. Si no mejoró, revertilo.** Una optimización sin número
> es una complicación gratuita del código.

## Línea base de este proyecto (medida el 2026-08-14)

| Métrica | Valor |
|---|---|
| `npm run build` | 21 s |
| Rutas | 48, **todas dinámicas** (`ƒ`) |
| JS de cliente | 1,3 MB en `.next/static/chunks` |
| Chunk mayor | 520 KB |
| `npm test` | 16,5 s (344 ejecutados) |

Reproducila:

```bash
time npm run build
du -sh .next/static/chunks
fd -e js . .next/static/chunks -x du -k {} | sort -rn | head -10
```

## Backend

### N+1 — lo primero que hay que buscar en un panel
Un `select` que devuelve N filas y después una consulta por fila dentro de un `map` o un `for`.

```bash
rg -n -B3 "\.from\(" -g '*.tsx' app/panel | rg -n "map\(|for \(|forEach"
```

Se arregla con un `select` anidado de PostgREST (`select('*, relacion(*)')`) o con un `in` sobre los
ids juntados.

### Consultas sin techo
```bash
rg -n "select\('\*'\)" -g '*.ts' -g '*.tsx' app lib      # trae todas las columnas
rg -n "count: 'exact'" -g '*.ts' -g '*.tsx' app lib      # COUNT completo en cada página
```

`{ count: 'exact' }` recorre la tabla entera para dar el total. En listados grandes usá
`'estimated'` o `'planned'`.

### Índices faltantes
Cruzá lo que el código filtra y ordena contra lo que las migraciones indexan:

```bash
rg -n "\.eq\('|\.order\('" -g '*.ts' -g '*.tsx' app lib
rg -n "create index" supabase/migrations
```

**Postgres no indexa las claves foráneas automáticamente.** Cada FK sin índice hace que un `DELETE`
del padre escanee la tabla hija entera.

### Agregaciones en JavaScript
`lib/domain/metricas.ts` (ocupación, ADR, RevPAR) y las vistas de saldos (`0026`): si se traen todas
las filas al servidor para sumar en JS, eso va a SQL.

### Serie vs paralelo
Pantallas que cargan varios paneles: si hay `await` seguidos e independientes, van con `Promise.all`.

## Frontend

- **Rutas dinámicas:** las 48 son `ƒ`. El panel tiene que serlo (usa cookies), pero `/alojamientos`
  y el catálogo público podrían ser estáticos o con `revalidate`. Ahí hay una mejora real de latencia.
- **Props a componentes cliente:** todo prop de un `'use client'` viaja en el payload de RSC. Además
  de la fuga de datos, pesa.
- **Listas largas sin virtualizar** y tablas que renderizan cientos de filas.
- **Bundle:** buscá importaciones de librería entera donde alcanza una función.

## Cómo se reporta

Tabla con **antes → después**, un número por fila:

| Cambio | Antes | Después |
|---|---|---|
| Índice en `estadias(reserva_id)` | 840 ms | 12 ms |

Sin los dos números no es una optimización, es una hipótesis. Y si el número no se movió, revertí:
el código quedó más complejo a cambio de nada.

## Trampas al medir

- La primera corrida siempre es más lenta (caché frío). Medí tres veces y quedate con la mediana.
- `npm run build` sin `.next` previo tarda más: no compares un build limpio contra uno incremental.
- Sin base local no podés medir consultas. Decilo en vez de estimar.
