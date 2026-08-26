import 'server-only'

/**
 * Proveedor de pagos simulado.
 *
 * Para qué sirve y para qué NO.
 *
 * Sirve para que el circuito completo —crear el link, pagar, recibir el webhook,
 * saldar la reserva— se pueda recorrer y demostrar sin contratar una pasarela.
 * Manda al huésped a `/pago-simulado`, una pantalla que dice en letras grandes
 * que no se está moviendo plata y que permite elegir el desenlace: aprobar,
 * rechazar o dejar pendiente. Esa pantalla firma el webhook con el mismo HMAC
 * que usaría la pasarela real, así que lo que se ejercita es el camino de
 * verdad y no un atajo.
 *
 * NO sirve para verificar una tarjeta, y eso es deliberado (ADR 0025). Verificar
 * exige hablar con el emisor; sin pasarela contratada no hay forma de saber si
 * una tarjeta sirve. Un simulador que devolviera «válida» sería peor que no
 * tener la función: recepción dejaría pasar un check-in confiando en una
 * garantía que nadie comprobó, y el hotel se enteraría el día que intente cobrar
 * un no-show.
 *
 * En producción, usarlo tiene que ser una decisión explícita: `PAGO_PROVIDER`
 * lo exige por nombre o el sistema no arranca (ADR 0018).
 */

import { verificarFirmaWebhook } from '@/lib/integraciones/firma-webhook'
import { MONEDAS_EXTRANJERAS } from '@/lib/domain/divisas'
import {
  ESTADOS_PAGO,
  TIPOS_PAGO,
  type MedioPago,
  type TipoPago,
  type EstadoPago,
} from '@/lib/domain/pagos'
import { MONEDA_BASE, type MonedaCobro } from '@/lib/domain/cobro'
import type {
  CapacidadesPago,
  CheckoutParams,
  DatosTarjeta,
  PaymentProvider,
  ResultadoCheckout,
  ResultadoVerificacionTarjeta,
  ResultadoWebhook,
} from './tipos'

/** Nombre con el que se lo elige en `PAGO_PROVIDER`. */
export const NOMBRE_SIMULADO = 'simulado'

export class ProveedorSimulado implements PaymentProvider {
  /**
   * El medio con el que se registran sus pagos.
   *
   * Es `tarjeta` y no un valor propio porque `medio_pago` es un enum de la base
   * y agregarle un valor «simulado» obligaría a una migración de enum —con la
   * trampa del SQLSTATE 55P04— para algo que no existe en el negocio. Lo que
   * distingue a un pago simulado no es el medio sino la nota, que lo dice.
   */
  readonly nombre: MedioPago = 'tarjeta'

  esReal(): boolean {
    return false
  }

  capacidades(): CapacidadesPago {
    return {
      // No verifica, y lo declara. Ver el docblock del módulo.
      verificaTarjeta: false,
      // Sí puede llevar el flujo de punta a punta, contra su propia pantalla.
      cobraEnLinea: true,
      // Acepta cualquiera: no cobra nada, así que no tiene restricción real.
      monedas: [MONEDA_BASE, ...MONEDAS_EXTRANJERAS] as readonly MonedaCobro[],
    }
  }

  /**
   * No verifica: lo dice.
   *
   * Devuelve `noSoportado: true` y **no** `ok: false` a secas, para que la
   * pantalla pueda distinguir «el emisor la rechazó» de «no hay con qué
   * probarla». Son dos situaciones distintas y llevan a acciones distintas.
   *
   * Los datos de la tarjeta se reciben y **se descartan**: no se guardan, no se
   * loguean y no se devuelven. Lo único que sale de acá son los últimos cuatro
   * dígitos, que PCI-DSS permite mostrar.
   */
  async verificarTarjeta(datos: DatosTarjeta): Promise<ResultadoVerificacionTarjeta> {
    const digitos = datos.numero.replace(/\D/g, '')
    return {
      ok: false,
      noSoportado: true,
      // Los últimos 4 son el único dato que se conserva, para que el huésped
      // reconozca cuál tarjeta dejó. Cuatro dígitos no identifican una tarjeta.
      ultimos4: digitos.length >= 4 ? digitos.slice(-4) : undefined,
      vencimiento: datos.vencimiento,
      detalle:
        'No hay pasarela de pagos contratada, así que la tarjeta no se pudo probar contra el emisor.',
    }
  }

