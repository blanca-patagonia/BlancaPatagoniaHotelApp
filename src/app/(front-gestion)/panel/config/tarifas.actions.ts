'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { ETIQUETA_CATALOGO } from '@/lib/catalogo/publico'
import { crearClienteServidor } from '@/lib/supabase/server'
import { requerirAcceso } from '@/lib/auth/session'
import { mensajeDeFalla } from '@/lib/acciones'

export interface EstadoTarifasFila {
  error?: string
  ok?: string
}

/**
 * Actualiza las tarifas (neto y rack) de un tipo de unidad, para las
 * temporadas que tenga cargadas — hasta tres (baja/media/alta) en un solo
 * envío.
 *
 * Solo admin/gerencia. El tarifario es la base de toda cotización, así que se
 * validan los importes antes de tocar la base: nada de precios negativos ni de
 * un neto por encima del rack (el neto es siempre el precio de agencia). Se
 * valida TODO antes de escribir nada, y la escritura es una sola llamada
 * transaccional (`actualizar_tarifas_en_lote`, 0122): si una temporada falla,
 * no se guarda ninguna, así una fila nunca queda a medio actualizar.
 *
 * ── Por qué una fila entera y no una tarifa por vez ─────────────────────────
 *
 * Antes cada celda (tipo × temporada) era su propio formulario con su propio
 * botón «OK»: guardar las tres temporadas de un tipo eran tres clics y tres
 * recargas completas de la pantalla, cada una devolviendo a quien cargaba los
 * precios al principio del tarifario. Juntarlas en un solo envío por fila es
 * un clic, una sola recarga, y no se pierde el lugar en la tabla.
 */
export async function actualizarTarifasDeFila(
  _prev: EstadoTarifasFila,
  formData: FormData,
): Promise<EstadoTarifasFila> {
  await requerirAcceso('config')

  const TEMPORADAS = ['baja', 'media', 'alta'] as const
  const cambios: { id: string; neto: number; rack: number }[] = []

  for (const t of TEMPORADAS) {
    const id = String(formData.get(`tarifa_id_${t}`) ?? '')
    if (!id) continue // Este tipo no tiene tarifa cargada para esta temporada.

    const neto = Number(formData.get(`precio_neto_${t}`))
    const rack = Number(formData.get(`precio_rack_${t}`))
    if (!Number.isFinite(neto) || !Number.isFinite(rack) || neto < 0 || rack < 0) {
      return { error: 'Los importes tienen que ser números positivos.' }
    }
    if (neto > rack) {
      return { error: 'El precio neto (agencia) no puede superar al rack (mostrador).' }
    }
    cambios.push({ id, neto, rack })
  }

  // Las tres temporadas van juntas: si una falla, no se guarda ninguna (0122).
  // Sin temporadas cargadas no hay nada que mandar (la función rechaza un lote vacío).
  if (cambios.length > 0) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.rpc('actualizar_tarifas_en_lote', { p_cambios: cambios })
    if (error) return { error: mensajeDeFalla(error, 'config:guardar', 'No se pudo guardar') }
  }

  // El precio rack se publica en `/alojamientos`, que lo lee cacheado: sin esto,
  // el nuevo precio tardaría hasta 5 minutos en verse en la web.
  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tarifario')

  return { ok: 'Tarifas guardadas.' }
}

export interface EstadoPorcentajeTarifario {
  error?: string
  ok?: string
}

/**
 * Sube o baja TODAS las tarifas cargadas (o las de una sola temporada) un
 * mismo porcentaje, de una vez.
 *
 * Es como se ajusta el tarifario en un hotel real, según lo que pidió el
 * dueño: al cambio de temporada no se entra tarifa por tarifa, se aplica un
 * porcentaje parejo y después se corrige a mano lo puntual. El mismo
 * porcentaje sube (o baja) el precio neto Y el rack juntos, así la relación
 * entre los dos —el neto de agencia nunca puede superar al rack de
 * mostrador— se mantiene sola: multiplicar dos números por el mismo factor
 * positivo no puede invertir el orden que ya tenían.
 *
 * Se calculan y validan TODOS los precios nuevos antes de escribir el
 * primero: si el porcentaje dejara algún precio negativo, no se guarda nada.
 * Y la escritura es todo o nada (`actualizar_tarifas_en_lote`, 0122): antes
 * era un `update` por tarifa, y si fallaba a mitad de camino quedaba medio
 * tarifario con el precio nuevo — y repetir el porcentaje lo aplicaba dos
 * veces a esa mitad.
 */
export async function aplicarPorcentajeTarifario(
  _prev: EstadoPorcentajeTarifario,
  formData: FormData,
): Promise<EstadoPorcentajeTarifario> {
  await requerirAcceso('config')

  const pct = Number(formData.get('porcentaje'))
  if (!Number.isFinite(pct) || pct === 0) return { error: 'Ingresá un porcentaje distinto de cero.' }
  if (pct < -90 || pct > 500) {
    return { error: 'Ese porcentaje parece un error de tipeo (tiene que estar entre -90 y 500). Revisalo.' }
  }

  const temporadaFiltro = String(formData.get('temporada') ?? '') // '' = todas

  const supabase = await crearClienteServidor()
  const { data, error: eLectura } = await supabase
    .from('tarifas')
    .select('id, precio_neto, precio_rack, temporada:temporadas(codigo)')

  if (eLectura) return { error: 'No se pudo leer el tarifario. Probá de nuevo.' }

  interface FilaTarifa {
    id: string
    precio_neto: number | string
    precio_rack: number | string
    temporada: { codigo: string } | null
  }
  const todas = (data ?? []) as unknown as FilaTarifa[]
  const alcanzadas = temporadaFiltro
    ? todas.filter((t) => t.temporada?.codigo === temporadaFiltro)
    : todas

  if (alcanzadas.length === 0) return { error: 'No hay tarifas cargadas para ese filtro.' }

  const factor = 1 + pct / 100
  const cambios = alcanzadas.map((t) => ({
    id: t.id,
    neto: Math.round(Number(t.precio_neto) * factor * 100) / 100,
    rack: Math.round(Number(t.precio_rack) * factor * 100) / 100,
  }))

  if (cambios.some((c) => c.neto < 0 || c.rack < 0)) {
    return { error: 'Ese porcentaje dejaría algún precio negativo. No se guardó nada.' }
  }

  // Todo el lote en una transacción (0122): si falla una tarifa, no cambia
  // ninguna, y se puede repetir sin miedo a aplicar el porcentaje dos veces.
  const { error } = await supabase.rpc('actualizar_tarifas_en_lote', { p_cambios: cambios })
  if (error) {
    return {
      error: mensajeDeFalla(
        error,
        'config:tarifario_lote',
        'No se pudo aplicar el cambio. No se modificó ninguna tarifa',
      ),
    }
  }

  updateTag(ETIQUETA_CATALOGO)
  revalidatePath('/panel/config/tarifario')

  const signo = pct > 0 ? '+' : ''
  return { ok: `Se aplicó ${signo}${pct}% a ${cambios.length} tarifa(s).` }
}
