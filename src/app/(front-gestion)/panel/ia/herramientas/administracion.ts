import 'server-only'
import { hoyISO, inicioDelDiaHotel } from '@/lib/fechas'
import { buscarEnAyuda } from '@/lib/domain/ayuda'
import { cronsAtrasados } from '@/lib/domain/crons'
import type { Rol } from '@/lib/domain/roles'
import { buscarGlobal } from '@/lib/busqueda/servicio'
import { crearClienteServidor } from '@/lib/supabase/server'
import { formatearUSD } from '@/lib/domain/moneda'
import { parsearPeriodo } from '@/lib/fechas'
import { SELECTS_IA, enlaceDeReserva, noSePudoLeer, textoArg, type Argumentos } from './comun'

/**
 * Herramientas transversales: buscar en todo el sistema, la guía de uso, las
 * cuentas corrientes de agencias y proveedores, y la salud del sistema.
 */

/** Fragmentos de la guía de uso, filtrados por lo que el rol puede usar. */
export function consultarAyuda(argumentos: Argumentos, rol: Rol) {
  const pregunta = typeof argumentos.pregunta === 'string' ? argumentos.pregunta : ''
  const fragmentos = buscarEnAyuda(rol, pregunta)
  return fragmentos.length > 0
    ? { fragmentos }
    : { fragmentos: [], aviso: 'La guía no tiene nada sobre eso. Decile al usuario que lo consulte en la sección Ayuda o con administración.' }
}

/**
 * El buscador global del panel (`lib/busqueda/servicio.ts`), el MISMO que usa
 * la pantalla «Buscar», pero sin personas (`sinPersonas`): ni huéspedes, ni
 * usuarios, ni el nombre del huésped de una reserva. Ya filtra por rol.
 */
export async function buscarEnSistema(argumentos: Argumentos, rol: Rol) {
  const termino = textoArg(argumentos, 'termino')
  if (termino.length < 2) return { error: 'Decime qué buscar (al menos dos letras).' }
  const supabase = await crearClienteServidor()
  const r = await buscarGlobal(supabase, rol, termino, 6, { sinPersonas: true })
  const total =
    r.secciones.length +
    r.glosario.length +
    r.reservas.length +
    r.unidades.length +
    r.tipos_unidad.length +
    r.productos.length +
    r.promociones.length +
    r.agencias.length +
    r.proveedores.length
  if (total === 0) {
    return {
      termino,
      encontrado: false,
      instruccion:
        'No hay nada con esa palabra en lo que este rol puede ver. Si es un huésped, probá con buscar_por_huesped; si es una duda de uso, con consultar_ayuda.',
    }
  }
  const siHay = <T,>(clave: string, filas: T[]) => (filas.length > 0 ? { [clave]: filas } : {})
  return {
    termino,
    encontrado: true,
    ...siHay(
      'pantallas',
      r.secciones.map((s) => ({ seccion: s.titulo, para: s.descripcion, enlace: s.href })),
    ),
    ...siHay(
      'glosario',
      r.glosario.map((g) => ({ termino: g.termino, significa: g.definicion })),
    ),
    ...siHay(
      'productos',
      r.productos.map((p) => ({
        nombre: p.nombre,
        precio: formatearUSD(Number(p.precio)),
        departamento: p.departamento?.nombre ?? null,
      })),
    ),
    ...siHay(
      'unidades',
      r.unidades.map((u) => ({ nombre: u.nombre, tipo: u.tipo?.nombre ?? null, piso: u.piso, activa: u.activo })),
    ),
    ...siHay(
      'tiposDeUnidad',
      r.tipos_unidad.map((t) => ({ nombre: t.nombre, capacidadMaxima: t.capacidad_max })),
    ),
    ...siHay(
      'promociones',
      r.promociones.map((p) => ({ nombre: p.nombre, activa: p.activa })),
    ),
    ...siHay(
      'agencias',
      r.agencias.map((a) => ({ nombre: a.nombre, tipo: a.tipo ?? null, enlace: `/panel/agencias/${a.id}` })),
    ),
    ...siHay(
      'proveedores',
      r.proveedores.map((p) => ({ nombre: p.nombre, rubro: p.rubro ?? null, enlace: `/panel/proveedores/${p.id}` })),
    ),
    ...siHay(
      'reservas',
      r.reservas.map((x) => ({
        codigo: x.codigo,
        estado: x.estado,
        llegada: x.estadias?.[0] ? parsearPeriodo(x.estadias[0].periodo).desde : null,
        enlace: enlaceDeReserva(x.id),
      })),
    ),
  }
}

/**
 * Saldo de cada cuenta corriente (agencias o proveedores), con las vistas que
 * ya usa la pantalla (`saldos_agencias` / `saldos_proveedores`, 0026): la base
 * agrega, así el número es el mismo que se ve en el listado.
 */
