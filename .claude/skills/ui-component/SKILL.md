---
name: ui-component
description: Crear o modificar una pantalla o componente del panel o del portal público. Usalo cuando aparezcan pantalla, formulario, listado, tabla, componente, interfaz, diseño, estados vacíos o accesibilidad. Cubre los componentes compartidos y las reglas de interfaz fijadas por el usuario del proyecto.
---

# Crear una pantalla

> Principio fijado por el usuario, no negociable: **nada oculto, nada manejado por URL, pensado para
> gente que no usa mucho la computadora.** Una recepcionista en temporada alta, con alguien esperando
> en el mostrador, no tiene tiempo de descubrir dónde está el botón.

## Componentes disponibles

Todo sale de [app/panel/_components/ui.tsx](../../../app/panel/_components/ui.tsx). **No inventes
componentes que ya existen ni escribas Tailwind suelto donde hay uno.**

| Componente | Para qué |
|---|---|
| `Pagina` | Envoltura de toda pantalla. Siempre. |
| `Encabezado` | Título, descripción, icono y botones de acción |
| `Tarjeta` | Bloque de contenido con título |
| `Kpi` | Métrica destacada, opcionalmente enlazada |
| `Tabla` + `TH`/`TD`/`FILA`/`COL_SECUNDARIA` | Listados. `COL_SECUNDARIA` oculta la columna en móvil |
| `EstadoVacio` | Listado sin resultados, con acción para salir del paso |
| `Buscador`, `Paginacion`, `BotonExportar`, `BarraHerramientas` | Barra de listado |
| `Campo` / `CAMPO` | Campo de formulario **con etiqueta visible** |
| `Mensaje` | Aviso de error u ok |
| `ExitoConPasos` | Confirmación tras guardar, con los siguientes pasos |
| `PieDeFormulario` | Botonera del formulario |
| `Etiqueta`, `Chip` | Estados y marcas |

`BotonEnvio` vive aparte, en `app/panel/_components/boton-envio.tsx`. Iconos en `iconos.tsx`.

Paleta propia (ADR 0009): `lago`, `calafate`, `stone`. Tonos: `neutro · lago · exito · alerta ·
peligro · calafate`. Variantes de botón: `primario · secundario · fantasma · peligro`.

## Reglas de interfaz (Fase 15) — se verifican en revisión

1. **Prohibido `<details>` para esconder una acción o un formulario.** Se eliminaron los 11 que había.
2. **El alta y la edición van en pantalla propia**, con un botón primario visible en el `Encabezado`
   del listado. Nada de formularios plegados dentro de la tabla.
3. **Todo campo lleva etiqueta visible** con `Campo`. Nunca solo `placeholder`: el placeholder
   desaparece al escribir y deja al usuario sin saber qué está cargando.
4. **Al guardar no se redirige solo.** Se usa `ExitoConPasos` con los siguientes pasos como botones.
5. Los `<form action={…}>` de servidor usan **`BotonEnvio`** (bloquea el doble clic).
6. `confirmar` en toda acción sin vuelta atrás.
7. Envolvé la pantalla en `Pagina`.

## Los cuatro estados — ninguno es opcional

```tsx
// Vacío: con salida, no una tabla muda
<EstadoVacio titulo="Todavía no hay proveedores" accion={{ href: '/panel/proveedores/nuevo', texto: 'Cargar el primero' }} />

// Error: mensaje humano, no un volcado técnico
{estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

// Éxito: qué pasó y qué sigue
{estado.ok && <ExitoConPasos mensaje={estado.ok} pasos={[...]} />}
```

**Loading:** va en un `loading.tsx` hermano de la `page.tsx`. Hoy hay 29 archivos de
`loading`/`error`/`not-found` para 47 páginas: si la tuya no lo tiene, agregalo.

## Accesibilidad — mínimos que se revisan

- Botón = `<button>`. Un `<div onClick>` no recibe foco ni responde a Enter.
- Icono solo, sin texto: necesita nombre accesible (`aria-label`).
- Iconos decorativos: `aria-hidden="true"`.
- `Tabla` recibe `resumen`: es la descripción accesible, completala de verdad.
- No pongas `outline-none` sin un `:focus-visible` que lo reemplace.
- Objetivo táctil mínimo 44 px en el panel: se usa desde el mostrador, a veces en tablet.

## Portal público

`app/reservar` y `app/alojamientos` usan `app/_publico/ui.tsx`, que es **otro** conjunto de
componentes. No mezcles: si trabajás en el portal, mirá primero qué hay ahí.

## Verificar

```bash
npm run lint && npm run typecheck
npm run dev     # y recorrelo a mano: vacío, error, éxito y en pantalla angosta
```

## Checklist

- [ ] Envuelto en `Pagina`, con `Encabezado`
- [ ] Sin `<details>` escondiendo acciones; alta/edición en pantalla propia
- [ ] Todo campo con `Campo` y etiqueta visible
- [ ] `BotonEnvio` en los formularios de servidor; `confirmar` si no tiene vuelta atrás
- [ ] Los cuatro estados cubiertos, `loading.tsx` incluido
- [ ] Sin colores crudos donde hay tono; sin Tailwind suelto donde hay componente
- [ ] Probado en pantalla angosta, sin scroll horizontal
