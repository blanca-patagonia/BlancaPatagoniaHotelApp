import 'server-only'
import { registrarFalla } from '@/lib/acciones'
import { validarPropuesta, type Propuesta } from '@/lib/domain/ia-acciones'
import type { Rol } from '@/lib/domain/roles'
import { buscarEnWikipedia, climaEnElCalafate, cotizacionDeMonedas } from '@/lib/ia/externo'
import { textoArg, type Argumentos } from './comun'
import * as informes from './informes'
import * as reservas from './reservas'
import * as operacion from './operacion'
import * as administracion from './administracion'
import * as propuestas from './propuestas'

export { SELECTS_IA } from './comun'

/**
 * Ejecución real de las herramientas del asistente de IA.
 *
 * El catálogo —nombre, descripción y parámetros de cada una— es puro y vive en
 * `lib/domain/ia-herramientas.ts`. Acá está lo que lee la base, repartido por
 * tema:
 *
 * | Archivo             | Qué tiene                                               |
 * |---------------------|---------------------------------------------------------|
 * | `comun.ts`          | Consultas (`SELECTS_IA`), reserva por código, unidad    |
 * |                     | por nombre, cuenta con saldo y el armado de propuestas  |
 * | `informes.ts`       | Ocupación, venta por categoría, facturación, encuestas  |
 * | `reservas.ts`       | Buscar reservas, cuenta, saldos, disponibilidad, cotizar|
 * | `operacion.ts`      | Limpieza, mantenimiento, objetos perdidos, cartelera    |
 * | `administracion.ts` | Buscar en el sistema, Ayuda, agencias, proveedores,     |
 * |                     | salud del sistema                                       |
 * | `propuestas.ts`     | Las `proponer_*` (ADR 0041): preparan, no escriben      |
 *
 * Todo corre con el cliente del usuario (RLS sigue aplicando) y ninguna
 * herramienta escribe: las escrituras pasan por `../acciones.ts` cuando una
 * persona confirma la tarjeta.
 */

type Implementacion = (argumentos: Argumentos, rol: Rol) => unknown

/**
 * Cada herramienta del catálogo, con su implementación. Una tabla y no un
 * `switch`: `tests/contratos/ia-herramientas-implementadas.test.ts` compara
 * estas claves con el catálogo y falla si una herramienta se declara sin
 * código (el modelo la llamaría y recibiría «desconocida») o al revés.
 */
export const IMPLEMENTACIONES: Record<string, Implementacion> = {
  // Informes (reportes)
  metricas_periodo: informes.metricasPeriodo,
  venta_por_categoria: informes.ventaPorCategoria,
  facturacion_mes: informes.facturacionMes,
  resumen_reservas: () => informes.resumenReservas(),
  satisfaccion_huespedes: informes.satisfaccionHuespedes,
  // Reservas y ocupación
  operacion_del_dia: reservas.operacionDelDia,
  buscar_reserva: reservas.buscarReserva,
  buscar_por_huesped: reservas.buscarPorHuesped,
  cuenta_de_reserva: reservas.cuentaDeReserva,
  saldos_pendientes: () => reservas.saldosPendientes(),
  disponibilidad: reservas.disponibilidad,
  cotizar_estadia: reservas.cotizar,
  movimientos_proximos: reservas.movimientosProximos,
  // Operación
  estado_limpieza: () => operacion.estadoLimpieza(),
  ordenes_mantenimiento: operacion.ordenesMantenimiento,
  objetos_perdidos: operacion.objetosPerdidos,
  avisos_internos: () => operacion.avisosInternos(),
  // Transversales
  consultar_ayuda: administracion.consultarAyuda,
  buscar_en_sistema: administracion.buscarEnSistema,
  cuentas_agencias: administracion.cuentasAgencias,
  cuentas_proveedores: administracion.cuentasProveedores,
  salud_del_sistema: () => administracion.saludDelSistema(),
  // Información de afuera (lib/ia/externo.ts)
  clima: (a) => climaEnElCalafate(Number(a.dias ?? 3)),
  cotizacion_monedas: () => cotizacionDeMonedas(),
  informacion_general: (a) => buscarEnWikipedia(textoArg(a, 'consulta')),
  // Propuestas (ADR 0041)
  proponer_aviso: propuestas.proponerAviso,
  proponer_orden_mantenimiento: propuestas.proponerOrden,
  proponer_estado_orden: propuestas.proponerEstadoOrden,
  proponer_objeto_perdido: propuestas.proponerObjetoPerdido,
  proponer_objeto_devuelto: propuestas.proponerObjetoDevuelto,
  proponer_consumo: propuestas.proponerConsumo,
  proponer_estado_limpieza: propuestas.proponerEstadoLimpieza,
  proponer_cambio_estado: propuestas.proponerCambioEstado,
  proponer_mudanza: propuestas.proponerMudanza,
  proponer_reprogramacion: propuestas.proponerReprogramacion,
  proponer_factura: propuestas.proponerFactura,
  proponer_nota_credito: propuestas.proponerNotaCredito,
  proponer_reserva: propuestas.proponerReserva,
  proponer_huesped: propuestas.proponerHuesped,
  proponer_editar_huesped: propuestas.proponerEditarHuesped,
  proponer_mensaje_huesped: propuestas.proponerMensajeHuesped,
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
  rol: Rol,
): Promise<Record<string, unknown>> {
  let argumentos: Argumentos = {}
  try {
    const parseado: unknown = argumentosJson.trim() ? JSON.parse(argumentosJson) : {}
    if (parseado && typeof parseado === 'object') argumentos = parseado as Argumentos
  } catch {
    return { error: 'Argumentos inválidos: no se pudo interpretar el JSON.' }
  }

  const implementacion = Object.hasOwn(IMPLEMENTACIONES, nombre) ? IMPLEMENTACIONES[nombre] : undefined
  if (!implementacion) return { error: `Herramienta desconocida: ${nombre}` }
  try {
    return (await implementacion(argumentos, rol)) as Record<string, unknown>
  } catch (e) {
    registrarFalla({ message: e instanceof Error ? e.message : String(e) }, `ia:herramienta_${nombre}`)
    return { error: 'No se pudo leer ese dato del sistema en este momento.' }
  }
}

/** La propuesta que trae el resultado de una herramienta, si trae una válida. */
export function propuestaDe(resultado: Record<string, unknown>): Propuesta | null {
  return 'propuesta' in resultado ? validarPropuesta(resultado.propuesta) : null
}
