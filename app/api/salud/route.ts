import { crearClienteServidor } from '@/lib/supabase/server'

/**
 * Chequeo de salud: `GET /api/salud`.
 *
 * Para qué sirve. Sin esto, la única forma de saber si el sistema está en pie es
 * que alguien intente reservar y falle. Un chequeo permite que la plataforma de
 * despliegue, un monitor externo o el propio equipo detecten una caída **antes**
 * que el huésped.
 *
 * Qué verifica y qué no. Confirma que el proceso responde y que la base contesta.
 * NO confirma que las integraciones externas estén operativas: eso exigiría
 * llamarlas en cada chequeo, y un monitor que golpea a AFIP cada treinta
 * segundos es un problema, no una solución. Para eso está el aviso de
 * `lib/integraciones/seleccion.ts`, que se dispara al arrancar.
 *
 * ⚠️ La respuesta es deliberadamente pobre en detalle: este endpoint es público
 * y no requiere sesión. Decir *qué* falla y con qué mensaje sería un mapa del
 * sistema para cualquiera que lo consulte. El detalle va al log del servidor.
 */

/** Un chequeo colgado es peor que uno que falla: el monitor no sabe qué pasa. */
const TIMEOUT_MS = 3000

export const dynamic = 'force-dynamic'

export async function GET() {
  const inicio = Date.now()

  let baseOk = false
  try {
    const supabase = await crearClienteServidor()

    // Se consulta el catálogo público, que es la tabla más liviana con lectura
    // permitida a `anon`: el chequeo no debería depender de tener una sesión.
    const consulta = supabase.from('tipos_unidad').select('id').limit(1)

    const resultado = await Promise.race([
      consulta,
      new Promise<never>((_, rechazar) =>
        setTimeout(() => rechazar(new Error('timeout')), TIMEOUT_MS),
      ),
    ])

    if (resultado.error) {
      console.error('[salud] la base respondió con error:', resultado.error.message)
    } else {
      baseOk = true
    }
  } catch (e) {
    console.error('[salud] no se pudo consultar la base:', e instanceof Error ? e.message : e)
  }

  const cuerpo = {
    estado: baseOk ? 'ok' : 'degradado',
    base: baseOk ? 'ok' : 'sin respuesta',
    ms: Date.now() - inicio,
  }

  // 503 y no 500: «no disponible por ahora» es lo que un balanceador entiende
  // como «sacame de rotación», que es exactamente lo que corresponde.
  return Response.json(cuerpo, {
    status: baseOk ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
