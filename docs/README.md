# Documentación — índice

Mapa del código y de las carpetas del repositorio: [`../ESTRUCTURA.md`](../ESTRUCTURA.md).

## 1. Tesis — `1-tesis/`

| Documento | Qué es |
|---|---|
| [tesis-completa.md](1-tesis/tesis-completa.md) · [pdf](1-tesis/tesis-completa.pdf) | La tesis completa |
| [tesis-pp3.md](1-tesis/tesis-pp3.md) · [pdf](1-tesis/tesis-pp3.pdf) | Entrega de Práctica Profesional III |
| [tesis-pp3-sistema-completo.md](1-tesis/tesis-pp3-sistema-completo.md) | PP3 con el sistema completo |
| [informe-final-pms-2026-09.md](1-tesis/informe-final-pms-2026-09.md) | Informe final del PMS |

## 2. Arquitectura — `2-arquitectura/`

| Documento | Qué es |
|---|---|
| [arquitectura.md](2-arquitectura/arquitectura.md) | Capas, dependencias y flujos |
| [modelo-datos.md](2-arquitectura/modelo-datos.md) | Tablas y relaciones |
| [modernizacion-winpax.md](2-arquitectura/modernizacion-winpax.md) | Reemplazo de WinPAX, paso a paso |
| [sincronizacion-automatica.md](2-arquitectura/sincronizacion-automatica.md) | Sincronización con canales de venta |

## 3. Manuales — `3-manuales/`

| Documento | Qué es |
|---|---|
| [manual-usuario.md](3-manuales/manual-usuario.md) | Cómo se usa el sistema |
| [manual-tecnico.md](3-manuales/manual-tecnico.md) | Cómo está hecho |
| [despliegue.md](3-manuales/despliegue.md) | Puesta en producción, variables y vuelta atrás |
| [integraciones-y-bandeja.md](3-manuales/integraciones-y-bandeja.md) | Cargar las claves de cada servicio, registrar los webhooks y conectar WhatsApp, Instagram, Messenger, correo y Telegram a la bandeja |

## 4. Seguridad y auditorías — `4-seguridad-y-auditorias/`

| Documento | Qué es |
|---|---|
| [SEGURIDAD.md](4-seguridad-y-auditorias/SEGURIDAD.md) | Modelo de seguridad |
| [AUDITORIA_INICIAL.md](4-seguridad-y-auditorias/AUDITORIA_INICIAL.md) | Primer relevamiento de seguridad |
| [revision-seguridad.md](4-seguridad-y-auditorias/revision-seguridad.md) | Revisión de seguridad |
| [auditoria-pms-2026-09.md](4-seguridad-y-auditorias/auditoria-pms-2026-09.md) | Auditoría integral del PMS |
| [audit/](4-seguridad-y-auditorias/audit/) | Pendientes y traspaso de la auditoría |
| [pulido-integral-2026-10/](4-seguridad-y-auditorias/pulido-integral-2026-10/) | Pulido integral por fases |

## 5. Pendientes — `5-pendientes/`

| Documento | Qué es |
|---|---|
| [PENDIENTES.md](5-pendientes/PENDIENTES.md) | Lista de trabajo pendiente |
| [analisis-pendientes-2026-09-09.md](5-pendientes/analisis-pendientes-2026-09-09.md) | Análisis contra sistemas de referencia |
| [pendientes-supabase.md](5-pendientes/pendientes-supabase.md) | Pendientes de la base |
| [prompt-sistema.md](5-pendientes/prompt-sistema.md) | Descripción del sistema para asistentes |

## Siempre en la raíz de `docs/`

| Documento | Qué es |
|---|---|
| [bitacora.md](bitacora.md) | Diario del desarrollo, fecha por fecha |
| [roadmap.md](roadmap.md) | Fases del proyecto |
| [decisiones/](decisiones/) | ADRs: cada decisión de arquitectura, numerada |
| [licencias/](licencias/) | Avisos de licencia de código de terceros en el que se basa el sistema (Chatwoot, MIT) |
| [wiki/](wiki/) | Páginas de la wiki de GitHub |
| [img/](img/) | Capturas usadas en la documentación |

## Dónde quedó cada archivo (reorganización del 2026-10-16)

La bitácora, los ADRs y las migraciones SQL son registro histórico y no se
reescriben: si mencionan `docs/despliegue.md`, el archivo está en
`docs/3-manuales/despliegue.md`. Todos los documentos se movieron, ninguno se borró.

| Antes | Ahora |
|---|---|
| `docs/tesis-*.md/pdf`, `docs/informe-final-pms-2026-09.md` | `docs/1-tesis/` |
| `docs/arquitectura.md`, `modelo-datos.md`, `modernizacion-winpax.md`, `sincronizacion-automatica.md` | `docs/2-arquitectura/` |
| `docs/manual-usuario.md`, `manual-tecnico.md`, `despliegue.md` | `docs/3-manuales/` |
| `docs/SEGURIDAD.md`, `AUDITORIA_INICIAL.md`, `revision-seguridad.md`, `auditoria-pms-2026-09.md`, `audit/`, `pulido-integral-2026-10/` | `docs/4-seguridad-y-auditorias/` |
| `docs/PENDIENTES.md`, `pendientes-supabase.md`, `analisis-pendientes-2026-09-09.md`, `prompt-sistema.md` | `docs/5-pendientes/` |
