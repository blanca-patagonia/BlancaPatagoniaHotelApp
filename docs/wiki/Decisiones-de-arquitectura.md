# Decisiones de arquitectura (ADR)

**28 decisiones documentadas.** Un ADR se escribe cuando una decisión tiene
alternativas razonables y consecuencias que alguien va a querer entender después —
sobre todo si la decisión fue *no* hacer algo.

Es la parte del proyecto que más se lee: varias cosas que parecen faltar **están
decididas a propósito**.

> Base de los enlaces: [`docs/decisiones/`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/tree/main/docs/decisiones)

---

## Fundacionales

| # | Decisión | En una línea |
|---|---|---|
| [0001](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0001-eleccion-de-stack.md) | Elección del stack | Next.js + Supabase: un solo lenguaje, y una base relacional de verdad con RLS |
| [0002](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0002-motor-de-disponibilidad.md) | **Motor de disponibilidad sin overbooking** | La garantía es una restricción de exclusión de Postgres, no una comprobación de la app. **La decisión más importante del proyecto** |
| [0005](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0005-autenticacion-y-roles.md) | Autenticación y control de acceso por rol | Cuatro roles de staff, resueltos en la base con `rol_actual()` |
| [0009](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0009-sistema-de-diseno-del-panel.md) | Sistema de diseño del panel | Componentes compartidos e identidad propia. **Reemplazado en paleta por el 0026**, vigente en todo lo demás |

## Dinero y tarifas

| # | Decisión | En una línea |
|---|---|---|
| [0003](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0003-moneda-usd-ars.md) | Moneda: USD base, ARS a cotización | El precio de lista y el saldo son en dólares. **Lo cierra el 0020** |
| [0004](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0004-tarifas-neto-rack-iva.md) | Neto vs rack, IVA discriminado | Doble precio según el canal, e IVA calculado en el dominio y nunca almacenado sumado |
| [0006](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0006-pagos-abstraccion-e-idempotencia.md) | Pagos: abstracción e idempotencia | Un puerto para las pasarelas, y un webhook que puede recibir el mismo evento dos veces sin cobrar dos veces |
| [0008](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0008-consumos-y-factura-interna.md) | Consumos y factura interna | La cuenta del huésped y el comprobante, con AFIP preparado |
| [0012](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0012-facturacion-electronica-argentina.md) | Facturación electrónica argentina | Letra del comprobante, desglose que cierra y CUIT validado. El CAE real queda pendiente |
| [0019](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0019-cobro-efectivo-de-la-politica-de-cancelacion.md) | Cobro efectivo de la cancelación | ⏳ **Sin decidir**, pero ya tiene el dato que le faltaba: la garantía dice si hay de dónde cobrar un no-show |
| [0020](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0020-cotizacion-de-divisas.md) | Cotización de divisas | Fuente pública con respaldo **manual** y nunca bloqueante: si la fuente no responde usa lo que cargó un admin, no un número inventado. **Cierra el 0003** |
| [0023](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0023-contabilidad-de-la-comision-de-canal.md) | La comisión del canal, en dos capas | Lo que paga el huésped y lo que se lleva el canal son dos hechos distintos |
| [0024](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0024-exencion-de-iva-al-turista-del-exterior.md) | Exención de IVA al turista del exterior | **Se deriva, no se tilda.** Un extranjero que paga en efectivo no está exento |
| [0027](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0027-cobro-en-linea-dos-pasarelas-y-una-sola-moneda-de-saldo.md) | Cobro en línea: dos pasarelas, una moneda de saldo | Stripe para la tarjeta del exterior y MercadoPago para pesos y cuotas. El saldo siempre en USD |

## Cara al público

| # | Decisión | En una línea |
|---|---|---|
| [0007](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0007-portal-publico-reservas.md) | Portal público de reservas | El canal propio del hotel, sin obligar al huésped a crear una cuenta |
| [0010](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0010-contratos-y-firma-electronica.md) | Contratos y firma electrónica | Firma por token desde una vista pública, con verificación por hash |
| [0011](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0011-asistente-basado-en-reglas.md) | Asistente basado en reglas, **no LLM** | Responde lo que sabe y deriva lo que no. Un modelo que inventa una política de cancelación es peor que no tener asistente |
| [0014](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0014-portal-de-socios-por-token.md) | Portal de socios por token | Agencias y proveedores entran sin cuenta. Un token inválido devuelve 404, no 401 |
| [0026](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0026-interfaz-azul-y-blanca.md) | Interfaz azul y blanca | La paleta del registro visual de las plataformas de reserva. ⚠️ Los **nombres** de los tokens no cambiaron: renombrarlos rompe sin que el typecheck lo vea |

## Canales de venta

| # | Decisión | En una línea |
|---|---|---|
| [0021](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0021-canales-de-venta-solo-lectura.md) | Canales de venta de **sólo lectura** | Sin ser *Connectivity Partner* no se puede publicar disponibilidad. **No evita el overbooking, y se declara en el código y en la pantalla** |
| [0022](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0022-feed-ical-saliente.md) | Feed iCal de salida | Publica la ocupación y **angosta la ventana del overbooking sin cerrarla**. Por eso `publicaDisponibilidad` sigue en `false` |

## Seguridad

| # | Decisión | En una línea |
|---|---|---|
| [0015](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0015-endurecimiento-y-verificacion.md) | Endurecimiento: qué se verifica y qué se garantiza | La diferencia entre «lo probamos» y «no puede pasar» |
| [0016](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0016-precio-neto-fuera-del-alcance-publico.md) | El precio neto, fuera del alcance público | `anon` no lee `precio_neto` ni ejecuta `cotizar_estadia`. ⚠️ Esa función **no puede ser `security definer`** o la guarda queda siempre en verdadero |
| [0017](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0017-alta-de-usuario-sin-privilegios.md) | El alta de un usuario nace sin privilegios | `sin_rol` y `activo = false`. La baja revoca en la base |
| [0018](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md) | Los simuladores fallan fuerte en producción | Si falta la variable, el sistema **no arranca**. Un comprobante simulado que parece fiscal es peor que un error |
| [0025](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0025-verificar-la-tarjeta-sin-guardar-el-numero.md) | Verificar la tarjeta sin guardar el número | Preautorización tokenizada. Mantiene al hotel en el alcance SAQ-A de PCI-DSS |
| [0028](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0028-analisis-estatico-y-configuracion-de-github.md) | Análisis estático y configuración de GitHub | CodeQL versionado y no una casilla de la web; y lo que no puede vivir en el repositorio, documentado |

## Alcance

| # | Decisión | En una línea |
|---|---|---|
| [0013](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0013-alcance-erp-y-trabajo-futuro.md) | Alcance ERP: qué se implementó y qué queda | Gestión documental, seguridad por campo y multi-propiedad quedan como trabajo futuro. **No implementar sin releerlo** |

---

## Cómo se lee un ADR de este repositorio

Todos tienen la misma forma: **Estado · Fecha · Qué complementa**, después el
**contexto** (el problema real, muchas veces con lo que costaba), la **decisión**,
las **consecuencias** —incluidas las malas— y las **alternativas descartadas** con
el motivo.

La sección que más valor tiene es la última. Saber por qué *no* se hizo algo evita
que alguien lo intente de nuevo dentro de seis meses y descubra el mismo problema.
