import 'server-only'
import { mesActual, inicioFinDeMes } from '@/lib/fechas'
import { mesValido } from '@/lib/domain/informes'
import { metricasDeMes } from '@/lib/domain/metricas'
import { ventaPorTipo, totalesDeVenta } from '@/lib/domain/metricas-categoria'
import { facturadoEnPeriodo, cobradoPorMedioEnPeriodo } from '@/lib/domain/metricas-facturacion'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { registrarFalla } from '@/lib/acciones'
import {
  traerUnidades,
  traerEstadias,
  traerEstadiasPorTipo,
  traerTiposConInventario,
  traerReservas,
  traerFacturasConFecha,
  traerPagosConMedio,
  traerEncuestas,
} from '../reportes/datos'

/**
 * Ejecución real de las herramientas del asistente de IA.
 *
 * Vive en `app/` y no en `lib/domain/` (que declara sólo el *catálogo*, ver
 * `lib/domain/ia-herramientas.ts`) porque lee la base: `lib/` no puede
 * importar de `app/`, y estas funciones reusan `../reportes/datos.ts` — las
 * mismas lecturas que ya usan los informes gerenciales, no consultas nuevas.
 * Un mismo número en el asistente y en `/panel/reportes` es la garantía de
 * que no van a decir cosas distintas.
 *
 * Cada función respeta RLS: corre con el cliente del usuario (`crearClienteServidor`,
 * por dentro de cada `traer*`), nunca con `service_role`. El asistente sólo
 * puede leer lo que la persona que lo usa ya podría leer entrando a Reportes.
 *
 * Todas las herramientas son de **solo lectura**: ninguna hace `insert`,
 * `update` ni `delete`. Es deliberado — ver el system prompt en
 * `lib/domain/ia-herramientas.ts`.
 */

function resolverMes(argumentos: Record<string, unknown>): string {
  const crudo = typeof argumentos.mes === 'string' ? argumentos.mes : undefined
  return mesValido(crudo, mesActual())
}

async function metricasPeriodo(argumentos: Record<string, unknown>) {
  const mes = resolverMes(argumentos)
  const [unidades, estadias] = await Promise.all([traerUnidades(), traerEstadias()])
  if (unidades.filas.length === 0) {
    registrarFalla({ message: 'sin unidades activas' }, 'ia:metricas_periodo')
    return { mes, error: 'No hay unidades activas cargadas: no se puede calcular la ocupación.' }
  }
  const m = metricasDeMes(estadias.filas, mes, unidades.filas.length)
  return {
    mes,
    ocupacionPct: m.ocupacionPct,
    adrUsd: Math.round(m.adr * 100) / 100,
    revparUsd: Math.round(m.revpar * 100) / 100,
    nochesVendidas: m.nochesVendidas,
    nochesDisponibles: m.nochesDisponibles,
    ingresoUsd: Math.round(m.ingreso * 100) / 100,
    datosIncompletos: unidades.truncado || estadias.truncado,
  }
}

async function ventaPorCategoria(argumentos: Record<string, unknown>) {
  const mes = resolverMes(argumentos)
  const [estadias, tipos] = await Promise.all([traerEstadiasPorTipo(), traerTiposConInventario()])
  const filas = ventaPorTipo(estadias.filas, tipos.filas, mes)
  const totales = totalesDeVenta(filas)
  return {
    mes,
    categorias: filas.map((f) => ({
      nombre: f.nombre,
      codigo: f.codigo,
      nochesVendidas: f.nochesVendidas,
      ingresoUsd: f.ingreso,
      adrUsd: f.adr,
      ocupacionPct: f.ocupacionPct,
      participacionDelIngresoPct: f.participacionPct,
      sinInventarioActivo: f.sinInventario,
    })),
    totales: {
      nochesVendidas: totales.nochesVendidas,
      ingresoUsd: totales.ingreso,
      adrUsd: totales.adr,
      ocupacionPct: totales.ocupacionPct,
      revparUsd: totales.revpar,
    },
    datosIncompletos: estadias.truncado || tipos.filas.length === 0,
  }
}

