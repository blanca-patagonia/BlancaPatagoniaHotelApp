# Sistema Integral de Gestión Hotelera — Hotel Blanca Patagonia

Un **PMS** (*Property Management System*) hecho a medida para el Hotel Blanca
Patagonia, en El Calafate, Santa Cruz. Cubre el ciclo completo del negocio:
reserva → estadía → consumos → pago → factura, más housekeeping, mantenimiento,
agencias, proveedores, canales de venta y reportes gerenciales.

> **Proyecto de tesis** — Analista de Sistemas, Colegio Universitario IES.
> Autores: **Octavio Fakiani** y **Santiago Morán**.

---

## El problema, en una frase

El hotel gestionaba con **WinPAX** —un sistema de Oracle Forms de alrededor del
año 2000, monousuario, instalado en una sola máquina del mostrador— más planillas
de Excel para todo lo que WinPAX no cubría, y **el 79 % de sus reservas entraban
por Booking**, pagando comisión sobre cada una.

Este sistema reemplaza lo primero y ataca lo segundo.

👉 **[El problema que resuelve](El-problema-que-resuelve)** — el detalle, con lo
que cada limitación costaba en plata y en tiempo.

---

## Qué reemplaza, punto por punto

| Antes | Ahora |
|---|---|
| WinPAX en una sola PC del mostrador | Aplicación web: el mostrador, la oficina y el teléfono de la mucama ven lo mismo |
| El overbooking lo evitaba la atención de quien cargaba | Lo **rechaza Postgres** con una restricción de exclusión: no depende de que la aplicación esté bien |
| Excel para cuentas de agencias, consumos y reportes | Módulos integrados, con la misma fuente de datos que las reservas |
| Sin web propia de reservas | Portal público con disponibilidad, precios por temporada y cobro en línea |
| Tarifas en un PDF que había que mirar a mano | Temporadas y tarifas cargadas, con neto/rack e IVA calculados por el sistema |
| Comisión de OTA sobre 8 de cada 10 reservas | Canal directo propio, y las de Booking importadas y conciliadas |

---

## El sistema en números

Todos verificables en el repositorio, no estimados.

| | |
|---|---|
| **67** migraciones SQL numeradas | **43** tablas, todas con RLS activo |
| **90+** políticas de seguridad a nivel de fila | **4** roles de staff + el huésped público sin cuenta |
| **1555** tests automatizados, **0** salteados | **94** archivos de test |
| **21** áreas del panel interno | **50** módulos de dominio puro (sin base, testeables) |
| **28** decisiones de arquitectura documentadas (ADR) | **7** puertos de integración con adaptador intercambiable |
| **15** unidades en el inventario cargado | **3** temporadas tarifarias (Anexo A 2025/2026) |

---

## Recorrido recomendado

**Si venís a entender qué hace y por qué existe:**

1. [El problema que resuelve](El-problema-que-resuelve)
2. [Módulos del panel](Modulos-del-panel)
3. [Reglas de negocio](Reglas-de-negocio)

**Si venís a entender cómo está construido:**

1. [Arquitectura](Arquitectura)
2. [Modelo de datos](Modelo-de-datos)
3. [Seguridad](Seguridad)
4. [Decisiones de arquitectura](Decisiones-de-arquitectura)

**Si lo vas a levantar o a tocar:**

1. [Puesta en marcha](Puesta-en-marcha)
2. [Preguntas frecuentes y trampas conocidas](Preguntas-frecuentes)

---

## Una advertencia sobre este wiki

Está escrito para explicar, no para reemplazar al repositorio. **La fuente de
verdad es el código y `docs/`**: si algo de acá contradice a un ADR o a un
comentario del código, el que está bien es el código.

Lo que este wiki agrega es lo que no entra en un `README`: el porqué de cada
decisión, lo que se probó y no funcionó, y los errores que costaron plata y
quedaron como reglas.
