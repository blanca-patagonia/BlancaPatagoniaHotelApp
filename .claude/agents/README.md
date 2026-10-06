# Agentes del proyecto

Son **11 subagentes** especializados. Cada uno corre en su propio contexto: mira lo suyo a fondo sin
llenar el contexto principal de archivos, y devuelve un informe.

## Agentes vs. skills — cuál usar

| | `.claude/skills/` | `.claude/agents/` |
|---|---|---|
| **Qué es** | Un **procedimiento**: el paso a paso para hacer algo bien en este repo | Un **especialista**: mira mucho material y devuelve un diagnóstico |
| **Cuándo** | Cuando ya sabés qué hay que hacer | Cuando hay que averiguar qué está mal, o revisar algo entero |
| **Ejemplo** | `db-migration` te dice cómo escribir la migración | `release-manager` te dice si esa migración se puede revertir |

Se complementan: `perf-audit` (skill) da el método para medir; `explorer` (agente) encuentra dónde
está el problema.

## Los agentes

### Sobre el código

| Agente | Cuándo delegarle | Escribe |
|---|---|---|
| **`explorer`** | «¿Dónde está X?», «¿quién usa Y?», «¿cómo fluye este proceso?» | No |
| **`reviewer`** | Antes de un commit o un PR: revisa el diff contra el checklist del proyecto | No |
| **`security-auditor`** | Permisos, RLS, exposición de datos, antes de exponer algo a internet | No |
| **`test-writer`** | Cubrir código nuevo, el test de un bugfix, huecos de cobertura | Sólo `tests/` |

### Procesos de producto y operación

| Agente | Cuándo delegarle | Escribe |
|---|---|---|
| **`sre-observabilidad`** | Antes del deploy, o cuando «no sabemos por qué falló» | No |
| **`release-manager`** | Antes de desplegar, o al planificar una migración riesgosa | No |
| **`continuidad`** | Respaldos, restauración, RPO/RTO, qué pasa si un servicio externo cae | No |
| **`privacidad`** | Al agregar un campo con datos de personas, al exportar, al integrar un tercero | No |
| **`accesibilidad`** | Al terminar una pantalla, al tocar un formulario o una tabla | No |
| **`i18n`** | Huéspedes extranjeros, idiomas, formatos de fecha y moneda | No |
| **`docs-sync`** | Después de un cambio grande o antes de una entrega | Sólo documentación |

## Por qué casi todos son de sólo lectura

Porque **reportar y arreglar son dos trabajos distintos**, y mezclarlos hace mal los dos: un agente
que puede arreglar tiende a arreglar lo primero que ve en vez de terminar de mirar, y sus cambios
llegan sin que nadie haya decidido que valían la pena.

Las dos excepciones tienen el alcance acotado en su propio prompt: `test-writer` escribe únicamente
en `tests/`, y `docs-sync` únicamente en documentación —si encuentra que el error está en el código,
lo reporta y no lo toca—.

## Cómo se invocan

Se le pide al asistente que delegue: «pasale esto al `security-auditor`», «que `docs-sync` revise si
quedó algo viejo». También los elige solo cuando la tarea encaja con su descripción.

## Si agregás uno

1. **Que no se pise con otro.** Si su trabajo ya lo hace un agente existente, mejorá ese. Once
   agentes con límites claros sirven; veinte que se superponen, no.
2. **Que sea de este proyecto.** Lo que hace útil a estos agentes no es el rol genérico: son los
   datos concretos —que `pagos.monto` está siempre en USD, que PostgREST corta en 1000 filas, que
   `/panel/respaldos` no es un backup—. Un agente que podría funcionar en cualquier repositorio no
   aporta nada sobre el modelo base.
3. **Cerrale la escritura** salvo que haya un motivo fuerte, y si la abrís, acotá el alcance en el
   prompt como hacen `test-writer` y `docs-sync`.
4. **`name` igual al nombre del archivo**, y la `description` en tercera persona diciendo **cuándo**
   delegarle: es lo que lee el asistente para decidir.
5. Sumalo a esta tabla y a la de `AGENTS.md`.
