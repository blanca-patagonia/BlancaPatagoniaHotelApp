import 'server-only'
import type { ClienteServicio } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarFalla } from '@/lib/acciones'
import { enviarPlantilla } from '@/lib/email'
import { EVENTOS_EMAIL, type EventoEmail } from '@/lib/domain/plantillas'
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
  /**
   * A quién: el correo del huésped. Sin él no hay nada que hacer.
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
  /**
   * Con `service_role` (`crearClienteAdmin()`): `notificaciones` no acepta
   * escrituras del cliente del usuario (0075). El tipo lo exige.
   */
  client: ClienteServicio,
  p: PedidoDeNotificacion,
): Promise<ResultadoEncolado> {
  const destinatario = p.destinatario

  if (!destinatario) {
    return { ok: false, motivo: 'El huésped no tiene email cargado.' }
  }

  // Consentimiento. Se consulta acá y no al despachar: si el huésped pidió no
  // recibir avisos, el mensaje no debería ni existir en la bandeja.
  if (p.huespedId) {
    const { data, error } = await client
      .from('huespedes')
      .select('acepta_avisos')
      .eq('id', p.huespedId)
      .maybeSingle<PreferenciasHuesped>()
    /*
      Falla CERRADO. Una lectura fallida devuelve `data: null`, y `null` es «sin
      ficha de preferencias: no se bloquea nada». Así, un error de la base hacía
      salir una promoción a quien había pedido no recibirlas. No mandar un aviso
      tiene arreglo (se reintenta); escribirle a quien no quiere, no.
    */
    if (error) {
      registrarFalla(error, 'notificaciones:consentimiento')
      return { ok: false, motivo: 'No se pudo verificar el consentimiento del huésped.' }
    }

    const motivo = motivoNoNotificar(data ?? null)
    if (motivo) return { ok: false, motivo }
  }

  const cuando = cuandoEnviar(p.evento, new Date())

  const { error } = await client.from('notificaciones').insert({
    evento: p.evento,
    canal: 'email',
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
}

/** Lo que devuelve un intento de entrega por correo. */
interface Entrega {
  ok: boolean
  detalle: string
  /** Id del envío en el proveedor, cuando lo hay. Ver `ResultadoEnvio`. */
  proveedorId?: string
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
  /**
   * Tiempo máximo para TOMAR envíos nuevos, en milisegundos. Sin tope, 25
   * envíos de hasta 10 s cada uno (el corte del proveedor) superaban el
   * `maxDuration` de 60 s del cron: la función moría a mitad de camino, lo ya
   * enviado quedaba sin marcar y se volvía a mandar 5 minutos después. Con el
   * tope, lo que no entra queda pendiente para la próxima corrida.
   */
  presupuestoMs = Number.POSITIVE_INFINITY,
): Promise<ResumenDespacho> {
  const inicio = Date.now()
  const resumen: ResumenDespacho = {
    tomadas: 0,
    enviadas: 0,
    reintentar: 0,
    fallidas: 0,
  }

  /*
    ⚠️ El «ahora» lo pone la BASE, no la aplicación.

    Con `new Date().toISOString()` el corte depende del reloj del proceso, y la
    app y Postgres corren en máquinas distintas. Basta que la base vaya unos
    segundos adelantada para que una fila recién encolada —cuyo `proximo_en` es
    el `now()` de la base— quede por encima del corte y **no se despache**: el
    aviso se queda esperando sin que nada falle.

    No es teórico: apareció como un fallo intermitente en
    `tests/base-de-datos/notificaciones-bandeja.test.ts` con el contenedor local unos segundos
    adelantado respecto del host.

    Postgres interpreta el literal `'now'` como el momento de la transacción, así
    que el corte y el sello quedan medidos por el mismo reloj.
  */
  const { data, error } = await client
    .from('notificaciones')
    .select('id, evento, canal, destinatario, variables, intentos')
    .eq('estado', 'pendiente')
    /*
      Sólo lo que esta versión sabe mandar: correo, de los eventos del catálogo.
      La base conserva filas de módulos quitados (avisos internos, WhatsApp,
      «por vencer»…). Sin este filtro una de ésas —sin plantilla o con un
      destinatario que no es un correo— lanzaba al renderizar, el cron daba 500
      y, al seguir primera en la cola, los avisos de atrás nunca salían.
    */
    .eq('canal', 'email')
    .in('evento', [...EVENTOS_EMAIL])
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
    if (Date.now() - inicio > presupuestoMs) break
    const r: Entrega = await enviarPlantilla(n.evento as EventoEmail, n.destinatario, n.variables ?? {})

    if (r.ok) {
      const ahora = new Date().toISOString()

      /*
        `enviada` y no `entregada`: el proveedor acepta el mensaje mucho antes de
        saber si el servidor del destinatario lo aceptó.
      */
      const { error: eOk } = await client
        .from('notificaciones')
        .update({
          estado: 'enviada',
          enviada_en: ahora,
          // El id del proveedor, cuando lo hay. Sólo se escribe si vino: pisarlo con
          // `null` en un reintento del proveedor de consola borraría el id del
          // envío real anterior.
          ...(r.proveedorId ? { proveedor_id: r.proveedorId } : {}),
          error: null,
        })
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
