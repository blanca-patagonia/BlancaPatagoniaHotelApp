import { crearClienteAdmin } from '@/lib/supabase/admin'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { correrRecordatorios } from '@/lib/notificaciones/recordatorios'
import { registrarError, registrarInfo } from '@/lib/registro'

/**
 * Recordatorios automáticos: `POST /api/cron/recordatorios`.
 *
 * ── Qué encola ──────────────────────────────────────────────────────────────
 *
 * Los cinco avisos que dependen del calendario y no de una acción de nadie: el
 * recordatorio de llegada, el de saldo, el de salida, el de que la reserva
 * pendiente se libera y el pedido de reseña. La lógica está en
 * `lib/notificaciones/recordatorios.ts`; acá sólo está la autorización.
 *
 * ── Por qué es un cron aparte del de la bandeja ─────────────────────────────
 *
 * Son dos trabajos distintos: éste **decide qué hay que comunicar** una vez por
 * día, y `/api/cron/notificaciones` **manda lo que está anotado** cada cinco
 * minutos. Juntarlos obligaría a recorrer todas las reservas cada cinco minutos
 * para no encontrar nada, o a mandar los correos una vez por día — y entonces una
 * confirmación de reserva podría tardar veinticuatro horas.
 *
 * ── Por qué a las 9 de la mañana ────────────────────────────────────────────
 *
 * Porque el horario permitido para escribirle a un huésped empieza a las 9 (ver
 * `cuandoEnviar`). Correrlo de madrugada anotaría todo con `proximo_en` a las 9
 * igual; correrlo a las 9 hace que el aviso salga en la primera corrida de la
 * bandeja, sin una espera que después habría que explicar.
 *
 * `0 12 * * *` en UTC son las 9 de El Calafate (UTC−3, sin horario de verano).
 *
 * ⚠️ **Si `CRON_SECRET` no está configurada, el handler RECHAZA.** No «si falta,
 * dejá pasar»: eso convertiría esto en un endpoint público que le escribe a los
 * huéspedes del hotel.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return Response.json(
      { error: 'los recordatorios automáticos no están configurados' },
      { status: 503 },
    )
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    // 401 sin detalle: decir «el secreto no coincide» confirma que el endpoint
    // existe y que el esquema es un Bearer.
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  let resumen
  try {
    resumen = await correrRecordatorios(crearClienteAdmin())
  } catch (e) {
    await registrarError('recordatorios_fallo', {
      detalle: e instanceof Error ? e.message : String(e),
    })
    // 500 para que el disparador reintente: no se encoló nada de más, y la
    // bandeja descarta lo repetido por la clave de idempotencia.
    return Response.json({ error: 'no se pudieron generar los recordatorios' }, { status: 500 })
  }

  const encolados =
    resumen.llegadas + resumen.saldos + resumen.salidas + resumen.porVencer + resumen.resenas

  // Sólo se anota cuando hubo algo: un día sin llegadas ni salidas es normal en
  // temporada baja y no vale una línea por día.
  if (encolados > 0 || resumen.fallidas.length > 0) {
    await registrarInfo('recordatorios_diarios', { ...resumen, encolados })
  }

  /*
    500 si falló alguna tarea, para que Vercel lo marque.

    Lo que ya se encoló no se pierde ni se duplica en el reintento: la clave de
    idempotencia de la bandeja incluye la fecha, así que la segunda corrida
    encuentra las filas que ya están.
  */
  const estado = resumen.fallidas.length > 0 ? 500 : 200
  return Response.json(
    { ok: resumen.fallidas.length === 0, ...resumen, encolados },
    { status: estado },
  )
}

/** Vercel Cron dispara con GET. Mismo camino, misma autenticación. */
export async function GET(req: Request) {
  return POST(req)
}
