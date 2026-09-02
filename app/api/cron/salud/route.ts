import { crearClienteAdmin } from '@/lib/supabase/admin'
import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { registrarError, registrarInfo } from '@/lib/registro'

/**
 * Chequeo de salud programado: `POST /api/cron/salud`.
 *
 * ── Qué agrega, teniendo ya `/api/salud` ────────────────────────────────────
 *
 * `/api/salud` responde cuando alguien pregunta. El problema que marcó la
 * auditoría es que **nadie preguntaba** en un schedule: una caída de la base a
 * las 3 de la mañana se descubría cuando el primer huésped no podía reservar.
 *
 * Esto lo llama Vercel Cron. Si la base no responde, **escribe una fila en
 * `errores`** (migración 0068), que tiene pantalla en `/panel/errores`: la falla
 * de la madrugada queda a la vista a la mañana siguiente, con hora. No manda una
 * alerta por cada chequeo —sería ruido—: deja el rastro donde se mira.
 *
 * ── Autenticación ───────────────────────────────────────────────────────────
 *
 * El mismo secreto compartido que `/api/cron/canales`. Si `CRON_SECRET` no está,
 * el handler rechaza: un cron que no se puede autenticar no debe correr.
 */

export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 3000

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return Response.json({ error: 'el chequeo programado no está configurado' }, { status: 503 })
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  const inicio = Date.now()
  let baseOk = false
  let detalle = ''

  try {
    const consulta = crearClienteAdmin().from('tipos_unidad').select('id').limit(1)
    const resultado = await Promise.race([
      consulta,
      new Promise<never>((_, r) => setTimeout(() => r(new Error(`sin respuesta en ${TIMEOUT_MS} ms`)), TIMEOUT_MS)),
    ])
    if (resultado.error) detalle = resultado.error.message
    else baseOk = true
  } catch (e) {
    detalle = e instanceof Error ? e.message : String(e)
  }

  const ms = Date.now() - inicio

  if (!baseOk) {
    // Va a `errores` para que aparezca en `/panel/errores`. El sink de
    // `lib/registro.ts` lo persiste con `service_role`.
    await registrarError('salud_base_sin_respuesta', {
      detalle: detalle || 'la base no respondió al chequeo programado',
      ms,
    })
    return Response.json({ estado: 'degradado', ms }, { status: 503 })
  }

  // Una línea de info a stdout, sin fila en `errores`: que el cron corrió y todo
  // estaba bien no es un evento que valga guardar.
  await registrarInfo('salud_ok', { ms })
  return Response.json({ estado: 'ok', ms })
}
