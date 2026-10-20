import { obtenerSesion } from '@/lib/auth/session'
import { puedeAcceder, type Area } from '@/lib/domain/permisos'
import { crearClienteServidor } from '@/lib/supabase/server'
import { aCsv, decimal, respuestaCsv, type Columna } from '@/lib/csv'
import { traerTodo } from '@/lib/paginado'
import { registrarAviso, registrarError } from '@/lib/registro'
import { terminoBusqueda } from '@/lib/listados'
import {
  parsearPeriodo,
  mesActual,
  hoyISO,
  fechaDelHotel,
  inicioDelDiaHotel,
  inicioFinDeMes,
} from '@/lib/fechas'
import { metricasDeMes, ultimosMeses, type MetricasMes } from '@/lib/domain/metricas'
import { mesValido } from '@/lib/domain/informes'
import { deLista } from '@/lib/domain/listas'
import {
  filasLibroVentas,
  type FacturaLibro,
  type FilaLibroVentas,
  type NotaCreditoLibro,
} from '@/lib/domain/libro-ventas'
import { ETIQUETAS_ESTADO_RESERVA, type EstadoReserva } from '@/lib/domain/reservas'
import { nombreCompleto } from '@/lib/domain/huespedes'
import { resumenDeCuenta, type EstadoPago, type TipoPago } from '@/lib/domain/pagos'
import { totalConsumos } from '@/lib/domain/consumos'
import { esVista, type VistaReservas } from '@/lib/domain/vistas-reservas'
import {
  ETIQUETAS_GARANTIA,
  ETIQUETAS_PLAN,
  ETIQUETAS_SEGMENTO,
  type Garantia,
  type Plan,
  type Segmento,
} from '@/lib/domain/reservas'
import { esNotaDeCredito, nombreDeComprobante, numeroVisible } from '@/lib/domain/comprobante-qr'
import { consultaReservas, filtroTermino } from '../../reservas/consulta'
import { traerEstadias, traerUnidades } from '../../reportes/datos'
import { busquedaHuespedes, busquedaOrdenes, busquedaProveedores, contiene } from '../busquedas'
import {
  CATEGORIAS_GASTO,
  ETIQUETAS_CATEGORIA_GASTO,
  type CategoriaGasto,
} from '@/lib/domain/gastos'

/**
 * Punto único de exportación a CSV del panel.
 *
 * Concentrar todas las descargas en un solo handler permite auditar en un
 * único lugar que cada recurso exige el permiso del área correspondiente: una
 * mucama no puede bajarse la base de huéspedes cambiando la URL a mano.
 */

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>

/**
 * Lo que los filtros de exportación usan de una consulta de supabase-js.
 *
 * Es una vista angosta a propósito: el tipo completo del builder depende del
 * `select` y TypeScript no puede seguirlo cuando la tabla llega como texto.
 */
interface Consulta {
  or(filtros: string): Consulta
  ilike(columna: string, patron: string): Consulta
  eq(columna: string, valor: string): Consulta
  is(columna: string, valor: null): Consulta
}

/**
 * Tope de filas por archivo, para no tumbar el servidor con una descarga.
 *
 * ⚠️ `.limit(MAX_FILAS)` **no alcanzaba** para traer esta cantidad: PostgREST
 * aplica su propio techo (`max_rows = 1000` en supabase/config.toml) y recorta
 * la respuesta sin error y sin aviso. Todas las exportaciones venían saliendo
 * con mil filas, y quien descargaba el archivo no tenía cómo notarlo.
 *
 * Por eso las consultas van por `traerTodo`, que pagina en tramos de mil hasta
 * completar, y avisa si igual quedó truncado.
 */
const MAX_FILAS = 5000

/**
 * La base no respondió, o cortó a mitad de camino.
 *
 * Se lanza en vez de devolver lo que se alcanzó a leer: un CSV con sólo el
 * encabezado no se ve como un error, se ve como «no hay datos», y uno a medias
 * se ve como uno más corto. Las dos cosas terminan en una decisión tomada con
 * datos que faltan. `GET` la convierte en un 500 con un mensaje en español.
 */
class FallaDeLectura extends Error {
  constructor(
    readonly recurso: string,
    readonly detalle: string,
  ) {
    super(`No se pudo leer ${recurso}: ${detalle}`)
  }
}

