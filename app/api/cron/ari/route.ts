import { comparacionConstante } from '@/lib/integraciones/firma-webhook'
import { registrarFalla } from '@/lib/acciones'
import { publicarAri } from '@/lib/canales/ari'

/**
 * Publicación automática de disponibilidad y tarifas: `POST /api/cron/ari`.
 *
 * ── El hueco que llena (auditoría 2026-09, P1-1) ────────────────────────────
 *
 * `publicarDisponibilidad` existía en el puerto desde la modernización WinPAX y
 * **no lo llamaba nadie**. El ADR 0021 promete que enchufar un channel manager es
 * configuración; sin este cron y sin el mapeo de la 0081, no lo era: el día que el
 * hotel contratara uno habría que escribir además el cálculo del ARI, la lectura
 * de tarifas, el rastro y el disparador.
 *
 * ── ⚠️ Que hoy no publique nada NO es una falla ─────────────────────────────
 *
 * Los dos caminos disponibles sin ser Connectivity Partner —el informe CSV del
 * extranet y el feed iCal— son de **solo lectura**. Con ésos, `publicarAri`
 * calcula las filas y el proveedor responde `noSoportado`. Este handler devuelve
 * **200** en ese caso, y es deliberado:
 *
 * · Un 500 dejaría el cron marcado como fallando para siempre, y ahí un fallo real
 *   —el día que sí haya channel manager— se perdería entre el ruido.
 * · La corrida queda igual registrada en `canal_sincronizaciones` con
 *   `sentido = 'salida'` y el motivo escrito, así que la pantalla puede decir la
 *   verdad: «se calculó, y este proveedor no puede publicar».
 *
 * Es la misma distinción que hace el cron de canales cuando el proveedor no
 * sondea, y la misma que `ResultadoEnvio.noSoportado` hace en el puerto.
 *
 * ── Autenticación ───────────────────────────────────────────────────────────
 *
 * Igual que los otros crons: secreto compartido en `authorization`, comparado en
 * tiempo constante. **Si `CRON_SECRET` falta, rechaza**; dejar pasar convertiría
 * esto en un endpoint público que le habla a un canal externo.
 */

/** Un año de ventana por tipo: sin esto puede pasar el límite por defecto. */
export const maxDuration = 60

/** Nunca se cachea: es un disparador, no una lectura. */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET

  if (!secreto) {
    registrarFalla(
      { message: 'CRON_SECRET no está configurada' },
      'publicación automática de disponibilidad (ARI)',
    )
    return Response.json(
      { error: 'La publicación automática no está configurada.' },
      { status: 503 },
    )
  }

  const cabecera = req.headers.get('authorization') ?? ''
  if (!comparacionConstante(cabecera, `Bearer ${secreto}`)) {
    // 401 sin detalle: decir «el secreto no coincide» confirma que el endpoint
    // existe y que el esquema es un Bearer.
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  let resultado
  try {
    resultado = await publicarAri('booking')
  } catch (e) {
    registrarFalla(
      { message: e instanceof Error ? e.message : String(e) },
      'publicar el ARI desde el cron',
    )
    // 500 para que el disparador lo reintente: un canal caído es transitorio.
    return Response.json({ error: 'no se pudo publicar la disponibilidad' }, { status: 500 })
  }

  /*
    200 cuando el proveedor no puede publicar. Ver el aviso del encabezado.

    El cuerpo lleva `noSoportado` para que quien mire la respuesta —o el log de la
    plataforma— distinga «no puedo» de «salió todo bien», que es justamente lo que
    un 200 pelado confundiría.
  */
  if (!resultado.ok && !resultado.noSoportado) {
    return Response.json(
      { error: resultado.detalle, resumen: resultado.resumen },
      { status: 500 },
    )
  }

  return Response.json({
    ok: resultado.ok,
    noSoportado: resultado.noSoportado,
    motivo: resultado.detalle,
    aceptadas: resultado.aceptadas,
    resumen: resultado.resumen,
  })
}
