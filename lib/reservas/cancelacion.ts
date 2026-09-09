import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cargoPorCancelacion,
  montoCancelacion,
  nochePromedioConIva,
  primeraNocheRealConIva,
  type Cargo,
  type ReglaCancelacion,
} from '@/lib/domain/cancelacion'
import { formatearUSD } from '@/lib/domain/moneda'
import { cotizarEstadia } from '@/lib/pricing/cotizar'
import { diasEntre, hoyISO } from '@/lib/fechas'

/**
 * «¿Cuánto se le cobra a esta reserva si se cancela hoy?»
 *
 * ── Por qué es un módulo y no una función de la pantalla ────────────────────
 *
 * La pregunta se responde en dos lugares: la ficha de la reserva, que muestra el
 * cargo **antes** de cancelar, y el correo que se le manda al huésped **al**
 * cancelar. Los dos tienen que decir el mismo número.
 *
 * Es exactamente la situación que ya se dio con `saldarSiCorresponde`: la misma
 * cuenta escrita dos veces, que divergió, y el síntoma apareció en la plata.
 * Anunciarle al huésped en pantalla un cargo y mandarle otro por correo es la
 * clase de diferencia que termina en una discusión en el mostrador — con el
 * tarifario publicado del lado del huésped.
 */

export interface CargoDeCancelacion {
  /** Días de anticipación con que se cancela. Es lo que decide el tramo. */
  dias: number
  cargo: Cargo
  monto: number
}

/**
 * Calcula el cargo con la política estándar del Tarifario.
 *
 * `null` cuando falta lo indispensable: sin la política cargada, adivinar un
 * cargo es peor que no mostrarlo.
 */
export async function cargoDeCancelacion(
  client: SupabaseClient,
  d: {
    checkIn: string
    checkOut: string
    total: number
    tipoUnidadId: string
    tarifaTipo: 'neto' | 'rack'
    noches: number
    noShow?: boolean
  },
): Promise<CargoDeCancelacion | null> {
  const { data: pol } = await client
    .from('politicas_cancelacion')
    .select('reglas')
    .eq('codigo', 'estandar')
    .maybeSingle()

  const reglas = (pol?.reglas ?? []) as ReglaCancelacion[]
  if (reglas.length === 0) return null

  const dias = diasEntre(hoyISO(), d.checkIn)
  const cargo = cargoPorCancelacion(reglas, dias)

  /*
    La primera noche REAL, no el promedio.

    `estadias.precio_noche` guarda `totalNeto / noches`: ya viene promediado. Si
    la estadía cruza un cambio de temporada, el promedio cobra de más o de menos
    según cuál de las dos sea la primera noche, y en los dos sentidos es plata mal
    cobrada.

    Se reparte el total **guardado** según la proporción de las tarifas, no se
    recotiza: el precio se fijó al reservar (ADR 0004), y recotizar cobraría un
    número que el huésped nunca aceptó.

    Si no se pudieron leer las tarifas —temporada sin cargar— se cae al promedio:
    peor que lo exacto, mejor que nada.
  */
  const cotizacion = await cotizarEstadia({
    tipoUnidadId: d.tipoUnidadId,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    tarifaTipo: d.tarifaTipo,
  }).catch(() => null)

  const preciosPorNoche = (cotizacion?.noches ?? []).map((n: { precio: number }) => n.precio)

  const monto = montoCancelacion({
    cargo,
    totalEstadia: d.total,
    primeraNocheConIva:
      preciosPorNoche.length > 0
        ? primeraNocheRealConIva(d.total, preciosPorNoche)
        : nochePromedioConIva(d.total, d.noches),
    noShow: d.noShow,
  })

  return { dias, cargo, monto }
}

/**
 * La frase que va en el correo, en lenguaje del huésped.
 *
 * ⚠️ **No dice «no se te cobra nada» cuando el cálculo no se pudo hacer.** Un
 * `null` significa que falta la política, no que el cargo sea cero, y afirmar lo
 * segundo es prometer algo que después se cobra. En ese caso la frase remite al
 * hotel, que es lo honesto.
 */
export function textoDeCancelacion(cargo: CargoDeCancelacion | null): string {
  if (!cargo) {
    return 'Si corresponde algún cargo por la cancelación, te lo confirmamos por este medio.'
  }
  if (cargo.monto <= 0) {
    return `Cancelaste con ${cargo.dias} días de anticipación, así que **no hay cargo**.`
  }
  if (cargo.cargo === 'primera_noche') {
    return `Cancelaste con ${cargo.dias} días de anticipación: según la política del hotel se cobra la primera noche, ${formatearUSD(cargo.monto)}.`
  }
  return `Cancelaste con ${cargo.dias} días de anticipación: según la política del hotel se cobra el total de la estadía, ${formatearUSD(cargo.monto)}.`
}

/** La frase del no-show, que no depende de los días: es siempre el total. */
export function textoDeNoShow(monto: number): string {
  return `Según la política del hotel, la no presentación se cobra al 100 %: ${formatearUSD(monto)}.`
}
