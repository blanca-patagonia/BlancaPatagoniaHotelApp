import { obtenerSesion } from '@/lib/auth/session'
import { puedeAcceder } from '@/lib/domain/permisos'
import { permitirIntentoDe } from '@/lib/limites'
import { iaActiva } from '@/lib/ia/proveedor'
import { conversar, type MensajeEntrante } from '../motor'

/** Tope de mensajes que se aceptan del cliente, para no dejar crecer el pedido sin límite. */
const MAX_MENSAJES = 20
/** Tope de caracteres por mensaje. */
const MAX_CARACTERES = 4000

/**
 * El chat del asistente: sesión, permiso, cupo y validación del pedido. La
 * conversación en sí (prompt, herramientas, propuestas) la lleva el motor
 * (`../motor.ts`), que comparte con las consultas rápidas del tablero.
 *
 * Co-ubicado con `app/panel/ia/page.tsx` en vez de bajo `app/api/`, mismo
 * criterio que `app/panel/exportar/[recurso]/route.ts`: es una acción del
 * panel, no una API pública, y la sesión se resuelve igual que cualquier
 * página del panel.
 */

export const maxDuration = 120

function validarMensajes(valor: unknown): MensajeEntrante[] | null {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAX_MENSAJES) return null
  const mensajes: MensajeEntrante[] = []
  for (const m of valor) {
    if (
      !m ||
      typeof m !== 'object' ||
      ((m as { rol?: unknown }).rol !== 'user' && (m as { rol?: unknown }).rol !== 'assistant') ||
      typeof (m as { contenido?: unknown }).contenido !== 'string'
    ) {
      return null
    }
    const contenido = (m as { contenido: string }).contenido.trim().slice(0, MAX_CARACTERES)
    if (!contenido) return null
    mensajes.push({ rol: (m as { rol: 'user' | 'assistant' }).rol, contenido })
  }
  return mensajes
}

export async function POST(peticion: Request) {
  const sesion = await obtenerSesion()
  if (!sesion) return Response.json({ error: 'Sesión requerida.' }, { status: 401 })
  if (!puedeAcceder(sesion.rol, 'ia')) {
    return Response.json({ error: 'Sin permiso sobre esta sección.' }, { status: 403 })
  }
  if (!iaActiva()) {
    return Response.json(
      { error: 'El asistente de IA no está configurado todavía.' },
      { status: 503 },
    )
  }

  const cuerpo = await peticion.json().catch(() => null)
  const entrada = validarMensajes(cuerpo?.mensajes)
  if (!entrada) {
    return Response.json({ error: 'La conversación no tiene un formato válido.' }, { status: 400 })
  }

  /*
    Tope de consultas por persona (después de validar: un pedido mal formado no
    gasta el cupo de nadie). Cada una son hasta cinco llamadas al
    proveedor, que tiene cupo (gratis) o costo (pago): sin tope, una pestaña
    olvidada reintentando o alguien probando de más deja sin asistente al resto
    del hotel. Va por usuario y no por IP: todo el hotel sale por la misma.
  */
  if (!(await permitirIntentoDe('ia_consulta', sesion.userId))) {
    return Response.json(
      {
        error:
          'Hiciste muchas consultas seguidas al asistente. Esperá unos minutos y probá de nuevo.',
      },
      { status: 429 },
    )
  }

  const r = await conversar({ sesion, entrada, pantalla: cuerpo?.pantalla })
  return Response.json(
    r.error
      ? { error: r.error, propuestas: r.propuestas }
      : { respuesta: r.respuesta, propuestas: r.propuestas },
    { status: r.estado },
  )
}