interface Archivo {
  contenido: string
  /** Se llegó a `MAX_FILAS` y quedaron filas afuera: el nombre del archivo lo dice. */
  truncado: boolean
}

interface Definicion {
  area: Area
  archivo: string
  generar: (supabase: Cliente, params: URLSearchParams) => Promise<Archivo>
}

/** Lee una consulta entera; corta con `FallaDeLectura` si la base falla. */
async function leerTodo<T>(
  recurso: string,
  armar: (
    desde: number,
    hasta: number,
  ) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<{ filas: T[]; truncado: boolean }> {
  const { filas, truncado, error } = await traerTodo<T>(armar, MAX_FILAS)
  if (error) throw new FallaDeLectura(recurso, error)
  if (truncado) {
    // Además del nombre del archivo, queda en `errores`: hace falta subir el
    // tope o agregar un filtro a la pantalla.
    await registrarAviso('exportacion_truncada', { recurso, techo: MAX_FILAS })
  }
  return { filas, truncado }
}

/**
 * Construye un generador simple: una consulta, sus filtros y sus columnas.
 *
 * El orden siempre termina en `id`: `traerTodo` lee por tramos, y con un orden
 * que admite empates (dos huéspedes con el mismo apellido, dos gastos del mismo
 * día) Postgres puede repetir una fila en dos tramos y saltear otra.
 */
function simple<T>(
  tabla: string,
  select: string,
  orden: { columna: string; descendente?: boolean },
  columnas: Columna<T>[],
  filtrar?: (consulta: Consulta, params: URLSearchParams) => Consulta,
): (supabase: Cliente, params: URLSearchParams) => Promise<Archivo> {
  return async (supabase, params) => {
    const { filas, truncado } = await leerTodo<T>(tabla, (desde, hasta) => {
      const base = supabase.from(tabla).select(select)
      const consulta = (
        filtrar ? filtrar(base as unknown as Consulta, params) : base
      ) as typeof base
      return consulta
        .order(orden.columna, { ascending: !orden.descendente })
        .order('id')
        .range(desde, hasta) as never
    })
    return { contenido: aCsv(filas, columnas), truncado }
  }
}

/** El término de búsqueda de la URL, limpio como lo usa la pantalla. */
function termino(params: URLSearchParams): string | null {
  return terminoBusqueda(params.get('q') ?? undefined)
}

const SI_NO = (v: boolean) => (v ? 'Sí' : 'No')

interface FilaReserva {
  codigo: string
  estado: EstadoReserva
  total: number | string
  canal: string
  creada_en: string
  huesped: { apellido: string; nombre: string; email: string | null } | null
  estadias: { periodo: string }[]
  /** Para el saldo. Llega del `SELECT_RESERVAS` compartido con la pantalla. */
  pagos: { tipo: TipoPago; monto: number | string; estado: EstadoPago }[]
  /** Para el saldo contra la cuenta consolidada, igual que la pantalla. */
  consumos: { cantidad: number; precio_unitario: number | string }[] | null
  /* Desglose comercial y fiscal (paso 6). */
  plan: string
  garantia: string
  segmento: string
  total_neto: number | string
  iva: number | string
}

/** Consumos de una fila, en la forma del dominio. */
function consumosDe(r: FilaReserva) {
  return (r.consumos ?? []).map((c) => ({ cantidad: c.cantidad, precioUnitario: Number(c.precio_unitario) }))
}

/** Saldo de una fila, con el mismo cálculo que usa la pantalla. */
function saldoDe(r: FilaReserva) {
  return resumenDeCuenta(
    Number(r.total),
    consumosDe(r),
    (r.pagos ?? []).map((p) => ({ tipo: p.tipo, monto: Number(p.monto), estado: p.estado })),
  )
}

const RECURSOS: Record<string, Definicion> = {
  reservas: {
    area: 'reservas',
    archivo: 'reservas',
    generar: async (supabase, params) => {
      const q = params.get('q') ?? undefined
      const orTermino = await filtroTermino(supabase, q)
      const consulta = consultaReservas(
        supabase,
        {
          q,
          estado: params.get('estado') ?? undefined,
          canal: params.get('canal') ?? undefined,
          desde: params.get('desde') ?? undefined,
          hasta: params.get('hasta') ?? undefined,
          grupo: params.get('grupo') ?? undefined,
          // La vista tiene que viajar o el CSV bajaría todas las reservas
          // mientras la pantalla muestra sólo las llegadas de hoy. El botón de
          // exportar ya conserva los filtros vigentes en la URL.
          vista: esVista(params.get('vista') ?? undefined)
            ? (params.get('vista') as VistaReservas)
            : undefined,
          plan: params.get('plan') ?? undefined,
          garantia: params.get('garantia') ?? undefined,
          segmento: params.get('segmento') ?? undefined,
          contrato: params.get('contrato') ?? undefined,
          unidad: params.get('unidad') ?? undefined,
          tipoUnidad: params.get('tipo') ?? undefined,
          hoy: hoyISO(),
        },
        orTermino,
      )
      const { filas, truncado } = await leerTodo<FilaReserva>(
        'reservas',
        (desde, hasta) => consulta.range(desde, hasta) as never,
      )

      const contenido = aCsv<FilaReserva>(filas, [
        { titulo: 'Código', valor: (r) => r.codigo },
        {
          titulo: 'Huésped',
          valor: (r) => (r.huesped ? nombreCompleto(r.huesped) : ''),
        },
        { titulo: 'Email', valor: (r) => r.huesped?.email ?? '' },
        {
          titulo: 'Check-in',
          valor: (r) => (r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo).desde : ''),
        },
        {
          titulo: 'Check-out',
          valor: (r) => (r.estadias?.[0] ? parsearPeriodo(r.estadias[0].periodo).hasta : ''),
        },
        { titulo: 'Canal', valor: (r) => r.canal },
        { titulo: 'Estado', valor: (r) => ETIQUETAS_ESTADO_RESERVA[r.estado] ?? r.estado },
        { titulo: 'Plan', valor: (r) => ETIQUETAS_PLAN[r.plan as Plan] ?? r.plan ?? '' },
        {
          titulo: 'Garantía',
          valor: (r) => ETIQUETAS_GARANTIA[r.garantia as Garantia] ?? r.garantia ?? '',
        },
        {
          titulo: 'Segmento',
          valor: (r) => ETIQUETAS_SEGMENTO[r.segmento as Segmento] ?? r.segmento ?? '',
        },
        // Neto e IVA discriminados: es lo que administración necesita para
        // conciliar, y antes del paso 6 no se podía sacar del total.
        { titulo: 'Neto sin IVA USD', valor: (r) => decimal(r.total_neto) },
        { titulo: 'IVA USD', valor: (r) => decimal(r.iva) },
        { titulo: 'Total con IVA USD', valor: (r) => decimal(r.total) },
        // Consumos, pagado y saldo salen de `resumenDeCuenta`, el mismo cálculo
        // que muestra la pantalla: el CSV y el listado no pueden decir cosas
        // distintas. El saldo se mide contra alojamiento + consumos, así que
        // los consumos van en su propia columna para que la cuenta cierre a mano.
        {
          titulo: 'Consumos USD',
          valor: (r) => decimal(totalConsumos(consumosDe(r))),
        },
        {
          titulo: 'Pagado USD',
          valor: (r) => decimal(saldoDe(r).pagado),
        },
        {
          titulo: 'Saldo USD',
          valor: (r) => decimal(saldoDe(r).saldo),
        },
        // El día del hotel: cortar el `timestamptz` daba el día siguiente a la noche.
        { titulo: 'Creada', valor: (r) => (r.creada_en ? fechaDelHotel(r.creada_en) : '') },
      ])
      return { contenido, truncado }
    },
  },

  reportes: {
    area: 'reportes',
    archivo: 'metricas-mensuales',
    generar: async (_supabase, params) => {
      const mes = mesValido(params.get('mes') ?? undefined, mesActual())
      // Las mismas lecturas que la pantalla de informes (`reportes/datos.ts`):
      // paginadas por encima de las 1000 filas. La versión anterior leía las
      // estadías con una consulta pelada, así que desde la estadía 1001 el
      // archivo traía ocupación e ingresos más bajos que la pantalla.
      const [unidades, estadias] = await Promise.all([traerUnidades(), traerEstadias()])
      if (unidades.error) throw new FallaDeLectura('unidades', unidades.error)
      if (estadias.error) throw new FallaDeLectura('estadias', estadias.error)

      // Un año móvil terminando en el mes consultado.
      const serie = ultimosMeses(mes, 12).map((m) =>
        metricasDeMes(estadias.filas, m, unidades.filas.length),
      )

      const contenido = aCsv<MetricasMes>(serie, [
        { titulo: 'Mes', valor: (m) => m.mes },
        { titulo: 'Noches vendidas', valor: (m) => m.nochesVendidas },
        { titulo: 'Noches disponibles', valor: (m) => m.nochesDisponibles },
        { titulo: 'Ocupación %', valor: (m) => decimal(m.ocupacionPct, 1) },
        { titulo: 'Ingreso alojamiento USD', valor: (m) => decimal(m.ingreso) },
        { titulo: 'ADR USD', valor: (m) => decimal(m.adr) },
        { titulo: 'RevPAR USD', valor: (m) => decimal(m.revpar) },
      ])
      return { contenido, truncado: unidades.truncado || estadias.truncado }
    },
  },

  /*
    Libro de ventas: facturas y notas de crédito del mes, para el contador.

    Las notas de crédito van en el mismo archivo y en negativo
    (`lib/domain/libro-ventas.ts`): la suma de la columna «Total» es lo que el
    hotel vendió de verdad en el mes.
  */
  facturas: {
    area: 'reportes',
    archivo: 'libro-ventas',
    generar: async (supabase, params) => {
      const mes = mesValido(params.get('mes') ?? undefined, mesActual())
      const { inicio, fin } = inicioFinDeMes(mes)
      // Los límites del mes en la zona del hotel, no en UTC.
      const desde = inicioDelDiaHotel(inicio)
      const hasta = inicioDelDiaHotel(fin)
      const RESERVA =
        'reserva:reservas(codigo, huesped:huespedes!reservas_huesped_id_fkey(nombre, apellido))'
      const FISCALES =
        'numero, numero_fiscal, tipo_comprobante, punto_venta, emitida_en, neto, iva, exento, alicuota_iva, total, moneda, cae, cae_vto'

      const [facturas, notas] = await Promise.all([
        leerTodo<FacturaLibro>(
          'facturas',
          (d, h) =>
            supabase
              .from('facturas')
              .select(
                `${FISCALES}, cuit_receptor, condicion_iva_receptor, motivo_exencion, ${RESERVA}`,
              )
              .gte('emitida_en', desde)
              .lt('emitida_en', hasta)
              .order('emitida_en')
              .order('id')
              .range(d, h) as never,
        ),
        leerTodo<NotaCreditoLibro>(
          'notas_credito',
          (d, h) =>
            supabase
              .from('notas_credito')
              .select(
                `${FISCALES}, motivo, factura:facturas(numero, numero_fiscal, cuit_receptor, condicion_iva_receptor, ${RESERVA})`,
              )
              .gte('emitida_en', desde)
              .lt('emitida_en', hasta)
              .order('emitida_en')
              .order('id')
              .range(d, h) as never,
        ),
      ])

      const filas = filasLibroVentas(facturas.filas, notas.filas)
      const contenido = aCsv<FilaLibroVentas>(filas, [
        { titulo: 'Fecha', valor: (f) => f.fecha },
        { titulo: 'Comprobante', valor: (f) => f.comprobante },
        { titulo: 'Letra', valor: (f) => f.letra },
        { titulo: 'Punto de venta', valor: (f) => f.puntoVenta },
        { titulo: 'Número', valor: (f) => f.numero },
        { titulo: 'CAE', valor: (f) => f.cae },
        { titulo: 'Vto. CAE', valor: (f) => f.vencimientoCae },
        { titulo: 'Reserva', valor: (f) => f.reserva },
        { titulo: 'Cliente', valor: (f) => f.cliente },
        { titulo: 'CUIT', valor: (f) => f.cuit },
        { titulo: 'Condición IVA', valor: (f) => f.condicionIva },
        { titulo: 'Moneda', valor: (f) => f.moneda },
        { titulo: 'Neto gravado', valor: (f) => decimal(f.netoGravado) },
        { titulo: 'Exento', valor: (f) => decimal(f.exento) },
        { titulo: 'Alícuota IVA %', valor: (f) => decimal(f.alicuota) },
        { titulo: 'IVA', valor: (f) => decimal(f.iva) },
        { titulo: 'Total', valor: (f) => decimal(f.total) },
        { titulo: 'Corrige a', valor: (f) => f.referencia },
        { titulo: 'Observaciones', valor: (f) => f.observaciones },
      ])
      return { contenido, truncado: facturas.truncado || notas.truncado }
    },
  },

  huespedes: {
    area: 'huespedes',
    archivo: 'huespedes',
    generar: simple<{
      apellido: string
      nombre: string
      doc_tipo: string | null
      doc_numero: string
      email: string | null
      telefono: string | null
      nacionalidad: string | null
      puntos: number | null
    }>(
      'huespedes',
      'apellido, nombre, doc_tipo, doc_numero, email, telefono, nacionalidad, puntos',
      { columna: 'apellido' },
      [
        { titulo: 'Apellido', valor: (h) => h.apellido },
        { titulo: 'Nombre', valor: (h) => h.nombre },
        { titulo: 'Tipo doc.', valor: (h) => h.doc_tipo ?? '' },
        { titulo: 'Documento', valor: (h) => h.doc_numero },
        { titulo: 'Email', valor: (h) => h.email ?? '' },
        { titulo: 'Teléfono', valor: (h) => h.telefono ?? '' },
        { titulo: 'Nacionalidad', valor: (h) => h.nacionalidad ?? '' },
        { titulo: 'Puntos', valor: (h) => h.puntos ?? 0 },
      ],
      (c, p) => {
        const t = termino(p)
        return t ? c.or(busquedaHuespedes(t)) : c
      },
    ),
  },

  agencias: {
    area: 'agencias',
    archivo: 'agencias',
    generar: simple<{
      nombre: string
      tipo: string
      cuit: string | null
      email: string | null
      descuento_pct: number
      activo: boolean
    }>(
      'agencias',
      'nombre, tipo, cuit, email, descuento_pct, activo',
      { columna: 'nombre' },
      [
        { titulo: 'Nombre', valor: (a) => a.nombre },
        { titulo: 'Tipo', valor: (a) => a.tipo },
        { titulo: 'CUIT', valor: (a) => a.cuit ?? '' },
        { titulo: 'Email', valor: (a) => a.email ?? '' },
        { titulo: 'Descuento %', valor: (a) => decimal(a.descuento_pct) },
        { titulo: 'Activa', valor: (a) => SI_NO(a.activo) },
      ],
      (c, p) => {
        const t = termino(p)
        return t ? c.ilike('nombre', contiene(t)) : c
      },
    ),
  },

  gastos: {
    area: 'conciliacion',
    archivo: 'gastos-operativos',
    generar: simple<{
      fecha: string
      categoria: string
      descripcion: string
      monto: number | string
      moneda: string
    }>(
      'gastos_operativos',
      'fecha, categoria, descripcion, monto, moneda',
      { columna: 'fecha', descendente: true },
      [
        { titulo: 'Fecha', valor: (g) => g.fecha },
        {
          titulo: 'Categoría',
          valor: (g) => ETIQUETAS_CATEGORIA_GASTO[g.categoria as CategoriaGasto] ?? g.categoria,
        },
        { titulo: 'Descripción', valor: (g) => g.descripcion },
        { titulo: 'Monto', valor: (g) => decimal(g.monto) },
        { titulo: 'Moneda', valor: (g) => g.moneda },
      ],
      (c, p) => {
        // Los mismos filtros que la pantalla: categoría y búsqueda en la descripción.
        const categoria = deLista(CATEGORIAS_GASTO, p.get('categoria'))
        const t = termino(p)
        let filtrada = categoria ? c.eq('categoria', categoria) : c
        if (t) filtrada = filtrada.ilike('descripcion', contiene(t))
        return filtrada
      },
    ),
  },

  proveedores: {
    area: 'proveedores',
    archivo: 'proveedores',
    generar: simple<{
      nombre: string
      rubro: string | null
      cuit: string | null
      email: string | null
      telefono: string | null
      activo: boolean
    }>(
      'proveedores',
      'nombre, rubro, cuit, email, telefono, activo',
      { columna: 'nombre' },
      [
        { titulo: 'Nombre', valor: (p) => p.nombre },
        { titulo: 'Rubro', valor: (p) => p.rubro ?? '' },
        { titulo: 'CUIT', valor: (p) => p.cuit ?? '' },
        { titulo: 'Email', valor: (p) => p.email ?? '' },
        { titulo: 'Teléfono', valor: (p) => p.telefono ?? '' },
        { titulo: 'Activo', valor: (p) => SI_NO(p.activo) },
      ],
      (c, p) => {
        const t = termino(p)
        return t ? c.or(busquedaProveedores(t)) : c
      },
    ),
  },

  /*
    Comprobantes recibidos — la segunda mitad del objetivo 9.

    «Que se le saque una foto a una factura y que se carguen los datos de esa
    factura a un excel»: la foto la resuelve el escaneo del QR, y el «excel» es
    esto. Se baja como CSV con `;`, que es lo que Excel en es-AR abre en columnas
    sin preguntar nada.

    Las columnas son las que sirven para conciliar contra el papel y para pasarle
    el archivo al contador: identidad fiscal completa, importe con su moneda, y de
    dónde salieron los datos —un número tipeado puede estar mal y uno del QR no—.
  */
  comprobantes: {
    area: 'proveedores',
    archivo: 'comprobantes-recibidos',
    generar: simple<{
      fecha: string
      tipo_codigo: number
      letra: string | null
      punto_venta: number
      numero: number
      cuit_emisor: string
      razon_social: string | null
      total: number | string
      moneda: string
      cae: string
      origen_dato: string
      movimiento_id: string | null
      proveedor: { nombre: string } | null
    }>(
      'comprobantes_recibidos',
      'fecha, tipo_codigo, letra, punto_venta, numero, cuit_emisor, razon_social, total, moneda, cae, origen_dato, movimiento_id, proveedor:proveedores(nombre)',
      { columna: 'fecha', descendente: true },
      [
        { titulo: 'Fecha', valor: (c) => c.fecha },
        { titulo: 'Comprobante', valor: (c) => nombreDeComprobante(c.tipo_codigo) },
        { titulo: 'Letra', valor: (c) => c.letra ?? '' },
        { titulo: 'Número', valor: (c) => numeroVisible(c.punto_venta, c.numero) },
        { titulo: 'CUIT emisor', valor: (c) => c.cuit_emisor },
        { titulo: 'Razón social', valor: (c) => c.razon_social ?? c.proveedor?.nombre ?? '' },
        { titulo: 'Moneda', valor: (c) => c.moneda },
        // Sin comillas ni símbolo: Excel lo tiene que poder sumar.
        { titulo: 'Total', valor: (c) => decimal(c.total) },
        // El signo contable, resuelto acá: una nota de crédito devuelve plata.
        { titulo: 'Signo', valor: (c) => (esNotaDeCredito(c.tipo_codigo) ? 'Haber' : 'Debe') },
        { titulo: 'CAE', valor: (c) => c.cae },
        { titulo: 'Origen del dato', valor: (c) => (c.origen_dato === 'qr' ? 'QR' : 'Manual') },
        { titulo: 'Imputado', valor: (c) => SI_NO(c.movimiento_id !== null) },
        { titulo: 'Proveedor', valor: (c) => c.proveedor?.nombre ?? '' },
      ],
      (c, p) => {
        // Los mismos filtros que la pantalla: la vista «sin imputar» y la búsqueda.
        let filtrada = p.get('vista') === 'sin_imputar' ? c.is('movimiento_id', null) : c
        const t = termino(p)
        if (t) filtrada = filtrada.ilike('razon_social', contiene(t))
        return filtrada
      },
    ),
  },

  mantenimiento: {
    area: 'mantenimiento',
    archivo: 'ordenes-mantenimiento',
    generar: simple<{
      titulo: string
      descripcion: string | null
      prioridad: string
      estado: string
      creada_en: string
      unidad: { nombre: string } | null
    }>(
      'ordenes_mantenimiento',
      'titulo, descripcion, prioridad, estado, creada_en, unidad:unidades(nombre)',
      { columna: 'creada_en', descendente: true },
      [
        { titulo: 'Unidad', valor: (o) => o.unidad?.nombre ?? '' },
        { titulo: 'Título', valor: (o) => o.titulo },
        { titulo: 'Descripción', valor: (o) => o.descripcion ?? '' },
        { titulo: 'Prioridad', valor: (o) => o.prioridad },
        { titulo: 'Estado', valor: (o) => o.estado },
        { titulo: 'Creada', valor: (o) => (o.creada_en ? fechaDelHotel(o.creada_en) : '') },
      ],
      (c, p) => {
        // Los mismos filtros que la pantalla: estado, prioridad y búsqueda.
        const estado = deLista(['pendiente', 'en_proceso', 'resuelta'] as const, p.get('estado'))
        const prioridad = deLista(['baja', 'media', 'alta'] as const, p.get('prioridad'))
        let filtrada = estado ? c.eq('estado', estado) : c
        if (prioridad) filtrada = filtrada.eq('prioridad', prioridad)
        const t = termino(p)
        if (t) filtrada = filtrada.or(busquedaOrdenes(t))
        return filtrada
      },
    ),
  },

  'objetos-perdidos': {
    area: 'objetos_perdidos',
    archivo: 'objetos-perdidos',
    generar: simple<{
      descripcion: string
      ubicacion: string | null
      fecha_hallazgo: string
      estado: string
    }>(
      'objetos_perdidos',
      'descripcion, ubicacion, fecha_hallazgo, estado',
      { columna: 'fecha_hallazgo', descendente: true },
      [
        { titulo: 'Descripción', valor: (o) => o.descripcion },
        { titulo: 'Ubicación', valor: (o) => o.ubicacion ?? '' },
        { titulo: 'Hallazgo', valor: (o) => o.fecha_hallazgo },
        { titulo: 'Estado', valor: (o) => o.estado },
      ],
    ),
  },

  'lista-compras': {
    area: 'servicio',
    archivo: 'lista-compras',
    generar: simple<{
      nombre: string
      cantidad: string
      precio_estimado: number | string | null
      comprado: boolean
      nota: string
    }>(
      'lista_compras_cocina',
      'nombre, cantidad, precio_estimado, comprado, nota',
      { columna: 'nombre' },
      [
        { titulo: 'Artículo', valor: (i) => i.nombre },
        { titulo: 'Cantidad', valor: (i) => i.cantidad },
        {
          titulo: 'Precio estimado ARS',
          valor: (i) => decimal(i.precio_estimado),
        },
        { titulo: 'Comprado', valor: (i) => SI_NO(i.comprado) },
        { titulo: 'Nota', valor: (i) => i.nota },
      ],
    ),
  },
}

