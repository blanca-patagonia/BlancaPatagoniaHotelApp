import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import {
  emparejarResenaConReserva,
  type CandidataResena,
} from '@/lib/domain/resenas-canal'
import type { ResenaEntrante } from './resenas-csv'
import type { CanalVenta } from '.'

/**
 * Guardar las reseñas importadas, ligándolas a su reserva cuando se puede.
 *
 * ── Una consulta de candidatas para todo el archivo ─────────────────────────
 *
 * Las candidatas se traen **una sola vez**, acotadas al rango de fechas que cubren las
 * reseñas del archivo. Buscar por reseña serían 200 consultas para un export de un año.
 *
 * ── Idempotencia en dos piezas ──────────────────────────────────────────────
 *
 * Las que traen `external_id` van por el unique parcial de la migración 0054. Las que
 * no, por `huella`. Hacen falta las dos: un `unique` sobre una columna nullable no
 * impide duplicados, porque en Postgres cada `null` es distinto de todos los demás.
 */

export interface ResumenResenas {
  leidas: number
  nuevas: number
  actualizadas: number
  ligadas: number
  sinLigar: number
  rechazadas: number
}

export async function guardarResenas(
  client: SupabaseClient,
  entrantes: readonly ResenaEntrante[],
  contexto: { canal: CanalVenta; origen: string; perfilId?: string },
): Promise<ResumenResenas> {
  const resumen: ResumenResenas = {
    leidas: entrantes.length,
    nuevas: 0,
    actualizadas: 0,
    ligadas: 0,
    sinLigar: 0,
    rechazadas: 0,
  }

  if (entrantes.length === 0) return resumen

  /*
    Candidatas: reservas del canal ya importadas cuyo check-out cae en el rango que
    cubren las reseñas, más un margen. El margen es la ventana de la reseña: una
    publicada el 20 puede referirse a una estadía que terminó el 6.
  */
  const fechas = entrantes.map((r) => r.publicadaEn).filter((f): f is string => Boolean(f))
  const desde = fechas.length > 0 ? fechas.reduce((a, f) => (f < a ? f : a)) : null
  const hasta = fechas.length > 0 ? fechas.reduce((a, f) => (f > a ? f : a)) : null

  let candidatas: CandidataResena[] = []

  if (desde && hasta) {
    // 30 días de margen hacia atrás cubre con holgura la ventana de 14 del dominio.
    const margen = new Date(Date.parse(`${desde}T00:00:00Z`) - 30 * 86400000)
      .toISOString()
      .slice(0, 10)

    const { data, error } = await client
      .from('canal_reservas')
      .select('id, external_id, huesped_apellido, check_in, check_out, reserva_id')
      .eq('canal', contexto.canal)
      .not('reserva_id', 'is', null)
      .gte('check_out', margen)
      .lte('check_out', hasta)

    if (error) {
      // Sin candidatas las reseñas entran sin ligar, que es peor que ligadas pero
      // mucho mejor que no importarlas: el texto es el dato que importa.
      registrarFalla(error, 'leer candidatas para ligar reseñas')
    } else {
      candidatas = ((data ?? []) as unknown as {
        id: string
        external_id: string
        huesped_apellido: string
        check_in: string
        check_out: string
        reserva_id: string
      }[]).map((c) => ({
        reservaId: c.reserva_id,
        canalReservaId: c.id,
        externalId: c.external_id,
        apellido: c.huesped_apellido,
        checkIn: c.check_in,
        checkOut: c.check_out,
      }))
    }
  }

  for (const r of entrantes) {
    const emparejamiento = emparejarResenaConReserva(
      { reservaExternalId: r.reservaExternalId, autor: r.autor, publicadaEn: r.publicadaEn },
      candidatas,
    )

    const fila = {
      canal: contexto.canal,
      external_id: r.externalId,
      // La huella solo se guarda si NO hay external_id: el unique de huella es parcial
      // y excluye las que tienen id, para que las dos reglas no se pisen.
      huella: r.externalId ? null : r.huella,
      autor: r.autor,
      pais: r.pais,
      puntaje: r.puntaje,
      titulo: r.titulo,
      positivo: r.positivo,
      negativo: r.negativo,
      publicada_en: r.publicadaEn,
      respuesta: r.respuesta,
      // Que el export traiga la respuesta significa que ya se respondió en el extranet.
      respondida: Boolean(r.respuesta),
      reserva_id: emparejamiento.reservaId,
      vinculo: emparejamiento.vinculo,
      motivo_sin_vinculo: emparejamiento.motivo,
    }

    /*
      Se busca la existente por la misma regla con la que se identifica: por
      `external_id` si lo hay, por `huella` si no. `maybeSingle` y no `single`: lo
      normal es que no exista.
    */
    const consulta = client
      .from('canal_resenas')
      .select('id, respuesta, vinculo, reserva_id')
      .eq('canal', contexto.canal)

    const { data: existente } = r.externalId
      ? await consulta.eq('external_id', r.externalId).maybeSingle<FilaResena>()
      : await consulta.eq('huella', r.huella).is('external_id', null).maybeSingle<FilaResena>()

    if (!existente) {
      const { error } = await client.from('canal_resenas').insert(fila)
      if (error) {
        registrarFalla(error, `guardar reseña de ${r.autor}`)
        resumen.rechazadas++
        continue
      }
      resumen.nuevas++
      if (emparejamiento.reservaId) resumen.ligadas++
      else resumen.sinLigar++
      continue
    }

    /*
      Ya existe. Se actualiza el contenido, pero con dos cosas que NO se pisan:

      · **Un vínculo hecho a mano.** Si alguien ya decidió a qué reserva pertenece, la
        heurística no tiene autoridad para cambiarlo. Reimportar el archivo borraría el
        trabajo de esa persona.
      · **Una respuesta escrita acá.** Si el hotel respondió desde el panel y el export
        del extranet todavía no la refleja, el archivo trae la respuesta vacía —y pisar
        con vacío perdería el texto.
    */
    const { error } = await client
      .from('canal_resenas')
      .update({
        ...fila,
        ...(existente.vinculo === 'manual'
          ? { vinculo: 'manual', reserva_id: existente.reserva_id, motivo_sin_vinculo: '' }
          : {}),
        ...(!r.respuesta && existente.respuesta
          ? { respuesta: existente.respuesta, respondida: true }
          : {}),
      })
      .eq('id', existente.id)

    if (error) {
      registrarFalla(error, `actualizar reseña de ${r.autor}`)
      resumen.rechazadas++
      continue
    }
    resumen.actualizadas++
    if (emparejamiento.reservaId || existente.vinculo === 'manual') resumen.ligadas++
    else resumen.sinLigar++
  }

  return resumen
}

interface FilaResena {
  id: string
  respuesta: string
  vinculo: string
  reserva_id: string | null
}
