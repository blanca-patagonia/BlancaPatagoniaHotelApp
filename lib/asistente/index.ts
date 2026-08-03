import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { ReglaCancelacion } from '@/lib/domain/cancelacion'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { hoyISO } from '@/lib/fechas'
import {
  detectarIntencion,
  componerRespuesta,
  componerDisponibilidad,
  extraerFechas,
  type DatosHotel,
  type RespuestaAsistente,
} from '@/lib/domain/asistente'

/**
 * Abstracción del asistente del portal público (`AsistenteProvider`).
 *
 * Mismo patrón que `PaymentProvider` y `FirmaElectronicaProvider`: la
 * implementación vigente resuelve las preguntas con **reglas propias** sobre los
 * datos del dominio, y la interfaz deja lista la sustitución por un modelo de
 * lenguaje sin reescribir nada de lo que la rodea (ver ADR 0011).
 */

export interface AsistenteProvider {
  nombre: string
  responder(pregunta: string): Promise<RespuestaAsistente>
}

/**
 * Datos del hotel que no están modelados en la base.
 *
 * Los horarios y servicios son política del hotel y hoy no tienen tabla propia;
 * viven acá, en un solo lugar, hasta que exista una de configuración general.
 * La política de cancelación **sí** se lee de la base.
 */
const HORA_CHECK_IN = '15:00'
const HORA_CHECK_OUT = '10:00'
const SERVICIOS = [
  'desayuno',
  'wifi',
  'estacionamiento',
  'calefacción central',
  'habitaciones con vista al lago e hidromasaje',
  'cabañas con hogar a leña y parrilla',
]
const DIRECCION = 'El Calafate, Santa Cruz'
const ADMITE_MASCOTAS = false

/** Reúne los datos con los que el motor de reglas arma sus respuestas. */
async function cargarDatosHotel(): Promise<DatosHotel> {
  const supabase = await crearClienteServidor()

  const [{ data: politica }, { data: tarifas }] = await Promise.all([
    supabase.from('politicas_cancelacion').select('reglas').eq('codigo', 'estandar').maybeSingle(),
    // El rango de precios sale del tarifario real, no de un texto fijo.
    supabase.from('tarifas').select('precio_rack'),
  ])

  const precios = (tarifas ?? [])
    .map((t) => Number(t.precio_rack))
    .filter((p) => Number.isFinite(p) && p > 0)

  return {
    horaCheckIn: HORA_CHECK_IN,
    horaCheckOut: HORA_CHECK_OUT,
    reglasCancelacion: (politica?.reglas ?? []) as ReglaCancelacion[],
    servicios: SERVICIOS,
    direccion: DIRECCION,
    admiteMascotas: ADMITE_MASCOTAS,
    rangoTarifas: precios.length
      ? { min: Math.round(Math.min(...precios)), max: Math.round(Math.max(...precios)) }
      : null,
  }
}

/** Asistente basado en reglas: determinista, sin servicios externos ni claves. */
class AsistenteDeReglas implements AsistenteProvider {
  nombre = 'reglas'

  async responder(pregunta: string): Promise<RespuestaAsistente> {
    const intencion = detectarIntencion(pregunta)

    // Si la consulta es de disponibilidad y trae fechas, se responde con la
    // disponibilidad REAL: la misma función SQL que usa el buscador, es decir
    // el motor anti-overbooking, no una estimación.
    if (intencion === 'disponibilidad' || intencion === 'tarifas') {
      const rango = extraerFechas(pregunta, Number(hoyISO().slice(0, 4)))
      if (rango && rango.hasta > rango.desde) {
        const tipos = await disponibilidadPorTipo(rango.desde, rango.hasta)
        return componerDisponibilidad(
          rango,
          tipos.map((t) => ({
            nombre: t.nombre,
            disponibles: t.disponibles,
            capacidadMax: t.capacidad_max,
          })),
        )
      }
    }

    return componerRespuesta(intencion, await cargarDatosHotel())
  }
}

const PROVEEDORES: Record<string, AsistenteProvider> = {
  reglas: new AsistenteDeReglas(),
}

/**
 * Proveedor vigente. Se resuelve por variable de entorno para que enchufar un
 * LLM real sea un cambio de configuración, no de código.
 */
export function obtenerAsistente(
  nombre: string = process.env.ASISTENTE_PROVIDER ?? 'reglas',
): AsistenteProvider {
  return PROVEEDORES[nombre] ?? PROVEEDORES.reglas
}
