---
name: revisar-codigo
description: Revisar código o un diff antes de commitear o abrir un PR. Usalo cuando se pida revisar, revisión, code review, mirar el diff, o antes de un PR. Checklist ordenado por severidad, con la exigencia de citar evidencia y no aprobar sin verificar.
---

# Revisión de código

Orden fijo: **corrección > seguridad > performance > mantenibilidad > estilo.** Un problema de estilo
nunca se reporta antes que un bug. Si se te acaba el tiempo, que se caiga el estilo.

**Regla dura: no apruebes nada que no hayas abierto.** Citá `archivo:línea` en cada hallazgo. Un
hallazgo sin evidencia verificada es ruido, y el ruido entrena al equipo a ignorar las revisiones.

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

## 1. Corrección

- **Errores de Supabase descartados.** El bug clásico de este stack:
  ```bash
  rg -n "const \{ data \} = await supabase" -g '*.ts' -g '*.tsx'
  ```
  Destructurar `{ data }` sin mirar `{ error }` hace que la escritura falle en silencio y la pantalla
  diga que salió bien. Debe usar `return { error }`, `cortarSiFalla` o `registrarFalla`.
- `await` faltante, promesas sin `catch`.
- Casos borde: `null`, cadena vacía, `0`, negativos, fechas en el límite, decimales de dinero.
- Off-by-one en fechas: los umbrales de cancelación (14 y 7 días) y el cálculo de noches.
- Estados imposibles representables: si un tipo permite una combinación que el negocio prohíbe,
  se modela mal.
- `revalidatePath` faltante tras escribir: la pantalla muestra datos viejos.

## 2. Seguridad

- ¿Cada Server Action nueva verifica el rol con `requerirAcceso(area)`? Son endpoints HTTP públicos.
- ¿Alguna tabla nueva sin RLS, o con política sin `with check` en escritura?
- ¿Uso del cliente `admin` (service_role) con datos del usuario sin filtrar?
- ¿Un `id` que viene de la request se usa sin comprobar alcance (IDOR)?
- ¿Datos sensibles pasados como props a un componente `'use client'`? Viajan al navegador.
- ¿Secretos hardcodeados? Ver el skill `revisar-seguridad` para el checklist completo.

## 3. Performance

- **N+1:** un `select` que devuelve N filas y después una consulta por fila dentro de un `map`.
- `select('*')` sobre tablas grandes, o consultas sin `.limit()` ni paginación.
- `{ count: 'exact' }`: hace un COUNT completo en cada pedido de página.
- Filtros y ordenamientos sobre columnas sin índice. Cruzalo contra las migraciones.
- Consultas en serie que podrían ir con `Promise.all`.
- Agregaciones hechas en JavaScript sobre todas las filas en vez de en SQL.

## 4. Mantenibilidad

- ¿La lógica de negocio quedó en `app/` en vez de `lib/domain/`? Es la deuda estructural del repo.
- ¿`lib/domain/` importó algo de framework? Rompe la pureza y la testabilidad.
- ¿Se copió el literal `['admin','gerencia']` en vez de usar `lib/domain/permisos.ts`? Ya hay 19.
- ¿Duplicación de algo que ya existe en `lib/listados.ts`, `lib/csv.ts`, `lib/fechas.ts` o `ui.tsx`?
- Archivos de más de 400 líneas o funciones de más de 80: pedí que se parta.

## 5. Estilo

- Español en comentarios, mensajes y nombres, como el resto del repo.
- Sin `console.log` de depuración, sin código comentado, sin `TODO` sin issue.
- Sin `any`, `as any` ni `@ts-ignore` sin comentario que lo justifique.

## 6. Tests

- ¿El cambio trae test? Si es un bugfix, ¿el test **fallaba antes** del fix?
- ¿Se testeó el rechazo por rol, o solo el camino feliz?
- ¿Se agregó un test que se saltea sin base? Está bien, pero decilo: hoy ya hay 43 sin ejecutar.

## Formato

Por hallazgo: **`archivo:línea` → qué está mal → qué se rompe en concreto → severidad → fix propuesto.**

Si no encontraste nada serio, decilo en una línea. Inflar una revisión con observaciones menores para
parecer riguroso es peor que un "está bien": entrena al equipo a no leerlas.
