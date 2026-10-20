# Auditoría inicial — Fase 0 (reconocimiento)

**Fecha:** 2026-08-07 · **Alcance:** todo el repositorio, sin modificar código.

Este informe es el punto de partida de una auditoría de seguridad y robustez.
No asume que nada esté bien: cada afirmación se apoya en una comprobación hecha
sobre el repositorio, y se indica cómo repetirla.

---

## 1. El checklist genérico no aplica tal cual

El pedido original estaba redactado para un backend Node/Express con ORM
(«Helmet», «controladores/servicios/repositorios», «queries parametrizadas»).
Este sistema **no tiene ese stack**, así que varios controles se verifican en
otro lugar. Traducción:

| Control clásico | Dónde vive acá |
|---|---|
| Middleware de autorización en Express | **RLS de PostgreSQL** + guardas `requerirAcceso` en cada pantalla |
| ORM / queries parametrizadas | **PostgREST**: no se concatena SQL; las funciones SQL usan parámetros tipados |
| Helmet (headers) | `next.config.ts` — **pendiente de verificar en Fase 1** |
| CSRF tokens | **Server Actions de Next**, que traen protección de origen incorporada |
| Rate limiting en Express | No hay servidor propio: hay que resolverlo en la acción o en el borde |
| Capa de repositorios | `lib/domain` (reglas puras) + `lib/*` (acceso a datos) |

Lo que **sí** aplica igual: gestión de secretos, validación en servidor,
exposición de datos, integridad transaccional y calidad de proceso.

---

## 2. Stack detectado

| Componente | Versión |
|---|---|
| Next.js | 16.2.9 (App Router, Server Components y Server Actions) |
| React | 19.2.4 |
| TypeScript | 5.x, `strict` |
| Supabase JS / SSR | 2.108 / 0.12 |
| PostgreSQL | 17 (vía Supabase, local con Docker) |
| Zod | 4.4.3 |
| Vitest | 3.2.6 |
| Tailwind | 4 |
| ESLint | 9 |

**Tamaño:** 44 commits · 276 archivos versionados · ~28.000 líneas
(TS/TSX/SQL/MD).

**Distribución:** `app/` 122 · `lib/` 43 · `tests/` 38 · `supabase/` 30 ·
`docs/` 23.

---

## 3. Gestión de secretos — sin hallazgos

Tres comprobaciones independientes, todas limpias:

1. **Ningún `.env` estuvo jamás en el historial.** Solo se commiteó
   `.env.example`, con placeholders.
   ```bash
   git log --all --diff-filter=A --name-only -- '.env*'
   ```
2. **Ningún token real en ningún commit.** Se recorrieron los 44 commits
   buscando patrones de JWT de Supabase, claves de Stripe, MercadoPago, Resend
   y bloques `BEGIN PRIVATE KEY`.
3. **Ningún literal sospechoso en el código actual.**

`.gitignore` cubre `.env*` con excepción explícita de `.env.example`, además de
`node_modules`, `.next`, `.vercel` y los artefactos locales del CLI de Supabase.

> **No hace falta rotar credenciales.** Este es el mejor resultado posible de
> esta sección y conviene dejarlo asentado.

### Salvedad: contraseña por defecto del seed

`scripts/seed-usuarios.mjs:26`

```js
const password = process.env.ADMIN_PASSWORD ?? 'blancadev1234'
```

Está documentada en `README.md` y `CLAUDE.md` como credencial **de
desarrollo**. El riesgo no es que esté en el repo, sino que **si alguien corre
el seed contra la base de producción sin definir `ADMIN_PASSWORD`, queda un
administrador con contraseña pública**. Se trata en la Fase 1.

---

## 4. Superficie de ataque

### Rutas accesibles sin sesión

```
/                             portada
/reservar                     buscador de disponibilidad
/reservar/checkout            alta de reserva  ← escribe en la base
/reservar/confirmacion/[token]
/encuesta/[token]             ← escribe
/firmar/[token]               ← escribe (firma de contratos)
/portal/[token]               cuenta corriente de agencias y proveedores
/login                        ← autenticación
/api/webhooks/pagos/[proveedor]  ← escribe (pagos)
```

### Uso de la clave privilegiada

`service_role` **saltea RLS por completo**. Se usa en 13 archivos. El módulo
que la expone (`lib/supabase/admin.ts`) está marcado con `server-only`, lo que
impide que un import accidental la filtre al navegador — verificado.

Siete de esos usos están en rutas públicas y son los que más importan:

| Ruta pública | Qué la protege |
|---|---|
| `/api/webhooks/pagos/…` | Verifica firma; responde 401 si falla |
| `/firmar/[token]` | Token opaco + límite por IP |
| `/encuesta/[token]` | Token opaco |
| `/portal/[token]` | Token opaco |
| `/reservar/confirmacion/[token]` | Token opaco |
| `/reservar` (alta) | Solo validación de campos |
| Asistente del portal | Límite por IP |

