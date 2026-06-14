# ADR 0001 — Elección del stack tecnológico

- **Estado:** Aceptada
- **Fecha:** 2026-06-14

## Contexto

La PP2 propone una solución web que reemplace Winpax y reduzca la dependencia de
las OTA. El relevamiento sugirió React + Node/Express + PostgreSQL. Hay que elegir
un stack concreto que sea **moderno, escalable** y rápido de demostrar para una
tesis, apto para **producción**.

## Decisión

Usar **Next.js 16 (App Router, TypeScript)** + **Supabase** (PostgreSQL
gestionado + Auth + Storage + Realtime + Edge Functions), con **Tailwind CSS**
para la UI y despliegue en **Vercel**.

## Justificación

- Sigue siendo "React + PostgreSQL" como anticipa la tesis, pero Next.js unifica
  frontend y backend (Server Components + Route Handlers), reduciendo el código
  de infraestructura propio.
- Supabase aporta autenticación, RLS, storage y una base PostgreSQL real lista
  para producción, sin montar y mantener un servidor Express + Auth a mano.
- PostgreSQL permite resolver la integridad anti-overbooking a nivel de base de
  datos (restricciones de exclusión sobre rangos de fecha).
- Costos iniciales bajos (planes free de Vercel y Supabase) y escalado simple.

## Alternativas consideradas

- **React + Node/Express + PostgreSQL autogestionado:** máxima fidelidad con la
  redacción original de la tesis, pero más código repetitivo (auth, API, capa de
  datos) y más superficie para mantener.
- **Híbrido (Express + Supabase como Postgres):** mantiene Express pero duplica
  responsabilidades con lo que ya ofrece Supabase.

## Consecuencias

- El equipo trabaja en un único proyecto Next.js (un solo despliegue).
- Hay que conocer las convenciones de Next.js 16 (APIs async, `proxy` en lugar de
  `middleware`) y el modelo de RLS de Supabase.
