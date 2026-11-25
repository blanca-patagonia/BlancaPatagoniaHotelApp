# Documentación — índice

Mapa del código y de las carpetas del repositorio: [`../ESTRUCTURA.md`](../ESTRUCTURA.md).

> Rama `tesis-a-presentar`: es la versión reducida del sistema. Qué se quitó y qué
> quedó: [ADR 0045](decisiones/0045-version-reducida-para-la-tesis.md).

## 1. Tesis — `1-tesis/`

| Documento | Qué es |
|---|---|
| [tesis-completa.md](1-tesis/tesis-completa.md) | La tesis completa |
| [PREPARACION.md](1-tesis/PREPARACION.md) | Hoja de ruta para escribir la tesis sobre la versión reducida: qué exige la cátedra, qué hay escrito y qué falta |
| [tesis-pp3.md](1-tesis/tesis-pp3.md) | Entrega de Práctica Profesional III |

## 2. Arquitectura — `2-arquitectura/`

| Documento | Qué es |
|---|---|
| [arquitectura.md](2-arquitectura/arquitectura.md) | Capas, dependencias y flujos |
| [modelo-datos.md](2-arquitectura/modelo-datos.md) | Tablas y relaciones, y cuáles son del sistema reducido |
| [modernizacion-winpax.md](2-arquitectura/modernizacion-winpax.md) | Reemplazo de WinPAX, paso a paso |

## 3. Manuales — `3-manuales/`

| Documento | Qué es |
|---|---|
| [manual-usuario.md](3-manuales/manual-usuario.md) | Cómo se usa el sistema |
| [manual-tecnico.md](3-manuales/manual-tecnico.md) | Cómo está hecho |
| [despliegue.md](3-manuales/despliegue.md) | Puesta en producción, variables y vuelta atrás |

## 4. Seguridad y auditorías — `4-seguridad-y-auditorias/`

| Documento | Qué es |
|---|---|
| [SEGURIDAD.md](4-seguridad-y-auditorias/SEGURIDAD.md) | Modelo de seguridad |
| [AUDITORIA_INICIAL.md](4-seguridad-y-auditorias/AUDITORIA_INICIAL.md) | Primer relevamiento de seguridad |
| [revision-seguridad.md](4-seguridad-y-auditorias/revision-seguridad.md) | Revisión de seguridad |

## 5. Pendientes — `5-pendientes/`

| Documento | Qué es |
|---|---|
| [PENDIENTES.md](5-pendientes/PENDIENTES.md) | Lista de trabajo pendiente |

## Siempre en la raíz de `docs/`

| Documento | Qué es |
|---|---|
| [bitacora.md](bitacora.md) | Diario del desarrollo, fecha por fecha |
| [roadmap.md](roadmap.md) | Fases del proyecto |
| [decisiones/](decisiones/) | ADRs: cada decisión de arquitectura, numerada. Los números saltan: las decisiones de los módulos quitados siguen en `main` |
| [wiki/](wiki/) | Páginas de la wiki de GitHub. Se editan acá; mergear no las publica, hay que copiarlas a la wiki (esta rama no trae script de publicación) |
| [img/](img/) | Capturas usadas en la documentación |

La bitácora y los ADRs son registro histórico y no se reescriben: pueden nombrar
rutas, módulos o archivos que en esta rama ya no existen (ver el ADR 0045).
