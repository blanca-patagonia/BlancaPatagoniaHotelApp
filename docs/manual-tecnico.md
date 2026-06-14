# Manual técnico

> Documento en construcción. Se completa hacia la entrega final (Fase 7).

## Requisitos

- Node.js 20.9+ y npm
- Cuenta de Supabase (o Supabase CLI para entorno local)
- (Opcional) Supabase CLI para correr la base de datos local

## Puesta en marcha (desarrollo)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local   # y completar con los valores reales

# 3. Levantar la app
npm run dev                  # http://localhost:3000
```

## Base de datos (Supabase local, opcional)

```bash
supabase start               # levanta Postgres + Studio local
supabase db reset            # aplica migraciones + seed
```

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Servidor de producción |
| `npm run lint` | ESLint |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | Chequeo de tipos |

## Estructura del repositorio

Ver [arquitectura.md](arquitectura.md) y el README principal.
