import 'server-only'

/**
 * Publicación de disponibilidad y tarifas hacia el canal (ARI).
 *
 * Es el llamador que le faltaba a `publicarDisponibilidad` (auditoría 2026-09,
 * P1-1). El puerto declaraba ese método desde la modernización WinPAX y **nadie
 * lo invocaba**, así que la promesa del ADR 0021 —«enchufar un channel manager es
 * configuración»— no se cumplía.
 *
 * Las reglas viven en `lib/domain/ari.ts` y se prueban sin base. Acá está lo que
 * necesita Postgres: leer ocupación, tarifas y mapeos, y dejar el rastro.
 *
 * ⚠️ **Hoy esto NO evita el overbooking, y no lo disimula.** Los dos caminos
 * disponibles sin ser Connectivity Partner —el informe CSV y el feed iCal— son de
 * solo lectura: `publicarDisponibilidad` devuelve `noSoportado` y la corrida queda
 * registrada diciendo exactamente eso. Es la diferencia entre «no puedo» y
 * «fallé», y es lo que permite que el día que el hotel contrate un channel manager
 * lo único que falte sea su adapter.
 */

import { crearClienteAdmin } from '@/lib/supabase/admin'
import { registrarFalla } from '@/lib/acciones'
import { traerTodo } from '@/lib/paginado'
import { hoyISO, sumarDias, parsearPeriodo } from '@/lib/fechas'
import { conIva } from '@/lib/domain/catalogo'
import {
  calcularAri,
  motivoNoPublicar,
  resumirAri,
  DIAS_DE_VENTANA,
  MENSAJES_NO_PUBLICAR,
  type EstadiaOcupada,
  type FilaAri,
  type MapeoTipo,
  type PrecioDelDia,
  type ResumenAri,
} from '@/lib/domain/ari'
import { obtenerProveedorCanal, type CanalVenta } from '.'

export interface ResultadoAri {
  ok: boolean
  resumen: ResumenAri
  /** Cuántas filas aceptó el canal. */
  aceptadas: number
  /**
   * `true` cuando el proveedor **no puede** publicar, en vez de haberlo intentado
   * y fallado. Ver el aviso del encabezado.
   */
  noSoportado: boolean
  /** En español, para mostrar tal cual. */
  detalle: string
}

const VACIO: ResumenAri = {
  filas: 0,
  nochesAbiertas: 0,
  nochesCerradas: 0,
  sinPrecio: 0,
  tipos: 0,
}

/**
 * Calcula el ARI de un canal y se lo publica.
 *
 * Corre con `service_role`: lo dispara un cron sin sesión, y además lee ocupación
 * de todas las unidades, que es más de lo que ve cualquier rol por RLS.
 */
