---
name: add-feature
description: Agregar una funcionalidad completa al sistema, de punta a punta. Usalo cuando se pida un módulo nuevo, una sección del panel, una funcionalidad que cruza base de datos, dominio, acciones y pantallas. Da el orden de trabajo y qué archivo crear en cada paso.
---

# Agregar una feature

El orden importa: **de adentro hacia afuera**. La regla del dominio primero, la pantalla al final.
Al revés terminás con lógica de negocio incrustada en un `page.tsx`, que es el problema que este
proyecto ya tiene (el 79 % del código vive en `app/`).

Antes de escribir nada, leé `CLAUDE.md`: el proyecto trabaja por fases y exige mostrar el plan antes
de implementar algo grande.

## Orden de trabajo

### 1. Base de datos → skill `db-migration`
`supabase/migrations/00XX_<tema>.sql`. Tabla, RLS, políticas por rol, índices en las FK.
La integridad crítica vive en la base, no en la app.

### 2. Reglas puras → `lib/domain/<tema>.ts`
Todo lo que sea *decisión de negocio* va acá: qué estados existen, qué transición es válida, cómo se
calcula un importe, qué se puede hacer con qué rol.

**`lib/domain/` no importa Supabase, ni `next/*`, ni React, ni zod.** Son funciones puras sobre datos
que recibe por parámetro. Ese aislamiento es lo que las hace testeables sin base — no lo rompas.

Modelo a copiar: `lib/domain/cancelacion.ts` (chico y claro) o `lib/domain/reservas.ts` (máquina de
estados).

### 3. Test del dominio → skill `write-tests`
`tests/<tema>.test.ts`. Sin base, sin mocks. Escribilo **antes** de la pantalla: si la regla está
bien modelada, el test sale corto.

### 4. Server Actions → skill `api-endpoint`
`app/panel/<tema>/actions.ts`. Verificación de rol, validación, `{ error }` revisado, `revalidatePath`.

### 5. Pantallas → skill `ui-component`
Un módulo del panel se compone así (contá 6 archivos, es lo que cuesta hoy agregar uno):

```
app/panel/<tema>/page.tsx              listado con Buscador + Paginacion + BotonExportar
app/panel/<tema>/loading.tsx           esqueleto de carga
app/panel/<tema>/nuevo/page.tsx        alta en pantalla propia
app/panel/<tema>/[id]/page.tsx         ficha
app/panel/<tema>/[id]/editar/page.tsx  edición en pantalla propia
app/panel/<tema>/actions.ts            Server Actions
```

Modelo completo a copiar: `app/panel/proveedores/`.

### 6. Registrar en el sistema
- Permisos: agregá el área en `lib/domain/permisos.ts` y decidí qué rol la ve.
- Menú: el panel arma la navegación desde los permisos; verificá que aparezca.
- Ayuda: `lib/domain/ayuda.ts` filtra la guía por los mismos permisos. Sumá tu sección.
- Búsqueda global: si la entidad es buscable, sumá el ámbito en `lib/domain/busqueda.ts`.

### 7. Documentar — lo pide el proyecto, es una tesis
- `docs/bitacora.md`: fecha · fase · qué · por qué · decisiones.
- ADR numerado en `docs/decisiones/` **si hubo una decisión de arquitectura**.

## Verificación final

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Los cuatro en verde, o no está listo. Y si `npm test` reporta tests salteados, decilo: hoy son 43 y
no se ejecutan sin base local.

## Errores comunes en este repo

- Meter la consulta a Supabase adentro de `lib/domain/`: rompe la pureza y la testabilidad.
- Verificar el rol solo en la página y no en la acción. La acción es un endpoint público.
- Copiar el literal `['admin','gerencia']` en vez de usar `lib/domain/permisos.ts`. Ya hay 19 casos.
- Olvidar `loading.tsx`: la pantalla queda congelada sin señal de vida.
