import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, estadoSegunPagos, type Pago } from '@/lib/domain/pagos'
import { caminoDeEstados, type EstadoReserva } from '@/lib/domain/reservas'

/**
 * «¿Qué estado le corresponde a la reserva según lo que se cobró?»
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────
 *
 * Esa pregunta se responde en dos lugares: cuando recepción registra un cobro en
 * el mostrador (`registrarPago`) y cuando la pasarela avisa que un pago se aprobó
 * (el webhook). Los dos hacían la misma secuencia —leer la reserva, leer los pagos,
 * consolidar, comparar, transicionar— por duplicado.
 *
 * Y **divergieron**. El webhook fue corregido para consolidar alojamiento + consumos;
 * el mostrador se quedó comparando contra `reservas.total`, que cubre solo la
 * estadía. Resultado: quien había consumido del frigobar y pagaba el alojamiento en
 * efectivo quedaba marcado «pagada» debiendo esa parte, y en el mostrador nadie se
 * lo cobraba porque el sistema decía que estaba al día. Se descubría al cerrar caja,
 * o no se descubría.
 *
 * Copiar el arreglo al otro lado habría dejado el problema de fondo intacto: dos
 * copias de una regla de plata se vuelven a separar. Así que la regla vive acá una
 * sola vez y los dos caminos la llaman.
 *
 * ── Por qué recibe el cliente ────────────────────────────────────────────────
 *
 * El webhook corre sin sesión de usuario y necesita `service_role`; el mostrador
 * corre con la sesión de quien está cobrando y tiene que pasar por RLS. Es el mismo
 * patrón de `lib/reservas/crear.ts`.
 */

export interface ResultadoSaldar {
  /**
   * Motivo del fallo, en español y listo para loguear. `null` si todo salió bien
   * —incluido el caso normal de «todavía no está saldada», que no es un fallo—.
   */
  error: string | null
  /** `true` solo si esta llamada movió la reserva a `pagada`. */
  marcadaPagada: boolean
  /**
   * `true` si esta llamada la movió a `confirmada` por el cobro de la seña.
   *
   * Va aparte de `marcadaPagada` porque son dos cosas distintas para quien mira
   * la pantalla: una dice «ya no debe nada», la otra «la unidad dejó de estar en
   * riesgo de liberarse».
   */
  confirmada: boolean
  /**
   * La reserva no existe.
   *
   * Va aparte de `error` porque los dos llamadores necesitan tratarlo distinto y
   * aplanarlo rompería a uno de los dos. Para el webhook **no** es un fallo: una
   * reserva inexistente no se arregla reintentando, así que pedirle a la pasarela
   * que reintente sería peor que aceptar el evento. Para el mostrador sí es raro
   * —el pago se acaba de insertar contra esa reserva— y vale avisar.
   */
  noExiste: boolean
}

/** «No pasó nada»: el caso normal, y la base de los demás retornos. */
const NADA: ResultadoSaldar = {
  error: null,
  marcadaPagada: false,
  confirmada: false,
  noExiste: false,
}

/**
 * Recalcula la cuenta de la reserva y, si está cubierta, la pasa a `pagada`.
 *
 * **Ningún error de lectura se descarta.** Si no se pueden leer los consumos, el
 * total sale más bajo de lo que es y la reserva se marcaría como saldada sin
 * estarlo: en una función de plata, seguir con datos incompletos es peor que cortar.
 */
export async function saldarSiCorresponde(
  cliente: SupabaseClient,
  reservaId: string,
): Promise<ResultadoSaldar> {
  const { data: reserva, error: eReserva } = await cliente
    .from('reservas')
    .select('estado, total')
    .eq('id', reservaId)
    .maybeSingle<{ estado: string; total: number }>()

  if (eReserva) return { ...NADA, error: `no se pudo leer la reserva: ${eReserva.message}` }
  if (!reserva) return { ...NADA, noExiste: true }
  if (reserva.estado === 'pagada') return NADA

  const { data: pagos, error: ePagos } = await cliente
    .from('pagos')
    .select('tipo, monto, estado')
    .eq('reserva_id', reservaId)
  if (ePagos) return { ...NADA, error: `no se pudieron leer los pagos: ${ePagos.message}` }

  // La cuenta del huésped es alojamiento MÁS consumos, no solo el alojamiento.
  const { data: consumos, error: eConsumos } = await cliente
    .from('consumos')
    .select('cantidad, precio_unitario')
    .eq('reserva_id', reservaId)
  if (eConsumos) {
    return { ...NADA, error: `no se pudieron leer los consumos: ${eConsumos.message}` }
  }

  const cuenta = cuentaConsolidada(
    Number(reserva.total),
    (consumos ?? []).map((c) => ({
      cantidad: c.cantidad as number,
      precioUnitario: Number(c.precio_unitario),
    })) as Consumo[],
  )

  const resumen = resumenPagos(cuenta.total, (pagos ?? []) as Pago[])

  // La regla vive en el dominio: la seña confirma, la cuenta cubierta paga.
  const destino = estadoSegunPagos(reserva.estado, resumen)
  if (!destino) return NADA

  /*
    El camino, no el salto.

    `pendiente → pagada` NO es una transición válida: hay que pasar por
    `confirmada`. Es exactamente lo que hace un huésped que reserva por la web
    —su reserva nace `pendiente`— y paga todo de una.

    Antes esto se descartaba en silencio con un `puedeTransicionar(...) === false`
    y la reserva quedaba `pendiente`. La expiración la liberaba a los 5 días y el
    hotel revendía la unidad **con la plata ya cobrada**. Una reserva anulada
    sigue sin moverse, que es lo que aquella guarda quería proteger; la diferencia
    es que ahora eso lo decide `estadoSegunPagos` y no un efecto lateral.
  */
  const camino = caminoDeEstados(reserva.estado as EstadoReserva, destino)
  if (!camino || camino.length === 0) return NADA

  for (const paso of camino) {
    const { error: eEstado } = await cliente
      .from('reservas')
      .update({ estado: paso })
      .eq('id', reservaId)
    if (eEstado) {
      return { ...NADA, error: `no se pudo pasar la reserva a «${paso}»: ${eEstado.message}` }
    }
  }

  return { ...NADA, marcadaPagada: destino === 'pagada', confirmada: destino === 'confirmada' }
}
