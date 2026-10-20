import { MENSAJES_FICHA_RESERVA as MENSAJES_ERROR } from './mensajes'
import { mensajeDe } from '@/lib/listados'
import { type EstadoReserva } from '@/lib/domain/reservas'
import { formatoFechaCorta } from '@/lib/fechas'
import { formatearUSD } from '@/lib/domain/moneda'
import { Mensaje } from '../../_components/ui'

/**
 * Los avisos de arriba de la ficha: el resultado de la última acción
 * (`?error=` / `?ok=`) y las alertas de plata que no pueden pasar
 * desapercibidas (pagos ilegibles, «pagada» con saldo, agencia vencida).
 */
export function SeccionAvisos({
  errorParam,
  detalleParam,
  okParam,
  fallaPagos,
  fallaCuenta,
  estado,
  saldo,
  totalReserva,
  avisoPagoAgenciaVencido,
}: {
  errorParam: string | undefined
  detalleParam: string | undefined
  okParam: string | undefined
  fallaPagos: boolean
  fallaCuenta: boolean
  estado: EstadoReserva
  saldo: number
  totalReserva: number
  avisoPagoAgenciaVencido: { vencimiento: string; totalPagado: number } | null
}) {
  return (
    <>
      {errorParam && (
        <Mensaje tono="error">
          {/*
            `ficha_ocupantes` es la única clave con un `detalle` propio: lo
            manda `editarFichaReserva` con el motivo puntual que calculó
            `validarOcupantes` (de qué capacidad se pasó, o qué falta),
            porque el texto fijo de MENSAJES_ERROR lista las tres
            condiciones posibles en vez de decir cuál falló.
          */}
          {errorParam === 'ficha_ocupantes' && detalleParam
            ? detalleParam
            : mensajeDe(MENSAJES_ERROR, errorParam, 'No se pudo completar la operación.')}
        </Mensaje>
      )}

      {fallaPagos && (
        <Mensaje tono="error">
          No se pudieron leer los pagos de esta reserva — el saldo que se ve abajo puede no ser el
          real. Revisá directamente en Pagos antes de dar algo por cobrado.
        </Mensaje>
      )}

      {/*
        «Pagada» con saldo: pasa cuando una reserva ya saldada se reprograma a
        fechas más caras o se registra un reembolso. La máquina de estados no
        tiene vuelta de `pagada` a `confirmada` (es una decisión de negocio
        pendiente), así que por lo menos no se esconde: quien mira el estado
        vería «Pagada» y no le cobraría la diferencia.
      */}
      {!fallaCuenta && estado === 'pagada' && saldo > 0 && (
        <Mensaje tono="error">
          Figura como pagada, pero quedan {formatearUSD(saldo)} sin cobrar (la estadía se
          recotizó, se cargaron consumos o hubo un reembolso después del pago). Cobrá la diferencia
          antes de la salida.
        </Mensaje>
      )}

      {avisoPagoAgenciaVencido && (
        <Mensaje tono="error">
          El pago de la agencia está vencido: tenía que estar cubierto el{' '}
          {formatoFechaCorta(avisoPagoAgenciaVencido.vencimiento)} (un mes antes del check-in) y
          lleva pagado {formatearUSD(avisoPagoAgenciaVencido.totalPagado)} de{' '}
          {formatearUSD(totalReserva)}. Reclamale a la agencia o evaluá liberar la
          unidad.
        </Mensaje>
      )}

      {okParam === 'mudanza' && (
        <Mensaje tono="ok">
          Unidad cambiada. La habitación liberada quedó marcada para limpieza si el huésped ya
          estaba alojado.
        </Mensaje>
      )}

      {okParam === 'ficha' && <Mensaje tono="ok">Ficha actualizada.</Mensaje>}
    </>
  )
}
