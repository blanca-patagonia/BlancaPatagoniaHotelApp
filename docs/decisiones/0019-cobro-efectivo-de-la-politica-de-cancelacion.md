# ADR 0019 — Cobro efectivo de la política de cancelación

**Estado:** 🔲 **PROPUESTA — falta decidir** · **Fecha:** 2026-08-14 · **Fase:** Auditoría · Fase 4

> Este ADR está escrito hasta la sección «Decisión», que queda **en blanco a propósito**.
> No es una omisión técnica: es una decisión de producto y de riesgo comercial que corresponde
> tomar al hotel, no al código.

## Contexto

### Lo que la política dice

El Tarifario Blanca Patagonia fija:

| Anticipación de la cancelación | Cargo |
|---|---|
| Más de 14 días | Sin cargo |
| Entre 14 y 7 días | Primera noche |
| Menos de 7 días | 100 % de la estadía |
| No-show | 100 % de la estadía |

Está cargada en la tabla `politicas_cancelacion` (código `estandar`) como una lista de umbrales,
y el dominio la resuelve en `lib/domain/cancelacion.ts`.

### Lo que el sistema hace hoy

**Calcula el cargo y se lo muestra al usuario. No lo cobra.**

El único llamador de `cargoPorCancelacion` y `montoCancelacion` es
`app/panel/reservas/[id]/page.tsx:188-195`, que arma un *preview*:

```ts
const dias = diasEntre(hoyISO(), periodo.desde)
const tipoCargo = cargoPorCancelacion(reglas, dias)
const monto = montoCancelacion({ ... })
cargo = { dias, monto }
```

Ese `cargo` se pinta en pantalla junto al botón de cancelar. Al confirmar la cancelación,
`cambiarEstadoReserva` transiciona la reserva a `cancelada` y **nada más**: no se registra un pago,
ni un cargo en la cuenta, ni una retención. El monto anunciado no deja rastro en ninguna tabla.

**La rama de no-show no tiene un solo llamador.** `montoCancelacion` acepta `noShow: true` y ningún
punto del sistema se lo pasa: el estado `no_show` existe en la máquina de estados, pero cambiar una
reserva a `no_show` no genera cargo alguno.

### Dónde se corta la cadena

```
política cargada en la base
  → dominio la resuelve correctamente          ✅ con tests
    → la pantalla muestra el monto             ✅
      → se cancela la reserva                  ✅
        → se cobra                             ❌ NO EXISTE
          → se asienta contablemente           ❌ NO EXISTE
```

### Qué se corrigió mientras tanto

El monto anunciado estaba además **mal calculado**: la pantalla pasaba
`estadias.precio_noche` —que es `totalNeto / noches`, sin IVA y promediado— junto a `reserva.total`,
que sí lleva IVA. Se corrigió con `nochePromedioConIva` (mismo módulo, con tests).

Queda pendiente el promedio: si la estadía cruza un cambio de temporada, la «primera noche» real no
es el promedio. Los precios por noche **no se persisten** hoy —solo el promedio en
`estadias.precio_noche`—, así que arreglarlo exige un cambio de modelo de datos.

## Riesgo de la situación actual

Esto es lo que hace que la decisión no pueda postergarse indefinidamente.

**Se le comunica al huésped un cargo que no se produce.** La pantalla dice «se cobrará USD X» y no
se cobra. Dos consecuencias, ninguna buena:

- **Comercial:** el hotel pierde el ingreso que la política prevé. En temporada alta, una
  cancelación a 5 días es una habitación que ya no se vuelve a vender.
- **Legal y de expectativa:** la política publicada genera una obligación para el huésped. Anunciarla
  y no ejecutarla debilita la posición del hotel si alguna vez sí decide cobrarla, porque hay un
  historial de no aplicarla. El reclamo por un cargo que «nunca antes se cobró» es previsible.

