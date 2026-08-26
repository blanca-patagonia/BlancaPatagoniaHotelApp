# El wiki: qué es, dónde vive y cómo se publica

Las páginas del wiki del repositorio **se escriben y se versionan en
[`docs/wiki/`](wiki/)**, no en la web de GitHub.

## Por qué acá y no directamente en el wiki

El wiki de GitHub es un repositorio git aparte: el mismo nombre con el sufijo
`.wiki.git`. Eso trae dos problemas si se edita sólo desde la web:

1. **No pasa por un pull request.** Nadie revisa lo que se publica, y el
   historial queda fuera del repositorio principal.
2. **Se desincroniza del código sin que nada avise.** Un wiki que describe una
   arquitectura que ya cambió es peor que no tener wiki: se le cree.

Teniendo las páginas en `docs/wiki/`, un cambio que rompa lo que el wiki afirma se
ve en el mismo diff que el cambio de código.

## Las páginas

| Archivo | Página | De qué trata |
|---|---|---|
| `Home.md` | **Home** | Portada: qué es, qué reemplaza, los números y el mapa del wiki |
| `El-problema-que-resuelve.md` | El problema que resuelve | El hotel, WinPAX, el 79 % de OTAs, los cinco problemas de fondo y qué **no** resuelve |
| `Arquitectura.md` | Arquitectura | Capas, reglas de dependencia, los dos frentes y los siete puertos |
| `Modelo-de-datos.md` | Modelo de datos | Las 43 tablas por dominio y las garantías que impone la base |
| `Modulos-del-panel.md` | Módulos del panel | Las 21 áreas, quién ve qué y el portal público |
| `Reglas-de-negocio.md` | Reglas de negocio | Estados, tarifas, IVA, monedas, cancelación, garantías |
| `Seguridad.md` | Seguridad | El enfoque, las capas, la auditoría y lo pendiente |
| `Decisiones-de-arquitectura.md` | Decisiones (ADR) | Los 28 ADRs, agrupados y con una línea cada uno |
| `Puesta-en-marcha.md` | Puesta en marcha | Instalación, comandos, las dos trampas de los tests y el deploy |
| `Preguntas-frecuentes.md` | Preguntas frecuentes | «Por qué está hecho así» + el inventario de trampas |
| `_Sidebar.md` | *(navegación lateral)* | Se muestra en todas las páginas |
| `_Footer.md` | *(pie)* | Ídem |

GitHub arma el título de cada página a partir del nombre del archivo, cambiando
los guiones por espacios. **No hay que renombrarlos**: los enlaces entre páginas
usan esos nombres.

## Publicar

### La primera vez

GitHub **no crea** el repositorio `.wiki.git` hasta que exista una página. Hay que
crearla una única vez desde la web:

1. Abrir https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/wiki/_new
2. Título: `Home`
3. Pegar el contenido de [`docs/wiki/Home.md`](wiki/Home.md)
4. Guardar

### Después, y cada vez que cambie algo

```bash
bash scripts/publicar-wiki.sh
```

El script clona el wiki en un directorio temporal, copia las páginas, commitea y
pushea. Si no hay cambios, no hace nada.

Requiere credenciales de escritura de GitHub configuradas en la máquina — las
mismas con las que se pushea el repositorio principal.

### A mano, si se prefiere

```bash
git clone https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp.wiki.git
cp docs/wiki/*.md BlancaPatagoniaHotelApp.wiki/
cd BlancaPatagoniaHotelApp.wiki
git add -A && git commit -m "docs: sincronizar el wiki" && git push
```

## Al tocar el wiki

- **Los números se verifican, no se recuerdan.** Las cifras que hay en las páginas
  (43 tablas, 67 migraciones, 1555 tests, 28 ADRs, 21 áreas) salen del repositorio.
  Si cambian, hay que actualizarlas o sacarlas.
- **La fuente de verdad es el código y `docs/`.** El wiki explica; no reemplaza a
  un ADR ni a un comentario del código. Si se contradicen, el que está bien es el
  código.
- **Publicar es un paso aparte.** Mergear a `main` no actualiza el wiki: hay que
  correr el script.
