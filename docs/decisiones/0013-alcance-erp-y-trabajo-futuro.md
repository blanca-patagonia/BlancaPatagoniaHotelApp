# ADR 0013 — Alcance ERP: qué se implementó y qué queda como trabajo futuro

- **Estado:** aceptada
- **Fecha:** 2026-08-02
- **Fase:** 11

## Contexto

Se comparó el alcance de Blanca Patagonia contra las funcionalidades típicas de
un ERP maduro (Odoo) aplicadas a hotelería, y surgieron diez áreas no cubiertas.
No todas tienen el mismo valor para una tesis de Analista de Sistemas, y el
tiempo restante está comprometido con el deploy y la vista pública de clientes.

Este ADR deja registrada la evaluación: **por qué se implementó lo que se
implementó y por qué lo demás no**. Es tan parte del trabajo de arquitectura
decidir qué queda afuera como decidir qué entra.

## Criterio de priorización

1. **Valor demostrable en la defensa** por sobre completitud funcional.
2. **Lógica de negocio propia** (testeable, defendible) por sobre integraciones
   con terceros, que en este proyecto siempre terminan siendo stubs.
3. **Coherencia con lo ya construido**: reutilizar los patrones existentes
   (adapters, tokens públicos, dominio puro, RLS) en vez de abrir frentes nuevos.

## Implementado

| Área | Qué se hizo | Por qué |
| --- | --- | --- |
| **Facturación AFIP** | Dominio fiscal completo + adapter (ADR 0012) | La lógica de comprobantes e IVA es propia y testeable |
| **Conciliación de proveedores** | Estados de comprobante, vencimientos y *aging report* | Informe clásico de cuentas por pagar, todo dominio puro |
| **Pipeline comercial** | Etapas de negociación del convenio con agencias | Bajo esfuerzo; conecta con los contratos de la Fase 10 |
| **Plantillas de comunicaciones** | Catálogo de plantillas + render con variables | Define *qué* se comunica, que es la parte que no depende del proveedor |
| **Encuestas NPS** | Tabla, trigger en check-out, encuesta pública y NPS en Reportes | KPI hotelero real que completa ADR/RevPAR |
| **Mantenimiento preventivo** | Planes recurrentes + función que genera las órdenes | Muestra diseño de tareas programadas |
| **Auditoría** | Tabla *append-only* + trigger genérico sobre pagos, tarifas y estados de reserva | Máximo valor por esfuerzo: trazabilidad en lo que mueve dinero |

## Trabajo futuro (no implementado)

### Gestión documental con Supabase Storage

**Qué sería.** Una tabla `documentos` con metadatos (título, categoría, versión,
visibilidad por rol) apuntando a objetos en un bucket de Storage: contratos
firmados en PDF, políticas internas, manuales de housekeeping.

**Por qué no ahora.** Storage introduce un modelo de permisos **paralelo** al de
RLS: hay que escribir políticas de bucket, resolver URLs firmadas con
vencimiento y decidir el versionado. Es una fase propia, no un agregado. Además
el valor incremental es bajo: los contratos ya viven en el sistema como texto
con su firma y su hash (ADR 0010).

**Cómo encararlo.** Bucket privado `documentos`; política de Storage que replique
`rol_actual()`; la tabla guarda `ruta`, `version` y `roles_visibles`; el acceso
se sirve siempre por URL firmada de corta duración generada en el servidor,
nunca exponiendo el bucket.

### Seguridad granular por campo

**Qué sería.** Que recepción vea el precio rack pero no el neto de agencia, al
estilo de los grupos de seguridad de Odoo.

**Evaluación.** El caso es **real**: `tarifas` tiene `precio_neto` y
`precio_rack`, y hoy recepción puede leer ambos. Pero PostgreSQL resuelve esto
con `GRANT` a nivel de columna, que **RLS no puede expresar**: las políticas
filtran filas, no columnas. Habría que combinar:

1. `revoke select (precio_neto) on tarifas from authenticated`, y
2. una vista `tarifas_mostrador` con las columnas permitidas, o `GRANT` por
   columna a roles de base distintos por cada rol de aplicación.

**Por qué no ahora.** El modelo actual tiene **cuatro roles de aplicación sobre
un único rol de base** (`authenticated`). Pasar a permisos por columna obliga a
crear un rol de Postgres por cada rol de negocio y a que el JWT los distinga,
que es un rediseño del modelo de seguridad completo. El riesgo real hoy es bajo:
todos los roles son empleados del mismo hotel, y la **auditoría** (implementada
en esta fase) ya deja rastro de quién mira y toca qué.

**Recomendación.** Si se avanza, hacerlo con vistas y no con `GRANT` por columna:
son más fáciles de razonar y de testear. Documentar qué campo ve qué rol en una
tabla del propio sistema, no en el código.

### Multi-propiedad (multi-tenant)

**Qué sería.** Que el sistema administre más de una hostería.

**Por qué no ahora.** El negocio real es **una sola propiedad**. Implementar
multi-tenant sin un segundo hotel que lo valide es agregar complejidad a ciegas:
toda consulta pasa a necesitar un filtro más y toda política RLS una condición
más, sin ningún caso de uso que lo justifique.

**Cómo evolucionaría.** La clave es que hoy `unidades` referencia una propiedad
**implícita**. El camino sería:

1. Tabla `propiedades` y `unidades.propiedad_id` obligatorio.
2. `perfiles.propiedad_id` (o una tabla puente para staff que trabaja en varias).
3. Una función `propiedad_actual()` análoga a `rol_actual()`, y agregar
   `propiedad_id = propiedad_actual()` a **todas** las políticas RLS.
4. Las tarifas y temporadas pasan a ser por propiedad; el motor anti-overbooking
   no cambia, porque ya opera sobre `unidad_id`.

El punto crítico: **la migración de datos existentes** (asignar todo a la
propiedad 1) y no olvidar ninguna política. Conviene hacerlo temprano si alguna
vez se decide, nunca con el sistema en producción y datos de varios años.

## Consecuencias

- El sistema queda con **cobertura funcional de ERP en lo que hace al hotel**, y
  con las tres decisiones diferidas documentadas y con un camino concreto.
- La deuda asumida está explícita: no hay repositorio documental, la seguridad
  es por área y no por campo, y el sistema es de una sola propiedad.
