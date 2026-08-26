# Configuración del repositorio en GitHub

Este documento cubre la parte de la calidad del proyecto que **no vive en el
código**: lo que hay que activar desde la web de GitHub y que ningún archivo del
repositorio puede encender por su cuenta.

Existe porque es la parte que se olvida. Un workflow roto se nota —el check queda
en rojo—; una casilla apagada no se nota nunca: la pestaña simplemente está vacía
y parece que no hay nada que reportar.

> **Estado al 2026-08-26.** Los estados de la tabla salen del panel
> **Security and quality** del repositorio en esa fecha. Si ya los activaste,
> actualizá la columna.

---

## 1. Lo que sí está versionado

Estos archivos viajan con el repositorio, se revisan en un PR y funcionan en
cualquier clon o fork. No hay nada que tocar en la web para que anden.

| Archivo | Qué hace |
|---|---|
| `.github/workflows/ci.yml` | Levanta Postgres con Docker y corre `npm audit`, typecheck, lint, la suite completa con `EXIGIR_DB=1` y el build |
| `.github/workflows/codeql.yml` | Análisis estático de seguridad sobre el código propio (ADR 0028). **Es lo que resuelve el «Code scanning · Needs setup» del panel** |
| `.github/workflows/dependency-review.yml` | Bloquea el PR que introduce una dependencia con vulnerabilidad alta o crítica |
| `.github/dependabot.yml` | Propone actualizaciones de dependencias, semanales (npm) y mensuales (actions) |
| `.github/ISSUE_TEMPLATE/` | Dos plantillas de issue —error y mejora— que piden el rol y el área, que es lo que hace falta para reproducir un bug de este sistema |
| `.github/pull_request_template.md` | La Definition of Done de `AGENTS.md` como checklist, más lo específico de las migraciones |
| `.github/CODEOWNERS` | Pide la revisión de los dos autores en cada PR |
| `SECURITY.md` | La política de seguridad: alcance, cómo reportar, qué defiende el sistema y sus límites |

---

## 2. El panel «Security and quality»

Se llega por la pestaña **Security** del repositorio. Cada renglón tiene su botón
para activarlo ahí mismo.

**Los cinco son gratis en este repositorio**, porque es público. No hay que
contratar nada ni activar una prueba.

| Función | Estado | Quién lo resuelve |
|---|---|---|
| Security policy | ✅ Activa | `SECURITY.md` |
| Security advisories | ✅ Activa | — |
| **Private vulnerability reporting** | ❌ Apagada | Un botón (§2.1) |
| **Dependabot alerts** | ❌ Apagada | Un botón (§2.2) |
| **Code scanning** | ⚙️ «Needs setup» | Ya lo resuelve `codeql.yml` (§2.3) |
| **Secret scanning** | ❌ Apagada | Un botón (§2.4) |
| **Code quality findings** | ❌ Apagada | Un botón, y va último (§2.5) |

### 2.1 Private vulnerability reporting — primero, porque hoy hay una promesa rota

`SECURITY.md` dice, textual: *«Usá la pestaña Security → Report a vulnerability de
este repositorio»*. **Ese botón no existe mientras esta opción esté apagada.**

O sea que hoy le estamos pidiendo a quien encuentre un problema que use un canal
que no está abierto. Las dos salidas que le quedan son malas: publicarlo en un
issue —que es exactamente lo que el documento pide no hacer— o no reportarlo.

Activarla crea un canal privado entre quien reporta y los dos autores, con su
propio hilo, sin exponer nada hasta que esté arreglado.

**Cómo:** Security → Overview → **Enable vulnerability reporting**.

### 2.2 Dependabot alerts — lo que falta para que el Dependabot que ya tenemos sirva de verdad

Acá hay una confusión fácil, y conviene dejarla escrita porque el repositorio se
ve cubierto cuando no lo está del todo.

Dependabot hace **dos cosas distintas**:

- **Version updates** — las configura `.github/dependabot.yml`, ya funcionan y son
  los siete PRs de dependencias abiertos hoy. Suben versiones porque salió una
  nueva, sin mirar si había una vulnerabilidad.
- **Security updates** — abren un PR *porque se publicó una vulnerabilidad* que
  nos afecta, sin esperar al lunes. **Necesitan que las alertas estén
  encendidas.** Con esta casilla apagada, no existen.

El `npm audit` del CI tapa parte del hueco, pero sólo parte: corre **cuando
alguien hace push**. Una vulnerabilidad publicada un viernes en una semana sin
commits no la ve nadie hasta el siguiente push, que en un proyecto de tesis puede
ser dentro de quince días. La alerta llega igual aunque el repositorio esté
quieto.

**Cómo:** Security → Overview → **Enable Dependabot alerts**. Después, en Settings
→ Code security, activar también **Dependabot security updates** (es la que abre
el PR) y, si molesta el volumen, **Grouped security updates**.

### 2.3 Code scanning — resuelto por `codeql.yml`

