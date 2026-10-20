'use server'

import { MENSAJES_PROMOCION } from './promociones/mensajes'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { obtenerSesion } from '@/lib/auth/session'
import { cortarSiFalla, mensajeDeFalla } from '@/lib/acciones'
import { puedeAcceder } from '@/lib/domain/permisos'

/**
 * Lee y valida los campos comunes del alta y la edición de una promoción.
 *
 * `tipo` solo admite `porcentaje` y `monto`: `paquete` existe en el `check` de
 * la base (y en `lib/domain/precios.ts`, para cuando haya una Fase que lo
 * resuelva) pero hoy no ajusta ningún precio —`calcularEstadia` lo excluye a
 * propósito—, así que ofrecerlo en el alta crearía una promoción que no hace
 * nada y nadie lo notaría hasta reclamar el descuento que nunca se aplicó.
 */
function leerCamposPromocion(formData: FormData):
  | {
      nombre: string
      tipo: 'porcentaje' | 'monto'
      valor: number
      minNoches: number | null
      anticipacionDias: number | null
      vigenciaDesde: string | null
      vigenciaHasta: string | null
    }
  | { error: string } {
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
  const tipo = String(formData.get('tipo') ?? '')
  const valorCrudo = Number(formData.get('valor'))
  const minNochesCrudo = String(formData.get('min_noches') ?? '').trim()
  const anticipacionCrudo = String(formData.get('anticipacion_dias') ?? '').trim()
  const vigenciaDesde = String(formData.get('vigencia_desde') ?? '').trim()
  const vigenciaHasta = String(formData.get('vigencia_hasta') ?? '').trim()

  if (!nombre) return { error: 'promo_nombre' }
  if (tipo !== 'porcentaje' && tipo !== 'monto') return { error: 'promo_tipo' }
  if (!Number.isFinite(valorCrudo) || valorCrudo <= 0) return { error: 'promo_valor' }
  if (tipo === 'porcentaje' && valorCrudo > 100) return { error: 'promo_valor' }
  if (vigenciaDesde && vigenciaHasta && vigenciaHasta < vigenciaDesde) {
    return { error: 'promo_vigencia' }
  }

  return {
    nombre,
    tipo,
    valor: valorCrudo,
    minNoches: minNochesCrudo ? Math.max(0, Math.trunc(Number(minNochesCrudo))) : null,
    anticipacionDias: anticipacionCrudo ? Math.max(0, Math.trunc(Number(anticipacionCrudo))) : null,
    vigenciaDesde: vigenciaDesde || null,
    vigenciaHasta: vigenciaHasta || null,
  }
}

/** Da de alta una promoción. El código queda fijo: es lo que se comunica como cupón. */
/** Lo que vuelve al formulario de alta de una promoción cuando algo se rechaza. */
export interface EstadoAltaPromocion {
  error?: string
  valores?: Record<string, string>
}

export async function crearPromocion(
  _prev: EstadoAltaPromocion,
  formData: FormData,
): Promise<EstadoAltaPromocion> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  // Lo cargado vuelve con el error: el alta tiene su pantalla y no se vacía.
  const valores = Object.fromEntries(
    ['codigo', 'nombre', 'tipo', 'valor', 'min_noches', 'anticipacion_dias', 'vigencia_desde', 'vigencia_hasta'].map(
      (k) => [k, String(formData.get(k) ?? '')],
    ),
  )
  const codigo = String(formData.get('codigo') ?? '').trim().toUpperCase().slice(0, 40)
  if (!codigo || !/^[A-Z0-9-]+$/.test(codigo)) {
    return { error: MENSAJES_PROMOCION.promo_codigo, valores }
  }

  const campos = leerCamposPromocion(formData)
  if ('error' in campos) return { error: MENSAJES_PROMOCION[campos.error], valores }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('promociones').insert({
    codigo,
    nombre: campos.nombre,
    tipo: campos.tipo,
    valor: campos.valor,
    condiciones: {
      ...(campos.minNoches != null ? { min_noches: campos.minNoches } : {}),
      ...(campos.anticipacionDias != null ? { anticipacion_dias: campos.anticipacionDias } : {}),
    },
    vigencia_desde: campos.vigenciaDesde,
    vigencia_hasta: campos.vigenciaHasta,
  })
  if (error) {
    return {
      error:
        error.code === '23505'
          ? MENSAJES_PROMOCION.promo_codigo_repetido
          : mensajeDeFalla(error, 'config:crear_promocion', 'No se pudo guardar la promoción'),
      valores,
    }
  }

  revalidatePath('/panel/config/promociones')
  redirect('/panel/config/promociones?ok=promo_creada')
}

/** Edita una promoción existente. No recibe `codigo`: ver el comentario de `crearPromocion`. */
export async function editarPromocion(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('promocion_id') ?? '')
  if (!id) redirect('/panel/config/promociones?error=promo_guardar')

  const campos = leerCamposPromocion(formData)
  if ('error' in campos) redirect(`/panel/config/promociones?error=${campos.error}`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('promociones')
    .update({
      nombre: campos.nombre,
      tipo: campos.tipo,
      valor: campos.valor,
      condiciones: {
        ...(campos.minNoches != null ? { min_noches: campos.minNoches } : {}),
        ...(campos.anticipacionDias != null ? { anticipacion_dias: campos.anticipacionDias } : {}),
      },
      vigencia_desde: campos.vigenciaDesde,
      vigencia_hasta: campos.vigenciaHasta,
    })
    .eq('id', id)
  cortarSiFalla(error, '/panel/config/promociones', 'promo_guardar')

  revalidatePath('/panel/config/promociones')
  redirect('/panel/config/promociones?ok=promo_editada')
}

/** Da de baja o reactiva una promoción. No afecta reservas que ya la tengan aplicada. */
export async function alternarActivoPromocion(formData: FormData): Promise<void> {
  const sesion = await obtenerSesion()
  if (!sesion || !puedeAcceder(sesion.rol, 'config')) redirect('/panel')

  const id = String(formData.get('promocion_id') ?? '')
  const activo = formData.get('activo') === '1'
  if (!id) redirect('/panel/config/promociones?error=promo_guardar')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('promociones').update({ activo }).eq('id', id)
  cortarSiFalla(error, '/panel/config/promociones', 'promo_guardar')

  revalidatePath('/panel/config/promociones')
  redirect(`/panel/config/promociones?ok=${activo ? 'promo_activada' : 'promo_dada_de_baja'}`)
}
