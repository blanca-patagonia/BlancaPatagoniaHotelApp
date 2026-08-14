# ADR 0018 — La selección de proveedor no degrada en silencio

**Estado:** aceptada · **Fecha:** 2026-08-14 · **Fase:** Auditoría · Fase 3

## Contexto

El proyecto tiene cinco integraciones externas detrás de un puerto propio
(ADR 0006, 0010, 0011, 0012): `PaymentProvider`, `EmailProvider`,
`FirmaElectronicaProvider`, `FacturacionElectronicaProvider` y `AsistenteProvider`.
El patrón es correcto y no se discute acá.

Lo que sí era un problema es **cómo se elegía la implementación**. Cuatro de los cinco
resolvían así:

```ts
process.env.X_PROVIDER ?? 'stub'
```

y además caían al stub ante cualquier nombre desconocido: `PROVEEDORES[nombre] ?? PROVEEDORES.stub`.

Ese doble `??` es cómodo en desarrollo y peligroso en producción, porque una variable
faltante, mal escrita o no propagada por el despliegue **no produce ningún error**: el
sistema sigue andando con el simulador. Las consecuencias concretas:

- `FACTURACION_PROVIDER`: `ProveedorSimulado` devuelve un **CAE simulado de 14 dígitos**,
  con la misma forma que el real, sobre una factura verdadera. Es un comprobante apócrifo
  ante AFIP. Se verificó que **nadie llama a `esReal()`**: `app/panel/reservas/actions.ts:477`
  emite sin comprobar nada.
- `EMAIL_PROVIDER`: `ProveedorConsola` escribe el correo en el log del servidor. La
  confirmación de reserva, el enlace de firma y la encuesta nunca llegan al huésped, y el
  sistema informa «enviado».
- `FIRMA_PROVIDER`: el proveedor local produce algo que el propio módulo documenta como
  **sin validez legal** (ADR 0010).

`PaymentProvider` ya estaba bien resuelto: `obtenerProveedor` devuelve `null` ante un
nombre desconocido, y `verificarFirma` hace *fail-closed* en producción
(`lib/payments/index.ts:63-68`). Ese es el criterio que se generaliza.

## Decisión

Se crea `lib/integraciones/seleccion.ts` con `seleccionarProveedor`, que usan
`facturacion`, `email` y `firma`.

La regla: **fuera de producción se cae al simulador sin ruido** —es lo que permite
desarrollar y correr los tests sin credenciales—; **en producción hay solo dos caminos
válidos**: la variable nombra un proveedor real que existe, o nombra el simulador de forma
explícita. Cualquier otra cosa lanza, con un mensaje que dice qué variable definir y con
qué valores.

`advertirSiEsSimulado` deja además un `console.warn` cuando alguien declaró el simulador
adrede en producción: es su decisión, pero queda rastro para una investigación.

## Alternativas consideradas

- **Validar todo en `lib/env.ts` al arrancar.** Descartada como única medida: esas
  funciones son perezosas (se ejecutan al ser llamadas, no al cargar el módulo), así que
  no garantizan el fallo temprano que su propio comentario promete. Queda como trabajo
  pendiente y complementario.
- **Comprobar `esReal()` en cada llamador.** Descartada: es la solución que ya existía y
  que nadie usó en facturación. Una guarda que hay que acordarse de invocar no es una
  guarda.
- **Quitar los simuladores.** Descartada: son necesarios para desarrollo, tests y para la
  demostración de la tesis, donde ningún borde externo es real.

## Consecuencias

- Un despliegue mal configurado falla al usar la integración, con un mensaje accionable,
  en vez de emitir comprobantes inválidos.
- `EMAIL_PROVIDER`, `FIRMA_PROVIDER` y `FACTURACION_PROVIDER` pasan a ser **obligatorias
  en producción**. Hay que declararlas en el despliegue y en `.env.example`.
- Los tests y el desarrollo local no cambian: sin `NODE_ENV=production` el comportamiento
  es el de antes.
- `AsistenteProvider` **no se modifica**: su proveedor `reglas` no es un simulador sino la
  implementación prevista por el ADR 0011.
- Cubierto por `tests/integraciones.test.ts` (10 casos, ambos entornos).
