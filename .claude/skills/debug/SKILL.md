---
name: debug
description: Diagnosticar y arreglar un bug. Usalo cuando algo falla, no anda, tira error, da un resultado incorrecto, o cuando se pida investigar, depurar o encontrar la causa. Protocolo de reproducir primero y arreglar la causa raíz, no el síntoma.
---

# Depurar

> **No toques una línea hasta poder reproducirlo.** Un arreglo sin reproducción previa es una
> apuesta, y las apuestas en producción se pagan con datos.

## 1. Reproducir con un test que falle

Antes de leer código: escribí el test que expone el bug y **velo en rojo**.

```bash
npm test -- <patrón>
```

Si no lo podés reproducir, el problema es el entendimiento, no el código. Volvé a preguntar qué pasó
exactamente: qué pantalla, qué rol, qué datos, qué esperaba y qué vio.

Si el bug necesita base y no tenés Docker, **decilo explícitamente** en vez de dar por buena una
hipótesis sin verificar.

## 2. Hipótesis, en orden de probabilidad en este repo

1. **Error de Supabase descartado.** El más frecuente. La escritura falló, nadie miró `{ error }`,
   la pantalla dijo que salió bien.
   ```bash
   rg -n "const \{ data \} = await supabase" -g '*.ts' -g '*.tsx'
   ```
2. **RLS.** La consulta es correcta pero la política no deja pasar. Da cero filas sin error, que es
   lo que la hace difícil de ver. Probá la misma consulta con `clienteDePrueba()` (service_role): si
   con service_role anda y con la sesión no, es RLS.
3. **`revalidatePath` faltante.** Se guardó bien y la pantalla muestra lo viejo.
4. **Fechas y zona horaria.** El Calafate es UTC-3: un cálculo en UTC corre el borde un día. Sospechá
   siempre que el bug aparezca "solo a veces" o "cerca de medianoche".
5. **Next 16.** `cookies()` y `headers()` son `async`; `params` y `searchParams` son `Promise`. Un
   `await` faltante ahí da errores desconcertantes.
6. **Redondeo de dinero.** Error que se acumula noche a noche.

## 3. Aislar

Bajá por capas hasta encontrar dónde se rompe:

```
pantalla → Server Action → lib/domain (¿la regla pura da bien?) → consulta → RLS → dato en la base
```

`lib/domain/` es puro: probá la regla sola en un test. Si la regla da bien, el bug está más afuera.
Si da mal, ya lo encontraste y no hace falta mirar la base.

## 4. Arreglar la causa, no el síntoma

Preguntas antes de dar por buena la corrección:

- ¿Por qué el sistema permitió ese estado? ¿La base debería impedirlo con una constraint?
- ¿Hay otros lugares con el mismo patrón? Buscalos con `rg` y arreglalos todos.
- ¿El tipo permite representar el estado inválido? Modelalo mejor y el bug se vuelve imposible.

Poner un `if` que tape el caso puntual deja el mismo bug esperando en otras cinco pantallas.

## 5. Cerrar

```bash
npm test                                        # el test que fallaba ahora pasa
npm run lint && npm run typecheck && npm run build
```

- El test de regresión queda en el repo. Es la garantía de que no vuelve.
- Anotá en `docs/bitacora.md` qué era y por qué pasaba. La causa raíz es lo que vale, no el diff.

## Herramientas

```bash
rg -n "<patrón>" -g '*.ts' -g '*.tsx'    # buscar en el código
git log -S "<texto>" --oneline           # cuándo entró esa línea
git log -p <archivo>                     # historia de un archivo
npm test -- <patrón> --reporter=verbose  # detalle del test
```

`console.error` con contexto es válido para diagnosticar, pero **no queda en el commit final**
salvo que sea un log deliberado, como los de `lib/acciones.ts`.
