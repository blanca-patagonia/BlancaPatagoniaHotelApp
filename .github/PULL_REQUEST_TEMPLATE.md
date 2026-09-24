## Qué cambia y por qué

<!-- Una o dos frases. El "por qué" importa más que el "qué": el diff ya muestra lo segundo. -->

Cierra #

## Tipo de cambio

- [ ] Funcionalidad nueva
- [ ] Corrección de error
- [ ] Refactor (sin cambio de comportamiento)
- [ ] Migración de base de datos
- [ ] Documentación
- [ ] Dependencias / CI

## Checklist

- [ ] `npm run typecheck` y `npm run lint` pasan
- [ ] `npm test` pasa contra la base local (`EXIGIR_DB=1`), no contra la nube
- [ ] Agregué o actualicé tests para lo que cambié
- [ ] Documentación al día (bitácora, manual o README si corresponde)

### Si toca la base de datos

- [ ] Migración nueva y numerada, sin editar migraciones ya aplicadas
- [ ] Tablas nuevas con RLS activado y políticas por rol
- [ ] Probé `npx supabase db reset` desde cero
- [ ] Las restricciones críticas (anti-overbooking, auditoría append-only) siguen intactas

### Si toma una decisión de arquitectura

- [ ] Escribí o actualicé un ADR en `docs/`

## Cómo probarlo

<!-- Pasos concretos para que quien revisa lo pueda reproducir. -->

## Capturas (si hay cambios visuales)
