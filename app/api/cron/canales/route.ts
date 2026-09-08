import { crearClienteAdmin } from '@/lib/supabase/admin'
import { obtenerProveedorCanal } from '@/lib/canales'
import { guardarEntrantes } from '@/lib/canales/servicio'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { registrarFalla } from '@/lib/acciones'
import { avisarCanalPorRevisar, avisarErrorSincronizacion } from '@/lib/notificaciones/eventos'
import { hoyISO, sumarDias } from '@/lib/fechas'

/**
 * Sincronización automática de canales: `POST /api/cron/canales`.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Hasta acá **nadie sincronizaba si nadie apretaba el botón**. El feed iCal de Booking
 * se leía solo cuando alguien entraba a la pantalla de canales y hacía clic, así que
 * una reserva que entró el viernes a la noche podía descubrirse el lunes — o el día del
 * check-in, con el huésped en la puerta.
 *
 * ── ⚠️ El cron ATERRIZA, no importa ─────────────────────────────────────────
 *
 * Trae lo que el canal tenga y lo deja en `canal_reservas` para que alguien lo revise.
 * **No crea reservas.**
 *
 * Es deliberado y es la decisión más importante de este archivo. Importar es crear una
 * reserva `confirmada` que ocupa inventario, y hacerlo sin que nadie mire contradice
 * la razón por la que existe la zona de recepción (ADR 0021): que el choque con el
 * anti-overbooking sea **visible** en vez de perderse en un log. Un cron que importa
 * solo convertiría ese caso —el más caro que le puede pasar al hotel— en una fila de
 * error que nadie lee.
 *
 * Lo que sí gana el hotel es tiempo: el conflicto de cupo se detecta al aterrizar
 * (migración 0052), así que el KPI de posible overbooking se enciende sin que nadie
 * haya entrado al sistema.
 *
 * ── Autenticación ───────────────────────────────────────────────────────────
 *
 * Un secreto compartido en la cabecera `authorization`, comparado en tiempo constante.
 * Es lo que Vercel Cron sabe mandar y alcanza para esto: el endpoint no recibe datos
 * del llamador, solo dispara un trabajo.
 *
 * ⚠️ **Si `CRON_SECRET` no está configurada, el handler RECHAZA.** No «si falta, dejá
 * pasar»: eso convertiría esto en un endpoint público que escribe en la base, y el
 * fallo sería silencioso justo en producción, que es donde importa. Es el mismo
 * criterio del ADR 0018 con los proveedores simulados.
 *
 * ⚠️ **La cabecera `x-vercel-cron` NO es autenticación.** Vercel la agrega a sus
 * llamadas, pero cualquiera puede escribirla en un `curl`. Sirve para saber quién dice
 * ser el llamador, no para creerle.
 */

/** Sin esto el trabajo puede tardar más que el límite por defecto. */
export const maxDuration = 60