  /**
   * Manda a la pantalla de pago simulado con todo lo necesario para cerrar el
   * circuito: el importe a mostrar y a dónde volver.
   */
  async crearCheckout(p: CheckoutParams): Promise<ResultadoCheckout> {
    const q = new URLSearchParams({
      external_id: p.externalId,
      reserva_id: p.reservaId,
      monto: String(p.monto),
      moneda: p.moneda,
      tipo: p.tipo,
      descripcion: p.descripcion,
      volver: p.urls.exito,
      cancelar: p.urls.error,
    })
    return { url: `/pago-simulado?${q.toString()}`, externalId: p.externalId }
  }

  async verificarFirma(req: Request): Promise<boolean> {
    const secreto = process.env.PAGO_WEBHOOK_SECRET
    if (!secreto) {
      // Sin secreto configurado: se acepta SOLO fuera de producción (enganche de
      // desarrollo). En producción se rechaza (fail-closed) para que nadie pueda
      // registrar pagos falsos sin la firma de la pasarela.
      return process.env.NODE_ENV !== 'production'
    }

    // El cuerpo tiene que leerse CRUDO: parsearlo y volver a serializarlo cambia
    // espacios y orden de claves, y la firma deja de coincidir. Por eso el
    // llamador pasa un `req.clone()`.
    const cuerpo = await req.text()
    const { valida, motivo } = await verificarFirmaWebhook(secreto, req.headers, cuerpo)

    if (!valida) {
      // El motivo va al log del servidor y nunca a la respuesta: decirle a quien
      // llama *por qué* falló su firma es ayudarlo a construir una válida.
      console.error(`[webhook ${NOMBRE_SIMULADO}] firma rechazada: ${motivo}`)
    }
    return valida
  }

  async parsearWebhook(req: Request): Promise<ResultadoWebhook> {
    let cuerpo: Record<string, unknown>
    try {
      cuerpo = await req.json()
    } catch {
      return { tipo: 'invalido', motivo: 'el cuerpo no es JSON' }
    }
    const externalId = String(cuerpo.external_id ?? '')
    const reservaId = String(cuerpo.reserva_id ?? '')
    const monto = Number(cuerpo.monto ?? 0)
    if (!externalId) return { tipo: 'invalido', motivo: 'falta external_id' }
    if (!(monto > 0)) return { tipo: 'invalido', motivo: 'el monto no es positivo' }

    /*
      El estado y el tipo se VALIDAN contra el dominio; no se castean.

      Antes eran `(cuerpo.estado as EstadoPago) ?? 'aprobado'`, con dos problemas:

      · **`?? 'aprobado'` es fail-open sobre dinero.** Un evento al que le falte
        el campo se convertía en un cobro aprobado que nadie hizo. Ante un
        mensaje incompleto corresponde rechazarlo, no darlo por bueno.
      · **El `as` no verifica nada.** Un valor fuera del enum pasaba el tipado y
        explotaba recién en el `insert` contra `estado_pago`, devolviendo 500 y
        dejando a la pasarela reintentando en bucle un evento que nunca va a
        entrar.
    */
    const tipo = cuerpo.tipo ?? 'saldo'
    if (!TIPOS_PAGO.includes(tipo as TipoPago)) {
      return { tipo: 'invalido', motivo: `tipo de pago desconocido: ${String(tipo)}` }
    }

    const estado = cuerpo.estado
    if (!ESTADOS_PAGO.includes(estado as EstadoPago)) {
      return { tipo: 'invalido', motivo: `estado de pago desconocido: ${String(estado)}` }
    }

    const moneda = String(cuerpo.moneda ?? MONEDA_BASE)
    if (!esMonedaDeCobro(moneda)) {
      return { tipo: 'invalido', motivo: `moneda desconocida: ${moneda}` }
    }

    return {
      tipo: 'evento',
      evento: {
        externalId,
        reservaId,
        monto,
        moneda,
        medio: this.nombre,
        tipo: tipo as TipoPago,
        estado: estado as EstadoPago,
      },
    }
  }
}

/** ¿Es una moneda en la que el sistema sabe cobrar y convertir? */
export function esMonedaDeCobro(v: string): v is MonedaCobro {
  return v === MONEDA_BASE || (MONEDAS_EXTRANJERAS as readonly string[]).includes(v)
}
