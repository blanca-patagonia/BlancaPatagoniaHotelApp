# ADR 0009 — Sistema de diseño del panel e identidad visual

- **Estado:** aceptada
- **Fecha:** 2026-07-31
- **Fase:** 9 (mejora integral del panel de gestión)

## Contexto

El panel llegó a 13 módulos construidos de forma incremental (fases 2 a 8). Cada
pantalla repetía a mano las mismas clases de Tailwind, con lo cual:

- Mejorar "el panel" obligaba a editar 40+ archivos con copy-paste, y las
  pantallas se iban desincronizando entre sí (bordes, radios y espaciados
  distintos para el mismo tipo de elemento).
- Solo **Huéspedes** tenía buscador; ningún listado tenía paginación y todos
  cortaban en un `.limit(100)`/`.limit(200)` fijo, **descartando filas en
  silencio** apenas el hotel superara ese volumen.
- No existía exportación de datos, algo que gerencia necesita y que la defensa
  de la tesis requiere para mostrar resultados.
- La accesibilidad era mínima (dos `role="alert"` en todo el panel).

Además se detectaron tres defectos de base:

1. `globals.css` conservaba `font-family: Arial` del starter de Next, que pisaba
   la tipografía Geist: se descargaba en cada carga y no se usaba nunca.
2. La barra lateral era `hidden … sm:flex` sin alternativa: **desde un teléfono
   no había forma de navegar** entre secciones.
3. Existía un bloque `prefers-color-scheme: dark` que invertía las variables de
   color sin que la interfaz acompañara, dejando texto casi blanco sobre blanco.

## Decisión

**1. Identidad visual propia, tomada del entorno del hotel.** Se definen escalas
de color con nombre en `@theme` (Tailwind 4):

| Token | Referencia | Uso |
| --- | --- | --- |
| `lago` | turquesa glaciar del Lago Argentino | color principal, navegación, acciones |
| `calafate` | violeta de la baya que da nombre al pueblo | acentos y datos financieros |
| `lenga` | naranja del bosque en otoño | pendientes y alertas |
| `stone` | grises cálidos de la estepa | texto y superficies |

La tipografía combina **Geist** para la interfaz y **Fraunces** (serif) para
títulos y marca, que aporta el carácter de hostería boutique sin resignar
legibilidad en tablas densas.

**2. Componentes compartidos de servidor** en `app/panel/_components/ui.tsx`
(`Encabezado`, `Tarjeta`, `Kpi`, `Etiqueta`, `Tabla`, `EstadoVacio`, `Buscador`,
`Paginacion`, `Chip`, `BarraHerramientas`, `BotonExportar`, `Mensaje`). Son
deliberadamente **sin estado ni eventos**: cualquier página puede usarlos sin
arrastrar JavaScript al cliente.

**3. Búsqueda y paginación por URL (GET).** Los filtros viven en el querystring
y los formularios son `method="get"`. Funcionan sin JavaScript, la búsqueda se
puede compartir o guardar en favoritos, y el estado de la pantalla es siempre
reproducible. La lógica pura vive en `lib/listados.ts` y está testeada.

**4. Iconografía propia en SVG inline** (`_components/iconos.tsx`) en lugar de
sumar una librería: son pocos iconos, heredan `currentColor` y evitan una
dependencia más en un proyecto de tesis.

**5. Exportación centralizada** en `app/panel/exportar/[recurso]/route.ts`. Un
único handler concentra todas las descargas, de modo que se audita **en un solo
lugar** que cada recurso exija el permiso del área correspondiente.

## Consecuencias

**A favor**

- Mejorar el panel vuelve a ser barato: cambiar un componente impacta en los 13
  módulos a la vez.
- Los listados dejan de perder filas: la paginación informa el total real
  («26–50 de 214») en lugar de truncar sin avisar.
- El panel es usable desde un teléfono (cajón de navegación con foco, `Escape`
  y bloqueo de scroll).
- La exportación permite llevar los datos a Excel para el análisis de la tesis.

**En contra / riesgos asumidos**

- **Se eliminó el soporte de modo oscuro** en lugar de completarlo. Toda la
  interfaz está diseñada en claro; un tema oscuro real es un trabajo aparte y
  dejar las variables a medias producía texto ilegible. Queda documentado como
  deuda consciente.
- Los buscadores usan `ilike` sin índices de texto completo. Es suficiente para
  el volumen de un hotel de 15 unidades; si creciera, corresponde `pg_trgm`.
- La exportación tiene un tope de 5000 filas por archivo para no comprometer al
  servidor.

## Notas de implementación

Dos trampas encontradas y resueltas, que conviene recordar:

- **El builder de PostgREST es *thenable*.** Una función `async` que lo devuelva
  hace que el `await` de quien la llama **ejecute la consulta** en vez de
  entregar el builder para seguir encadenando. Por eso `consultaReservas()` es
  síncrona y la parte asíncrona (`filtroTermino`) devuelve texto plano.
- **`ilike` interpreta `%` y `_` como comodines.** Buscar literalmente "100%"
  devolvía la tabla entera; `terminoBusqueda()` los escapa.
- La exportación a CSV **neutraliza la inyección de fórmulas**: un huésped
  llamado `=1+1` no debe ejecutarse al abrir el archivo en Excel.
