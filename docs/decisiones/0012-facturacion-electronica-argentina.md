# ADR 0012 — Facturación electrónica argentina (AFIP/ARCA)

- **Estado:** aceptada
- **Fecha:** 2026-08-02
- **Fase:** 11

## Contexto

La Fase 5 dejó una factura **interna**: un comprobante imprimible con número
propio (`FAC-20260802-A1B2`) que sirve para cerrar la cuenta del huésped, pero
que no tiene ninguna validez fiscal. La migración 0010 ya había reservado las
columnas `cae`, `cae_vto`, `punto_venta` y `tipo_comprobante` anticipando esto.

Un hotel real en Argentina no puede operar así: está obligado a emitir
comprobantes electrónicos autorizados por AFIP (hoy ARCA) mediante el web
service WSFEv1, que devuelve un **CAE** (Código de Autorización Electrónico) con
su fecha de vencimiento.

## Decisión

**1. El modelo fiscal se implementa completo; la conexión con el organismo, no.**

Se incorpora al dominio lo que define el régimen y que es lógica pura,
verificable y que no depende de ningún servicio externo:

- **Letra del comprobante** según la condición frente al IVA de emisor y
  receptor: entre responsables inscriptos corresponde **A**; de responsable
  inscripto a consumidor final, **B**; un emisor monotributista siempre emite
  **C**.
- **Discriminación del IVA**: solo la factura A lo muestra como renglón aparte,
  y solo ella exige el CUIT del receptor.
- **Desglose del impuesto** a partir del importe final. Las tarifas del hotel se
  publican con IVA incluido, así que el cálculo es `neto = total / (1 + alícuota)`.
  El IVA se obtiene **por diferencia** para garantizar que `neto + iva === total`
  aunque el redondeo de cada parte por separado no cerrara.
- **Validación de CUIT** con su dígito verificador (módulo 11), que evita cargar
  un CUIT mal tipeado en una factura A que AFIP rechazaría.
- **Numeración oficial** `PPPP-NNNNNNNN` y **vigencia del CAE**.

Todo esto vive en `lib/domain/facturacion.ts` y está cubierto por 17 tests.

**2. Un adapter más, con el patrón ya establecido.**

`FacturacionElectronicaProvider` es el **cuarto** adapter del proyecto, después
de `PaymentProvider`, `FirmaElectronicaProvider` y `AsistenteProvider`. La
implementación vigente es un proveedor **simulado** que reproduce dos
comportamientos reales de AFIP porque condicionan la interfaz:

1. rechaza una factura A sin CUIT de receptor;
2. devuelve el CAE con fecha de vencimiento.

Conectar el WSFEv1 real es escribir una clase que implemente la interfaz y
cambiar `FACTURACION_PROVIDER`.

**3. La condición fiscal se guarda en la contraparte, no en la factura.**

`agencias.condicion_iva` (por defecto responsable inscripto) y
`huespedes.condicion_iva` (por defecto consumidor final). Así la letra del
comprobante se deduce sola en lugar de tener que elegirla a mano cada vez.

## Por qué no se integra AFIP de verdad

- Exige un **certificado digital** emitido por AFIP y una clave privada asociada
  a un CUIT real, con un trámite presencial. No es algo que se pueda incluir en
  un repositorio de tesis.
- Obliga a operar contra **homologación** primero y luego producción, con
  numeración correlativa que, una vez emitida, no se puede deshacer: un error
  en una demo dejaría comprobantes fiscales reales colgados.
- Es coherente con el resto del proyecto: no hay pasarela de pago real, ni
  proveedor de email real, ni firma digital legal. Todos los bordes con el mundo
  exterior son stubs documentados.

## Consecuencias

**A favor**

- La parte difícil y propia del negocio (qué comprobante corresponde, cómo se
  discrimina el IVA, si el CUIT es válido) está resuelta y testeada.
- El circuito completo se puede demostrar de punta a punta con el proveedor
  simulado.
- Conectar AFIP no toca el dominio ni las pantallas.

**En contra / limitaciones**

- Los CAE que emite el sistema **son simulados**: los comprobantes no tienen
  validez fiscal.
- No se implementó el libro IVA ventas, ni notas de crédito y débito, ni
  percepciones o retenciones. La estructura los admite, pero exceden el alcance.
- La numeración correlativa por punto de venta se prevé (`numero_fiscal` con
  índice único) pero la asigna el proveedor, no un contador transaccional en la
  base. Con AFIP real hay que revisar ese punto: la correlatividad es una
  obligación formal.
