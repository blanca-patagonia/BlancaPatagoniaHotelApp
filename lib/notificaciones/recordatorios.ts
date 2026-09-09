import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, seniaSugerida, type Pago } from '@/lib/domain/pagos'
import { diasEntre, hoyISO } from '@/lib/fechas'
import { HORA_CHECK_IN } from '@/lib/domain/hotel'
import { mereceLaPenaPedirResena, ventanasDeAviso } from '@/lib/domain/recordatorios'
import { urlDelSitio } from '@/lib/env'
import { encolar } from './index'
import {
  avisarCheckoutProximo,
  avisarReservaPorVencer,
  avisarSaldoPendiente,
  avisarSolicitudResena,
  type DestinoHuesped,
} from './eventos'

/**
 * Los recordatorios que salen solos (objetivo 6 del pedido).
 *
 * ── El hueco que cierra ─────────────────────────────────────────────────────
 *
 * El catálogo tenía veinte plantillas y **cuatro de ellas no las disparaba
 * nadie**: el aviso de que la reserva se libera mañana, el recordatorio de saldo,
 * el de check-out y el pedido de reseña. Una plantilla que existe y nunca se
 * manda es peor que no tenerla: da la sensación de que el hotel avisa.
 *
 * El recordatorio de check-in sí existía, pero **atado a un botón** del listado
 * de reservas: si nadie lo apretaba —un domingo, por ejemplo— no salía. Acá pasa
 * a salir solo, y el botón queda como el modo de forzarlo.
 *
 * ── Por qué cinco consultas y no un `join` grande ───────────────────────────
 *
 * Cada recordatorio mira un momento distinto de la reserva y ninguno depende del
 * otro. Un fallo de uno **no frena a los demás**: que no se pueda leer quién sale
 * mañana no es motivo para dejar de avisar los saldos.
 *
 * ── La idempotencia la pone la bandeja ──────────────────────────────────────
 *
 * Todos van por `encolar`, cuya clave incluye la fecha que corresponda. Correr
 * este cron dos veces el mismo día no manda nada dos veces: el segundo intento
 * choca con el `unique` de la 0075 y se descarta, que es exactamente lo que se
 * quiere.
 */

export interface ResumenRecordatorios {
  llegadas: number
  saldos: number
  salidas: number
  porVencer: number
  resenas: number
  /** Tareas que fallaron, por nombre. Ninguna frena a las otras. */
  fallidas: string[]
}

/** La forma en que se leen reserva + huésped + estadía para armar un aviso. */
interface FilaReserva {
  id: string
  codigo: string
  total: number
  huesped_id: string | null
  creado_en?: string
  huesped: { nombre: string; apellido: string; email: string | null; telefono: string | null } | null
  // ⚠️ PostgREST tipa el embed como arreglo aunque la relación sea a-uno.
  estadia?: { check_in: string; check_out: string }[] | null
}

const CAMPOS = `id, codigo, total, huesped_id, creado_en,
  huesped:huespedes!reservas_huesped_id_fkey(nombre, apellido, email, telefono)`

function destinoDe(r: FilaReserva): DestinoHuesped {
  return {
    reservaId: r.id,
    huespedId: r.huesped_id,
    email: r.huesped?.email ?? null,
    telefono: r.huesped?.telefono ?? null,
    nombre: r.huesped?.nombre || (r.huesped?.apellido ?? ''),
    codigo: r.codigo,
  }
}

/**
 * Saldo de una reserva, con la cuenta consolidada.
 *
 * Alojamiento **más consumos**: decirle «saldo 0» a quien consumió del frigobar
 * es el mismo error que dejó una reserva marcada «pagada» debiendo esa parte.
 */
async function saldoDe(client: SupabaseClient, reservaId: string, total: number): Promise<number> {
  const [{ data: pagos }, { data: consumos }] = await Promise.all([
    client.from('pagos').select('tipo, monto, estado').eq('reserva_id', reservaId),
    client.from('consumos').select('cantidad, precio_unitario').eq('reserva_id', reservaId),
  ])

  const cuenta = cuentaConsolidada(
    Number(total),
    (consumos ?? []).map((c) => ({
      cantidad: (c as { cantidad: number }).cantidad,
      precioUnitario: Number((c as { precio_unitario: number }).precio_unitario),
    })) as Consumo[],
  )
  return resumenPagos(cuenta.total, (pagos ?? []) as Pago[]).saldo
}

/**
 * Corre las cinco tareas.
 *
 * `hoy` se recibe para poder fijarlo en un test; por omisión sale de `hoyISO()`,
 * que resuelve en la zona del hotel. Con `toISOString()` pelado, entre las 21 y
 * la medianoche de El Calafate «mañana» sería pasado mañana y los recordatorios
 * de llegada saldrían para el día equivocado.
 */
