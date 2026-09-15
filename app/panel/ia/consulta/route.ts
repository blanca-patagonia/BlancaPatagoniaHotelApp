import { obtenerSesion } from '@/lib/auth/session'
import { puedeAcceder } from '@/lib/domain/permisos'
import { promptSistemaIA } from '@/lib/domain/ia-herramientas'
import { iaActiva, obtenerProveedorIa, type MensajeIa } from '@/lib/ia/proveedor'
import { registrarError } from '@/lib/registro'
import { ejecutarHerramienta } from '../herramientas'

/**
 * Único camino del chat del asistente: recibe la conversación, arma el turno
 * con el system prompt y ejecuta el ida y vuelta de herramientas hasta que el
 * modelo contesta con texto en vez de pedir otra llamada.
 *
 * Co-ubicado con `app/panel/ia/page.tsx` en vez de bajo `app/api/`, mismo
 * criterio que `app/panel/exportar/[recurso]/route.ts`: es una acción del
 * panel, no una API pública, y la sesión se resuelve igual que cualquier
 * página del panel.
 */

/** Tope de mensajes que se aceptan del cliente, para no dejar crecer el pedido sin límite. */
const MAX_MENSAJES = 30
/** Tope de caracteres por mensaje. */
const MAX_CARACTERES = 4000
/**
 * Tope de vueltas de herramienta por consulta.
 *
 * Cada vuelta es una llamada al proveedor de IA, que casi siempre es un
 * servicio de pago o con cupo gratis limitado. Sin este tope, un modelo que
 * insiste en pedir la misma herramienta agotaría el cupo del hotel en una
 * sola pregunta de una persona.
 */
const MAX_VUELTAS_HERRAMIENTA = 4

interface MensajeEntrante {
  rol: 'user' | 'assistant'
  contenido: string
}

function validarMensajes(valor: unknown): MensajeEntrante[] | null {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAX_MENSAJES) return null
  const mensajes: MensajeEntrante[] = []
  for (const m of valor) {
    if (
      !m ||
      typeof m !== 'object' ||
      (m as { rol?: unknown }).rol !== 'user' && (m as { rol?: unknown }).rol !== 'assistant' ||
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

  const conversacion: MensajeIa[] = [
    { rol: 'system', contenido: promptSistemaIA() },
    ...entrada.map((m) => ({ rol: m.rol, contenido: m.contenido })),
  ]

  try {
    const proveedor = obtenerProveedorIa()

    for (let vuelta = 0; vuelta <= MAX_VUELTAS_HERRAMIENTA; vuelta++) {
      const respuesta = await proveedor.chat(conversacion)

      if (respuesta.llamadas.length === 0) {
        return Response.json({
          respuesta: respuesta.contenido?.trim() || 'No obtuve una respuesta de texto para esto.',
        })
      }

      if (vuelta === MAX_VUELTAS_HERRAMIENTA) break

      conversacion.push({ rol: 'assistant', contenido: respuesta.contenido ?? '', llamadas: respuesta.llamadas })

      for (const llamada of respuesta.llamadas) {
        const resultado = await ejecutarHerramienta(llamada.nombre, llamada.argumentos)
        conversacion.push({
          rol: 'tool',
          contenido: JSON.stringify(resultado),
          idLlamada: llamada.id,
          nombreHerramienta: llamada.nombre,
        })
      }
    }

    return Response.json({
      error: 'El asistente necesitó demasiados pasos para esta consulta. Probá con una pregunta más puntual.',
    })
  } catch (e) {
    await registrarError(
      'ia_consulta',
      { detalle: e instanceof Error ? e.message : String(e) },
      { usuarioId: sesion.userId, rol: sesion.rol },
    )
    return Response.json(
      { error: 'No se pudo consultar al asistente en este momento. Probá de nuevo en un rato.' },
      { status: 502 },
    )
  }
}
