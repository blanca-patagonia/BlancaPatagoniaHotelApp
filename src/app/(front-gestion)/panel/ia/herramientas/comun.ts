import 'server-only'
import { mesActual } from '@/lib/fechas'
import { mesValido } from '@/lib/domain/informes'
import { registrarFalla } from '@/lib/acciones'
import { crearClienteServidor } from '@/lib/supabase/server'
import { cuentaConsolidada, type Consumo } from '@/lib/domain/consumos'
import { resumenPagos, type Pago } from '@/lib/domain/pagos'
import type { EstadoReserva } from '@/lib/domain/reservas'
import { normalizarCodigoReserva } from '@/lib/domain/ia-datos'
import { describirPropuesta, validarPropuesta } from '@/lib/domain/ia-acciones'
import { terminoBusqueda } from '@/lib/listados'
import { condicionNombre } from '../../exportar/busquedas'

/**
 * Lo que comparten las herramientas del asistente: las consultas a la base
 * (`SELECTS_IA`), la reserva por código, la cuenta con saldo, la unidad por
 * nombre y el armado de una propuesta.
 *
 * Todo corre con el cliente del usuario (`crearClienteServidor`), nunca con
 * `service_role`: RLS sigue aplicando y el asistente sólo lee lo que la persona
 * ya podría leer en su pantalla.
 */

/** Argumentos de una herramienta, tal como llegan del modelo (ya parseados). */
export type Argumentos = Record<string, unknown>

export const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function resolverMes(argumentos: Argumentos): string {
  const crudo = typeof argumentos.mes === 'string' ? argumentos.mes : undefined
  return mesValido(crudo, mesActual())
}

export function textoArg(argumentos: Argumentos, clave: string): string {
  const v = argumentos[clave]
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * El primer error de lectura de varias consultas, ya registrado, o `null`.
 *
 * Una herramienta que sigue con datos fallidos le da al modelo un número falso
 * con la forma de uno real («no hay unidades», «ocupación 0 %»): justo lo que
 * el asistente promete no hacer. Ante un error, la herramienta lo dice.
 */
export function fallaDeLectura(contexto: string, ...resultados: { error: string | null }[]) {
  const error = resultados.find((r) => r.error)?.error ?? null
  if (!error) return null
  registrarFalla({ message: error }, `ia:${contexto}`)
  return { error: 'No se pudieron leer los datos del sistema en este momento. Decile a la persona que pruebe de nuevo.' }
}

/** El error genérico de una lectura fallida, ya registrado. */
export function noSePudoLeer(error: unknown, contexto: string, que: string) {
  registrarFalla(error as { message: string }, `ia:${contexto}`)
  return { error: `No se pudo leer ${que}. Decile a la persona que pruebe de nuevo en un rato.` }
}

/** Lo mínimo de una reserva para calcular su saldo, igual que el tablero. */
export interface ReservaConCuenta {
  codigo: string
  estado: string
  total: number | string
  pagos: Pago[]
  consumos: { cantidad: number; precio_unitario: number | string }[]
}

/**
 * Saldo con la cuenta CONSOLIDADA (alojamiento + consumos) y `resumenPagos`:
 * la misma cuenta que usan el tablero y `lib/reservas/saldo.ts`. Una segunda
 * noción de «saldo» terminaría contradiciendo a la pantalla.
 */
export function cuentaDe(r: ReservaConCuenta) {
  const cuenta = cuentaConsolidada(
    Number(r.total),
    (r.consumos ?? []).map(
      (c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }) as Consumo,
    ),
  )
  const resumen = resumenPagos(
    cuenta.total,
    (r.pagos ?? []).map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
  )
  const redondear = (n: number) => Math.round(n * 100) / 100
  return {
    totalUsd: redondear(cuenta.total),
    pagadoUsd: redondear(resumen.pagado),
    saldoUsd: redondear(resumen.saldo),
  }
}

export const SELECT_CUENTA = 'codigo, estado, total, pagos(tipo, monto, estado), consumos(cantidad, precio_unitario)'

/**
 * Las consultas a la base de las herramientas, en un solo lugar.
 *
 * Están exportadas para que `tests/base-de-datos/ia-consultas.test.ts` las
 * EJECUTE contra la base: una columna mal escrita no falla al compilar, falla
 * al usarla, y el modelo la cuenta como «no se encontró». Así fue con
 * `reservas.adultos` (el desglose está en `estadias`): `buscar_reserva` nunca
 * había funcionado.
 */
export const SELECTS_IA = {
  buscarReserva: `id, ${SELECT_CUENTA}, canal, estadias(periodo, adultos, menores, unidad:unidades(nombre, tipo:tipos_unidad(nombre)))`,
  reservasDeHuesped: 'id, codigo, estado, estadias(periodo, unidad:unidades(nombre))',
  saldosPendientes: `${SELECT_CUENTA}, estadias!inner(check_in, check_out)`,
  operacionDelDia: 'periodo, unidad:unidades(nombre), reserva:reservas(codigo)',
  reservaParaConsumo: 'id, codigo, estado, facturas(id)',
  tiposUnidad: 'id, codigo, nombre, capacidad_max',
  estadoUnidades: 'nombre, estado',
  unidadPorNombre: 'id, nombre',
  reservaParaAccion:
    'id, codigo, estado, total, tarifa_tipo, huesped_id, facturas(id), estadias(periodo, tipo_unidad_id, unidad:unidades(nombre))',
  cuentaDeReserva:
    'id, codigo, estado, total, pagos(tipo, monto, estado, medio, creado_en), consumos(cantidad, precio_unitario, fecha, producto:productos_servicios(nombre)), facturas(numero)',
  ordenesMantenimiento: 'id, titulo, prioridad, estado, creada_en, resuelta_en, unidad:unidades(nombre)',
  objetosPerdidos: 'id, descripcion, ubicacion, fecha_hallazgo, estado, reserva:reservas(codigo)',
  avisosInternos: 'mensaje, fijado, creado_en',
  // Empresas, no personas: sin cuit, email ni teléfono igual (no le hacen falta).
  agencias: 'id, nombre, tipo, activo',
  proveedores: 'id, nombre, rubro, activo',
} as const

