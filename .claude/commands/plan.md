---
description: Planificar antes de codear — lee el código, lista archivos a tocar, riesgos y orden
argument-hint: [qué querés hacer]
---

Planificá esto **sin escribir una línea de código**: $ARGUMENTS

`CLAUDE.md` lo pide explícitamente: antes de implementar algo grande, mostrar el plan y esperar
validación. Este comando es ese paso.

## 1. Entender antes de proponer

Leé el código que está en juego. Si son más de tres o cuatro archivos, delegá al subagente
`explorer` para no inflar el contexto.

Respondé primero:
- ¿Esto ya existe, total o parcialmente? Buscá antes de proponer construir.
- ¿Qué ADR de `docs/decisiones/` lo condiciona? Hay 16 y varios fijan decisiones que no se
  reabren sin motivo.
- ¿Toca dinero, disponibilidad, permisos o datos personales? Ahí el listón sube.

## 2. El plan

**Archivos a tocar**, cada uno con qué cambia y por qué:

| Archivo | Qué cambia | Por qué |
|---|---|---|

Respetá el orden de adentro hacia afuera: migración → `lib/domain` → test → Server Action → pantalla.

**Riesgos.** Concretos, no genéricos:
- ¿Qué se puede romper que hoy anda?
- ¿Hay migración? ¿Es reversible? ¿Bloquea la tabla?
- ¿Cambia una firma que otros usan?
- ¿Necesita Docker? Acá puede no haber: decilo ahora, no a mitad de camino.

**Tests** que van a cubrirlo, y cuáles se van a saltear sin base local.

**Orden de trabajo**, en pasos verificables. Cada paso debe poder terminar con la suite en verde.

## 3. Lo que no sabés

Listá las decisiones que necesitan que yo responda antes de arrancar. Una pregunta por vez, la más
importante primero.

---

**Terminás acá y esperás.** No escribas código, no crees archivos, no corras migraciones. Cuando
apruebe, seguimos.
