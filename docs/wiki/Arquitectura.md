# Arquitectura

Aplicación web única en **Next.js 16 (App Router)** con **Supabase**
(PostgreSQL + Auth + RLS + Storage) como backend. Despliegue previsto en Vercel.

El principio que ordena todo lo demás: **la integridad crítica vive en la base de
datos, no en la aplicación.** La app puede tener un bug; la base tiene que
rechazar igual lo que no puede pasar.

---

## Vista general

```mermaid
flowchart TB
    subgraph clientes[" "]
        H["🌐 Huésped<br/>(sin cuenta)"]
        S["👤 Staff<br/>(4 roles)"]
    end

    subgraph next["Next.js 16 — App Router"]
        POR["Portal público<br/>src/app/(front-publico)/reservar · src/app/(front-publico)/[idioma]/alojamientos"]
        PAN["Panel interno<br/>src/app/(front-gestion)/panel — 12 áreas"]
        TOK["Acceso por token<br/>src/app/(front-publico)/encuesta"]
        API["Route handlers<br/>src/app/(back-api)/api — webhook de pagos, salud, cron"]
    end

    subgraph logica["lib/ — lógica de negocio"]
        DOM["src/lib/domain<br/>57 módulos PUROS<br/>sin base, sin React"]
        SRV["availability · pricing · payments<br/>divisas · facturacion<br/>email · notificaciones · auth"]
    end

    subgraph datos["Supabase"]
        PG[("PostgreSQL<br/>RLS en todas las tablas · 127 migraciones")]
        AUTH["Auth"]
    end

    EXT["MercadoPago · Stripe · Payway<br/>DolarAPI · Resend"]

    H --> POR
    H --> TOK
    S --> PAN
    POR & PAN & TOK & API --> SRV
    SRV --> DOM
    SRV --> PG
    PAN --> AUTH
    API <--> EXT
```

---

## Las capas, y las reglas que las sostienen

```
src/app/rutas ───95──> panel/_components            (interfaz compartida)
          ──109──> src/lib/domain              (reglas puras)
          ───91──> src/lib/{auth,reservas,payments,pricing,notificaciones,
                            email,facturacion,availability,divisas,…}
          ───69──> src/lib/supabase            ← puentea la capa de datos (deuda conocida)

src/lib/servicios ──> src/lib/domain ──> src/lib/fechas
src/lib/supabase  ──> PostgreSQL + RLS
```

Tres reglas de dependencia, todas **verificables con `rg`** y no sólo declaradas (los números de arriba son archivos de `src/app/` que importan cada capa, recontados el 2026-11-10):

1. **`src/lib/domain/` es puro.** No importa `@supabase/*`, ni `next/*`, ni `react`,
   ni `zod`. Son 57 módulos de reglas que se testean sin levantar una base. Es lo
   que permite que 1197 tests corran en segundos sin ninguna base.
2. **`src/lib/` nunca importa de `src/app/`.** Cero excepciones, y hoy hay cero aristas.
3. **La lógica de negocio va en `src/lib/domain/`.** Las páginas y las acciones
   orquestan: leen, llaman al dominio, escriben. No calculan reglas.

`src/lib/supabase/admin.ts` usa la `service_role` y **saltea RLS**: es sólo de
servidor (marcado con `server-only`) y nunca recibe datos del usuario sin filtrar.

---

## Los dos frentes, separados a propósito

| | Panel interno | Portal público |
|---|---|---|
| **Ruta** | `src/app/(front-gestion)/panel` | `src/app/(front-publico)/reservar`, `src/app/(front-publico)/[idioma]/alojamientos` |
| **Quién entra** | Staff con sesión, por rol | Cualquiera, sin cuenta |
| **Qué ve** | Las áreas (de 12) que su rol permite | Catálogo, disponibilidad, checkout |
| **Datos** | Todo lo del hotel | Sólo el catálogo público |

La separación no es estética: el rol `anon` **no puede leer el precio neto**
(la tarifa de agencia) ni ejecutar la función que cotiza una estadía. Eso lo impone la base,
no la pantalla ([ADR 0016](Decisiones-de-arquitectura)).

Las funciones cara al cliente —las encuestas de satisfacción hoy; el web check-in,
si algún día se hace— van en el portal, nunca en la gestión.