async function saldosDeCuentas(
  argumentos: Argumentos,
  cual: 'agencias' | 'proveedores',
): Promise<Record<string, unknown>> {
  const soloConSaldo = argumentos.solo_con_saldo !== false
  const supabase = await crearClienteServidor()
  const [cuentas, saldos] = await Promise.all([
    supabase.from(cual).select(SELECTS_IA[cual]).order('nombre').limit(500),
    cual === 'agencias'
      ? supabase.from('saldos_agencias').select('agencia_id, saldo')
      : supabase.from('saldos_proveedores').select('proveedor_id, saldo'),
  ])
  if (cuentas.error || saldos.error) {
    return noSePudoLeer(cuentas.error ?? saldos.error, `cuentas_${cual}`, `las cuentas de ${cual}`)
  }
  const saldoDe = new Map(
    ((saldos.data ?? []) as unknown as Record<string, string | number>[]).map((s) => [
      String(s.agencia_id ?? s.proveedor_id),
      Number(s.saldo),
    ]),
  )
  const filas = ((cuentas.data ?? []) as unknown as { id: string; nombre: string; activo: boolean; tipo?: string; rubro?: string | null }[])
    .map((c) => ({
      nombre: c.nombre,
      ...(cual === 'agencias' ? { tipo: c.tipo ?? null } : { rubro: c.rubro ?? null }),
      activa: c.activo,
      saldoUsd: Math.round((saldoDe.get(c.id) ?? 0) * 100) / 100,
      enlace: `/panel/${cual}/${c.id}`,
    }))
    .filter((c) => !soloConSaldo || c.saldoUsd > 0)
    .sort((a, b) => b.saldoUsd - a.saldoUsd)
  const total = filas.reduce((t, c) => t + Math.max(0, c.saldoUsd), 0)
  return {
    cantidad: filas.length,
    [cual === 'agencias' ? 'totalACobrarUsd' : 'totalAPagarUsd']: Math.round(total * 100) / 100,
    cuentas: filas.slice(0, 30),
    nota:
      cual === 'agencias'
        ? 'Saldo positivo: lo que la agencia le debe al hotel.'
        : 'Saldo positivo: lo que el hotel le debe al proveedor.',
  }
}

export const cuentasAgencias = (a: Argumentos) => saldosDeCuentas(a, 'agencias')
export const cuentasProveedores = (a: Argumentos) => saldosDeCuentas(a, 'proveedores')

/**
 * Cómo viene funcionando el sistema: los mismos datos que `/panel/errores`,
 * `/panel/notificaciones` y la alarma de tareas programadas del tablero.
 * Sólo nombres de evento y conteos: el detalle de un error puede traer datos
 * de quien lo provocó y no sale hacia el modelo.
 */
export async function saludDelSistema() {
  const supabase = await crearClienteServidor()
  const hace24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const [hoy, recientes, fallidas, corridas] = await Promise.all([
    supabase
      .from('errores')
      .select('id', { count: 'exact', head: true })
      .eq('nivel', 'error')
      .gte('creado_en', inicioDelDiaHotel(hoyISO())),
    supabase.from('errores').select('evento, nivel').gte('creado_en', hace24h).limit(1000),
    supabase.from('notificaciones').select('id', { count: 'exact', head: true }).eq('estado', 'fallida'),
    supabase.from('cron_corridas').select('nombre, ultima_ok'),
  ])
  const error = hoy.error ?? recientes.error ?? fallidas.error
  if (error) return noSePudoLeer(error, 'salud_del_sistema', 'el registro del sistema')

  const porEvento = new Map<string, { veces: number; nivel: string }>()
  for (const e of (recientes.data ?? []) as { evento: string; nivel: string }[]) {
    const previo = porEvento.get(e.evento)
    porEvento.set(e.evento, { veces: (previo?.veces ?? 0) + 1, nivel: e.nivel })
  }
  const enProduccion = process.env.NODE_ENV === 'production'
  return {
    erroresHoy: hoy.count ?? 0,
    masRepetidos24h: [...porEvento.entries()]
      .sort((a, b) => b[1].veces - a[1].veces)
      .slice(0, 6)
      .map(([evento, d]) => ({ evento, veces: d.veces, nivel: d.nivel })),
    avisosQueFallaron: fallidas.count ?? 0,
    tareasProgramadas: corridas.error
      ? 'No se pudo leer el registro de tareas programadas.'
      : enProduccion
        ? cronsAtrasados(corridas.data ?? [], new Date()).map((c) => ({
            tarea: c.etiqueta,
            ultimaCorridaBien: c.ultimaOk,
          }))
        : 'En desarrollo las tareas programadas no corren: no hay nada que revisar.',
    enlaces: { errores: '/panel/errores', avisosEnviados: '/panel/notificaciones' },
  }
}
