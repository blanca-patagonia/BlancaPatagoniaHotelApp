'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cortarSiFalla } from '@/lib/acciones'
import { interpretarCsvResenas } from '@/lib/canales/resenas-csv'
import { guardarResenas } from '@/lib/canales/resenas-servicio'
import { requerirAcceso } from '@/lib/auth/session'

/** Reseñas del canal: importarlas del CSV, cargarlas a mano, vincularlas a una reserva y responderlas. */

const DESTINO = '/panel/canales'

/* ──────────────────────────────────────────────── importar reseñas ──── */

/** Mismo tope que el CSV de reservas (`actions.ts`): un archivo equivocado no se lee entero. */
const MAX_BYTES = 5 * 1024 * 1024

export interface EstadoImportacionResenas {
  error?: string
  ok?: string
  rechazadas?: { fila: number; motivos: string[] }[]
  /** Cuántas quedaron sin ligar, para ofrecer resolverlas. */
  sinLigar?: number
}

/**
 * Importa el export de reseñas del extranet.
 *
 * ── Lo que resuelve ────────────────────────────────────────────────────────
 *
 * Hasta acá `canal_resenas` existía con las columnas correctas y **sin ningún camino
 * de ingesta**: solo un formulario manual que escribía cinco campos, así que
 * `external_id`, `reserva_id`, `pais` y `titulo` nunca se llenaban y una reseña
 * cargada a mano no quedaba ligada a nada.
 *
 * La API de reseñas de Booking es de partner, así que el export del extranet es el
 * único camino disponible — y es suficiente: trae puntaje, texto, fecha y a veces el
 * número de reserva.
 */
export async function importarResenasCanal(
  _prev: EstadoImportacionResenas,
  formData: FormData,
): Promise<EstadoImportacionResenas> {
  const sesion = await requerirAcceso('canales')

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el archivo de reseñas que bajaste del extranet.' }
  }
  if (archivo.size > MAX_BYTES) {
    return { error: 'El archivo es demasiado grande. ¿Seguro que es el export de reseñas?' }
  }

  const resultado = interpretarCsvResenas(await archivo.text())

  if (resultado.faltantes.length > 0) {
    return {
      error:
        'No se reconoció la columna con el nombre de quien escribió la reseña, que es la única ' +
        'imprescindible. Revisá que el archivo sea el export de reseñas y no otro.',
    }
  }

  if (resultado.resenas.length === 0 && resultado.rechazadas.length === 0) {
    return { error: 'El archivo no tiene ninguna reseña.' }
  }

  const supabase = await crearClienteServidor()
  const resumen = await guardarResenas(supabase, resultado.resenas, {
    canal: 'booking',
    origen: archivo.name,
    perfilId: sesion.userId,
  })

  revalidatePath(DESTINO)

  return {
    ok:
      `Se leyeron ${resumen.leidas} reseña(s): ${resumen.nuevas} nueva(s), ` +
      `${resumen.actualizadas} actualizada(s). ${resumen.ligadas} quedaron ligadas a su reserva.`,
    rechazadas: resultado.rechazadas.length > 0 ? resultado.rechazadas : undefined,
    sinLigar: resumen.sinLigar > 0 ? resumen.sinLigar : undefined,
  }
}

/**
 * Liga una reseña a una reserva, a mano.
 *
 * El vínculo queda marcado como `'manual'`, y eso importa: reimportar el archivo **no**
 * lo pisa. Si alguien ya decidió a qué reserva pertenece, la heurística no tiene
 * autoridad para cambiarlo.
 */
export async function vincularResena(formData: FormData): Promise<void> {
  await requerirAcceso('canales')

  const resenaId = String(formData.get('resena_id') ?? '')
  const reservaId = String(formData.get('reserva_id') ?? '')
  if (!resenaId) redirect(`${DESTINO}?vista=resenas&error=falta_id`)

  const supabase = await crearClienteServidor()

  // Cadena vacía = desvincular. Es un caso legítimo: alguien se dio cuenta de que la
  // había ligado mal.
  const { error } = await supabase
    .from('canal_resenas')
    .update(
      reservaId
        ? { reserva_id: reservaId, vinculo: 'manual', motivo_sin_vinculo: '' }
        : {
            reserva_id: null,
            vinculo: 'sin_vincular',
            motivo_sin_vinculo: 'Se desvinculó a mano.',
          },
    )
    .eq('id', resenaId)

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'vincular')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=${reservaId ? 'vinculada' : 'desvinculada'}`)
}

/** Carga a mano una reseña publicada en el canal. */
export async function cargarResena(formData: FormData): Promise<void> {
  await requerirAcceso('canales')

  const autor = String(formData.get('autor') ?? '').trim()
  const puntajeCrudo = Number(formData.get('puntaje'))
  const positivo = String(formData.get('positivo') ?? '').trim()
  const negativo = String(formData.get('negativo') ?? '').trim()

  // Booking puntúa de 1 a 10. Un valor fuera de rango lo rechaza el `check` de la
  // base, pero se corta antes para poder explicarlo en español.
  if (!Number.isFinite(puntajeCrudo) || puntajeCrudo < 0 || puntajeCrudo > 10) {
    redirect(`${DESTINO}?vista=resenas&error=puntaje`)
  }
  if (!positivo && !negativo) {
    redirect(`${DESTINO}?vista=resenas&error=resena_vacia`)
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('canal_resenas').insert({
    canal: 'booking',
    autor: autor || 'Anónimo',
    puntaje: puntajeCrudo,
    positivo,
    negativo,
    publicada_en: String(formData.get('publicada_en') ?? '') || null,
  })

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'resena')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=resena`)
}

/** Guarda la respuesta del hotel a una reseña. */
export async function responderResena(formData: FormData): Promise<void> {
  await requerirAcceso('canales')

  const id = String(formData.get('resena_id') ?? '')
  const respuesta = String(formData.get('respuesta') ?? '').trim()
  if (!id) redirect(`${DESTINO}?error=falta_id`)
  if (!respuesta) redirect(`${DESTINO}?vista=resenas&error=respuesta_vacia`)

  const supabase = await crearClienteServidor()
  const { error } = await supabase
    .from('canal_resenas')
    .update({ respuesta, respondida: true })
    .eq('id', id)

  cortarSiFalla(error, `${DESTINO}?vista=resenas`, 'respuesta')
  revalidatePath(DESTINO)
  redirect(`${DESTINO}?vista=resenas&ok=respuesta`)
}