No hay botón que apretar: el panel dice «Needs setup» porque no había ningún
análisis configurado, y a partir de este cambio lo hay
(`.github/workflows/codeql.yml`). En cuanto el workflow corra sobre `main`, la
pestaña pasa a mostrar los hallazgos.

Qué mira que hoy no mira nada: el CI cubre las **dependencias** (`npm audit`), los
**tipos** (`tsc`) y el **estilo** (ESLint). Ninguno mira el código propio buscando
patrones de vulnerabilidad —un dato del request que llega a una consulta, una
redirección abierta, una expresión regular que se cuelga—, que son bugs con el
tipo perfectamente correcto.

El porqué de hacerlo con un workflow versionado en vez del *default setup* de la
web está en el [ADR 0028](decisiones/0028-analisis-estatico-y-configuracion-de-github.md).

**Qué esperar la primera vez:** con `security-extended` es normal que aparezcan
hallazgos, y varios van a ser falsos positivos. Se descartan de a uno con
*Dismiss* **poniendo el motivo**, que queda registrado. Un panel que nadie triaja
es igual de inútil que uno apagado.

### 2.4 Secret scanning y push protection — el que más importa el día del deploy

Hoy el repositorio no tiene secretos: `.env.local` está en `.gitignore`, las claves
del stack local de Supabase son públicas por diseño y hay un hook que bloquea las
escrituras sobre `.env*`.

El riesgo no es el pasado, es el futuro. El deploy a Vercel y a Supabase cloud
está pendiente, y ese es el día en que aparecen por primera vez un
`SUPABASE_SERVICE_ROLE_KEY` real, un `STRIPE_SECRET_KEY` y un
`MERCADOPAGO_ACCESS_TOKEN` — justo las variables que `CLAUDE.md` lista como
obligatorias en producción. **Un secreto que llega al historial ya está
comprometido**: borrarlo con un commit no lo saca, hay que rotarlo.

Lo que vale de verdad es el **push protection**: rechaza el push *antes* de que el
secreto entre al historial. El hook local ya cubre el caso de escribir un `.env`,
pero no cubre el token pegado dentro de un `.ts`, ni un push hecho desde otra
máquina o desde la web.

**Cómo:** Security → Overview → **Enable in settings**, y activar tanto el escaneo
como **Push protection**.

### 2.5 Code quality findings — último, y a propósito

Es la función más nueva del panel y la que menos aporta acá: buena parte de lo que
señala ya lo cubren ESLint y el typecheck, que corren en cada push y fallan el
build. Sumarla antes de haber triado la salida de CodeQL deja dos paneles con
hallazgos sin mirar, y la señal se pierde entre el ruido.

Conviene activarla **después** de que CodeQL esté en cero pendientes, y confirmar
en el propio botón las condiciones que GitHub muestre para este repositorio.

---

## 3. Reglas de rama sobre `main`

`AGENTS.md` dice «no hagas `git push --force` ni trabajes directo sobre `main`».
Hoy eso es una regla escrita: nada la impone. Una ruleset la convierte en algo que
GitHub rechaza.

**Settings → Rules → Rulesets → New branch ruleset**, apuntando a `main`:

| Regla | Por qué |
|---|---|
| Require a pull request before merging | Es lo que hace que `CODEOWNERS` sirva: sin PR no hay revisión que pedir |
| Require status checks to pass → `verificar` (CI) | El CI ya es verde y verificado; esto impide mergear el día que deje de serlo |
| Block force pushes | La regla de `AGENTS.md`, impuesta |
| Restrict deletions | `main` es la única línea del proyecto |

Con dos personas conviene **no** exigir aprobación obligatoria salvo que ambos
estén activos: si uno se va de viaje en la semana de entrega, la regla bloquea el
repositorio. `CODEOWNERS` igual pide la revisión, que es el 90 % del beneficio sin
el riesgo de quedar trabados.

---

## 4. Cómo verificar que quedó bien

Después de activar todo, la pestaña **Security → Overview** no debería tener
ningún «Disabled» ni ningún «Needs setup». Además:

1. **Code scanning:** Actions → workflow «CodeQL» → tiene que haber una corrida
   verde sobre `main`, y la pestaña Security → Code scanning tiene que listar
   hallazgos o decir que no hay ninguno (las dos cosas son un resultado; «Needs
   setup» no lo es).
2. **Dependency review:** abrir cualquier PR que toque `package-lock.json` — los
   de Dependabot sirven — y ver el check «Dependencias nuevas del PR».
3. **Private vulnerability reporting:** en Security → Advisories tiene que
   aparecer el botón *Report a vulnerability*, que es el que `SECURITY.md` promete.
4. **Push protection:** no hace falta probarlo con un secreto real. Alcanza con
   ver la casilla activada.

---

## 5. Lo que este documento no cubre

- Las variables de entorno del deploy (Vercel y Supabase cloud): van en
  `.env.example` y en `CLAUDE.md`, y **nunca** en el repositorio.
- Los *secrets* de Actions: el CI de hoy no usa ninguno, a propósito — levanta su
  propia base con Docker y sus claves son las públicas del stack local.
- La configuración del proyecto Supabase hosted, que todavía no existe.
