import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { ReglaCancelacion } from '@/lib/domain/cancelacion'
import {
  responder as responderConReglas,
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
  const { data } = await supabase
    .from('politicas_cancelacion')
    .select('reglas')
    .eq('codigo', 'estandar')
    .maybeSingle()

  return {
    horaCheckIn: HORA_CHECK_IN,
    horaCheckOut: HORA_CHECK_OUT,
    reglasCancelacion: (data?.reglas ?? []) as ReglaCancelacion[],
    servicios: SERVICIOS,
    direccion: DIRECCION,
    admiteMascotas: ADMITE_MASCOTAS,
  }
}

/** Asistente basado en reglas: determinista, sin servicios externos ni claves. */
class AsistenteDeReglas implements AsistenteProvider {
  nombre = 'reglas'

  async responder(pregunta: string): Promise<RespuestaAsistente> {
    const datos = await cargarDatosHotel()
    return responderConReglas(pregunta, datos)
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
