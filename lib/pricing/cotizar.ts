import 'server-only'
import { crearClienteServidor } from '@/lib/supabase/server'
import {
  calcularEstadia,
  type NocheTarifada,
  type Promocion,
  type ResumenPrecio,
  type TarifaTipo,
} from '@/lib/domain/precios'

/**
 * Cotización de una estadía: combina las tarifas por noche (RPC `cotizar_estadia`)
 * con el motor de precios puro (`calcularEstadia`) para obtener el total con IVA
 * y descuentos.
 */

export interface Cotizacion {
  noches: NocheTarifada[]
  faltanTarifas: boolean
  resumen: ResumenPrecio
}

interface FilaCotizacion {
  fecha: string
  precio: number | null
  iva_pct: number
}

export async function cotizarEstadia(params: {
  tipoUnidadId: string
  checkIn: string
  checkOut: string
  tarifaTipo: TarifaTipo
  promocion?: Promocion | null
  anticipacionDias?: number
}): Promise<Cotizacion> {
  const supabase = await crearClienteServidor()

  // Dos funciones y no una con parámetro (migración 0031). `cotizar_estadia`
  // menciona `precio_neto`, así que el rol `anon` no puede ni ejecutarla ni leer
  // esa columna; `cotizar_estadia_publica` solo toca rack y por eso funciona
  // desde el portal. Pedir rack por la pública también cuando hay sesión no
  // cuesta nada y deja un solo camino para el precio de mostrador.
  const { data, error } =
    params.tarifaTipo === 'neto'
      ? await supabase.rpc('cotizar_estadia', {
          p_tipo_unidad_id: params.tipoUnidadId,
          p_check_in: params.checkIn,
          p_check_out: params.checkOut,
          p_tarifa_tipo: 'neto',
        })
      : await supabase.rpc('cotizar_estadia_publica', {
          p_tipo_unidad_id: params.tipoUnidadId,
          p_check_in: params.checkIn,
          p_check_out: params.checkOut,
        })
  if (error) throw new Error(`Error al cotizar la estadía: ${error.message}`)

  const filas = (data ?? []) as FilaCotizacion[]
  const faltanTarifas = filas.length === 0 || filas.some((f) => f.precio == null)
  const noches: NocheTarifada[] = filas
    .filter((f) => f.precio != null)
    .map((f) => ({ fecha: f.fecha, precio: Number(f.precio), ivaPct: Number(f.iva_pct) }))

  const resumen = calcularEstadia({
    noches,
    promocion: params.promocion ?? null,
    anticipacionDias: params.anticipacionDias,
  })

  return { noches, faltanTarifas, resumen }
}
