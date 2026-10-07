# Sistema Integral de Gestión Hotelera — Hotel Blanca Patagonia

**Documentación técnica del proyecto.**

| | |
|---|---|
| **Institución** | Colegio Universitario IES — Analista de Sistemas |
| **Autores** | Octavio Fakiani · Santiago Morán |
| **Establecimiento** | Hotel Blanca Patagonia — El Calafate, provincia de Santa Cruz |
| **Naturaleza** | Proyecto de tesis |
| **Estado** | Sistema desarrollado y verificado; despliegue en producción pendiente |
| **Última revisión** | 26 de agosto de 2026 |

---

## Qué es

Un **PMS** (*Property Management System*) desarrollado a medida para el Hotel
Blanca Patagonia. Cubre el ciclo completo del negocio —reserva → estadía →
consumos → pago → factura— e incorpora housekeeping, mantenimiento, cuentas de
agencias y proveedores, canales de venta y reportes gerenciales.

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
| Excel para cuentas de agencias, consumos y reportes | Módulos integrados sobre la misma base de datos que las reservas |
| Sin canal de venta propio | Portal público con disponibilidad, precios por temporada y cobro en línea |
| Tarifas consultadas manualmente en un documento | Temporadas y tarifas parametrizadas, con neto/rack e IVA calculados por el sistema |
| Comisión de OTA sobre 8 de cada 10 reservas | Canal directo propio; las reservas de Booking se importan y concilian |

---

## El sistema en cifras

Todas verificables en el repositorio.

| | |
|---|---|
| **67** migraciones SQL numeradas | **43** tablas, todas con RLS activo |
| **90+** políticas de seguridad a nivel de fila | **4** roles de personal + huésped público sin cuenta |
| **1555** pruebas automatizadas, **0** omitidas | **94** archivos de prueba |
| **21** áreas del panel interno | **50** módulos de dominio puro, verificables sin base de datos |
| **28** decisiones de arquitectura documentadas (ADR) | **7** puertos de integración con adaptador intercambiable |
| **15** unidades en el inventario cargado | **3** temporadas tarifarias (Anexo A 2025/2026) |

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
dentro del repositorio principal, y se publican aquí mediante un procedimiento
documentado. Toda corrección debe realizarse allí.