async function facturacionMes(argumentos: Record<string, unknown>) {
  const mes = resolverMes(argumentos)
  const ventana = inicioFinDeMes(mes)
  const [facturas, pagos] = await Promise.all([traerFacturasConFecha(), traerPagosConMedio()])
  const facturado = facturadoEnPeriodo(facturas.filas, ventana)
  const cobrado = cobradoPorMedioEnPeriodo(pagos.filas, ventana)
  return {
    mes,
    facturadoUsd: Math.round(facturado * 100) / 100,
    cobradoPorMedio: cobrado.map((c) => ({ medio: c.medio, montoUsd: Math.round(c.monto * 100) / 100 })),
    // Los pagos y las facturas están SIEMPRE en USD (ADR 0027): no hace falta
    // convertir nada para que estos dos números se puedan sumar entre sí.
    datosIncompletos: facturas.truncado || pagos.truncado,
  }
}

async function resumenReservas() {
  const reservas = await traerReservas()
  const porEstado = new Map<string, number>()
  const porCanal = new Map<string, number>()
  for (const r of reservas.filas) {
    porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1)
    porCanal.set(r.canal, (porCanal.get(r.canal) ?? 0) + 1)
  }
  return {
    totalReservas: reservas.filas.length,
    porEstado: [...porEstado.entries()].map(([estado, cantidad]) => ({
      estado: ETIQUETAS_ESTADO_RESERVA[estado as EstadoReserva] ?? estado,
      cantidad,
    })),
    porCanal: [...porCanal.entries()]
      .map(([canal, cantidad]) => ({ canal, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad),
    datosIncompletos: reservas.truncado,
  }
}

async function satisfaccionHuespedes(argumentos: Record<string, unknown>) {
  const mesCrudo = typeof argumentos.mes === 'string' ? argumentos.mes : undefined
  const ventana = mesCrudo ? inicioFinDeMes(mesValido(mesCrudo, mesActual())) : null
  const encuestas = await traerEncuestas()

  const enVentana = ventana
    ? encuestas.filas.filter((e) => {
        if (!e.respondida_en) return false
        const fecha = e.respondida_en.slice(0, 10)
        return fecha >= ventana.inicio && fecha < ventana.fin
      })
    : encuestas.filas

  const respondidas = enVentana.filter((e) => e.puntaje !== null)
  const promedio =
    respondidas.length > 0
      ? Math.round((respondidas.reduce((a, e) => a + (e.puntaje ?? 0), 0) / respondidas.length) * 10) / 10
      : null

  return {
    mes: mesCrudo ?? null,
    encuestasEnviadas: enVentana.length,
    encuestasRespondidas: respondidas.length,
    puntajePromedio: promedio,
    datosIncompletos: encuestas.truncado,
  }
}

/**
 * Ejecuta una herramienta por nombre. Devuelve un objeto serializable a JSON
 * — nunca lanza por un nombre desconocido o argumentos rotos, porque el
 * resultado vuelve directo al modelo como el contenido de un mensaje `tool`:
 * un `throw` acá cortaría toda la conversación en vez de dejar que el
 * asistente le explique al usuario que no pudo obtener el dato.
 */
export async function ejecutarHerramienta(
  nombre: string,
  argumentosJson: string,
): Promise<Record<string, unknown>> {
  let argumentos: Record<string, unknown> = {}
  try {
    const parseado: unknown = argumentosJson.trim() ? JSON.parse(argumentosJson) : {}
    if (parseado && typeof parseado === 'object') argumentos = parseado as Record<string, unknown>
  } catch {
    return { error: 'Argumentos inválidos: no se pudo interpretar el JSON.' }
  }

  try {
    switch (nombre) {
      case 'metricas_periodo':
        return await metricasPeriodo(argumentos)
      case 'venta_por_categoria':
        return await ventaPorCategoria(argumentos)
      case 'facturacion_mes':
        return await facturacionMes(argumentos)
      case 'resumen_reservas':
        return await resumenReservas()
      case 'satisfaccion_huespedes':
        return await satisfaccionHuespedes(argumentos)
      default:
        return { error: `Herramienta desconocida: ${nombre}` }
    }
  } catch (e) {
    registrarFalla({ message: e instanceof Error ? e.message : String(e) }, `ia:herramienta_${nombre}`)
    return { error: 'No se pudo leer ese dato del sistema en este momento.' }
  }
}
