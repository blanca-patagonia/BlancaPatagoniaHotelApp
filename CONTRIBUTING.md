# Cómo contribuir

Este es el sistema de gestión del Hotel Blanca Patagonia (proyecto de tesis, Analista de Sistemas, IES). Gracias por sumar. Esta guía cubre lo mínimo para que un cambio entre sin fricción.

## Antes de empezar

1. Levantá el entorno siguiendo el [README](README.md) y [COMO-LEVANTARLO.md](COMO-LEVANTARLO.md).
2. Los tests **nunca** se corren contra la base de la nube: usá la base local (`npx supabase start`). `tests/db.ts` corta si las variables no apuntan a una base local.
3. Si vas a hacer algo grande, abrí primero un issue con la plantilla de mejora para acordar el enfoque.

## Flujo de trabajo

- Trabajá en una rama que salga de `main`. No se commitea directo a `main`.
- Nombre de rama: `feat/…`, `fix/…`, `docs/…`, `chore/…` o `refactor/…`, corto y descriptivo.
- Mensajes de commit en español, con prefijo: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`. Explicá el *por qué*, no solo el *qué*.
- Abrí un Pull Request con la plantilla. Se asigna solo y pide revisión a la otra persona del equipo.
- Un PR chico y enfocado se revisa mejor que uno grande. Si mezcla temas, dividilo.

## Antes de abrir el PR

```bash
npm run typecheck
npm run lint
npm test          # con la base local levantada; en CI corre con EXIGIR_DB=1
```

El CI corre lo mismo y debe quedar en verde para mergear.

## Reglas del proyecto

- **Base de datos:** toda migración es nueva y numerada; no se editan migraciones ya aplicadas. Toda tabla nueva lleva RLS activado y políticas por rol. La integridad crítica (anti-overbooking, auditoría append-only) vive en la base, no en la app.
- **Tests:** un cambio de comportamiento lleva su test. No se saltean tests de integración en CI.
- **Decisiones de arquitectura:** si cambia una decisión existente o se toma una nueva, se documenta como ADR en `docs/decisiones/`.
- **Documentación:** en español. Actualizá la bitácora (`docs/bitacora.md`) y el manual que corresponda cuando el cambio sea visible para el usuario.
- **Secretos:** nunca se commitean claves. `.env.local` está ignorado; usá `.env.example` como referencia.

## Seguridad

Las vulnerabilidades no se reportan como issue público. Seguí [SECURITY.md](SECURITY.md).

## Conducta

Al participar aceptás el [Código de conducta](CODE_OF_CONDUCT.md).