Hay un tercer riesgo, más sutil: **el equipo cree que el sistema lo cobra.** La pantalla muestra el
monto con la misma prolijidad que el resto de los importes, y nada indica que sea informativo.

## Opciones

### A. Cobro al cancelar

Al confirmar la cancelación se genera un cargo y se cobra contra el medio de pago registrado.

- **Pagos:** exige un proveedor real con capacidad de cobro sin presencia del titular
  (*merchant-initiated*) y un medio guardado. Hoy `PaymentProvider` es un stub y no hay tokenización.
- **Datos:** un `pago` de tipo cargo, o una tabla de cargos por cancelación. Hay que decidir si
  reusar `pagos` o modelarlo aparte.
- **Contracargo:** riesgo **alto**. Un cobro que el huésped no inició es el escenario típico de
  disputa. Requiere evidencia de la política aceptada al reservar.

### B. Retención previa al confirmar la reserva

Se retiene el importe máximo al momento de reservar y se libera o captura según corresponda.

- **Pagos:** exige *pre-autorización* con captura diferida. No todos los medios lo soportan.
- **Datos:** hay que guardar el identificador de la retención y su vencimiento.
- **Contracargo:** riesgo **bajo** — el huésped autorizó al reservar.
- **Contra:** afecta el límite disponible del huésped durante toda la anticipación. En estadías
  reservadas con meses de plazo, la retención suele vencer antes del check-in.

### C. Cargo diferido a la cuenta

Se asienta el cargo en la cuenta corriente —del huésped o de la agencia— y se cobra por el circuito
habitual.

- **Pagos:** ninguno nuevo. Funciona con lo que ya existe.
- **Datos:** un movimiento en `movimientos_cuenta`; la infraestructura de cuentas corrientes ya está.
- **Contracargo:** riesgo **nulo**.
- **Contra:** solo sirve para agencias con cuenta corriente. Para un huésped directo que canceló y no
  vuelve, el cargo queda impago y hay que gestionarlo a mano.
- **Nota:** es la opción **más barata de implementar** y la que menos supuestos nuevos introduce.

### D. Nota de crédito sobre lo ya cobrado

Aplica cuando hubo seña: se retiene la parte que corresponde al cargo y se devuelve el resto.

- **Pagos:** reembolso parcial. `TIPOS_PAGO` ya contempla `reembolso`.
- **Datos:** un pago de tipo reembolso por la diferencia.
- **Contracargo:** riesgo **bajo**.
- **Contra:** solo cubre los casos con seña. No resuelve la cancelación de una reserva sin pago previo,
  que es justamente donde más duele.

### E. No cobrar, y dejar de anunciarlo

Se quita el monto de la pantalla y la política pasa a ser informativa, gestionada a mano.

- **Contra:** el hotel renuncia al ingreso.
- **A favor:** elimina el riesgo de anunciar algo que no ocurre, que es el problema más urgente.
  Es la opción honesta si la decisión va a demorar.

## Preguntas que hay que responder antes de decidir

1. ¿El hotel **quiere** cobrar cancelaciones, o la política existe como disuasivo?
2. Si quiere: ¿a todos por igual, o solo a reservas de agencia, donde hay cuenta corriente?
3. ¿Hay medio de pago guardado al reservar, o el cobro es contra el que se presente después?
4. ¿Quién autoriza el cargo: se aplica solo, o lo confirma alguien de recepción?
5. ¿Qué pasa con el no-show, que hoy no tiene ningún llamador?

## Decisión

<!--
    ═══════════════════════════════════════════════════════════════════════
    A COMPLETAR POR EL EQUIPO.

    Escribir acá la opción elegida (A/B/C/D/E o una combinación) y el porqué.
    Mientras esto esté vacío, el sistema sigue anunciando un cargo que no
    ocurre, que es el riesgo descrito más arriba.
    ═══════════════════════════════════════════════════════════════════════
-->

**Pendiente.**

## Consecuencias

<!-- A completar junto con la decisión. -->

**Pendiente.**
