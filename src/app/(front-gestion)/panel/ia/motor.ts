import 'server-only'
import { herramientasPara, herramientasRelevantes } from '@/lib/domain/ia-herramientas'
import { pantallaDeRuta, promptSistemaIA } from '@/lib/domain/ia-prompt'
import { enmascararDatosPersonales } from '@/lib/domain/ia-datos'
import { ETIQUETAS_ROL, type Rol } from '@/lib/domain/roles'
import { hoyISO } from '@/lib/fechas'
import { IaNoDisponible, obtenerProveedorIa, type MensajeIa } from '@/lib/ia/proveedor'
import { registrarError, registrarInfo } from '@/lib/registro'
import { ejecutarHerramienta, propuestaDe } from './herramientas'
import type { Propuesta } from '@/lib/domain/ia-acciones'

/**
 * El motor del asistente: arma el turno con el prompt del sistema y ejecuta el
 * ida y vuelta de herramientas hasta que el modelo contesta con texto.
 *
 * Lo usan el chat (`consulta/route.ts`) y las consultas rápidas del tablero
 * (resumen del día, qué necesita atención). Quien lo llama ya verificó la
 * sesión, el permiso y el cupo: acá sólo se conversa.
 */

/** Cuántas acciones puede preparar una sola respuesta: más que esto no se revisa con atención. */
const MAX_PROPUESTAS = 3

/**
 * Tope de vueltas de herramienta por consulta.
 *
 * Cada vuelta es una llamada al proveedor de IA, que casi siempre es un
 * servicio de pago o con cupo gratis limitado. Sin este tope, un modelo que
 * insiste en pedir la misma herramienta agotaría el cupo del hotel en una
 * sola pregunta de una persona.
 */
const MAX_VUELTAS_HERRAMIENTA = 4

/**
 * Tope de herramientas que se ejecutan por vuelta y por consulta.
 *
 * Un modelo puede pedir decenas en paralelo («compará cada mes de los últimos
 * cinco años»): cada `facturacion_mes` lee tablas enteras, y todo vuelve como
 * texto al proveedor. Sin tope, una sola pregunta haría cientos de barridos de
 * la base de producción del hotel. Las que pasan el tope reciben un error que
 * le pide al modelo acotar la consulta.
 */
const MAX_LLAMADAS_POR_VUELTA = 6
const MAX_LLAMADAS_POR_CONSULTA = 12

/**
 * Tiempo máximo de una consulta. Cada vuelta puede tardar hasta 30 s por
 * llamada (más reintento y modelo de respaldo); sin un corte propio, la
 * plataforma cortaría la función con un error genérico y en inglés. Pasado
 * este tiempo no se empieza otra vuelta: se responde con lo que hay.
 */
const PRESUPUESTO_MS = 50_000

/** Vercel: margen sobre `PRESUPUESTO_MS` para terminar la vuelta en curso. */
export interface MensajeEntrante {
  rol: 'user' | 'assistant'
  contenido: string
}

export interface ResultadoConversacion {
  respuesta?: string
  error?: string
  propuestas: Propuesta[]
  /** Código HTTP sugerido para la ruta del chat. */
  estado: number
}

