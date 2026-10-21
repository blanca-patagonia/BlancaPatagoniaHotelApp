import 'server-only'
import { mesActual, inicioFinDeMes, fechaDelHotel } from '@/lib/fechas'
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
} from '../../reportes/datos'
import { fallaDeLectura, resolverMes, type Argumentos } from './comun'

/**
 * Herramientas de informes (área `reportes`): ocupación, venta por categoría,
 * facturación, reservas por estado y canal, satisfacción.
 *
 * Reusan `../../reportes/datos.ts` — las mismas lecturas que los informes
 * gerenciales, no consultas nuevas. Un mismo número en el asistente y en
 * `/panel/reportes` es la garantía de que no van a decir cosas distintas.
 */

export async function metricasPeriodo(argumentos: Argumentos) {
  const mes = resolverMes(argumentos)
  const [unidades, estadias] = await Promise.all([traerUnidades(), traerEstadias()])
  const falla = fallaDeLectura('metricas_periodo', unidades, estadias)
  if (falla) return { mes, ...falla }
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

export async function ventaPorCategoria(argumentos: Argumentos) {
  const mes = resolverMes(argumentos)
  const [estadias, tipos] = await Promise.all([traerEstadiasPorTipo(), traerTiposConInventario()])
  const falla = fallaDeLectura('venta_por_categoria', estadias, tipos)
  if (falla) return { mes, ...falla }
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
    datosIncompletos: estadias.truncado || tipos.truncado,
  }
}

export async function facturacionMes(argumentos: Argumentos) {
  const mes = resolverMes(argumentos)
  const ventana = inicioFinDeMes(mes)
  const [facturas, pagos] = await Promise.all([traerFacturasConFecha(), traerPagosConMedio()])
  const falla = fallaDeLectura('facturacion_mes', facturas, pagos)
  if (falla) return { mes, ...falla }
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

export async function resumenReservas() {
  const reservas = await traerReservas()
  const falla = fallaDeLectura('resumen_reservas', reservas)
  if (falla) return falla
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

export async function satisfaccionHuespedes(argumentos: Argumentos) {
  const mesCrudo = typeof argumentos.mes === 'string' ? argumentos.mes : undefined
  const ventana = mesCrudo ? inicioFinDeMes(mesValido(mesCrudo, mesActual())) : null
  const encuestas = await traerEncuestas()
  const falla = fallaDeLectura('satisfaccion_huespedes', encuestas)
  if (falla) return falla

  // El día del hotel, no el UTC (ver `fechaDelHotel`).
  const enMes = (iso: string | null) => {
    if (!ventana) return true
    if (!iso) return false
    const fecha = fechaDelHotel(iso)
    return fecha >= ventana.inicio && fecha < ventana.fin
  }
  // Enviadas por cuándo se ENVIARON y respondidas por cuándo se RESPONDIERON:
  // filtrar las dos por `respondida_en` daba siempre una tasa del 100 %.
  const enviadas = encuestas.filas.filter((e) => enMes(e.enviada_en))
  const respondidas = encuestas.filas.filter((e) => e.puntaje !== null && enMes(e.respondida_en))
  const promedio =
    respondidas.length > 0
      ? Math.round((respondidas.reduce((a, e) => a + (e.puntaje ?? 0), 0) / respondidas.length) * 10) / 10
      : null

  return {
    mes: mesCrudo ?? null,
    encuestasEnviadas: enviadas.length,
    encuestasRespondidas: respondidas.length,
    puntajePromedio: promedio,
    datosIncompletos: encuestas.truncado,
  }
}
