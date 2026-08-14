---
name: refactor
description: Reestructurar código sin cambiar su comportamiento. Usalo cuando se pida refactorizar, limpiar, reorganizar, extraer, deduplicar o partir un archivo grande. Exige red de tests primero y no mezclar refactor con cambio funcional.
---

# Refactorizar

> **Refactor = cambia la forma, NO cambia el comportamiento.** Si además arreglás un bug o agregás
> algo, ya no es un refactor: son dos cambios mezclados y nadie va a poder revisarlos.

## 1. Red de tests primero

Antes de mover nada, comprobá que lo que vas a tocar está cubierto:

```bash
npm test
rg -l "<modulo>" tests/
```

Si no hay tests sobre eso, **escribilos primero** — describiendo el comportamiento actual, incluso el
que te parece feo. Ese es el contrato que tenés que preservar. Refactorizar sin red es reescribir a
ciegas y descubrir lo que rompiste en producción.

De los 28 módulos de `lib/domain`, 25 tienen test. Si el tuyo es de los otros tres, empezá por ahí.

## 2. Pasos chicos, verificando en cada uno

```bash
npm run typecheck && npm test
```

Después de **cada** paso, no al final. Cuando algo se rompe, querés saber cuál de los quince
movimientos lo rompió, no buscarlo entre todos.

Commits atómicos: uno por paso. Ver el skill `work-unit-commits` si está disponible.

## 3. Los refactors que este repo pide

Salen de la auditoría, no son gustos:

**Centralizar la autorización.** Hay 19 lugares con el literal `['admin','gerencia'].includes(...)`
y `lib/domain/permisos.ts` existe justamente para eso. Migralos de a uno, verificando en cada paso.

**Unificar el guard de sesión.** `app/panel/huespedes/actions.ts:26` define un `exigirAcceso` local
más débil que el `requerirAcceso` que usan los otros 36 sitios. **Ojo: este cambia el comportamiento
—empieza a rechazar roles que antes pasaban— así que NO es un refactor.** Va como corrección, con su
propio test.

**Bajar lógica de `app/` a `lib/domain/`.** El 79 % del código vive en `app/`. Cuando toques una
pantalla con reglas de negocio adentro, extraé la regla a un módulo puro y testeala. De a poco, no
todo junto.

**Partir archivos grandes.** Buscá los candidatos:
```bash
fd -e ts -e tsx --exclude node_modules -x wc -l {} | sort -rn | head -15
```

## 4. Reglas que no se rompen al mover código

- `lib/domain/` no importa Supabase, `next/*`, React ni zod. Si al extraer una función necesitás un
  cliente de datos, esa función no va al dominio: partila en dos.
- `lib/` nunca importa de `app/`.
- Español en nombres, comentarios y mensajes.

## 5. Verificación final

```bash
npm run lint && npm run typecheck && npm test && npm run build
git diff main...HEAD --stat
```

**El diff debe ser legible.** Si mueve 2.000 líneas, partilo en varios PRs encadenados: nadie revisa
2.000 líneas de verdad, las aprueba.

## Checklist

- [ ] Tests que cubren lo que toqué, verdes **antes** de empezar
- [ ] Cero cambios de comportamiento (si los hay, va en otro commit y con su test)
- [ ] Verificado después de cada paso, no solo al final
- [ ] Reglas de dependencia respetadas
- [ ] Diff revisable; si es grande, partido
