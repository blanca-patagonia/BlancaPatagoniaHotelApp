# Decisiones de arquitectura (ADR)

**29 decisiones documentadas en esta rama.** Un ADR se escribe cuando una decisión tiene
alternativas razonables y consecuencias que alguien va a querer entender después —
sobre todo si la decisión fue *no* hacer algo.

Es la parte del proyecto que más se lee: varias cosas que parecen faltar **están
decididas a propósito**.

> Los números saltan (no hay 0010, 0014, 0021…) porque las decisiones de los
> módulos que la rama `tesis-a-presentar` no tiene —firma de contratos, portal de
> socios, canales de venta, conciliación, aplicación instalable, bandeja de
> mensajes, asistente de IA, etc.— se quedaron en `main`. La que explica el recorte
> es el [0045](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/docs/decisiones/0045-version-reducida-para-la-tesis.md).

> Base de los enlaces: [`docs/decisiones/`](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/tree/main/docs/decisiones)

---

## Fundacionales

| # | Decisión | En una línea |
|---|---|---|
| [0001](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0001-eleccion-de-stack.md) | Elección del stack | Next.js + Supabase: un solo lenguaje, y una base relacional de verdad con RLS |
| [0002](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0002-motor-de-disponibilidad.md) | **Motor de disponibilidad sin overbooking** | La garantía es una restricción de exclusión de Postgres, no una comprobación de la app. **La decisión más importante del proyecto** |
| [0005](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0005-autenticacion-y-roles.md) | Autenticación y control de acceso por rol | Cuatro roles de staff, resueltos en la base con `rol_actual()` |
| [0009](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0009-sistema-de-diseno-del-panel.md) | Sistema de diseño del panel | Componentes compartidos e identidad propia. **Reemplazado en paleta y tipografía por el 0026**, vigente en todo lo demás |
| [0045](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/tesis-a-presentar/docs/decisiones/0045-version-reducida-para-la-tesis.md) | **Versión reducida para la tesis** | De 26 a 12 áreas del panel: se quita lo que el hotel no pidió y se deja la base intacta. `main` conserva el sistema completo |

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
| [0024](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0024-exencion-de-iva-al-turista-del-exterior.md) | Exención de IVA al turista del exterior | **Se deriva, no se tilda.** Un extranjero que paga en efectivo no está exento |
| [0027](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0027-cobro-en-linea-dos-pasarelas-y-una-sola-moneda-de-saldo.md) | Cobro en línea: dos pasarelas, una moneda de saldo | Stripe para la tarjeta del exterior y MercadoPago para pesos y cuotas. El saldo siempre en USD |
| [0038](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0038-payway-como-tercera-pasarela.md) | Payway como tercera pasarela | Posnet / tarjeta local, con el patrón de los dos pasos del lado del integrador que exige su Gateway API |

## Cara al público

| # | Decisión | En una línea |
|---|---|---|
| [0007](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0007-portal-publico-reservas.md) | Portal público de reservas | El canal propio del hotel, sin obligar al huésped a crear una cuenta |
| [0011](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0011-asistente-basado-en-reglas.md) | Asistente basado en reglas, **no LLM** | Responde lo que sabe y deriva lo que no. Un modelo que inventa una política de cancelación es peor que no tener asistente |
| [0026](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0026-interfaz-azul-y-blanca.md) | Interfaz azul y blanca | La paleta del registro visual de las plataformas de reserva. ⚠️ Los **nombres** de los tokens no cambiaron: renombrarlos rompe sin que el typecheck lo vea |
| [0033](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0033-arrastrar-una-reserva-cambia-de-habitacion-no-de-fechas.md) | Arrastrar una reserva cambia de habitación, no de fechas | Correr fechas recotiza y cambia lo que el huésped paga: no puede salir de un gesto que se dispara sin querer |

## Seguridad y verificación

| # | Decisión | En una línea |
|---|---|---|
| [0015](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0015-endurecimiento-y-verificacion.md) | Endurecimiento: qué se verifica y qué se garantiza | La diferencia entre «lo probamos» y «no puede pasar» |
| [0016](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0016-precio-neto-fuera-del-alcance-publico.md) | El precio neto, fuera del alcance público | `anon` no lee `precio_neto` ni ejecuta `cotizar_estadia`. ⚠️ Esa función **no puede ser `security definer`** o la guarda queda siempre en verdadero |
| [0017](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0017-alta-de-usuario-sin-privilegios.md) | El alta de un usuario nace sin privilegios | `sin_rol` y `activo = false`. La baja revoca en la base |
| [0018](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0018-seleccion-de-proveedor-sin-degradacion-silenciosa.md) | Los simuladores fallan fuerte en producción | Si falta la variable, el sistema **no arranca**. Un comprobante simulado que parece fiscal es peor que un error |
| [0025](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0025-verificar-la-tarjeta-sin-guardar-el-numero.md) | Verificar la tarjeta sin guardar el número | Preautorización tokenizada. Mantiene al hotel en el alcance SAQ-A de PCI-DSS |
| [0029](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0029-errores-observables-en-postgres.md) | Los errores del servidor se guardan en Postgres | No en un tercero: los datos de huéspedes no salen del sistema y el hotel no depende de mirar el log de Vercel |
| [0042](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0042-verificacion-base-aislada-esquema-e2e.md) | Cómo se verifica el sistema | Base de tests aislada (`npm run test:aislado`), comparación de esquema antes de cada deploy, tests de interfaz y recorrido de punta a punta |

## Datos y alcance

| # | Decisión | En una línea |
|---|---|---|
| [0013](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0013-alcance-erp-y-trabajo-futuro.md) | Alcance ERP: qué se implementó y qué queda | Gestión documental, seguridad por campo y multi-propiedad quedan como trabajo futuro. **No implementar sin releerlo** |
| [0037](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0037-storage-para-fotos-operativas.md) | Supabase Storage para fotos operativas | Bucket privado y acceso siempre por URL firmada generada en el servidor |
| [0040](https://github.com/blanca-patagonia/BlancaPatagoniaHotelApp/blob/main/docs/decisiones/0040-inventario-fisico-real-de-unidades.md) | Inventario físico real de unidades | Los nombres reales de habitaciones y cabañas, en vez de un catálogo representativo |

---

## Cómo se lee un ADR de este repositorio

Todos tienen la misma forma: **Estado · Fecha · Qué complementa**, después el
**contexto** (el problema real, muchas veces con lo que costaba), la **decisión**,
las **consecuencias** —incluidas las malas— y las **alternativas descartadas** con
el motivo.

La sección que más valor tiene es la última. Saber por qué *no* se hizo algo evita
que alguien lo intente de nuevo dentro de seis meses y descubra el mismo problema.