export async function publicarAri(
  canal: CanalVenta = 'booking',
  opciones: { desde?: string; dias?: number; corridaPor?: string | null } = {},
): Promise<ResultadoAri> {
  const admin = crearClienteAdmin()
  const desde = opciones.desde ?? hoyISO()
  const hasta = sumarDias(desde, opciones.dias ?? DIAS_DE_VENTANA)

  const proveedor = obtenerProveedorCanal()
  const capacidades = proveedor.capacidades()

  /* ── 1. El mapeo: con qué código conoce el canal a cada tipo ── */

  const { data: mapeosData, error: eMapeos } = await admin
    .from('canal_tipos')
    .select(
      'tipo_unidad_id, codigo_canal, tope_cupo, minimo_noches, cerrado, tipo:tipos_unidad(id, activo)',
    )
    .eq('canal', canal)
    .eq('activo', true)

  if (eMapeos) {
    return {
      ok: false,
      resumen: VACIO,
      aceptadas: 0,
      noSoportado: false,
      detalle: `No se pudo leer el mapeo de tipos: ${eMapeos.message}`,
    }
  }

  const crudos = (mapeosData ?? []) as unknown as {
    tipo_unidad_id: string
    codigo_canal: string
    tope_cupo: number | null
    minimo_noches: number | null
    cerrado: boolean
  }[]

  /* ── 2. Cuántas unidades activas hay de cada tipo ── */

  const { data: unidadesData, error: eUnidades } = await admin
    .from('unidades')
    .select('id, tipo_unidad_id')
    .eq('activo', true)

  if (eUnidades) {
    return {
      ok: false,
      resumen: VACIO,
      aceptadas: 0,
      noSoportado: false,
      detalle: `No se pudieron contar las unidades: ${eUnidades.message}`,
    }
  }

  const activasPorTipo = new Map<string, number>()
  for (const u of (unidadesData ?? []) as { id: string; tipo_unidad_id: string }[]) {
    activasPorTipo.set(u.tipo_unidad_id, (activasPorTipo.get(u.tipo_unidad_id) ?? 0) + 1)
  }

  const mapeos: MapeoTipo[] = crudos.map((m) => ({
    tipoUnidadId: m.tipo_unidad_id,
    codigoCanal: m.codigo_canal,
    unidadesActivas: activasPorTipo.get(m.tipo_unidad_id) ?? 0,
    topeCupo: m.tope_cupo,
    minimoNoches: m.minimo_noches,
    cerrado: m.cerrado,
  }))

  /* ── 3. La ocupación de la ventana ── */

  /*
    Por `traerTodo`: PostgREST corta en 1000 filas con HTTP 200 y sin aviso
    (`max_rows`). Un año de estadías de un hotel de 16 unidades pasa holgadamente
    ese techo, y el efecto sería publicar como libres noches vendidas — el peor
    resultado posible de esta función.
  */
  const { filas: estadiasData, error: eEstadias } = await traerTodo<{
    unidad_id: string
    periodo: string
    unidad: { tipo_unidad_id: string } | null
  }>((d, h) =>
    /*
      `as never` sobre el builder, igual que en el punto único de exportación.

      Los tipos generados declaran todo embed como arreglo, incluso cuando la
      relación es a-uno y PostgREST devuelve un objeto. Es un desajuste conocido
      de los tipos, no del dato: la forma real en tiempo de ejecución es la que
      declara el genérico de arriba.
    */
    admin
      .from('estadias')
      .select('unidad_id, periodo, unidad:unidades(tipo_unidad_id)')
      .lt('check_in', hasta)
      .gt('check_out', desde)
      .order('check_in')
      .range(d, h) as never,
  )

  if (eEstadias) {
    return {
      ok: false,
      resumen: VACIO,
      aceptadas: 0,
      noSoportado: false,
      detalle: `No se pudo leer la ocupación: ${eEstadias}`,
    }
  }

  const estadias: EstadiaOcupada[] = []
  for (const e of estadiasData) {
    if (!e.unidad?.tipo_unidad_id) continue
    const periodo = parsearPeriodo(e.periodo)
    estadias.push({
      unidadId: e.unidad_id,
      tipoUnidadId: e.unidad.tipo_unidad_id,
      checkIn: periodo.desde,
      checkOut: periodo.hasta,
    })
  }

  /* ── 4. Los precios de cada tipo, día por día ── */

  const precios = await preciosDeLaVentana(
    admin,
    mapeos.map((m) => m.tipoUnidadId),
    desde,
    hasta,
  )

  /* ── 5. Las filas ── */

  const { filas, sinPrecio } = calcularAri(mapeos, estadias, precios, {
    // La moneda del canal: la del tarifario. Publicar en otra exigiría convertir
    // 365 días con una cotización que cambia, y el canal cobraría distinto del
    // sitio del hotel el mismo día.
    moneda: precios[0]?.moneda ?? 'USD',
    desde,
    hasta,
  })

  const resumen = resumirAri(filas, sinPrecio)

  /* ── 6. El envío ── */

  const motivo = motivoNoPublicar({
    mapeos: mapeos.length,
    publicaDisponibilidad: capacidades.publicaDisponibilidad,
    filas: filas.length,
  })

  if (motivo) {
    const detalle = MENSAJES_NO_PUBLICAR[motivo]
    await registrarCorrida(admin, canal, proveedor.nombre, resumen, 0, detalle, opciones.corridaPor)
    return {
      ok: false,
      resumen,
      aceptadas: 0,
      // Sólo «el proveedor no publica» es una limitación declarada; los otros dos
      // son cosas que el hotel puede resolver, así que no se marcan como tales.
      noSoportado: motivo === 'proveedor_no_publica',
      detalle,
    }
  }

  const envio = await proveedor.publicarDisponibilidad(filas)
  const detalle = envio.ok
    ? `Se publicaron ${envio.aceptadas} de ${filas.length} filas.`
    : (envio.error ?? 'El canal rechazó la publicación.')

  await registrarCorrida(
    admin,
    canal,
    proveedor.nombre,
    resumen,
    envio.aceptadas,
    detalle,
    opciones.corridaPor,
  )

  return {
    ok: envio.ok,
    resumen,
    aceptadas: envio.aceptadas,
    noSoportado: Boolean(envio.noSoportado),
    detalle,
  }
}

