import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { enviarPlantilla } from '@/lib/email'
import { renderizar, type EventoEmail } from '@/lib/domain/plantillas'
import {
  agotoIntentos,
  claveDeNotificacion,
  cuandoEnviar,
  esperaDeReintento,
  motivoNoNotificar,
  rolDelAviso,
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
  /**
   * A quién. En los eventos del huésped es su correo, y sin él no hay nada que
   * hacer. En los **internos** se omite: lo pone `rolDelAviso`, porque ahí el
   * destinatario es un puesto del hotel y no una dirección.
   */
  destinatario?: string | null
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
  /*
    El destinatario de un aviso interno lo pone el sistema, no el call site.

    Dejarlo en manos de quien encola significaría que el rol de cada aviso queda
    escrito en veinte lugares distintos, y que cambiar «los errores de canal los
    ve gerencia» obliga a encontrarlos todos. Acá hay uno solo: `ROL_DEL_AVISO`.
  */
  const rol = rolDelAviso(p.evento)
  const destinatario = rol ?? p.destinatario

  if (!destinatario) {
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
    canal: rol ? 'interno' : 'email',
    clave: claveDeNotificacion(p.evento, p.entidadId, p.discriminante),
    destinatario,
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
  canal: string
  destinatario: string
  variables: Record<string, string | number>
  intentos: number
}

export interface ResumenDespacho {
  tomadas: number
  enviadas: number
  reintentar: number
  fallidas: number
  /** Cuántas aterrizaron en la cartelera interna en vez de salir por correo. */
  internas: number
}

/** Lo que devuelve un intento de entrega, sea por correo o a la cartelera. */
interface Entrega {
  ok: boolean
  detalle: string
}

/**
 * Publica un aviso interno en la cartelera que el staff ya mira (`avisos`).
 *
 * ── Por qué la cartelera y no un correo a una casilla del hotel ─────────────
 *
 * Porque una casilla obliga a decidir y mantener quién recibe qué —y a
 * acordarse de cambiarlo cuando esa persona se va—, mientras que la cartelera
 * existe desde la 0016, la abre todo el staff y ya tiene su lugar en el panel.
 *
 * ⚠️ El aviso nace **sin autor** (`autor_id` null): no lo escribió nadie. Poner
 * ahí al usuario que disparó la acción sería atribuirle un texto que no
 * escribió, y encima haría que «borra el autor» de la 0016 le diera permiso de
 * borrar avisos del sistema.
 */
async function publicarEnCartelera(
  client: SupabaseClient,
  n: FilaPendiente,
): Promise<Entrega> {
  const { asunto, cuerpo } = renderizar(n.evento as EventoEmail, n.variables ?? {})

  /*
    El asunto es el titular y el cuerpo el detalle. Van juntos en `mensaje`
    porque `avisos` guarda un texto solo, y agregarle una columna `titulo`
    obligaría a tocar la pantalla que ya existe para ganar muy poco: las
    plantillas internas son de una línea a propósito.
  */
  const mensaje = cuerpo.trim() && cuerpo.trim() !== asunto ? `${asunto}\n${cuerpo.trim()}` : asunto

  const { error } = await client.from('avisos').insert({
    mensaje,
    autor_id: null,
    automatico: true,
    evento: n.evento,
    rol: n.destinatario,
  })

  if (error) return { ok: false, detalle: `${error.code ?? ''} ${error.message}`.trim() }
  return { ok: true, detalle: 'publicado en la cartelera' }
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
  const resumen: ResumenDespacho = {
    tomadas: 0,
    enviadas: 0,
    reintentar: 0,
    fallidas: 0,
    internas: 0,
  }

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
    .select('id, evento, canal, destinatario, variables, intentos')
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
    const interno = n.canal === 'interno'

    const r: Entrega = interno
      ? await publicarEnCartelera(client, n)
      : await enviarPlantilla(n.evento as EventoEmail, n.destinatario, n.variables ?? {})

    if (r.ok) {
      const ahora = new Date().toISOString()

      /*
        ⚠️ Un aviso interno nace **entregado**, y el del huésped no.

        La cartelera es el destino: si la fila se insertó, el aviso está donde
        tiene que estar y no hay ningún tercero que pueda rebotarlo. Con el
        correo es al revés —el proveedor acepta el mensaje mucho antes de saber
        si el servidor del destinatario lo aceptó—, y entre `enviada` y
        `entregada` está justamente el rebote, que es el caso que el hotel
        necesita ver. Marcarlo entregado de una sería mentir sobre eso.

        `leida` no se toca en ninguno de los dos: eso lo informa quien lee.
      */
      const { error: eOk } = await client
        .from('notificaciones')
        .update({
          estado: interno ? 'entregada' : 'enviada',
          enviada_en: ahora,
          ...(interno ? { entregada_en: ahora } : {}),
          error: null,
        })
        .eq('id', n.id)
      registrarFalla(eOk, `marcar enviada la notificación ${n.id}`)

      resumen.enviadas++
      if (interno) resumen.internas++
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
