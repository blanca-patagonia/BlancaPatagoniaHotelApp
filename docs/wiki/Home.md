# Sistema Integral de Gestión Hotelera — Hotel Blanca Patagonia

**Documentación técnica del proyecto.**

| | |
|---|---|
| **Institución** | Colegio Universitario IES — Analista de Sistemas |
| **Autores** | Octavio Fakiani · Santiago Morán |
| **Establecimiento** | Hotel Blanca Patagonia — El Calafate, provincia de Santa Cruz |
| **Naturaleza** | Proyecto de tesis |
| **Versión** | Rama `tesis-a-presentar`: la versión **reducida** para presentar la tesis ([ADR 0045](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/docs/decisiones/0045-version-reducida-para-la-tesis.md)). `main` conserva el sistema completo |
| **Estado** | Sistema desarrollado; despliegue en producción pendiente |
| **Última revisión** | 10 de noviembre de 2026 |

---

## Qué es

Un **PMS** (*Property Management System*) desarrollado a medida para el Hotel
Blanca Patagonia. Cubre el ciclo completo del negocio —reserva → estadía →
consumos → pago → factura— e incorpora huéspedes, housekeeping y reportes
gerenciales. Esta versión se recortó a lo que pidió el hotel: no incluye bandeja
de mensajes, asistente de IA, canales de venta, conciliación, contratos, agencias,
proveedores, mantenimiento, aplicación instalable ni respaldos.

Reemplaza el sistema heredado del establecimiento y las planillas de cálculo que
lo complementaban, y suma un canal de venta propio.

---

## El problema, en una frase

El hotel operaba con **WinPAX** —un sistema desarrollado en Oracle Forms alrededor
del año 2000, monousuario e instalado en un único equipo del mostrador—
complementado con planillas de Excel, y **el 79 % de sus reservas ingresaba por
Booking**, con la comisión correspondiente sobre cada una.

Este sistema sustituye lo primero y reduce lo segundo.

📄 **[El problema que resuelve](El-problema-que-resuelve)** — análisis detallado,
con el costo concreto de cada limitación.

---

## Qué reemplaza

| Situación anterior | Situación actual |
|---|---|
| WinPAX en un único equipo del mostrador | Aplicación web: mostrador, oficina y personal de piso acceden a la misma información |
| El overbooking se evitaba por la atención del operador | Lo **rechaza PostgreSQL** mediante una restricción de exclusión: no depende de la corrección de la aplicación |
| Excel para consumos y reportes | Módulos integrados sobre la misma base de datos que las reservas |
| Sin canal de venta propio | Portal público con disponibilidad, precios por temporada y cobro en línea |
| Tarifas consultadas manualmente en un documento | Temporadas y tarifas parametrizadas, con neto/rack e IVA calculados por el sistema |
| Comisión de OTA sobre 8 de cada 10 reservas | Canal directo propio, para ir reduciendo esa dependencia |

---

## El sistema en cifras

Todas verificables en el repositorio (recontadas el 2026-11-10).

| | |
|---|---|
| **127** migraciones SQL numeradas | **69** tablas, todas con RLS activo (30 las usa el sistema reducido) |
| **1780** pruebas en **141** archivos | **1197** corren sin base de datos; las otras **583** necesitan Postgres |
| **12** áreas del panel interno | **55** pantallas |
| **57** módulos de dominio puro, verificables sin base de datos | **4** roles de personal + huésped público sin cuenta |
| **29** decisiones de arquitectura (ADR) | **5** puertos de integración con adaptador intercambiable |
| **37** unidades en el inventario real, en 10 tipos | **3** temporadas tarifarias (Anexo A 2025/2026) |

La suite completa contra la base aislada no se corrió desde esta rama (ver el ADR 0045).

---

## Organización de la documentación

**Para comprender qué hace el sistema y por qué existe**

1. [El problema que resuelve](El-problema-que-resuelve)
2. [Módulos del panel](Modulos-del-panel)
3. [Reglas de negocio](Reglas-de-negocio)

**Para comprender cómo está construido**

1. [Arquitectura](Arquitectura)
2. [Modelo de datos](Modelo-de-datos)
3. [Seguridad](Seguridad)
4. [Decisiones de arquitectura](Decisiones-de-arquitectura)

**Para instalarlo o modificarlo**

1. [Puesta en marcha](Puesta-en-marcha)
2. [Preguntas frecuentes y trampas conocidas](Preguntas-frecuentes)

---

## Alcance y vigencia de este documento

Este wiki tiene finalidad explicativa y **no sustituye al repositorio**. La fuente
de verdad es el código fuente y el directorio `docs/`: ante cualquier
discrepancia entre una afirmación de estas páginas y un ADR o un comentario del
código, **prevalece el código**.

Lo que esta documentación aporta, y que no corresponde a un archivo `README`, es
el fundamento de cada decisión, las alternativas evaluadas y descartadas, y los
errores que tuvieron un costo real durante el desarrollo y quedaron formulados
como reglas del proyecto.

Las páginas se redactan y versionan en
[`docs/wiki/`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/tree/main/docs/wiki)
dentro del repositorio principal, y se copian a esta wiki aparte: mergear no las
publica. Toda corrección debe realizarse allí.
