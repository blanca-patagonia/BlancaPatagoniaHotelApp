---
description: Checklist previo al PR — verificación, secretos, mensaje de commit y descripción
---

Preparar los cambios para el PR.

> **No commiteés ni pushees.** `CLAUDE.md` fija que eso pasa **solo** cuando el usuario lo pide.
> Este comando deja todo listo y frena.

## 1. Verificación completa

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Los cuatro en verde o no seguimos. Reportá el conteo de tests salteados: si son 43, la garantía de
anti-overbooking no se verificó acá.

## 2. Secretos y basura

```bash
git diff main...HEAD --stat
rg -n "sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}" $(git diff main...HEAD --name-only)
rg -n "console\.log|TODO|FIXME|debugger" $(git diff main...HEAD --name-only)
```

Confirmá que no entró ningún `.env`, ningún dump ni archivo temporal.

## 3. Revisión

Corré `/review` antes de dar por listo. Si hay hallazgos de severidad alta o crítica, se arreglan
primero.

## 4. Tamaño

Si el diff pasa las **400 líneas**, proponé partirlo en PRs encadenados. Nadie revisa 400 líneas de
verdad: las aprueba, que es distinto.

## 5. Preparar (sin ejecutar)

**Rama:** `audit/fase-N-<tema>` o `feat/<tema>`. Si estás en `main`, creala.

**Commit convencional**, en español, sin atribución a IA:

```
feat(reservas): permitir reprogramar una estadía confirmada

Por qué: recepción necesitaba mover una reserva sin cancelarla y volver a
cargarla, que hacía perder la seña.

- lib/domain/mudanzas.ts: regla de si corresponde cobrar diferencia
- app/panel/reservas/actions.ts: acción con verificación de rol
- tests/mudanzas.test.ts: cubre el borde de tarifa distinta
```

**Descripción del PR**, tres bloques:
- **Qué cambió** — en una frase.
- **Por qué** — el problema que resuelve, no la solución.
- **Cómo probarlo** — pasos concretos para que otro lo verifique a mano.

## 6. Documentación

- `docs/bitacora.md` actualizada: fecha · fase · qué · por qué · decisiones.
- ADR nuevo en `docs/decisiones/` si hubo decisión de arquitectura.

---

Mostrame todo preparado y esperá el visto bueno para commitear.