export async function correrRecordatorios(
  client: SupabaseClient,
  hoy: string = hoyISO(),
): Promise<ResumenRecordatorios> {
  const v = ventanasDeAviso(hoy)
  const resumen: ResumenRecordatorios = {
    llegadas: 0,
    saldos: 0,
    salidas: 0,
    porVencer: 0,
    resenas: 0,
    fallidas: [],
  }

  const tareas: [keyof ResumenRecordatorios, () => Promise<number>][] = [
    ['llegadas', () => recordarLlegadas(client, v.llegadaManana)],
    ['saldos', () => recordarSaldos(client, v.llegadaConSaldo)],
    ['salidas', () => recordarSalidas(client, v.salidaManana)],
    ['porVencer', () => avisarLasQueVencen(client, v.creadaAntesDe)],
    ['resenas', () => pedirResenas(client, v.salidaParaResena)],
  ]

  for (const [nombre, correr] of tareas) {
    try {
      const n = await correr()
      if (nombre !== 'fallidas') resumen[nombre] = n
    } catch (e) {
      // Una tarea que falla no frena a las otras: son independientes, y que no se
      // pueda leer quién sale mañana no justifica dejar de avisar los saldos.
      resumen.fallidas.push(String(nombre))
      registrarFalla(
        { message: e instanceof Error ? e.message : String(e) },
        `recordatorio automático «${String(nombre)}»`,
      )
    }
  }

  return resumen
}

/* ─────────────────────────────────────────────────── las cinco tareas ──── */

/**
 * Recordatorio de check-in a quienes llegan mañana.
 *
 * El `discriminante` es la fecha de llegada: sin él, una reserva reprogramada no
 * volvería a recibir aviso nunca, porque la clave ya estaría usada.
 */
async function recordarLlegadas(client: SupabaseClient, manana: string): Promise<number> {
  const { data, error } = await client
    .from('estadias')
    .select(`check_in, reserva:reservas!inner(${CAMPOS})`)
    .eq('check_in', manana)
    .in('estado', ['confirmada', 'pagada'])

  if (error) throw new Error(error.message)

  let n = 0
  for (const fila of (data ?? []) as unknown as { reserva: FilaReserva | null }[]) {
    const r = fila.reserva
    /*
      Alcanza con que exista la ficha del huésped: `encolar` decide el canal y
      devuelve el motivo si no hay por dónde. Exigir email acá dejaría afuera a
      quien cargó sólo el teléfono, que con WhatsApp enchufado sí es alcanzable.
    */
    if (!r?.huesped) continue

    const res = await encolar(client, {
      evento: 'recordatorio_checkin',
      entidadId: r.id,
      discriminante: manana,
      destinatario: r.huesped.email,
      telefono: r.huesped.telefono,
      huespedId: r.huesped_id,
      reservaId: r.id,
      variables: {
        nombre: r.huesped.nombre || r.huesped.apellido,
        codigo: r.codigo,
        check_in: manana,
        hora_check_in: HORA_CHECK_IN,
      },
    })
    if (res.ok && !res.yaEstaba) n++
  }
  return n
}

/** Recordatorio de saldo a quienes llegan en una semana y todavía deben. */
async function recordarSaldos(client: SupabaseClient, enUnaSemana: string): Promise<number> {
  const { data, error } = await client
    .from('estadias')
    .select(`check_in, reserva:reservas!inner(${CAMPOS})`)
    .eq('check_in', enUnaSemana)
    .in('estado', ['confirmada', 'pagada'])

  if (error) throw new Error(error.message)

  let n = 0
  for (const fila of (data ?? []) as unknown as { reserva: FilaReserva | null }[]) {
    const r = fila.reserva
    /*
      Alcanza con que exista la ficha del huésped: `encolar` decide el canal y
      devuelve el motivo si no hay por dónde. Exigir email acá dejaría afuera a
      quien cargó sólo el teléfono, que con WhatsApp enchufado sí es alcanzable.
    */
    if (!r?.huesped) continue

    const saldo = await saldoDe(client, r.id, r.total)
    // Sin saldo no hay nada que recordar. Mandar «saldo: 0» hace que alguien
    // revise si le están cobrando algo que ya pagó.
    if (saldo <= 0) continue

    const res = await avisarSaldoPendiente(client, destinoDe(r), {
      checkIn: enUnaSemana,
      saldo,
      enlace: `${urlDelSitio()}/reservar`,
    })
    if (res.ok && !res.yaEstaba) n++
  }
  return n
}

