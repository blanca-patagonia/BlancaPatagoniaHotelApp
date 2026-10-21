/**
 * El clima de El Calafate, tal como lo devuelve Open-Meteo, traducido para el
 * asistente (lógica pura: la consulta vive en `lib/ia/externo.ts`).
 *
 * En Patagonia lo que más cambia el día del huésped no es la temperatura sino
 * el VIENTO: una ráfaga de 80 km/h suspende la navegación por el lago y vuelve
 * peligrosas las pasarelas del glaciar. Por eso el resumen lo destaca.
 */

/** Coordenadas de El Calafate (centro). */
export const EL_CALAFATE = { latitud: -50.3379, longitud: -72.2648 } as const

/** Ráfaga desde la cual conviene avisar (km/h). */
export const RAFAGA_FUERTE_KMH = 60

/** Códigos WMO de Open-Meteo → descripción en castellano. */
export function descripcionClima(codigo: number): string {
  if (codigo === 0) return 'despejado'
  if (codigo <= 2) return 'parcialmente nublado'
  if (codigo === 3) return 'nublado'
  if (codigo === 45 || codigo === 48) return 'niebla'
  if (codigo >= 51 && codigo <= 57) return 'llovizna'
  if (codigo >= 61 && codigo <= 67) return 'lluvia'
  if (codigo >= 71 && codigo <= 77) return 'nieve'
  if (codigo >= 80 && codigo <= 82) return 'chaparrones'
  if (codigo === 85 || codigo === 86) return 'nevadas'
  if (codigo >= 95) return 'tormenta'
  return 'sin dato'
}

export interface PronosticoCrudo {
  current?: {
    temperature_2m?: number
    wind_speed_10m?: number
    wind_gusts_10m?: number
    weather_code?: number
  }
  daily?: {
    time?: string[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_sum?: number[]
    wind_gusts_10m_max?: number[]
    weather_code?: number[]
  }
}

const redondo = (n: number | undefined) => (typeof n === 'number' ? Math.round(n) : null)

/** El pronóstico en una forma corta, con el aviso de viento ya resuelto. */
export function resumirPronostico(crudo: PronosticoCrudo) {
  const d = crudo.daily ?? {}
  const dias = (d.time ?? []).map((fecha, i) => {
    const rafaga = redondo(d.wind_gusts_10m_max?.[i])
    return {
      fecha,
      cielo: descripcionClima(d.weather_code?.[i] ?? -1),
      maximaC: redondo(d.temperature_2m_max?.[i]),
      minimaC: redondo(d.temperature_2m_min?.[i]),
      lluviaMm: typeof d.precipitation_sum?.[i] === 'number' ? Math.round(d.precipitation_sum[i] * 10) / 10 : null,
      rafagaMaxKmh: rafaga,
      vientoFuerte: rafaga !== null && rafaga >= RAFAGA_FUERTE_KMH,
    }
  })
  const c = crudo.current
  return {
    ahora: c
      ? {
          temperaturaC: redondo(c.temperature_2m),
          vientoKmh: redondo(c.wind_speed_10m),
          rafagaKmh: redondo(c.wind_gusts_10m),
          cielo: descripcionClima(c.weather_code ?? -1),
        }
      : null,
    dias,
    fuente: 'Open-Meteo (pronóstico meteorológico abierto)',
  }
}
