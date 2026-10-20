'use server'

import { requerirAcceso } from '@/lib/auth/session'
import { iaActiva, obtenerProveedorIa, IaNoDisponible } from '@/lib/ia/proveedor'
import { permitirIntentoDe } from '@/lib/limites'
import { herramientasPara } from '@/lib/domain/ia-herramientas'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { registrarError } from '@/lib/registro'
import { ejecutarHerramienta } from './herramientas'

export type TipoConsultaRapida = 'resumen' | 'atencion'

/**
 * Consultas de un clic desde el tablero: el resumen del día y lo que necesita
 * atención.
 *
 * ── Por qué no pasan por el ida y vuelta del chat ──────────────────────────
 *
 * Por el chat, el modelo pedía cinco o seis herramientas en varias vueltas: cada
 * vuelta reenvía todo, y un resumen gastaba el cupo por minuto del plan gratuito.
 * Acá el sistema junta los datos PRIMERO —llamando a las mismas herramientas,
 * con los permisos del rol— y le hace al modelo UNA sola llamada, sin
 * herramientas, para redactarlos. Menos tokens, más rápido, y el modelo no puede
 * inventar un número que no esté en los datos que recibió.
 *
 * Sólo lee: no prepara acciones. Cuenta contra el cupo por persona del chat.
 */
const DATOS: Record<TipoConsultaRapida, { herramienta: string; argumentos: (hoy: string) => object }[]> = {
  resumen: [
    { herramienta: 'operacion_del_dia', argumentos: (hoy) => ({ fecha: hoy }) },
    { herramienta: 'operacion_del_dia', argumentos: (hoy) => ({ fecha: sumarDias(hoy, 1) }) },
    { herramienta: 'estado_limpieza', argumentos: () => ({}) },
    { herramienta: 'saldos_pendientes', argumentos: () => ({}) },
    { herramienta: 'clima', argumentos: () => ({ dias: 2 }) },
  ],
  atencion: [
    { herramienta: 'operacion_del_dia', argumentos: (hoy) => ({ fecha: hoy }) },
    { herramienta: 'saldos_pendientes', argumentos: () => ({}) },
    { herramienta: 'estado_limpieza', argumentos: () => ({}) },
    { herramienta: 'metricas_periodo', argumentos: (hoy) => ({ mes: hoy.slice(0, 7) }) },
    { herramienta: 'metricas_periodo', argumentos: (hoy) => ({ mes: sumarDias(`${hoy.slice(0, 7)}-01`, -1).slice(0, 7) }) },
    { herramienta: 'clima', argumentos: () => ({ dias: 2 }) },
  ],
}

const INSTRUCCION: Record<TipoConsultaRapida, string> = {
  resumen:
    'Con estos datos del hotel armá el resumen operativo de hoy para el equipo: llegadas y salidas de hoy y de mañana (con código y unidad), unidades libres esta noche, habitaciones sucias, reservas con saldo pendiente y el clima con aviso si hay viento fuerte. Máximo 10 viñetas, sin introducción ni saludo.',
  atencion:
    'Con estos datos del hotel decime las 3 a 5 cosas que más necesitan atención hoy. Para cada una: qué pasa, qué conviene hacer y en qué pantalla (con la ruta /panel/…: /panel/reservas, /panel/housekeeping, /panel/ocupacion, /panel/reportes). Si algo está bien, no lo inventes como problema. Sin introducción ni saludo.',
}

export async function consultaRapida(
  tipo: TipoConsultaRapida,
): Promise<{ texto?: string; error?: string }> {
  const sesion = await requerirAcceso('ia')
  if (!iaActiva()) return { error: 'El asistente de IA no está configurado.' }
  // Es una Server Action: `tipo` llega del cliente y puede ser cualquier cosa.
  // `Object.hasOwn` y no `DATOS[tipo]` a secas: con 'constructor' devolvía la
  // función heredada de Object y la acción terminaba en un 500.
  const pedidos = Object.hasOwn(DATOS, tipo) ? DATOS[tipo] : undefined
  if (!pedidos) return { error: 'Consulta desconocida.' }
  if (!(await permitirIntentoDe('ia_consulta', sesion.userId))) {
    return { error: 'Hiciste muchas consultas seguidas al asistente. Esperá unos minutos.' }
  }

  // Sólo lo que el rol puede ver: housekeeping no recibe saldos ni métricas.
  const permitidas = new Set(herramientasPara(sesion.rol).map((h) => h.nombre))
  const hoy = hoyISO()
  const datos: Record<string, unknown> = {}
  await Promise.all(
    pedidos
      .filter((p) => permitidas.has(p.herramienta))
      .map(async (p, i) => {
        const args = p.argumentos(hoy)
        datos[`${p.herramienta}_${i}`] = {
          ...args,
          resultado: await ejecutarHerramienta(p.herramienta, JSON.stringify(args), sesion.rol),
        }
      }),
  )

  try {
    const r = await obtenerProveedorIa().chat(
      [
        {
          rol: 'system',
          contenido: `Sos el asistente interno del Hotel Blanca Patagonia (El Calafate). Hoy es ${hoy}. Usá SÓLO los datos que te paso: no inventes números ni reservas. Si un dato tiene «error», decí que no se pudo leer. Respondé en castellano rioplatense, en viñetas, importes como «USD 1.290,40». Para enumerar usá guiones y podés resaltar con **negrita**.`,
        },
        { rol: 'user', contenido: `${INSTRUCCION[tipo]}\n\nDATOS (JSON):\n${JSON.stringify(datos)}` },
      ],
      [],
    )
    return { texto: r.contenido?.trim() || 'No obtuve una respuesta.' }
  } catch (e) {
    await registrarError('ia_consulta_rapida', { tipo, detalle: e instanceof Error ? e.message : String(e) })
    if (e instanceof IaNoDisponible) {
      return {
        error:
          e.motivo === 'cupo'
            ? 'Se agotó por ahora el cupo del servicio de IA. Probá de nuevo en unos minutos.'
            : 'El servicio de IA está saturado en este momento. Probá de nuevo en un minuto.',
      }
    }
    return { error: 'No se pudo consultar al asistente en este momento.' }
  }
}
