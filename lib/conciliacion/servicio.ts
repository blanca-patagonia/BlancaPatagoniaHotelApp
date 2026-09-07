import 'server-only'

/**
 * Guarda movimientos externos y los concilia contra los pagos del sistema.
 *
 * Es la mitad con base de datos de la conciliación; las reglas viven en
 * `lib/domain/conciliacion.ts` y se prueban sin levantar nada.
 *
 * ── Las dos garantías ───────────────────────────────────────────────────────
 *
 * 1. **Reimportar no duplica.** La clave es `(origen, external_id)` y la impone la
 *    base (migración 0077). Acá se usa `upsert ... ignoreDuplicates`, así que
 *    subir dos veces el mismo extracto —cosa que pasa— deja los mismos
 *    movimientos y devuelve cuántos eran nuevos.
 * 2. **El emparejamiento automático sólo cierra lo que no admite duda.** Únicamente
 *    la referencia de la pasarela concilia sola. El importe y la fecha se muestran
 *    como candidato y decide una persona: dos huéspedes que pagan la misma seña el
 *    mismo día es lo más común del mundo, y casar el cobro con la reserva
 *    equivocada deja a uno figurando impago y al otro pagado sin haber pagado.
 */

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarFalla } from '@/lib/acciones'
import { traerTodo } from '@/lib/paginado'
import {
  coincidenciaAutomatica,
  emparejar,
  type MovimientoExterno,
  type PagoConciliable,
} from '@/lib/domain/conciliacion'

export interface ResultadoImportacion {
  ok: boolean
  /** Cuántos entraron por primera vez. */
  nuevos: number
  /** Cuántos ya estaban: la reimportación del mismo archivo. */
  repetidos: number
  /** Cuántos se conciliaron solos, por referencia exacta de la pasarela. */
  conciliados: number
  error?: string
}

/**
 * Cuántos días hacia atrás se buscan pagos para emparejar.
 *
 * Sesenta: cubre una liquidación atrasada y un extracto que alguien sube a fin de
 * mes, sin traerse el historial entero del hotel a la memoria en cada importación.
 */
const DIAS_DE_BUSQUEDA = 60

