# ADR 0002 — Motor de disponibilidad sin overbooking

- **Estado:** Aceptada
- **Fecha:** 2026-06-14

## Contexto

El principal problema detectado en la PP2 (sección 3.1) es el **riesgo de
overbooking**: la disponibilidad se verifica a mano en planillas y dos
recepcionistas pueden reservar la misma habitación al mismo tiempo.

## Decisión

Garantizar la no-superposición de reservas **a nivel de base de datos**, mediante
una **restricción de exclusión** de PostgreSQL sobre la tabla de ocupación:

```sql
create extension if not exists btree_gist;

-- En la tabla de estadías / reserva_unidad:
alter table estadias
  add constraint estadias_sin_solape
  exclude using gist (
    unidad_id with =,
    periodo   with &&
  )
  where (estado in ('confirmada', 'in_house'));
```

Donde `periodo` es un `daterange` `[check_in, check_out)`. Las confirmaciones de
reserva se ejecutan dentro de una **transacción**, de modo que la propia base de
datos rechaza cualquier intento de solapamiento, sin depender de validaciones en
la aplicación.

## Justificación

- Es **imposible** introducir un overbooking aunque dos requests lleguen
  simultáneamente: la garantía vive en el motor de datos, no en la app.
- Es eficiente: el índice GiST también acelera las consultas de disponibilidad.
- Cumple directamente el diagnóstico de la tesis.

## Consecuencias

- Requiere la extensión `btree_gist`.
- La lógica de aplicación debe **manejar el error** de violación de la restricción
  y traducirlo a un mensaje claro ("la unidad ya no está disponible").
- Se implementa y prueba en la **Fase 1** (con un test que verifica que un solape
  falla).