/** Nunca se cachea: es un disparador, no una lectura. */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET

  if (!secreto) {
    // Se registra para que aparezca en el log del servidor: un cron que rechaza todo
    // en silencio se ve igual que un cron que nunca se configuró.
    registrarFalla(
      { message: 'CRON_SECRET no está configurada' },
      'sincronización automática de canales',
    )
    return Response.json(
      { error: 'La sincronización automática no está configurada.' },
      { status: 503 },
    )
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    // 401 sin detalle: decir «el secreto no coincide» le confirma a quien prueba que
    // el endpoint existe y que el esquema es un Bearer.
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  const proveedor = obtenerProveedorCanal()

  if (!proveedor.capacidades().traeReservas) {
    // Con el proveedor simulado, o con uno que solo acepta subidas de archivo, no hay
    // nada que sondear. No es un error: es la configuración vigente, y responder 200
    // evita que el cron quede marcado como fallando para siempre.
    return Response.json({ ok: true, motivo: 'el proveedor configurado no sondea', leidas: 0 })
  }

  let entrantes
  try {
    entrantes = await proveedor.traerReservas(new Date().toISOString())
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    registrarFalla({ message: detalle }, 'sondear el canal desde el cron')

    /*
      Y alguien del hotel se entera, no sólo el log.

      Es el peor silencio del módulo: si el feed deja de responder, las reservas
      de Booking no llegan y **el síntoma es que no pasa nada**. Un 500 lo ve el
      disparador; la cartelera la ve gerencia.

      Se encola con el cliente administrativo —el cron no tiene sesión— y no corta
      la respuesta: el 500 sigue siendo el que corresponde para que se reintente.
    */
    await avisarErrorSincronizacion(crearClienteAdmin(), {
      canal: 'Booking',
      detalle: `No se pudo consultar el canal: ${detalle}`,
      dia: hoyISO(),
    })

    // 500 para que el disparador lo reintente: un feed caído es transitorio.
    return Response.json({ error: 'no se pudo consultar el canal' }, { status: 500 })
  }

  /*
    `service_role`: el cron corre sin sesión de usuario, así que no hay `rol_actual()`
    que satisfaga las políticas RLS de `canal_reservas`.

    `perfilId` queda sin definir, que ya está soportado: `corrida_por` admite nulo. La
    corrida se distingue por `origen: 'cron'`, y eso es lo que permite que la pantalla
    diga «se sincronizó sola hace 40 minutos» — la diferencia entre confiar en el
    sistema y no confiar.
  */
  const supabase = crearClienteAdmin()
  const resumen = await guardarEntrantes(supabase, entrantes, {
    canal: 'booking',
    proveedor: proveedor.nombre,
    origen: 'cron',
    /*
      El feed iCal publica TODO lo vigente, así que este lote es una foto completa
      y lo que no vino se puede presumir cancelado (migración 0074). El informe CSV
      no manda esto: es una exportación filtrada por fechas y su ausencia no
      significa nada.

      El corte es **mañana** y no hoy a propósito: una reserva que sale hoy puede
      caerse del feed legítimamente al completarse, y marcarla todos los días como
      presunta cancelación entrenaría a ignorar el aviso. Lo que interesa es la
      reserva futura que desapareció.

      `hoyISO()` y no `toISOString()`: el hotel está en UTC−3 y el cron corre en
      UTC, así que entre las 21:00 y la medianoche el segundo devuelve mañana.
    */
    instantanea: { desde: sumarDias(hoyISO(), 1) },
  })

  /*
    Los dos avisos que cierran el silencio de la corrida automática.

    ⚠️ `rechazadas > 0` se devolvía en este mismo body y **no lo leía nadie**: el
    cron responde a Vercel, no a una persona. Una fila rechazada es una reserva de
    Booking que no entró, así que el hotel puede estar vendiendo una unidad que ya
    vendió el canal.

    Y `nuevas > 0` es el corolario de que el cron aterriza pero no importa: hasta
    que alguien entre a la pantalla, esas fechas no ocupan inventario.
  */
  if (resumen.rechazadas > 0) {
    await avisarErrorSincronizacion(supabase, {
      canal: 'Booking',
      detalle: `${resumen.rechazadas} de ${resumen.leidas} reserva(s) no se pudieron guardar. ${resumen.motivos.join(' ')}`.trim(),
      dia: hoyISO(),
    })
  }

  if (resumen.nuevas > 0) {
    await avisarCanalPorRevisar(supabase, {
      canal: 'Booking',
      cantidad: resumen.nuevas,
      dia: hoyISO(),
    })
  }

  return Response.json({
    ok: true,
    leidas: resumen.leidas,
    nuevas: resumen.nuevas,
    actualizadas: resumen.actualizadas,
    rechazadas: resumen.rechazadas,
  })
}

/**
 * Vercel Cron dispara con GET.
 *
 * Se acepta por eso, aunque el método correcto para algo que escribe sea POST: pelearse
 * con el disparador no aporta nada, y la autorización es la misma. Lo que **no** se hace
 * es dejarlo sin secreto por ser un GET.
 */
export async function GET(req: Request) {
  return POST(req)
}