function haceDias(dias: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Guarda los movimientos y concilia lo que no admite duda.
 *
 * Corre con `service_role` porque la migración 0077 le revoca el `insert` a
 * `authenticated`: una fila cargada a mano desaparecería del cuadre sin dejar
 * rastro de qué archivo la trajo.
 */
export async function importarMovimientos(
  movimientos: readonly MovimientoExterno[],
  importadoPor: string | null,
): Promise<ResultadoImportacion> {
  if (movimientos.length === 0) {
    return { ok: true, nuevos: 0, repetidos: 0, conciliados: 0 }
  }

  const admin = crearClienteAdmin()

  const filas = movimientos.map((m) => ({
    origen: m.origen,
    cuenta: m.cuenta ?? null,
    external_id: m.externalId,
    fecha: m.fecha,
    descripcion: m.descripcion || null,
    monto: m.monto,
    moneda: m.moneda,
    importado_por: importadoPor,
  }))

  /*
    `ignoreDuplicates` y no `merge`.

    Un movimiento ya importado puede estar **conciliado**, y un `merge` le pisaría
    el importe y la descripción con los del archivo nuevo. Iguales serían, salvo
    que el banco haya corregido la línea — y en ese caso pisarla en silencio borra
    la conciliación que alguien ya revisó. Lo que entra es lo nuevo; lo que ya
    estaba se deja como está y se cuenta.
  */
  const { data, error } = await admin
    .from('movimientos_externos')
    .upsert(filas, { onConflict: 'origen,external_id', ignoreDuplicates: true })
    .select('id, origen, external_id, fecha, monto, moneda')

  if (error) {
    return {
      ok: false,
      nuevos: 0,
      repetidos: 0,
      conciliados: 0,
      error: `No se pudieron guardar los movimientos: ${error.message}`,
    }
  }

  const insertados = (data ?? []) as {
    id: string
    origen: string
    external_id: string
    fecha: string
    monto: number | string
    moneda: string
  }[]

  const conciliados = await conciliarLoEvidente(
    insertados.map((m) => ({
      id: m.id,
      externalId: m.external_id,
      fecha: m.fecha,
      monto: Number(m.monto),
      moneda: m.moneda,
    })),
  )

  return {
    ok: true,
    nuevos: insertados.length,
    repetidos: movimientos.length - insertados.length,
    conciliados,
  }
}

interface MovimientoGuardado {
  id: string
  externalId: string
  fecha: string
  monto: number
  moneda: string
}

/**
 * Concilia los movimientos cuya referencia coincide **exactamente** con un pago.
 *
 * Devuelve cuántos cerró. Un fallo acá no invalida la importación —los movimientos
 * ya están guardados y se pueden conciliar a mano—, así que se registra y se sigue:
 * cortar dejaría el archivo a medio importar, que es peor.
 */
async function conciliarLoEvidente(movimientos: readonly MovimientoGuardado[]): Promise<number> {
  const entrantes = movimientos.filter((m) => m.monto > 0)
  if (entrantes.length === 0) return 0

  const admin = crearClienteAdmin()

  /*
    Los pagos candidatos, por `traerTodo`.

    PostgREST corta en 1000 filas con HTTP 200 y sin aviso (`max_rows`): un hotel
    con más de mil pagos en dos meses vería que «algunos movimientos no concilian»
    sin ningún error, y el motivo sería la fila 1001.
  */
  const { filas: pagosData, error } = await traerTodo<{
    id: string
    external_id: string | null
    creado_en: string
    monto: number | string
    monto_cobrado: number | string | null
    moneda: string
  }>(
    (desde, hasta) =>
      admin
        .from('pagos')
        .select('id, external_id, creado_en, monto, monto_cobrado, moneda')
        .eq('estado', 'aprobado')
        .gte('creado_en', haceDias(DIAS_DE_BUSQUEDA))
        .order('creado_en', { ascending: false })
        .range(desde, hasta),
  )

  if (error) {
    // `traerTodo` devuelve el mensaje ya extraído, no el objeto de PostgREST.
    registrarFalla({ message: error }, 'leer pagos para conciliar movimientos externos')
    return 0
  }

  const pagos: PagoConciliable[] = (pagosData ?? []).map((p) => ({
    id: p.id,
    externalId: p.external_id,
    fecha: p.creado_en.slice(0, 10),
    // Lo que de verdad pasó por la pasarela: `monto` está siempre en USD y el
    // extracto viene en la moneda de la cuenta (ADR 0027).
    monto: p.monto_cobrado === null ? Number(p.monto) : Number(p.monto_cobrado),
    moneda: p.moneda,
  }))

  // Un pago no se puede conciliar dos veces: la base tiene el índice parcial que lo
  // impide, y acá se lleva la cuenta para no intentarlo y contar de más.
  const yaUsados = new Set<string>()
  let cerrados = 0

  for (const m of entrantes) {
    const candidato = coincidenciaAutomatica(emparejar(m, pagos))
    if (!candidato || yaUsados.has(candidato.pagoId)) continue

    const { error: eUpdate } = await admin
      .from('movimientos_externos')
      .update({
        estado: 'conciliado',
        pago_id: candidato.pagoId,
        nota: 'Conciliado automáticamente: la referencia de la pasarela coincide.',
        conciliado_en: new Date().toISOString(),
      })
      .eq('id', m.id)

    if (eUpdate) {
      // 23505 = ese pago ya estaba conciliado contra otro movimiento. No es una
      // falla del sistema: es la garantía de la base funcionando.
      if (eUpdate.code !== '23505') {
        registrarFalla(eUpdate, `conciliar automáticamente el movimiento ${m.id}`)
      }
      continue
    }

    yaUsados.add(candidato.pagoId)
    cerrados++
  }

  return cerrados
}
