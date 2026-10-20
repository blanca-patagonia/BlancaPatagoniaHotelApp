import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import type { ReglaCancelacion } from '@/lib/domain/cancelacion'
import { disponibilidadPorTipo } from '@/lib/availability/disponibilidad'
import { hoyISO, parsearPeriodo } from '@/lib/fechas'
import { conIva } from '@/lib/domain/catalogo'
import {
  detectarIntencion,
  componerRespuesta,
  componerDisponibilidad,
  extraerFechas,
  type DatosHotel,
  type RespuestaAsistente,
} from '@/lib/domain/asistente'
import {
  HORA_CHECK_IN,
  HORA_CHECK_OUT,
  DIRECCION,
  ADMITE_MASCOTAS,
  SERVICIOS,
} from '@/lib/domain/hotel'

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

// Los datos fijos del hotel (horarios, dirección, servicios) viven en
// `lib/domain/hotel.ts`. La política de cancelación, las tarifas y las
// temporadas **sí** se leen de la base, más abajo.

/** Reúne los datos con los que el motor de reglas arma sus respuestas. */
async function cargarDatosHotel(): Promise<DatosHotel> {
  const supabase = await crearClienteServidor()

  const [{ data: politica }, { data: tarifas }, { data: temporadasData }] = await Promise.all([
    supabase.from('politicas_cancelacion').select('reglas').eq('codigo', 'estandar').maybeSingle(),
    // El rango de precios sale del tarifario real, no de un texto fijo.
    supabase.from('tarifas').select('precio_rack, iva_pct').eq('vigente', true),
    // Temporadas con sus rangos: el calendario también sale de la base.
    supabase
      .from('temporadas')
      .select('nombre, orden, rangos:temporada_rangos(rango)')
      .order('orden'),
  ])

  // Con IVA: `precio_rack` se guarda SIN IVA (ADR 0004) y el checkout lo suma.
  // El texto que arma el asistente dice «(con IVA)», así que volcar la columna
  // cruda no era solo un precio bajo: era una afirmación falsa al huésped.
  const precios = (tarifas ?? [])
    .map((t) => conIva(Number(t.precio_rack), Number(t.iva_pct)))
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
    temporadas: (
      (temporadasData ?? []) as unknown as { nombre: string; rangos: { rango: string }[] }[]
    ).map((t) => ({
      nombre: t.nombre,
      // `daterange` llega como `[2026-11-15,2027-03-16)`: se reutiliza el
      // parser de períodos del dominio de fechas.
      rangos: (t.rangos ?? []).map((r) => {
        const p = parsearPeriodo(r.rango)
        return { desde: p.desde, hasta: p.hasta }
      }),
    })),
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