/**
 * Lo que ve quien apretó «Exportar» si la base no respondió: una página que lo
 * dice, en vez de un archivo vacío que parece «no hay datos».
 */
const PAGINA_DE_ERROR = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>No se pudo generar el archivo</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; color: #1c1917">
<h1 style="font-size: 1.25rem">No se pudo generar el archivo</h1>
<p>La base de datos no respondió y el archivo habría salido incompleto, así que no se descargó nada.</p>
<p>Volvé a la pantalla anterior y probá de nuevo en un momento. Si sigue pasando, avisá a administración: el detalle quedó registrado en «Errores del sistema».</p>
<p><a href="/panel">Volver al panel</a></p>
</body></html>`

export async function GET(peticion: Request, { params }: { params: Promise<{ recurso: string }> }) {
  const { recurso } = await params
  const definicion = RECURSOS[recurso]
  if (!definicion) return new Response('Recurso desconocido', { status: 404 })

  const sesion = await obtenerSesion()
  if (!sesion) return new Response('Sesión requerida', { status: 401 })
  if (!puedeAcceder(sesion.rol, definicion.area)) {
    return new Response('Sin permiso sobre esta sección', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const parametros = new URL(peticion.url).searchParams

  let archivo: Archivo
  try {
    archivo = await definicion.generar(supabase, parametros)
  } catch (e) {
    await registrarError('exportacion_fallida', {
      recurso,
      detalle: e instanceof FallaDeLectura ? e.detalle : e instanceof Error ? e.message : String(e),
    })
    return new Response(PAGINA_DE_ERROR, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // La fecha del archivo es la del hotel, igual que la de los datos que lleva
  // adentro: en UTC, un export bajado a las 21:30 salía fechado mañana. El mes,
  // cuando el archivo es de un mes; y si quedó cortado, el nombre lo dice.
  const mes = parametros.get('mes')
  const sufijo =
    recurso === 'facturas' || recurso === 'reportes'
      ? mesValido(mes ?? undefined, mesActual())
      : hoyISO()
  const nombre = `${definicion.archivo}-${sufijo}${archivo.truncado ? '-INCOMPLETO' : ''}.csv`
  return respuestaCsv(archivo.contenido, nombre)
}