export async function conversar(p: {
  sesion: { userId: string; rol: Rol }
  entrada: MensajeEntrante[]
  pantalla?: unknown
  /** Instrucciones adicionales para este pedido (formato de un resumen, por ejemplo). */
  extraSistema?: string
  /**
   * Sin herramientas `proponer_*`: para consultas automáticas que sólo leen
   * (un resumen no tiene por qué dejar tarjetas de acciones).
   */
  soloLectura?: boolean
}): Promise<ResultadoConversacion> {
  const { sesion, entrada } = p
  const conversacion: MensajeIa[] = [
    // La pantalla llega del navegador y se traduce a una etiqueta conocida
    // (`pantallaDeRuta`): nunca viaja al modelo texto libre del cliente.
    {
      rol: 'system',
      contenido:
        promptSistemaIA(pantallaDeRuta(p.pantalla), ETIQUETAS_ROL[sesion.rol], hoyISO()) +
        (p.extraSistema ? `\n\n${p.extraSistema}` : ''),
    },
    // El texto libre sale a un tercero: los emails, documentos y teléfonos que
    // alguien escriba se tapan antes (`enmascararDatosPersonales`, ADR 0039).
    ...entrada.map((m) => ({ rol: m.rol, contenido: enmascararDatosPersonales(m.contenido) })),
  ]

  // Acciones preparadas en esta respuesta (ADR 0041). Vuelven a la pantalla
  // como tarjetas para confirmar; nada se escribió todavía.
  const propuestas: Propuesta[] = []

  /*
    Al modelo se le mandan sólo las herramientas que tienen que ver con la
    conversación (`herramientasRelevantes`, sobre los últimos mensajes): las 27
    juntas pesan unos 3.700 tokens por llamada y agotaban el cupo por minuto del
    plan gratuito. Permitidas, en cambio, son todas las del rol: si el modelo
    pide una que no se le mandó pero el rol puede usar, se ejecuta igual.
  */
  const contexto = entrada
    .slice(-3)
    .map((m) => m.contenido)
    .join('\n')
  const soloLectura = (h: { nombre: string }) => !p.soloLectura || !h.nombre.startsWith('proponer_')
  const herramientas = herramientasRelevantes(sesion.rol, contexto).filter(soloLectura)
  const permitidas = new Set(
    herramientasPara(sesion.rol)
      .filter(soloLectura)
      .map((h) => h.nombre),
  )
  let llamadasHechas = 0

  try {
    const proveedor = obtenerProveedorIa()

    const inicio = Date.now()
    for (let vuelta = 0; vuelta <= MAX_VUELTAS_HERRAMIENTA; vuelta++) {
      if (vuelta > 0 && Date.now() - inicio > PRESUPUESTO_MS) {
        return {
          error: 'La consulta tardó demasiado. Probá con una pregunta más puntual.',
          propuestas,
          estado: 200,
        }
      }
      const respuesta = await proveedor.chat(conversacion, herramientas)

      if (respuesta.llamadas.length === 0) {
        return {
          respuesta:
            respuesta.contenido?.trim() ||
            (propuestas.length > 0
              ? 'Te dejé la acción preparada abajo: revisala y confirmala.'
              : 'No obtuve una respuesta de texto para esto.'),
          propuestas,
          estado: 200,
        }
      }

      if (vuelta === MAX_VUELTAS_HERRAMIENTA) break

      conversacion.push({
        rol: 'assistant',
        contenido: respuesta.contenido ?? '',
        llamadas: respuesta.llamadas,
      })

      for (const [i, llamada] of respuesta.llamadas.entries()) {
        if (i >= MAX_LLAMADAS_POR_VUELTA || llamadasHechas >= MAX_LLAMADAS_POR_CONSULTA) {
          conversacion.push({
            rol: 'tool',
            contenido: JSON.stringify({
              error:
                'Demasiadas consultas juntas. Respondé con lo que ya tenés o pedile a la persona que acote la pregunta.',
            }),
            idLlamada: llamada.id,
            nombreHerramienta: llamada.nombre,
          })
          continue
        }
        llamadasHechas++
        // Un modelo puede pedir una herramienta que no se le ofreció (la «recuerda»
        // de otra conversación, o la inventa): se rechaza acá, no en la herramienta.
        const resultado = permitidas.has(llamada.nombre)
          ? await ejecutarHerramienta(llamada.nombre, llamada.argumentos, sesion.rol)
          : { error: 'Esa herramienta no está disponible para tu rol.' }
        // Qué herramienta se usó y si dio resultado, sin los argumentos (pueden
        // traer un nombre): sirve para entender una respuesta rara del modelo.
        await registrarInfo('ia_herramienta', {
          herramienta: llamada.nombre,
          resultado: 'error' in resultado ? 'error' : 'ok',
          vacio: resultado.encontrada === false || resultado.encontrado === false,
        })
        const propuesta = propuestaDe(resultado)
        if (propuesta && propuestas.length < MAX_PROPUESTAS) propuestas.push(propuesta)
        // La propuesta entera NO vuelve al modelo: lleva ids y, en el caso de un
        // huésped, lo que se completa en la tarjeta. Le alcanza con saber que
        // quedó preparada (`accion`, `instruccion`).
        const paraElModelo = Object.fromEntries(
          Object.entries(resultado).filter(([k]) => k !== 'propuesta'),
        )
        conversacion.push({
          rol: 'tool',
          contenido: JSON.stringify(paraElModelo),
          idLlamada: llamada.id,
          nombreHerramienta: llamada.nombre,
        })
      }
    }

    return {
      error:
        'El asistente necesitó demasiados pasos para esta consulta. Probá con una pregunta más puntual.',
      propuestas,
      estado: 200,
    }
  } catch (e) {
    await registrarError(
      'ia_consulta',
      { detalle: e instanceof Error ? e.message : String(e) },
      { usuarioId: sesion.userId, rol: sesion.rol },
    )
    // Saturación o cupo del proveedor: no es una falla del sistema, y decirlo
    // así evita que alguien lo reporte como un error.
    const mensaje = !(e instanceof IaNoDisponible)
      ? 'No se pudo consultar al asistente en este momento. Probá de nuevo en un rato.'
      : e.motivo === 'cupo'
        ? 'Se agotó por ahora el cupo del servicio de IA (el plan gratuito tiene un límite por minuto y por día). Probá de nuevo en unos minutos; si pasa seguido, conviene un plan pago o un modelo de respaldo.'
        : 'El servicio de IA está saturado en este momento (le pasa al proveedor, no al sistema). Probá de nuevo en un minuto.'
    return { error: mensaje, propuestas: [], estado: 502 }
  }
}