---

## 5. Riesgos encontrados en esta primera pasada

### 🔴 CRÍTICO — El alta pública de reservas no tiene límite de tasa

`crearReservaPublica` no aplica ninguna restricción por IP ni por sesión, y
**cada reserva pendiente bloquea una unidad durante 5 días**
(`expirar_reservas_pendientes`, migración 0011).

Consecuencia concreta: con 15 unidades, un script que envíe el formulario unas
pocas decenas de veces **deja al hotel sin inventario vendible durante cinco
días**. No es una molestia técnica: es una denegación de servicio contra el
negocio, ejecutable por cualquiera con un navegador, sin autenticarse.

Es el hallazgo más importante de esta fase.

### 🟠 ALTO — El login no tiene límite de intentos

`iniciarSesion` no limita reintentos. Supabase Auth aplica su propio límite del
lado del servidor, lo que **mitiga** la fuerza bruta pero no la registra ni la
frena antes de llegar. Sumado a que existe una contraseña por defecto conocida
y documentada, conviene tratarlo con seriedad.

### 🟠 ALTO — Contraseña de administrador por defecto

Ver §3. Un deploy que corra el seed sin `ADMIN_PASSWORD` queda con acceso
administrativo público.

### 🟡 MEDIO — La encuesta pública no tiene límite

`responderEncuesta` puede reenviarse en masa. El daño es acotado (ensucia el
NPS), pero el NPS alimenta reportes de gestión.

### 🟡 MEDIO — Validación pública sin esquema

El alta pública valida el email con una expresión regular y comprueba campos
sueltos, en lugar de usar Zod como el resto del sistema. Funciona, pero no deja
un contrato explícito de qué acepta el endpoint.

### ⚪ A VERIFICAR EN FASE 1

- Headers de seguridad (`next.config.ts`).
- Qué campos devuelven exactamente las respuestas públicas (¿se filtra PII?).
- Políticas RLS una por una: **están todas activadas, pero no se auditó qué
  permite cada política**. Que RLS esté encendida no significa que esté bien
  escrita.

---

## 6. Lo que ya está sólido

No todo es deuda; conviene registrar lo que no hay que rehacer.

- **RLS activada en las 32 tablas**, sin excepción.
- **Anti-overbooking garantizado por la base**: restricción de exclusión GiST
  sobre `estadias`. No depende de que la aplicación se acuerde de chequear.
- **342 tests** en 35 archivos, incluidos tests de integración contra Postgres
  real y tests sobre las Server Actions.
- **CI verde y verificado** en GitHub: levanta Supabase con Docker y corre
  typecheck, lint, los 342 tests y el build en cada push.
- **Auditoría de operaciones sensibles** (`auditoria`), append-only, con los
  permisos de escritura revocados a `authenticated`.
- **Ningún borde externo real**: pagos, facturación, firma, email y asistente
  son adapters con stub. No hay credenciales de terceros que filtrar.
- ESLint y TypeScript `strict` corriendo en CI.

---

## 7. Plan propuesto

| Fase | Contenido | Prioridad |
|---|---|---|
| **1** | Límite de tasa en alta pública y login · contraseña del seed · headers · auditar cada política RLS · validación con Zod en el borde público | 🔴 Crítica |
| **2** | Revisar exposición de PII en respuestas públicas · atomicidad de las operaciones multi-paso · estrategia de backup documentada | 🟠 Alta |
| **3** | Manejo de errores centralizado · logging de eventos de seguridad · `CONTRIBUTING.md` | 🟡 Media |
| **4** | Endurecer el CI (auditoría de dependencias, escaneo de secretos) | 🟡 Media |
| **5** | `ARQUITECTURA.md` con diagramas · resumen ejecutivo | ⚪ Cierre |

La Fase 2 del pedido original (integridad de datos) figura acá degradada a
«alta» y no «crítica» porque el anti-overbooking —su punto central— **ya está
resuelto en la base y probado**. Se detalla en §6.

---

## 8. Cómo repetir estas comprobaciones

```bash
# Secretos en el historial
git log --all --diff-filter=A --name-only -- '.env*'

# Tablas sin RLS (debe salir vacío)
comm -23 \
  <(grep -rhoE "^create table [a-z_]+" supabase/migrations/*.sql | awk '{print $3}' | sort -u) \
  <(grep -rhoE "alter table [a-z_]+ +enable row level security" supabase/migrations/*.sql | awk '{print $3}' | sort -u)

# Dónde se usa la clave privilegiada
grep -rln "crearClienteAdmin" app lib
```
