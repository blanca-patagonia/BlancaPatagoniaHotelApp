import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { enviarPlantilla } from '@/lib/email'
import type { EventoEmail } from '@/lib/domain/plantillas'
import {
  agotoIntentos,
  claveDeNotificacion,
  cuandoEnviar,
  esperaDeReintento,
  motivoNoNotificar,
  type PreferenciasHuesped,
} from '@/lib/domain/notificaciones'

/**
 * La bandeja de salida (migración 0075).
 *
 * ── Por qué encolar y no enviar ─────────────────────────────────────────────
 *
 * Antes las cuatro plantillas se mandaban en el mismo request que originaba el
 * hecho: la confirmación salía dentro del alta de la reserva, la encuesta dentro
 * del check-out. Eso trae tres problemas que sólo se ven en producción:
 *
 *  1. **Un fallo del proveedor se pierde.** No había reintento ni rastro: el
 *     resultado del envío se descartaba en el call site.
 *  2. **Reprocesar duplica.** Un webhook reintentado mandaba el correo otra vez.
 *  3. **El envío bloquea la operación.** Una API lenta demora el alta de la
 *     reserva, que es lo que el huésped está esperando.
 *
 * Encolar los separa: la acción anota **qué hay que comunicar** y termina. El
 * envío es otro paso, reintentable y con estado.
 */

export interface PedidoDeNotificacion {
  evento: EventoEmail
  /** La entidad de la que habla el mensaje. Entra en la clave de idempotencia. */
  entidadId: string
  destinatario: string | null
  variables: Record<string, string | number>
  huespedId?: string | null
  reservaId?: string | null
  /**
   * Distingue dos mensajes del mismo evento sobre la misma entidad, cuando eso
   * es legítimo. Ver `claveDeNotificacion`.
   */
  discriminante?: string
}

export interface ResultadoEncolado {
  ok: boolean
  /** `true` si ya estaba encolada: no es un error, es la idempotencia haciendo su trabajo. */
  yaEstaba?: boolean
  motivo?: string
}

/**
 * Anota un mensaje para enviar. **No envía.**
 *
 * Nunca lanza y nunca corta la operación que la llamó: que no se pueda encolar un
 * recordatorio no justifica abortar un check-out.
 */
export async function encolar(
  client: SupabaseClient,
  p: PedidoDeNotificacion,
): Promise<ResultadoEncolado> {
  if (!p.destinatario) {
    return { ok: false, motivo: 'El huésped no tiene email cargado.' }
  }

  // Consentimiento. Se consulta acá y no al despachar: si el huésped pidió no
  // recibir avisos, el mensaje no debería ni existir en la bandeja.
  if (p.huespedId) {
    const { data } = await client
      .from('huespedes')
      .select('acepta_avisos, acepta_promociones')
      .eq('id', p.huespedId)
      .maybeSingle<PreferenciasHuesped>()

    const motivo = motivoNoNotificar(p.evento, data ?? null)
    if (motivo) return { ok: false, motivo }
  }

  const cuando = cuandoEnviar(p.evento, new Date())

  const { error } = await client.from('notificaciones').insert({
    evento: p.evento,
    canal: 'email',
    clave: claveDeNotificacion(p.evento, p.entidadId, p.discriminante),
    destinatario: p.destinatario,
    variables: p.variables,
    huesped_id: p.huespedId ?? null,
    reserva_id: p.reservaId ?? null,
    ...(cuando ? { proximo_en: cuando.toISOString() } : {}),
  })

  // 23505 = ya estaba encolada. Es exactamente lo que la clave tiene que hacer, y
  // no es un error para quien llamó.
  if (error?.code === '23505') return { ok: true, yaEstaba: true }

  if (error) {
    registrarFalla(error, `encolar ${p.evento} de ${p.entidadId}`)
    return { ok: false, motivo: 'No se pudo anotar el aviso.' }
  }

  return { ok: true }
}

interface FilaPendiente {
  id: string
  evento: string
  destinatario: string
  variables: Record<string, string | number>
  intentos: number
}

export interface ResumenDespacho {
  tomadas: number
  enviadas: number
  reintentar: number
  fallidas: number
}

/**
 * Envía lo que esté pendiente y le haya llegado el turno.
 *
 * Lo llama el cron. `limite` acota cuánto se procesa por corrida: sin él, una
 * bandeja acumulada por un corte largo del proveedor haría que la función se pase
 * del `maxDuration` y no termine **ninguna**.
 */
export async function despachar(
  client: SupabaseClient,
  limite = 25,
): Promise<ResumenDespacho> {
  const resumen: ResumenDespacho = { tomadas: 0, enviadas: 0, reintentar: 0, fallidas: 0 }

  /*
    ⚠️ El «ahora» lo pone la BASE, no la aplicación.

    Con `new Date().toISOString()` el corte depende del reloj del proceso, y la
    app y Postgres corren en máquinas distintas. Basta que la base vaya unos
    segundos adelantada para que una fila recién encolada —cuyo `proximo_en` es
    el `now()` de la base— quede por encima del corte y **no se despache**: el
    aviso se queda esperando sin que nada falle.

    No es teórico: apareció como un fallo intermitente en
    `tests/notificaciones-bandeja.test.ts` con el contenedor local unos segundos
    adelantado respecto del host.

    Postgres interpreta el literal `'now'` como el momento de la transacción, así
    que el corte y el sello quedan medidos por el mismo reloj.
  */
  const { data, error } = await client
    .from('notificaciones')
    .select('id, evento, destinatario, variables, intentos')
    .eq('estado', 'pendiente')
    .lte('proximo_en', 'now')
    .order('proximo_en', { ascending: true })
    .limit(limite)

  if (error) {
    registrarFalla(error, 'leer la bandeja de notificaciones')
    return resumen
  }

  const pendientes = (data ?? []) as FilaPendiente[]
  resumen.tomadas = pendientes.length

  for (const n of pendientes) {
    const r = await enviarPlantilla(
      n.evento as EventoEmail,
      n.destinatario,
      n.variables ?? {},
    )

    if (r.ok) {
      const { error: eOk } = await client
        .from('notificaciones')
        .update({ estado: 'enviada', enviada_en: new Date().toISOString(), error: null })
        .eq('id', n.id)
      registrarFalla(eOk, `marcar enviada la notificación ${n.id}`)
      resumen.enviadas++
      continue
    }

    /*
      Falló. Se decide entre reintentar y darla por perdida.

      La espera crece pero está acotada (ver `esperaDeReintento`): un mensaje que
      llega tarde puede ser peor que uno que no llega, y el recordatorio de
      check-in tres días después confunde más de lo que ayuda.
    */
    const intentos = n.intentos + 1
    const rendida = agotoIntentos(intentos)
    const proximo = new Date(Date.now() + esperaDeReintento(intentos) * 60_000)

    const { error: eFalla } = await client
      .from('notificaciones')
      .update({
        intentos,
        estado: rendida ? 'fallida' : 'pendiente',
        proximo_en: proximo.toISOString(),
        error: r.detalle.slice(0, 500),
      })
      .eq('id', n.id)
    registrarFalla(eFalla, `registrar el fallo de la notificación ${n.id}`)

    if (rendida) resumen.fallidas++
    else resumen.reintentar++
  }

  return resumen
}
