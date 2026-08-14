---
name: api-endpoint
description: Crear o modificar un punto de entrada del sistema — Server Action, route handler o webhook. Usalo cuando aparezcan las palabras Server Action, actions.ts, endpoint, route handler, webhook, formulario que guarda, alta, edición o borrado. Cubre verificación de rol, validación, manejo de errores de Supabase y revalidación.
---

# Crear un punto de entrada

> **Una Server Action es un endpoint HTTP público.** Cualquiera puede invocarla con un POST,
> sin pasar por tu pantalla. Que la página verifique el rol NO protege la acción.
> Cada acción verifica por sí misma. Sin excepciones.

## 1. Verificar el rol — siempre lo primero

```ts
import { requerirAcceso } from '@/lib/auth/session'

export async function crearProveedor(prev: EstadoProveedor, formData: FormData) {
  const sesion = await requerirAcceso('proveedores')   // ← primera línea, antes de leer nada
  ...
}
```

`requerirAcceso(area)` está en [lib/auth/session.ts:50](../../../lib/auth/session.ts) y consulta la
matriz de `lib/domain/permisos.ts`. `requerirSesion()` solo comprueba que haya sesión: **no alcanza**
para autorizar.

**Errores reales del repo, no los repitas:**
- `app/panel/huespedes/actions.ts:26` define un `exigirAcceso` local que no mira el rol. Es el outlier
  entre 36 usos correctos. No lo copies.
- Hay 19 lugares con el literal `['admin','gerencia'].includes(...)`. Usá `puedeAcceder` de
  `lib/domain/permisos.ts` en su lugar.

## 2. Leer y validar la entrada

El patrón del repo separa lectura de validación (ver `app/panel/huespedes/actions.ts:33-65`):

```ts
function leerCampos(formData: FormData) {
  return { nombre: String(formData.get('nombre') ?? '').trim(), ... }
}

function validar(c: ReturnType<typeof leerCampos>): string | null {
  if (!c.nombre) return 'Ingresá el nombre.'
  return null
}
```

Los mensajes van **en español, en segunda persona y dicen qué hacer**: "Ingresá el apellido.", no
"Campo requerido".

Convertí `''` a `null` para las columnas opcionales: `String(...).trim() || null`. Guardar `''` donde
la base espera `null` rompe los `is null` de las consultas.

## 3. Manejar el error de Supabase — nunca lo descartes

Elegí según si la acción devuelve estado o redirige:

```ts
// Acción que devuelve estado: se informa con { error }
const { data, error } = await supabase.from('x').insert(campos).select('id').single()
if (error) return { error: `No se pudo crear: ${error.message}` }

// Acción que redirige: no tiene retorno, se corta con el helper
import { cortarSiFalla } from '@/lib/acciones'
const { error } = await supabase.from('x').delete().eq('id', id)
cortarSiFalla(error, '/panel/x', 'borrar')

// Escritura accesoria o compensación: se registra sin cortar
import { registrarFalla } from '@/lib/acciones'
registrarFalla(error, 'revertir reserva tras fallo de pago')
```

`destructurar { data }` sin mirar `{ error }` es el bug clásico de este stack: la escritura falla,
la pantalla recarga y el usuario cree que guardó. Para eso existe [lib/acciones.ts](../../../lib/acciones.ts).

## 4. Revalidar

```ts
revalidatePath('/panel/proveedores')       // el listado que cambió
revalidatePath(`/panel/proveedores/${id}`) // y la ficha, si la tocaste
```

Sin esto la pantalla muestra datos viejos. No redirijas en silencio tras guardar: devolvé
`{ ok: 'mensaje' }` y que la pantalla use `ExitoConPasos` (ver el skill `ui-component`).

## 5. Route handlers y webhooks

Van en `app/api/**/route.ts`. Para webhooks mirá `app/api/webhooks/pagos/[proveedor]/route.ts`:
verificá la firma **antes** de parsear el cuerpo, leé el cuerpo crudo, y sé idempotente — los
proveedores reintentan siempre.

## 6. Probar

Test en `tests/acciones/`, con `describe.skipIf(!hayDB)` porque tocan la base. Ver el skill
`write-tests`.

```bash
npm test -- acciones
npm run typecheck && npm run lint
```

## Checklist

- [ ] `requerirAcceso(area)` en la primera línea
- [ ] Entrada leída con `String(...).trim()`, opcionales a `null`
- [ ] Validación con mensajes en español que dicen qué hacer
- [ ] Todo `{ error }` revisado: `return { error }`, `cortarSiFalla` o `registrarFalla`
- [ ] `revalidatePath` de cada ruta afectada
- [ ] Test que cubre el rechazo por rol, no solo el camino feliz