Hay un tercer frente más chico: los **accesos por token**, para quien no tiene ni
puede tener cuenta —un huésped respondiendo una encuesta, o abriendo la
confirmación, el pago o la factura de su reserva desde el enlace del correo—. Un
token inválido devuelve **404 y no 401**: un 401 confirmaría que la ruta existe y
que el token tenía la forma correcta.

---

## Cómo entra y sale la información

**Escrituras: Server Actions.** Hay 26 archivos con `'use server'` en `src/app/`, la mayoría uno por módulo. Cada
acción verifica el rol con `requerirAcceso(area)` —con una guarda estructural, no
por convención— valida con `zod` y **nunca descarta el error de la base**.

**Route handlers,** para lo que no es un formulario:

| Ruta | Para qué |
|---|---|
| `/api/webhooks/pagos/[proveedor]` | Confirmación de pago. Verifica firma HMAC y **falla cerrado** |
| `/api/cotizacion` | Tipo de cambio del día |
| `/api/buscar` | Búsqueda global del panel |
| `/api/cron/notificaciones` · `salud` · `mantenimiento` | Las tres tareas programadas (`vercel.json`) |
| `/api/salud` | 200 si la base responde, 503 si no |

---

## Los cinco puertos

Todo servicio externo entra por una **interfaz** con implementación
seleccionable por variable de entorno. Es lo que permite que el sistema esté
completo y testeado sin tener las cuentas contratadas.

| Puerto | Qué abstrae | Respaldo |
|---|---|---|
| `PaymentProvider` | Cobro en línea | Simulador · **MercadoPago, Stripe y Payway escritos** |
| `EmailProvider` | Envío de correo | Simulador · **Resend escrito** |
| `FacturacionElectronicaProvider` | CAE de ARCA/AFIP | Simulador |
| `AsistenteProvider` | Asistente del portal | Reglas, **no LLM** ([ADR 0011](Decisiones-de-arquitectura)) |
| `CotizacionProvider` | Tipo de cambio | **Manual** — usa lo que cargó un admin |

Dos detalles que valen más que la tabla:

- **Los simuladores fallan fuerte en producción.** Si el entorno es productivo y
  la variable no está configurada, el sistema **no arranca**. Es deliberado: un
  comprobante simulado que parece fiscal es peor que un error
  ([ADR 0018](Decisiones-de-arquitectura)).
- **El último no tiene simulador que mienta.** Su fuente es pública y sin
  credenciales, así que el respaldo de divisas es *manual* —usa el valor que
  cargó un gerente, no uno inventado—.

`PAGO_PROVIDER` es el único que admite **varios a la vez**
(`mercadopago,stripe`, y `payway` si se contrata): el hotel es internacional y
ninguna pasarela cubre las dos puntas —la tarjeta del exterior y el pago en
pesos con cuotas—.

---

## Agregar un área nueva del panel

Se toca en **cinco lugares, y cuatro tienen que moverse juntos** o el typecheck
falla (`Area` es una unión de tipos y la navegación un `Record<Area, …>`):

1. `src/lib/domain/permisos.ts` — el área, su etiqueta y qué roles la ven
2. `src/lib/domain/navegacion.ts` — el grupo del menú (hay un test que verifica cobertura)
3. `src/app/(front-gestion)/panel/_components/shell.tsx` — la ruta y el icono
4. `src/lib/domain/ayuda.ts` — el capítulo de la Ayuda
5. `src/app/(front-gestion)/panel/_components/iconos.tsx` — si el icono es nuevo

Y la estructura de un módulo: `page.tsx` (listado) · `nuevo/page.tsx` ·
`[id]/page.tsx` · `[id]/editar/page.tsx` · `actions.ts` · `loading.tsx` · su test.

---

## Interfaz

Todas las pantallas usan los mismos componentes (`Encabezado`, `Tarjeta`, `Kpi`,
`Tabla`, `Buscador`, `Paginacion`, `Chip`…) y la misma paleta azul y blanca
([ADR 0026](Decisiones-de-arquitectura)).

El principio de diseño lo fijó el usuario del sistema y es más restrictivo que el
habitual: **nada oculto, nada manejado por URL, pensado para gente que no usa
mucho la computadora.** En concreto — está prohibido esconder una acción o un
formulario detrás de un `<details>` (se eliminaron los once que había); el alta y
la edición van en **pantalla propia**; todo campo lleva **etiqueta visible**, nunca
sólo *placeholder*; y una acción sin vuelta atrás pide confirmación.
