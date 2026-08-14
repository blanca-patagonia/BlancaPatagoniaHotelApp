---
name: revisar-seguridad
description: Revisar seguridad del código. Usalo cuando se hable de seguridad, AppSec, RLS, permisos, autorización, IDOR, inyección, XSS, secretos, tokens, exposición de datos o rate limiting, y antes de exponer algo a internet. Checklist específico de este stack (Next 16 + Supabase + RLS).
---

# Revisión de seguridad

Este stack tiene fallas propias que no aparecen en un checklist genérico de OWASP. Revisá estas.

## 1. Server Actions = endpoints HTTP públicos

Es la falla más grave y más frecuente de este stack. Cualquiera puede invocar una Server Action con
un POST sin pasar por tu pantalla.

```bash
rg -n "'use server'" -g '*.ts' -g '*.tsx' app lib
```

Por cada una: ¿verifica el rol **por sí misma** con `requerirAcceso(area)`? Que la página lo haya
hecho no protege nada.

**Caso real del repo:** `app/panel/huespedes/actions.ts:26` define un `exigirAcceso` local que solo
comprueba que exista sesión, sin mirar el rol. Cualquier usuario autenticado —incluido housekeeping—
puede crear y editar huéspedes.

## 2. RLS: la única barrera real

Los `GRANT` de `0006_grants_api.sql:14` le dan a `authenticated` select/insert/update/delete sobre
**todas** las tablas. Lo único que separa a un usuario de la base entera son las ~60 políticas RLS.

Por cada tabla: ¿RLS activado? ¿hay política para SELECT / INSERT / UPDATE / DELETE? ¿el `for all`
tiene su `with check`? ¿alguna alcanza a `anon` sin querer?

```bash
rg -n "enable row level security|create policy|using \(true\)" supabase/migrations
```

`using (true)` sobre una tabla con datos personales es un hallazgo, no un atajo.

## 3. Quién puede darse de alta

Verificá el default con que nace un perfil y si el auto-registro está habilitado:

```bash
rg -n "default 'recepcion'|enable_signup" supabase/migrations supabase/config.toml
```

Si el signup público está abierto y el trigger de alta asigna un rol con privilegios, **cualquiera en
internet es staff**. La clave `anon` viaja al navegador por diseño: verificalo con
`rg -l "<clave>" .next/static` después de un build.

## 4. El cliente admin saltea RLS

```bash
rg -n "from '@/lib/supabase/admin'" -g '*.ts' -g '*.tsx' app lib
```

`lib/supabase/admin.ts` usa `service_role`: ignora todas las políticas. Cada uso debe estar en el
servidor y **nunca** recibir un identificador del usuario sin filtrar antes por alcance.

## 5. IDOR

Toda acción que recibe un `id` de la request: ¿comprueba que ese registro pertenezca al alcance del
rol, o confía en que el id vino de una pantalla legítima? Un id en un `formData` lo pone cualquiera.

## 6. Inyección en filtros de PostgREST

`.or()`, `.filter()` y `.textSearch()` interpolan strings: texto del usuario sin escapar permite
inyectar condiciones y saltear el filtro.

```bash
rg -n "\.or\(|\.filter\(|\.textSearch\(" -g '*.ts' -g '*.tsx' app lib
```

## 7. Tokens públicos

`app/portal/[token]`, `app/firmar/[token]`, `app/encuesta/[token]` son superficie sin login. Por cada
uno: ¿el token se genera con `crypto` y suficiente entropía (nunca `Math.random()`)? ¿caduca? ¿se
revoca al usarse? ¿el error distingue "no existe" de "expirado" (enumeración)? ¿la página filtra
más datos de los necesarios?

## 8. Fuga al bundle del cliente

Todo prop de un componente `'use client'` viaja al navegador en el payload de RSC, aunque no se
renderice. Buscá precios neto, PII y tokens pasados a componentes cliente. Solo las variables
`NEXT_PUBLIC_*` deben llegar al navegador.

## 9. Secretos

```bash
rg -n "sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}" --hidden -g '!node_modules' -g '!.next' .
```

Revisá también el historial de git, no solo el árbol actual.

## 10. Límite de tasa

`lib/domain/limites.ts` + migración `0029`. ¿Cubre login, reservas, encuestas **y** los endpoints de
token? ¿O solo el login? Ojo: un contador en memoria no funciona en serverless — cada request puede
caer en otra instancia.

## Formato del hallazgo

Cada uno con: **evidencia (`archivo:línea`) → vector de ataque concreto → severidad → remediación con
código → esfuerzo**. Sin vector de ataque reproducible no es un hallazgo, es una corazonada. Y una
corazonada reportada como hallazgo quema la credibilidad de toda la revisión.