/** Aviso de check-out a quienes salen mañana, con el saldo si queda. */
async function recordarSalidas(client: SupabaseClient, manana: string): Promise<number> {
  const { data, error } = await client
    .from('estadias')
    .select(`check_out, reserva:reservas!inner(${CAMPOS})`)
    .eq('check_out', manana)
    .in('estado', ['in_house', 'pagada', 'confirmada'])

  if (error) throw new Error(error.message)

  let n = 0
  for (const fila of (data ?? []) as unknown as { reserva: FilaReserva | null }[]) {
    const r = fila.reserva
    /*
      Alcanza con que exista la ficha del huésped: `encolar` decide el canal y
      devuelve el motivo si no hay por dónde. Exigir email acá dejaría afuera a
      quien cargó sólo el teléfono, que con WhatsApp enchufado sí es alcanzable.
    */
    if (!r?.huesped) continue

    const res = await avisarCheckoutProximo(client, destinoDe(r), {
      checkOut: manana,
      saldo: await saldoDe(client, r.id, r.total),
    })
    if (res.ok && !res.yaEstaba) n++
  }
  return n
}

/**
 * Aviso de que la reserva pendiente se libera.
 *
 * ⚠️ Es el que evita la peor sorpresa del sistema: una reserva sin seña se
 * libera sola y hasta ahora eso pasaba **en silencio**. El huésped creía tener la
 * habitación y se enteraba al llegar.
 */
async function avisarLasQueVencen(client: SupabaseClient, creadaAntesDe: string): Promise<number> {
  const { data, error } = await client
    .from('reservas')
    .select(`${CAMPOS}, estadia:estadias(check_in, check_out)`)
    .eq('estado', 'pendiente')
    .lt('creado_en', `${creadaAntesDe}T23:59:59-03:00`)

  if (error) throw new Error(error.message)

  let n = 0
  for (const r of (data ?? []) as unknown as FilaReserva[]) {
    if (!r.huesped) continue
    const estadia = r.estadia?.[0]
    if (!estadia) continue

    /*
      La seña que hace falta es la primera noche, igual que en el checkout: es lo
      que `seniaSugerida` calcula y lo que la pantalla ofrece cobrar. Decirle un
      número distinto del que después le van a pedir es peor que no decirle nada.
    */
    const noches = diasEntre(estadia.check_in, estadia.check_out)

    const res = await avisarReservaPorVencer(client, destinoDe(r), {
      checkIn: estadia.check_in,
      sena: seniaSugerida(Number(r.total), noches),
      enlace: `${urlDelSitio()}/reservar`,
    })
    if (res.ok && !res.yaEstaba) n++
  }
  return n
}

/**
 * Pedido de reseña a quienes salieron hace unos días **y puntuaron bien**.
 *
 * ⚠️ Doble filtro, y los dos importan: el evento es comercial —así que `encolar`
 * lo bloquea sin `acepta_promociones`— y además exige un puntaje alto. Pedirle
 * una reseña pública a quien puntuó bajo es pedirle que publique su queja.
 */
async function pedirResenas(client: SupabaseClient, salidaHaceDias: string): Promise<number> {
  const { data, error } = await client
    .from('estadias')
    .select(`check_out, reserva:reservas!inner(${CAMPOS})`)
    .eq('check_out', salidaHaceDias)
    .eq('estado', 'checkout')

  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as { reserva: FilaReserva | null }[]
  const ids = filas.map((f) => f.reserva?.id).filter((x): x is string => Boolean(x))
  if (ids.length === 0) return 0

  // Los puntajes en UNA consulta: una por reserva serían N viajes en serie
  // dentro de un cron que tiene `maxDuration`.
  const { data: encuestas } = await client
    .from('encuestas_satisfaccion')
    .select('reserva_id, puntaje')
    .in('reserva_id', ids)

  const puntajePorReserva = new Map<string, number | null>()
  for (const e of (encuestas ?? []) as { reserva_id: string; puntaje: number | null }[]) {
    puntajePorReserva.set(e.reserva_id, e.puntaje)
  }

  let n = 0
  for (const fila of filas) {
    const r = fila.reserva
    /*
      Alcanza con que exista la ficha del huésped: `encolar` decide el canal y
      devuelve el motivo si no hay por dónde. Exigir email acá dejaría afuera a
      quien cargó sólo el teléfono, que con WhatsApp enchufado sí es alcanzable.
    */
    if (!r?.huesped) continue
    if (!mereceLaPenaPedirResena(puntajePorReserva.get(r.id))) continue

    const res = await avisarSolicitudResena(client, destinoDe(r), {
      enlace: 'https://www.google.com/search?q=Hotel+Blanca+Patagonia+El+Calafate',
    })
    if (res.ok && !res.yaEstaba) n++
  }
  return n
}