/** La ficha de una reserva en el panel: el asistente la devuelve como enlace. */
export function enlaceDeReserva(id: string): string {
  return `/panel/reservas/${id}`
}

/**
 * Palabras de un nombre listas para buscar (hasta cuatro, de 2 letras o más).
 * Cada una tiene que estar en el nombre o en el apellido («juan almiron»).
 */
export function palabrasDeNombre(crudo: string): string[] {
  return crudo
    .split(/\s+/)
    .map((p) => terminoBusqueda(p))
    .filter((p): p is string => Boolean(p && p.length >= 2))
    .slice(0, 4)
}

/** Ids de huéspedes cuyo nombre o apellido contiene TODAS las palabras. Sólo ids: el nombre es un filtro. */
export async function idsDeHuespedes(palabras: readonly string[], limite: number) {
  const supabase = await crearClienteServidor()
  let consulta = supabase.from('huespedes').select('id')
  for (const p of palabras) consulta = consulta.or(condicionNombre(p))
  const { data, error } = await consulta.limit(limite)
  return { ids: (data ?? []).map((h) => (h as { id: string }).id), error }
}

/**
 * Una unidad activa por nombre: la exacta, o la única que contiene el texto.
 * Si hay varias o ninguna, el error trae las parecidas para que el asistente
 * pregunte cuál.
 */
export async function unidadPorNombre(
  nombre: string,
  contexto: string,
): Promise<{ unidad: { id: string; nombre: string } } | { error: string; parecidas?: string[]; instruccion?: string }> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('unidades')
    .select(SELECTS_IA.unidadPorNombre)
    .eq('activo', true)
    .ilike('nombre', `%${terminoBusqueda(nombre) ?? ''}%`)
    .order('nombre')
    .limit(6)
  if (error) return noSePudoLeer(error, contexto, 'las unidades')
  const filas = (data ?? []) as { id: string; nombre: string }[]
  const unidad =
    filas.find((u) => u.nombre.toLowerCase() === nombre.toLowerCase()) ?? (filas.length === 1 ? filas[0] : null)
  if (unidad) return { unidad }
  return {
    error: `No encontré una única unidad «${nombre}».`,
    parecidas: filas.map((u) => u.nombre),
    instruccion: 'Preguntale a la persona cuál es.',
  }
}

export interface ReservaParaAccion {
  id: string
  codigo: string
  estado: EstadoReserva
  total: number | string
  tarifa_tipo: 'neto' | 'rack'
  huesped_id: string | null
  facturas: { id: string } | { id: string }[] | null
  estadias: { periodo: string; tipo_unidad_id: string; unidad: { nombre: string } | null }[]
}

/** La reserva por su código (normalizado), o el error para el modelo. */
export async function reservaPorCodigo(
  crudo: unknown,
): Promise<{ reserva: ReservaParaAccion } | { error: string }> {
  const codigo = normalizarCodigoReserva(typeof crudo === 'string' ? crudo : '')
  if (!/^[A-Z0-9-]{3,30}$/.test(codigo)) return { error: 'Necesito el código de la reserva.' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('reservas')
    .select(SELECTS_IA.reservaParaAccion)
    .eq('codigo', codigo)
    .maybeSingle()
  if (error) {
    registrarFalla(error, 'ia:reserva_para_accion')
    return { error: 'No se pudo leer la reserva.' }
  }
  if (!data) return { error: `No existe la reserva ${codigo}. Si el código es parcial, buscala primero con buscar_reserva.` }
  return { reserva: data as unknown as ReservaParaAccion }
}

/* ───────────────────────────── propuestas de acción (ADR 0041) ─────────── */

/**
 * Lo que vuelve de una herramienta `proponer_*`: la propuesta validada, que la
 * ruta del chat junta para mostrar como tarjeta, y el texto para el modelo.
 * Nada se escribe acá.
 */
export function preparada(valor: unknown) {
  const propuesta = validarPropuesta(valor)
  if (!propuesta) return { error: 'Faltan datos o no son válidos para preparar esta acción.' }
  return {
    propuesta,
    preparada: true,
    // Sólo el título para el modelo: la propuesta entera (ids, y en el caso de un
    // huésped, lo que escribió la persona) la retira la ruta antes de devolverle
    // el resultado al proveedor.
    accion: describirPropuesta(propuesta).titulo,
    instruccion:
      'La acción NO está hecha: decile a la persona que revise la tarjeta, complete lo que haga falta y apriete «Confirmar».',
  }
}