/* ─────────────────────────────────────────────────────────── precios ──── */

type ClienteAdmin = ReturnType<typeof crearClienteAdmin>

/**
 * Precio al público de cada tipo, para cada día de la ventana.
 *
 * ⚠️ Se publica el **rack con IVA**, y las dos partes de esa frase importan:
 *
 * · **Rack y no neto.** El neto es la tarifa de agencia (ADR 0004). Publicarlo en
 *   una OTA rompería la paridad tarifaria que los contratos de OTA exigen, y le
 *   regalaría al canal el margen de la comisión.
 * · **Con IVA.** `tarifas.precio_rack` se guarda sin IVA. Publicar la columna
 *   cruda anunciaría un precio más bajo del que después se cobra, que es
 *   exactamente el bug que `conIva()` existe para evitar del lado público.
 *
 * Un día sin temporada cargada simplemente no aparece en el resultado, y
 * `calcularAri` lo cuenta como `sinPrecio` en vez de publicar cero.
 */
async function preciosDeLaVentana(
  admin: ClienteAdmin,
  tipos: readonly string[],
  desde: string,
  hasta: string,
): Promise<(PrecioDelDia & { moneda: string })[]> {
  if (tipos.length === 0) return []

  const { data: rangos, error: eRangos } = await admin
    .from('temporada_rangos')
    .select('temporada_id, rango')

  if (eRangos) {
    registrarFalla(eRangos, 'leer los rangos de temporada para el ARI')
    return []
  }

  const { data: tarifas, error: eTarifas } = await admin
    .from('tarifas')
    .select('tipo_unidad_id, temporada_id, precio_rack, moneda, iva_pct')
    .in('tipo_unidad_id', [...tipos])
    .eq('vigente', true)

  if (eTarifas) {
    registrarFalla(eTarifas, 'leer las tarifas para el ARI')
    return []
  }

  const porTemporada = new Map<string, { precio: number; moneda: string }>()
  for (const t of (tarifas ?? []) as {
    tipo_unidad_id: string
    temporada_id: string
    precio_rack: number | string
    moneda: string
    iva_pct: number | string
  }[]) {
    porTemporada.set(`${t.tipo_unidad_id}|${t.temporada_id}`, {
      precio: conIva(Number(t.precio_rack), Number(t.iva_pct)),
      moneda: t.moneda,
    })
  }

  const salida: (PrecioDelDia & { moneda: string })[] = []

  for (const r of (rangos ?? []) as { temporada_id: string; rango: string }[]) {
    const periodo = parsearPeriodo(r.rango)
    // Intersección con la ventana. Los rangos de temporada son `[desde, hasta)`.
    const inicio = periodo.desde < desde ? desde : periodo.desde
    const fin = periodo.hasta > hasta ? hasta : periodo.hasta
    if (inicio >= fin) continue

    for (const tipo of tipos) {
      const tarifa = porTemporada.get(`${tipo}|${r.temporada_id}`)
      if (!tarifa) continue

      for (let f = inicio; f < fin; f = sumarDias(f, 1)) {
        salida.push({ tipoUnidadId: tipo, fecha: f, precio: tarifa.precio, moneda: tarifa.moneda })
      }
    }
  }

  return salida
}

/* ──────────────────────────────────────────────────────────── rastro ──── */

/**
 * Deja la corrida en `canal_sincronizaciones` con `sentido = 'salida'`.
 *
 * Que quede registrada **aunque no se haya publicado nada** es el punto: sin eso,
 * «el canal no se está actualizando» no se distingue de «nadie corrió el proceso»,
 * y son dos problemas con soluciones distintas.
 */
async function registrarCorrida(
  admin: ClienteAdmin,
  canal: string,
  proveedor: string,
  resumen: ResumenAri,
  aceptadas: number,
  detalle: string,
  corridaPor: string | null | undefined,
): Promise<void> {
  const { error } = await admin.from('canal_sincronizaciones').insert({
    canal,
    proveedor,
    sentido: 'salida',
    origen: 'ari',
    // La equivalencia de los contadores en salida está escrita en la 0081.
    leidas: resumen.filas,
    actualizadas: aceptadas,
    rechazadas: resumen.sinPrecio,
    detalle: detalle.slice(0, 500),
    corrida_por: corridaPor ?? null,
  })

  // No corta: el ARI ya se publicó (o ya se supo que no se podía). Perder el
  // rastro es malo, pero deshacer una publicación al canal no es posible.
  registrarFalla(error, `registrar la corrida de ARI de ${canal}`)
}

export type { FilaAri }
